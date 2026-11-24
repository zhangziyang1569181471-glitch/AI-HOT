// Production web server: built client assets, the shared redirect table and SSR. Api-owned paths are
// proxied to the api process, so one port serves the whole site; a reverse proxy in front may also send
// them to the api directly.
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { ServerBuild } from "react-router";
import { isApiOwned, resolveRedirect } from "@aihot/contracts/http-policy";
import { createWebRenderer, pageResponse } from "./server-render.ts";
import { proxyToApi } from "./app/lib/api-proxy.server.ts";
import { logError } from "./app/lib/errors.server.ts";

const PORT = Number(process.env.WEB_PORT || 3000);
const HOST = process.env.WEB_HOST || "127.0.0.1";
/**
 * Whether a reverse proxy in front (Caddy, nginx) records the visitor in X-Forwarded-For. Without one
 * the header is never believed: a visitor could name any address and slip past the api's per-visitor
 * limits (sign-in attempts, feedback).
 */
const TRUST_PROXY = process.env.TRUST_PROXY === "true";
const CLIENT_DIR = path.resolve(import.meta.dirname, "build/client");

const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".ico": "image/x-icon",
  ".map": "application/json",
};

// A file URL, not a path: on Windows import() reads "C:\..." as a URL with the scheme "c:".
const build: ServerBuild = await import(pathToFileURL(path.resolve(import.meta.dirname, "build/server/index.js")).href);
const ssr = createWebRenderer(build);

class BadRequest extends Error {}

/** Hashed build assets are immutable; anything else from the client build gets a short cache. */
async function serveStatic(pathname: string, res: import("node:http").ServerResponse): Promise<boolean> {
  if (pathname.includes("..") || pathname.endsWith("/")) return false;
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    throw new BadRequest("malformed percent-encoding");
  }
  const file = path.join(CLIENT_DIR, decoded);
  if (!file.startsWith(CLIENT_DIR)) return false;
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) return false;
  const immutable = pathname.startsWith("/assets/");
  res.writeHead(200, {
    "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream",
    "Content-Length": info.size,
    "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "public, max-age=3600",
    "X-Content-Type-Options": "nosniff",
  });
  createReadStream(file).pipe(res);
  return true;
}

// One bad request must never take the process down: answer it and keep serving.
const server = createServer((req, res) => {
  handle(req, res).catch((error: unknown) => {
    const bad = error instanceof BadRequest || error instanceof URIError;
    if (!bad) logError(error, { msg: "web request failed", method: req.method, path: (req.url ?? "").split("?")[0]!.slice(0, 200) });
    if (res.headersSent) return res.destroy();
    res.writeHead(bad ? 400 : 500, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    res.end(bad ? "Bad request" : "Internal error");
  });
});

async function handle(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) {
  const raw = req.url ?? "/";
  const qi = raw.indexOf("?");
  const pathname = qi >= 0 ? raw.slice(0, qi) : raw;
  const search = qi >= 0 ? raw.slice(qi) : "";

  const decision = resolveRedirect(pathname, search);
  if (decision) {
    for (const [k, v] of Object.entries(decision.headers)) res.setHeader(k, v);
    if (decision.location) res.setHeader("Location", decision.location);
    res.statusCode = decision.status;
    return res.end(decision.location ? undefined : decision.status === 410 ? "Gone" : "Not found");
  }

  if (isApiOwned(pathname)) {
    // The visitor's address, decided here: the one the trusted proxy saw (the last X-Forwarded-For
    // entry), or this connection's own. Both headers carry only that.
    const forwarded = String(req.headers["x-forwarded-for"] ?? "").split(",").map((v) => v.trim()).filter(Boolean);
    const client = TRUST_PROXY && forwarded.length ? forwarded[forwarded.length - 1]! : (req.socket.remoteAddress ?? "");
    return proxyToApi(req, res, { "x-forwarded-for": client, "x-real-ip": client });
  }

  if ((req.method === "GET" || req.method === "HEAD") && pathname.includes(".") && (await serveStatic(pathname, res))) return;
  pageResponse(req, res);
  return ssr(req, res);
}

process.on("unhandledRejection", (reason) => {
  logError(reason, { msg: "unhandled rejection" });
});

server.keepAliveTimeout = 65_000;
server.listen(PORT, HOST, () => {
  const port = (server.address() as import("node:net").AddressInfo).port;
  // An ephemeral local site learns its canonical origin only after the listener owns the port.
  if (process.env.SITE_URL) {
    const site = new URL(process.env.SITE_URL);
    if (site.port === "0") { site.port = String(port); process.env.SITE_URL = site.origin; }
  }
  console.log(JSON.stringify({ level: "info", msg: "web started", port, pid: process.pid }));
});

const shutdown = () => server.close(() => process.exit(0));
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
