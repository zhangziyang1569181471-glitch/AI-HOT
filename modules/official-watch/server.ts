import { defineServerModule } from "@aihot/backend/modules";
import { adminHandler } from "../../apps/api/src/routes/admin-auth.ts";
import { collectOfficialPages } from "./watch.ts";
import { readTasmaniaReview, readTasmaniaStatus } from "./tasmania-read.ts";
import { TASMANIA_REVIEW_API, TASMANIA_STATUS_API } from "./tasmania.ts";

export const OFFICIAL_WATCH_SERVER = defineServerModule({
  name: "official-watch",
  schedules: [{ name: "official-pages.collect", cron: "*/5 * * * *", when: () => process.env.COLLECT_ENABLED === "true", run: collectOfficialPages }],
  http(app) {
    app.get(TASMANIA_STATUS_API, async (_request, reply) => {
      reply.header("Cache-Control", "no-cache");
      return { status: await readTasmaniaStatus() };
    });
    app.get(TASMANIA_REVIEW_API, adminHandler(async () => ({ card: await readTasmaniaReview() })));
  },
});
