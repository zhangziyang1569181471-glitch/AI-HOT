import { defineModule } from "@aihot/contracts/modules";

export const OFFICIAL_WATCH = defineModule({
  name: "official-watch",
  pages: [
    { path: "state-nomination/tasmania", file: "web/tasmania-status.tsx", id: "tasmania-status" },
    { path: "state-nomination/tasmania/review", file: "web/tasmania-review.tsx", id: "tasmania-review", gray: true },
  ],
  apiPaths: [/^\/api\/site\/tasmania-nomination$/, /^\/api\/admin\/tasmania-nomination\/review$/],
});
