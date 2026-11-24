// The backend of the site's modules, installed by the api and the worker when they start (site/modules/index.ts).
import type { ServerModule } from "@aihot/backend/modules";
import { OFFICIAL_WATCH_SERVER } from "@aihot/official-watch/server";

export const SERVER_MODULES: readonly ServerModule[] = [OFFICIAL_WATCH_SERVER];
