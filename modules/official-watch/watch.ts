import { sql } from "@aihot/backend/db";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { queueProcessing } from "@aihot/backend/jobs/content";
import { runOwner } from "@aihot/backend/jobs/runs";
import { jinaRead } from "@aihot/backend/providers/jina";
import { guardedFetch, requireOk } from "@aihot/backend/lib/http-fetch";
import { contentDocument } from "@aihot/backend/lib/page-content";
import { sha256 } from "@aihot/backend/lib/ids";
import {
  ACT_INVITATION_RANKINGS, STUDENT_PROCESSING_PRIORITIES, VISA_PRICING,
  readActRankingDocument, readStudentPriorityRules, readVisaPriceRows,
  type EnrichedWatch, type WatchEvidence,
} from "./government-snapshots.ts";
import {
  australianWatchTransport, CRICOS_PRIMARY, EMPLOYER_SALARIES, NSW_SKILLS_LISTS, PROVIDER_PRIORITIES, SKILLED_PROCESSING_PRIORITIES,
  TRA_FEES, TRAINING_REGISTER_RTO, VICTORIAN_POINTS_TEST, readCricosRecords, readEmployerSalaries, readNswSkillsLists,
  readProviderPriorities, readSkilledPriorityRules, readTraFeesSnapshot, readTrainingRegisterSnapshot, readVictorianPointsTest,
} from "./approved-pages.ts";

type WatchSpec = { url: string } & (
  | { read: () => Promise<EnrichedWatch & { title: string }>; transport: "public-json" | "direct-https" | "regional-https"; }
  | { selector: string; direct?: true; english?: true; enrich?: (html: string, pageText: string) => EnrichedWatch | Promise<EnrichedWatch>; }
);

// These official pages amend their existing text rather than publishing dated news entries.
export const WATCHES: Record<string, WatchSpec> = {
  "au-act-invitation-rankings": { url: ACT_INVITATION_RANKINGS, selector: "#main", enrich: readActRankingDocument },
  "au-visa-fees": { url: VISA_PRICING, selector: "main", direct: true, english: true, enrich: readVisaPriceRows },
  "au-student-visa-priorities": { url: STUDENT_PROCESSING_PRIORITIES, selector: "main", direct: true, english: true, enrich: readStudentPriorityRules },
  "au-act-news": { url: "https://www.act.gov.au/migration", selector: "#main" },
  "au-omara-notices": { url: "https://www.mara.gov.au/notices-and-reports/news-and-notices/notices", selector: "main .ms-rtestate-field", direct: true },
  "au-nt-dama": { url: "https://dtbar.nt.gov.au/workforce-population/northern-territory-designated-area-migration-agreement/important-update-on-the-nt-dama-program", selector: "#main-content > div[id^='component_']" },
  "au-tas-roi": { url: "https://www.migration.tas.gov.au/news/important-update-roi-system-currently-offline", selector: "main" },
  "au-tas-rounds": { url: "https://www.migration.tas.gov.au/news/processing_times_and_allocation_usage", selector: "main" },
  "au-nsw-skilled": { url: "https://www.nsw.gov.au/visas-and-migration/skilled-visas", selector: "main", direct: true },
  "au-education-provider-priorities": { url: PROVIDER_PRIORITIES, read: readProviderPriorities, transport: australianWatchTransport },
  "au-employer-salary-thresholds": { url: EMPLOYER_SALARIES, selector: "main", direct: true, english: true, enrich: readEmployerSalaries },
  "au-vic-points-test": { url: VICTORIAN_POINTS_TEST, selector: "main", enrich: readVictorianPointsTest },
  "au-skilled-visa-priorities": { url: SKILLED_PROCESSING_PRIORITIES, selector: "main", direct: true, english: true, enrich: readSkilledPriorityRules },
  "au-nsw-skills-lists": { url: NSW_SKILLS_LISTS, selector: "main", direct: true, enrich: readNswSkillsLists },
  "au-tra-jrp-fees": { url: TRA_FEES, read: readTraFeesSnapshot, transport: australianWatchTransport },
  "au-cricos-register": { url: CRICOS_PRIMARY, selector: "#content", direct: true, enrich: readCricosRecords },
  "au-national-training-register": { url: TRAINING_REGISTER_RTO, read: readTrainingRegisterSnapshot, transport: "public-json" },
};

export async function readOfficialPage(id: string): Promise<ReturnType<typeof pageSnapshot> & { evidence?: WatchEvidence }> {
  const spec = WATCHES[id];
  if (!spec) throw new Error("Unknown official page");
  if ("read" in spec) {
    const snapshot = await spec.read();
    return { ...snapshot, hash: sha256(snapshot.text) };
  }
  const raw = spec.direct
    ? requireOk(await guardedFetch(spec.url, { headers: { "user-agent": "node", accept: "*/*", ...(spec.english ? { "accept-language": "en-AU,en;q=0.9" } : {}) }, timeoutMs: 20_000 })).text()
    : (await jinaRead(spec.url, { purpose: "official_page_watch", subject: `source:${id}`, anonymous: true, format: "html", cacheToleranceSeconds: 900 })).raw;
  const snapshot = pageSnapshot(raw, spec.selector);
  if (!spec.enrich) return snapshot;
  const enriched = await spec.enrich(raw, snapshot.text);
  return { ...snapshot, ...enriched, hash: sha256(enriched.text) };
}

export function pageSnapshot(html: string, selector: string) {
  const document = contentDocument(html);
  const main = document.querySelector(selector);
  main?.querySelectorAll("script,style,nav,footer,header,form").forEach((node: { remove(): void }) => node.remove());
  const text = main?.textContent.replace(/\s+/g, " ").trim() ?? "";
  if (text.length < 100) throw new Error("Official page has no usable main content");
  return { title: document.querySelector("h1")?.textContent.trim() || document.title, text, hash: sha256(text) };
}

type WatchResult =
  | { sourceId: string; status: "ok"; mode: "baseline" | "changed" | "unchanged"; articleId: string; created: boolean }
  | { sourceId: string; status: "skipped"; reason?: string }
  | { sourceId: string; status: "failed"; error: string };

export async function watchOfficialPage(id: string, force = false): Promise<WatchResult> {
  const spec = WATCHES[id];
  if (!spec) return { sourceId: id, status: "skipped", reason: "not a managed official page" };
  const owner = await runOwner();
  const run = await sql.begin(async tx => {
    const [source] = await tx`SELECT kind,enabled FROM sources WHERE id=${id} FOR UPDATE`;
    if (source?.kind !== "external" || !source.enabled && !force) return null;
    const [running] = await tx`SELECT 1 FROM fetch_runs WHERE source_id=${id} AND status='running' AND started_at > now()-interval '5 minutes' LIMIT 1`;
    if (running) return null;
    const [claim] = await tx`INSERT INTO fetch_runs(source_id,detail) VALUES(${id},${tx.json({ owner })}) RETURNING id`;
    return claim;
  });
  if (!run) return { sourceId: id, status: "skipped" };
  try {
    const snapshot = await readOfficialPage(id);
    const proof = snapshot.evidence ? { evidence: snapshot.evidence } : {};
    const checkedAt = new Date().toISOString();
    return await sql.begin(async tx => {
      const [source] = await tx`SELECT kind,enabled,cursor FROM sources WHERE id=${id} FOR UPDATE`;
      if (source?.kind !== "external" || !source.enabled && !force) {
        await tx`UPDATE fetch_runs SET status='skipped',finished_at=now() WHERE id=${run.id}`;
        return { sourceId: id, status: "skipped" };
      }
      const previous = source.cursor?.officialWatch;
      const changed = !!previous && previous.hash !== snapshot.hash;
      const mode = previous ? changed ? "changed" : "unchanged" : "baseline";
      const material = await upsertMaterial({
        sourceId: id, identityKey: `official-page:${id}`, url: spec.url,
        title: snapshot.title, bodyText: snapshot.text, bodyStatus: "ok", publishedAt: null,
        language: "en", via: "official-page-watch",
        raw: { officialWatch: { publicationDateUnknown: true, transport: "transport" in spec ? spec.transport : spec.direct ? "direct-https" : "anonymous-reader", ...proof } },
      }, tx);
      if (material.created || material.revised) await queueProcessing(material.articleId, { db: tx });
      const cursor = { ...source.cursor, officialWatch: {
        hash: snapshot.hash, articleId: material.articleId, checkedAt,
        ...(changed ? { changedAt: checkedAt } : previous?.changedAt ? { changedAt: previous.changedAt } : {}),
      } };
      await tx`UPDATE fetch_runs SET status='ok',finished_at=now(),found_count=1,new_count=${material.created ? 1 : 0},
        detail=coalesce(detail,'{}'::jsonb)||${tx.json({ mode, materialId: material.articleId, publicationDateUnknown: true, ...proof })}::jsonb WHERE id=${run.id}`;
      await tx`UPDATE sources SET cursor=${tx.json(cursor)},health=CASE WHEN enabled THEN 'ok' ELSE 'paused' END,last_fetch_at=now(),last_ok_at=now(),last_error=NULL,fail_count=0,next_fetch_at=now()+make_interval(mins=>interval_minutes),updated_at=now() WHERE id=${id}`;
      return { sourceId: id, status: "ok", mode, articleId: material.articleId, created: material.created };
    });
  } catch (e) {
    const error = String(e instanceof Error ? e.message : e).slice(0, 1000);
    await sql.begin(async tx => {
      await tx`UPDATE fetch_runs SET status='failed',finished_at=now(),error=${error} WHERE id=${run.id}`;
      await tx`UPDATE sources SET health=CASE WHEN enabled THEN 'degraded' ELSE 'paused' END,last_fetch_at=now(),last_error=${error},fail_count=fail_count+1,next_fetch_at=now()+make_interval(mins=>interval_minutes),updated_at=now() WHERE id=${id}`;
    });
    return { sourceId: id, status: "failed", error };
  }
}

export async function collectOfficialPages() {
  const due = await sql`SELECT id FROM sources WHERE id=ANY(${Object.keys(WATCHES)}::text[]) AND enabled AND kind='external' AND (next_fetch_at IS NULL OR next_fetch_at<=now()) ORDER BY id`;
  const results = [];
  for (const s of due) results.push(await watchOfficialPage(s.id));
  return results;
}
