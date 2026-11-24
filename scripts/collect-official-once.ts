import { appendFile } from "node:fs/promises";
import { logError } from "@aihot/backend/lib/log-error";
import { closeDb, sql } from "@aihot/backend/db";
import { extractArticleBody } from "@aihot/backend/content/extract";
import { recordRun, stopBoss } from "@aihot/backend/jobs/queue";
import { installModules } from "@aihot/backend/modules";
import { collectSource } from "@aihot/backend/sources/collect";
import { SERVER_MODULES } from "@aihot/site/modules/server";
import { watchOfficialPage, WATCHES } from "../modules/official-watch/watch.ts";

if (!process.env.DATABASE_URL || process.env.COLLECT_ENABLED !== "true" || process.env.MODEL_CALLS_ENABLED !== "false") {
  throw new Error("Set DATABASE_URL, COLLECT_ENABLED=true and MODEL_CALLS_ENABLED=false for the official collection job");
}
installModules(SERVER_MODULES);

async function collect() {
  const retryFailed = process.argv.includes("--retry-failed");
  const [started] = await sql<{ at: Date }[]>`SELECT now() AS at`;
  const sources = await sql<{ id: string; kind: string }[]>`
    SELECT id, kind FROM sources WHERE enabled AND id LIKE 'au-%'
      AND (${!retryFailed} OR health IN ('degraded', 'failing'))
      AND (kind IN ('rss', 'web_list', 'json_list') OR (kind='external' AND id=ANY(${Object.keys(WATCHES)}::text[])))
    ORDER BY id
  `;
  if (!sources.length && !retryFailed) throw new Error("No enabled Australian official sources were found");

  const results = [];
  const fetchSource = async (source: typeof sources[number]) => {
    const result = source.kind === "external" ? await watchOfficialPage(source.id) : await collectSource(source.id);
    console.log(JSON.stringify({ sourceId: source.id, status: result.status, created: "created" in result ? Number(result.created) : 0 }));
    return result;
  };
  for (const source of sources) {
    results.push(await fetchSource(source));
  }
  for (const [i, result] of results.entries()) {
    if (result.status === "failed" && /timeout|timed out|HTTP 429/i.test(result.error ?? "")) {
      results[i] = await fetchSource(sources[i]!);
    }
  }

  const materials = await sql<{ id: string }[]>`
    SELECT id FROM articles WHERE source_id=ANY(${sources.map(s => s.id)}::text[])
      AND created_at>=${started!.at} AND body_status='pending'
    ORDER BY created_at, id
  `;
  const bodies = { ok: 0, unconfirmed: 0, skipped: 0, failed: 0 };
  for (const material of materials) {
    try { bodies[await extractArticleBody(material.id)]++; }
    catch (error) {
      bodies.failed++;
      console.error("Body extraction failed", material.id, logError(error));
    }
  }
  return { results, bodies };
}

try {
  const { results, bodies } = await recordRun("cloud.official-collection", collect);
  const successful = results.filter(result => result.status === "ok").length;
  const summary = `官方信源采集 ${successful}/${results.length} 成功。正文提取 ${bodies.ok} 成功、${bodies.unconfirmed} 待核实、${bodies.failed} 失败。\n`;
  console.log(summary.trim());
  if (process.env.GITHUB_STEP_SUMMARY) {
    const findings = results.map(result => `- \`${result.sourceId}\` ${result.status}`).join("\n");
    await appendFile(process.env.GITHUB_STEP_SUMMARY, summary + "\n" + findings + "\n");
  }
  if (successful !== results.length || bodies.failed) process.exitCode = 1;
} finally {
  await stopBoss();
  await closeDb();
}
