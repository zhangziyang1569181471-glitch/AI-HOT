import { closeDb } from "@aihot/backend/db";
import { recordRun } from "@aihot/backend/jobs/queue";
import { installModules } from "@aihot/backend/modules";
import { composeVerifiedDaily } from "@aihot/backend/reports/compose";
import { SERVER_MODULES } from "@aihot/site/modules/server";

if (!process.env.DATABASE_URL || process.env.MODEL_CALLS_ENABLED !== "false") {
  throw new Error("Set DATABASE_URL and MODEL_CALLS_ENABLED=false for the verified daily report");
}

installModules(SERVER_MODULES);
try {
  console.log(JSON.stringify(await recordRun("cloud.daily-report", () => composeVerifiedDaily())));
} finally {
  await closeDb();
}
