import { IconCalendar } from "@aihot/web/components/icons";
import { defineWebModule } from "@aihot/web/modules";
import { TASMANIA_STATUS_PATH } from "./tasmania.ts";

export const OFFICIAL_WATCH_WEB = defineWebModule({
  name: "official-watch",
  sidebar: { section: "内容", items: [{ to: TASMANIA_STATUS_PATH, label: "塔州州担保", icon: IconCalendar }] },
  tools: [{ to: TASMANIA_STATUS_PATH, label: "塔州州担保", icon: <IconCalendar size={19} /> }],
});
