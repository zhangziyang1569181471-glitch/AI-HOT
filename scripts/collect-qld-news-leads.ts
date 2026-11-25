import { appendFile } from "node:fs/promises";
import { closeDb } from "@aihot/backend/db";
import { recordRun } from "@aihot/backend/jobs/queue";
import { collectQueenslandNewsLeads } from "../modules/official-watch/qld-news-leads.ts";

if (!process.env.DATABASE_URL || process.env.COLLECT_ENABLED !== "true" || process.env.MODEL_CALLS_ENABLED !== "false") {
  throw new Error("Set DATABASE_URL, COLLECT_ENABLED=true and MODEL_CALLS_ENABLED=false for the Queensland RSS job");
}

try {
  const result = await recordRun("cloud.qld-news-leads", collectQueenslandNewsLeads);
  const summary = result.status === "skipped" ? "昆州 RSS 已暂停。"
    : "昆州 RSS 本轮采用 " + (result.feed === "google" ? "Google 新闻" : "VisaRadar 备用订阅")
      + "，读取 " + result.received + " 条，筛出 " + result.found + " 条线索，新增 "
      + result.created + " 条待审，" + (result.found - result.created) + " 条已入库。";
  if (result.status === "ok") console.log(JSON.stringify(result.checks));
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary + "\n");
} finally {
  await closeDb();
}
