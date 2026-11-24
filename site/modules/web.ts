// What the site's modules add to the web pages (site/modules/index.ts).
import type { WebModule } from "@aihot/web/modules";
import { OFFICIAL_WATCH_WEB } from "@aihot/official-watch/web";

export const WEB_MODULES: readonly WebModule[] = [OFFICIAL_WATCH_WEB];
