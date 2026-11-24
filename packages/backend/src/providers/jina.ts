// Jina Reader: authenticated reads retain paid receipts/budgets. A source may explicitly choose the
// official anonymous free endpoint instead (20 requests/minute/IP); it never sends credentials.
import { randomUUID } from "node:crypto";
import net from "node:net";
import { setTimeout } from "node:timers/promises";
import { credential } from "../config.ts";
import { guardedFetch } from "../lib/http-fetch.ts";
import { isBlockedAddress } from "../lib/url.ts";
import { assertPageContent, contentDocument, UnavailablePageError } from "../lib/page-content.ts";
import { assertAccepted, paidRequest } from "./receipts.ts";

/** A source address read through Jina: this prefix, then the page's own address. */
export const JINA_PREFIX = "https://r.jina.ai/";

// Shared by the listing, detail and body reads in this process. Another process sharing the IP can
// still exhaust the upstream allowance; its 429 is recorded as a failed read, not a successful page.
let anonymousQueue = Promise.resolve();
let anonymousNextAt = 0;
function anonymousTurn(): Promise<void> {
  const turn = anonymousQueue.then(async () => {
    const wait = anonymousNextAt - Date.now();
    if (wait > 0) await setTimeout(wait);
    anonymousNextAt = Date.now() + 3100;
  });
  anonymousQueue = turn.catch(() => undefined);
  return turn;
}

/** Jina's answer starts with header lines (Title, URL Source, Published Time); the page follows this line. */
const CONTENT = "\nMarkdown Content:\n";

/**
 * Reads a page through Jina: `raw` is the whole answer, `markdown` the page after its header lines.
 * The receipt key is the target URL plus the day, so a same-day retry of an article's body or detail
 * reuses it. A listing is read afresh on every fetch (`perRead`): with the day key every later fetch saw
 * the morning's page. Each such read has a receipt of its own, so after one whose outcome is unknown the
 * next fetch pays for a new read instead of waiting on it. A caller that reads on rounds of its own keys the
 * read by its `round`: a retry of the round reuses it, the next round reads afresh.
 */
export async function jinaRead(
  targetUrl: string,
  opts: { purpose: string; subject: string; format?: "markdown" | "html"; cacheToleranceSeconds?: number; perRead?: boolean; round?: string; removeSelector?: string; anonymous?: boolean },
): Promise<{ markdown: string; raw: string; receiptId: number | null }> {
  const key = credential("collectors", "JINA_API_KEY");
  if (!opts.anonymous && !key) throw new Error("JINA_API_KEY is not configured");
  if (opts.anonymous) {
    const target = new URL(targetUrl);
    const host = target.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
    if (!/^https?:$/.test(target.protocol) || target.username || target.password || host === "localhost" || /\.(?:localhost|internal|local)$/.test(host)
      || net.isIP(host) && isBlockedAddress(host)) throw new Error("Anonymous Reader requires a public HTTP(S) URL");
  }
  const base = opts.anonymous ? "https://r.jina.ai" : (credential("collectors", "JINA_BASE_URL") ?? "https://r.jina.ai").replace(/\/$/, "");
  // A listing whose freshness matters (xAI news) caps how old Jina's cached rendering may be.
  const tolerance: Record<string, string> = Number.isInteger(opts.cacheToleranceSeconds) && opts.cacheToleranceSeconds! >= 0 ? { "x-cache-tolerance": String(opts.cacheToleranceSeconds) } : {};
  const remove: Record<string, string> = opts.removeSelector ? { "x-remove-selector": opts.removeSelector } : {};
  const day = new Date().toISOString().slice(0, 10);
  // A per-read listing is keyed by an ID of its own, not the clock: two reads can see the same clock reading.
  const read = opts.round ? { round: opts.round } : opts.perRead ? { read: randomUUID() } : {};
  const send = async () => {
    const res = await guardedFetch(`${base}/${targetUrl}`, {
      headers: { ...(opts.anonymous ? {} : { authorization: `Bearer ${key}` }), "x-return-format": opts.format ?? "markdown", accept: "text/plain", ...tolerance, ...remove },
      timeoutMs: 60_000,
      maxBytes: 6 * 1024 * 1024,
    });
    const text = res.text();
    assertAccepted("jina", res.status, text);
    return { res, text };
  };
  let raw: string;
  let receiptId: number | null = null;
  if (opts.anonymous) {
    await anonymousTurn();
    raw = (await send()).text.replace(/\0/g, "\ufffd");
  } else {
    const receipt = await paidRequest(
      { service: "jina", model: null, purpose: opts.purpose, subject: opts.subject, identity: { url: targetUrl, day, format: opts.format ?? "markdown", ...read, ...remove }, requestSummary: { url: targetUrl } },
      async () => {
        const { res, text } = await send();
        // Billed in tokens; estimated at about ¥0.36 per million. Without the usage header nothing is guessed.
        const tokens = Number(res.headers.get("x-usage-tokens")) || null;
        const cost = tokens ? { amount: (tokens / 1e6) * 0.36, currency: "CNY", basis: "estimated" as const } : null;
        return { response: { text: text.slice(0, 2_000_000), status: res.status }, requestId: res.headers.get("x-request-id"), usage: { bytes: res.body.length, tokens }, cost };
      },
    );
    raw = String((receipt.response as { text?: string })?.text ?? "");
    receiptId = receipt.receiptId;
  }
  const at = raw.indexOf(CONTENT);
  const markdown = (at < 0 ? raw : raw.slice(at + CONTENT.length)).trim();
  // Authenticated reads save their receipt before checking the target. Only protocol warnings before
  // Markdown Content are errors: an article may quote the same words.
  if (opts.format === "html") contentDocument(raw);
  else {
    const header = at < 0 ? "" : raw.slice(0, at);
    const failure = /^Warning:.*(?:Target URL returned error [45]\d\d\b|requiring CAPTCHA).*$/im.exec(header);
    if (failure) throw new UnavailablePageError(failure[0]);
    assertPageContent(/^Title:\s*(.*)$/im.exec(header)?.[1] ?? "", markdown);
  }
  return { markdown, raw, receiptId };
}
