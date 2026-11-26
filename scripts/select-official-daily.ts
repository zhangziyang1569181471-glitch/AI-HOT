import { closeDb } from "@aihot/backend/db";
import { recordRun, stopBoss } from "@aihot/backend/jobs/queue";
import { installModules } from "@aihot/backend/modules";
import { SERVER_MODULES } from "@aihot/site/modules/server";
import { selectOfficialDaily } from "../modules/official-watch/daily-selection.ts";

if (!process.env.DATABASE_URL || process.env.MODEL_CALLS_ENABLED !== "false") {
  throw new Error("Set DATABASE_URL and MODEL_CALLS_ENABLED=false for the official daily selection");
}

installModules(SERVER_MODULES);
try {
  const result = process.argv.includes("--dry-run")
    ? await selectOfficialDaily({ dryRun: true })
    : await recordRun("cloud.daily-selection", () => selectOfficialDaily());
  console.log(JSON.stringify(result));
} finally {
  await stopBoss();
  await closeDb();
}
