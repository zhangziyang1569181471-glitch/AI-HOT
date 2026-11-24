// Free listing reads: one retry after a dropped connection or an upstream 500, YouTube's intermittent
// missing feed included, and nothing else is read twice. Without live services or a database.
import assert from "node:assert/strict";
import { syncBuiltinESMExports } from "node:module";
import { after, mock, test } from "node:test";
import timersPromises from "node:timers/promises";
import { MockAgent, getGlobalDispatcher, setGlobalDispatcher } from "undici";
import { config } from "@aihot/backend/config";
import { fetchListing } from "@aihot/backend/sources/listing-fetch";
import { fetchRss } from "@aihot/backend/sources/rss";
import { fetchDetail, fetchWebList } from "@aihot/backend/sources/web-list";
import { fetchJsonList } from "@aihot/backend/sources/json-list";
import { jinaRead } from "@aihot/backend/providers/jina";
import { ProviderRejectedError } from "@aihot/backend/providers/receipts";
import { extractFromUrl } from "@aihot/backend/content/extract";
import { assertSupportedConfig } from "@aihot/backend/sources/config-keys";
import type { SourceRow } from "@aihot/backend/sources/types";

const previousDispatcher = getGlobalDispatcher();
const previousPrivate = config.allowPrivateNetworkFetch;
const previousProxy = config.egressProxyUrl;
const previousJinaKey = process.env.JINA_API_KEY;
const mockAgent = new MockAgent();
mockAgent.disableNetConnect();
setGlobalDispatcher(mockAgent);
config.allowPrivateNetworkFetch = true;
config.egressProxyUrl = null;
// The pause before the retry is not what is under test.
mock.method(timersPromises, "setTimeout", async () => undefined);
syncBuiltinESMExports();
after(async () => {
  mock.restoreAll();
  syncBuiltinESMExports();
  config.allowPrivateNetworkFetch = previousPrivate;
  config.egressProxyUrl = previousProxy;
  if (previousJinaKey === undefined) delete process.env.JINA_API_KEY;
  else process.env.JINA_API_KEY = previousJinaKey;
  setGlobalDispatcher(previousDispatcher);
  await mockAgent.close();
});

const origin = "https://publisher.invalid";
const channelPath = "/feeds/videos.xml?channel_id=UCV03SRZXJEz-hchIAogeJOg";
const youtube = "https://www.youtube.com";
const xml = '<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>A new video</title><link href="https://www.youtube.com/watch?v=video"/><published>2026-10-02T19:44:06Z</published></entry></feed>';
const source = (kind: string, config: Record<string, unknown>, cursor: SourceRow["cursor"] = null) =>
  ({ id: "listing-retry", kind, config, cursor, participation_mode: "editorial" }) as SourceRow;
const dropped = (message = "Client network socket disconnected before secure TLS connection was established") =>
  Object.assign(new Error(message), { code: "ECONNRESET" });

test("RSS and HTML listings send declared request headers and retain RSS validators", async () => {
  const headers = { accept: "*/*", "user-agent": "publisher-feed-reader" };
  const rss = source("rss", { feedUrl: origin + "/negotiated.xml", headers });
  const html = source("web_list", { url: origin + "/negotiated", headers, parseMode: "html", itemSelector: "a:has(h3)", titleSelector: "h3" });
  for (const s of [rss, html]) assertSupportedConfig(s.kind, s.config);
  mockAgent.get(origin).intercept({ path: "/negotiated.xml", headers }).reply(200, xml, { headers: { etag: '"negotiated"' } });
  const first = await fetchRss(rss);
  assert.equal(first.candidates.length, 1);
  rss.cursor = { rss: first.validator };
  mockAgent.get(origin).intercept({ path: "/negotiated.xml", headers: { ...headers, "if-none-match": '"negotiated"' } }).reply(304, "");
  assert.equal((await fetchRss(rss)).notModified, true);
  mockAgent.get(origin).intercept({ path: "/negotiated", headers }).reply(200, '<a href="/post"><h3>Publisher update</h3></a>');
  assert.equal((await fetchWebList(html))[0]?.title, "Publisher update");
});

test("RSS, HTML and JSON listings recover from a dropped connection, a second drop fails", async () => {
  for (const [kind, path, body] of [
    ["rss", "/rss.xml", xml],
    ["web_list", "/blog", '<a href="/blog/post"><h3>A new post</h3><p>October 02, 2026</p></a>'],
    ["json_list", "/items", JSON.stringify([{ title: "A new post", url: origin + "/post" }])],
  ] as const) {
    mockAgent.get(origin).intercept({ path }).replyWithError(dropped());
    mockAgent.get(origin).intercept({ path }).reply(200, body);
    const items = kind === "rss" ? (await fetchRss(source(kind, { feedUrl: origin + path }))).candidates
      : kind === "web_list" ? await fetchWebList(source(kind, { url: origin + path, parseMode: "html", itemSelector: "a:has(h3)", titleSelector: "h3", publishedAtSelector: "p", publishedAtUtcOffset: "+00:00" }))
      : await fetchJsonList(source(kind, { url: origin + path, titlePaths: ["title"], urlTemplate: "{raw:url}" }));
    assert.equal(items.length, 1, kind);
    assert.match(items[0]!.title, /^A new /);
  }
  const failure = dropped("Socket closed");
  mockAgent.get(origin).intercept({ path: "/twice" }).replyWithError(failure).times(2);
  mockAgent.get(origin).intercept({ path: "/twice" }).reply(200, "Must not be read");
  await assert.rejects(fetchListing(origin + "/twice"), (error: Error) => (error.cause as NodeJS.ErrnoException)?.code === failure.code);
  assert.equal(mockAgent.pendingInterceptors().filter(i => i.path === "/twice").length, 1);
});

test("YouTube's intermittent 404 is retried with the same validators and accepts a valid 304", async () => {
  const s = source("rss", { feedUrl: youtube + channelPath });
  mockAgent.get(youtube).intercept({ path: channelPath }).reply(200, xml, { headers: { etag: '"saved"' } });
  const first = await fetchRss(s);
  assert.equal(first.candidates.length, 1);
  s.cursor = { rss: first.validator };
  for (const status of [404, 304]) {
    mockAgent.get(youtube).intercept({ path: channelPath, headers: { "if-none-match": '"saved"' } }).reply(status, "");
  }
  const second = await fetchRss(s);
  assert.equal(second.notModified, true);
  assert.deepEqual(second.candidates, []);
  assert.equal(second.validator.etag, '"saved"');
});

test("upstream 500 is retried once, but ordinary missing URLs and access/rate refusals are read once", async () => {
  mockAgent.get(origin).intercept({ path: "/temporary" }).reply(500, "Temporary error");
  mockAgent.get(origin).intercept({ path: "/temporary" }).reply(200, "Recovered");
  assert.equal((await fetchListing(origin + "/temporary")).text(), "Recovered");
  for (const [host, path, status] of [
    [origin, "/missing", 404], [origin, "/auth", 401], [origin, "/verify", 403], [origin, "/rate", 429],
    ["https://www.youtube.com.evil.invalid", channelPath, 404], [youtube, "/watch?v=missing", 404],
  ] as const) {
    let hits = 0;
    mockAgent.get(host).intercept({ path }).reply(status, () => { hits++; return "Refused"; }).persist();
    assert.equal((await fetchListing(host + path)).status, status);
    assert.equal(hits, 1, host + path);
  }
});

test("anonymous Reader is explicit, sends no key, and never opens a paid receipt", async () => {
  delete process.env.JINA_API_KEY;
  await assert.rejects(jinaRead(origin + "/reader", { purpose: "test", subject: "listing" }), /JINA_API_KEY is not configured/);
  // Even a configured key must not turn an explicitly free source into an authenticated request.
  process.env.JINA_API_KEY = "key-that-must-not-be-sent";
  mockAgent.get("https://r.jina.ai").intercept({ path: "/" + origin + "/reader" }).reply((opts) => {
    assert.doesNotMatch(JSON.stringify(opts.headers), /authorization|key-that-must-not-be-sent/i);
    return { statusCode: 200, data: "Title: Public news\n\nMarkdown Content:\nVerified public material\0and text." };
  });
  const page = await jinaRead(origin + "/reader", { purpose: "test", subject: "listing", anonymous: true });
  assert.equal(page.receiptId, null);
  assert.equal(page.markdown, "Verified public material�and text.");
  // Standalone setup points DATABASE_URL at an unreachable address: a paid receipt would fail this read.
});

test("anonymous Reader refuses private targets and reports upstream 429 or challenge pages", async () => {
  for (const url of ["http://127.0.0.1/page", "http://[::1]/page", "http://metadata.google.internal/page", "file:///private", "https://user:secret@example.org/page"]) {
    await assert.rejects(jinaRead(url, { purpose: "test", subject: "listing", anonymous: true }), /public HTTP\(S\) URL/);
  }
  mockAgent.get("https://r.jina.ai").intercept({ path: "/" + origin + "/reader-rate" }).reply(429, "Rate limit exceeded");
  await assert.rejects(jinaRead(origin + "/reader-rate", { purpose: "test", subject: "listing", anonymous: true }),
    (error: Error) => error instanceof ProviderRejectedError && error.status === 429 && error.retryable);
  mockAgent.get("https://r.jina.ai").intercept({ path: "/" + origin + "/reader-challenge" }).reply(200,
    "Title: Verification\nWarning: Target URL returned error 403: Forbidden\n\nMarkdown Content:\nYou must pass a browser check.");
  await assert.rejects(jinaRead(origin + "/reader-challenge", { purpose: "test", subject: "listing", anonymous: true }), /403/);
});

test("anonymous source details read CSS publication metadata from Reader HTML", async () => {
  const s = source("web_list", { url: "https://r.jina.ai/" + origin + "/news", jinaMode: "anonymous", parseMode: "html",
    detail: { publishedAtSelector: 'meta[property="article:published_time"]', titleSelector: "h1", summarySelector: 'meta[name="description"]' } });
  assertSupportedConfig(s.kind, s.config);
  mockAgent.get("https://r.jina.ai").intercept({ path: "/" + origin + "/news/detail" }).reply((opts) => {
    assert.doesNotMatch(JSON.stringify(opts.headers), /authorization/i);
    assert.match(JSON.stringify(opts.headers), /x-return-format.*html/i);
    return { statusCode: 200, data: '<html><head><meta property="article:published_time" content="2026-11-17T14:30:00+11:00"><meta name="description" content="Official description"></head><body><main><h1>Official update</h1></main></body></html>' };
  });
  const detail = await fetchDetail(origin + "/news/detail", s, { date: true, title: true, summary: true, body: false });
  assert.equal(detail.title, "Official update");
  assert.equal(detail.summary, "Official description");
  assert.equal(detail.publishedAt?.toISOString(), "2026-11-17T03:30:00.000Z");
  assert.equal(detail.publicationTime, "2026-11-17T03:30:00.000Z");
});

test("a source can explicitly use anonymous Reader for article body fallback", async () => {
  mockAgent.get(origin).intercept({ path: "/body-refused" }).reply(403, "Forbidden");
  const text = "The official source describes the published policy and the affected applications. ".repeat(8).trim();
  mockAgent.get("https://r.jina.ai").intercept({ path: "/" + origin + "/body-refused" }).reply((opts) => {
    assert.doesNotMatch(JSON.stringify(opts.headers), /authorization/i);
    return { statusCode: 200, data: `Title: Official report\n\nMarkdown Content:\n${text}` };
  });
  const body = await extractFromUrl(origin + "/body-refused", "article:test", {}, { jinaMode: "anonymous" });
  assert.equal(body?.via, "jina");
  assert.equal(body?.text, text);
});
