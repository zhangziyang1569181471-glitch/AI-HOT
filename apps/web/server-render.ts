import { createRequestListener } from "@react-router/node";
import type { ServerBuild } from "react-router";
import { BROWSER_MAX_SECONDS } from "./app/lib/api.server.ts";

export function createWebRenderer(build: ServerBuild) {
  // Keep an empty result for pages without a loader. A tab opened before a page lost its loader still asks
  // for that result, and its router rejects a missing one before React's release recovery can run; an empty
  // one reaches the component instead. The client manifest declares no loader, so current documents make no
  // such request. A tab updates only when its reader reloads it, so no date says when the last old one is
  // gone: remove this once such requests stop arriving.
  const routes = Object.fromEntries(Object.entries(build.routes).map(([id, route]) => [id,
    route?.module.default && !route.module.loader ? { ...route, module: { ...route.module, loader: () => null } } : route,
  ]));
  return createRequestListener({ build: { ...build, routes }, mode: "production" });
}

/**
 * The one writer of page response headers: a route only says how long shared caches may keep it (cachedPage, edgeTtl).
 * Public navigation returns all matched loaders, so `_routes` never changes a cached answer.
 */
export function pageResponse(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) {
  const target = req.url ?? "/";
  // An origin-form target is a path even when it starts with //, not a new URL authority.
  const url = new URL(target.startsWith("/") ? `http://web.local${target}` : target, "http://web.local");
  const pathname = decodeURIComponent(url.pathname).replace(/\.data$/, "");
  const publicRead = (req.method === "GET" || req.method === "HEAD") && !/^\/admin(?:\/|$)/i.test(pathname);
  if (publicRead && url.pathname.endsWith(".data")) {
    url.searchParams.delete("_routes");
    req.url = url.pathname + url.search;
  }

  // React Router uses the same route headers for HTML and single-fetch data. Apply the final
  // status here: a route's successful cache policy must never cache its error or action result.
  const writeHead = res.writeHead.bind(res);
  res.writeHead = ((status: number, messageOrHeaders?: string | import("node:http").OutgoingHttpHeaders, headers?: import("node:http").OutgoingHttpHeaders) => {
    const outgoing = typeof messageOrHeaders === "string" ? headers : messageOrHeaders;
    for (const [name, value] of Object.entries(outgoing ?? {})) if (value !== undefined) res.setHeader(name, value);
    // Download managers can treat prefetched .data with the unknown text/x-script type as a file.
    // Turbo-stream is text decoded from the response body; its client does not depend on the MIME.
    if (url.pathname.endsWith(".data") && res.getHeader("Content-Type") === "text/x-script") {
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
    }
    const cc = String(res.getHeader("Cache-Control") ?? "");
    if (!publicRead || status !== 200 || res.hasHeader("Set-Cookie") || !cc || /(?:private|no-store)/i.test(cc)) {
      res.removeHeader("Expires");
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("X-Accel-Expires", "0");
    } else {
      const now = new Date();
      const nowSeconds = Math.floor(now.getTime() / 1000);
      const sharedSeconds = Number(cc.match(/(?:^|,)\s*s-maxage=(\d+)/i)?.[1] ?? 0);
      const expires = String(res.getHeader("X-Accel-Expires") ?? `@${nowSeconds + sharedSeconds}`);
      // A sibling loader may have delayed this response after the selected loader set its TTL.
      const seconds = /(?:^|,)\s*no-cache(?:,|$)/i.test(cc) || expires === "0" ? 0
        : Math.max(0, Math.min(sharedSeconds, Number(expires.slice(1)) - nowSeconds));
      res.setHeader("Date", now.toUTCString());
      res.setHeader("X-Accel-Expires", seconds > 0 ? expires : "0");
      // Reuse intent-prefetched data in the browser within the same shared-cache deadline (capped).
      // Never serve it beyond that deadline, including while revalidating or on an error.
      res.setHeader("Cache-Control", seconds > 0
        ? `public, max-age=${Math.min(seconds, BROWSER_MAX_SECONDS)}, s-maxage=${seconds}, must-revalidate`
        : "no-cache");
    }
    return typeof messageOrHeaders === "string" ? writeHead(status, messageOrHeaders) : writeHead(status);
  }) as typeof res.writeHead;
}
