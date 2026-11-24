import type { IncomingMessage, ServerResponse } from "node:http";
import type { ServerBuild } from "react-router";
import { isApiOwned, resolveRedirect } from "@aihot/contracts/http-policy";
import { assertProductionSecrets, config } from "@aihot/backend/config";
import { logError } from "@aihot/backend/lib/log-error";
import { installModules } from "@aihot/backend/modules";
import { DEPLOYMENT } from "@aihot/site";
import { SERVER_MODULES } from "@aihot/site/modules/server";
import { buildApp } from "../../apps/api/src/app.ts";
import { createWebRenderer, pageResponse } from "../../apps/web/server-render.ts";

// The Vercel build first compiles the React Router application, then bundles both servers.
const build = await import("../../apps/web/build/server/index.js") as ServerBuild;
const render = createWebRenderer(build);
installModules(SERVER_MODULES);
assertProductionSecrets([["auth", "SESSION_SECRET"], ["auth", "IMG_PROXY_SIGN_SECRET"], ...DEPLOYMENT.requiredSecrets]);
if (!process.env.DATABASE_URL || !config.adminPassword || config.adminPassword.length < 12) {
  throw new Error("The Vercel deployment requires DATABASE_URL and a strong ADMIN_PASSWORD");
}
const app = await buildApp();
await app.ready();

export default async function radar(req: IncomingMessage, res: ServerResponse) {
  try {
    const raw = req.url ?? "/";
    const target = new URL(raw.startsWith("/") ? `http://radar.local${raw}` : raw, "http://radar.local");
    const decision = resolveRedirect(target.pathname, target.search);
    if (decision) {
      for (const [name, value] of Object.entries(decision.headers)) res.setHeader(name, value);
      if (decision.location) res.setHeader("Location", decision.location);
      res.statusCode = decision.status;
      return res.end(decision.location ? undefined : decision.status === 410 ? "Gone" : "Not found");
    }
    if (isApiOwned(target.pathname)) return app.routing(req, res);
    pageResponse(req, res);
    return await render(req, res);
  } catch (error) {
    if (res.headersSent) return res.destroy();
    const malformed = error instanceof URIError;
    if (!malformed) console.error("radar request failed", logError(error));
    res.writeHead(malformed ? 400 : 500, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    res.end(malformed ? "Bad request" : "Internal error");
  }
}
