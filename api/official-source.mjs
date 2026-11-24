import { timingSafeEqual } from "node:crypto";

const education = "https://www.education.gov.au";
const resources = {
  "provider-index": education + "/managed-system-international-education/resources/visa-prioritisation-status",
  "tra-fees": "https://www.tradesrecognitionaustralia.gov.au/fees-1",
};
const maxBytes = 2 * 1024 * 1024;

// Only the two official publishers tested from this region can be reached through this function.
export default async function officialSource(req, res) {
  res.setHeader("cache-control", "no-store");
  const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  const expected = Buffer.from("Bearer " + (secret ?? ""));
  const supplied = Buffer.from(req.headers.authorization ?? "");
  if (!secret || expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    return res.status(404).end();
  }
  if (req.method !== "GET") return res.status(405).end();
  const query = new URL(req.url, "http://radar.local").searchParams;
  const key = query.get("resource");
  const doc = query.get("path") ?? "";
  const url = key === "provider-document" && /^\/download\/\d+\/visa-prioritisation-status\/\d+\/current-snapshot\/docx\/?$/i.test(doc)
    ? education + doc : Object.hasOwn(resources, key) ? resources[key] : null;
  if (!url) return res.status(404).end();
  try {
    const upstream = await fetch(url, {
      redirect: "error", signal: AbortSignal.timeout(18_000),
      headers: { accept: "*/*", "accept-language": "en-AU,en;q=0.9" },
    });
    if (!upstream.ok || !upstream.body) return res.status(upstream.status === 429 ? 429 : 502).end();
    const reader = upstream.body.getReader();
    const chunks = [];
    let bytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > maxBytes) {
        await reader.cancel();
        return res.status(502).end();
      }
      chunks.push(value);
    }
    res.setHeader("content-type", key === "provider-document" ? "application/octet-stream" : "text/plain; charset=utf-8");
    return res.status(200).send(Buffer.concat(chunks, bytes));
  } catch {
    return res.status(502).end();
  }
}
