import { XMLParser, XMLValidator } from "fast-xml-parser";
import { sql } from "@aihot/backend/db";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { runOwner } from "@aihot/backend/jobs/runs";
import { guardedFetch, requireOk } from "@aihot/backend/lib/http-fetch";
import { sha256 } from "@aihot/backend/lib/ids";
import { collapseWhitespace, decodeEntities } from "@aihot/backend/lib/text";

export const QUEENSLAND_LEADS_ID = "qld-google-news-leads";
export const QUEENSLAND_NEWS_RSS = "https://news.google.com/rss/search?q=site%3Awww.migration.qld.gov.au%2Fnews&hl=en-AU&gl=AU&ceid=AU%3Aen";

const googleOrigin = "https://news.google.com";
const queenslandOrigins = new Set(["https://www.migration.qld.gov.au", "https://migration.qld.gov.au"]);
const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: false, processEntities: false });

type RssItem = { title?: unknown; link?: unknown; source?: { "@_url"?: unknown } };
type Lead = { identityKey: string; title: string; url: string; publisher: string };

function readUrl(value: unknown): URL | null {
  const url = typeof value === "string" ? URL.parse(decodeEntities(value)) : null;
  return url && !url.username && !url.password ? url : null;
}

function readLeads(xml: string) {
  if (/<!DOCTYPE/i.test(xml) || XMLValidator.validate(xml) !== true) throw new Error("Invalid Queensland news RSS");
  const { rss } = parser.parse(xml) as { rss?: { channel?: { title?: unknown; item?: RssItem | RssItem[] } } };
  const channel = rss?.channel;
  if (!channel || typeof channel.title !== "string" || !channel.title.includes("site:www.migration.qld.gov.au/news")) {
    throw new Error("Google News returned a different RSS channel");
  }
  const entries = Array.isArray(channel.item) ? channel.item : channel.item ? [channel.item] : [];
  const leads = new Map<string, Lead>();
  for (const item of entries) {
    const publisher = readUrl(item?.source?.["@_url"]);
    const link = readUrl(item?.link);
    if (!publisher || !queenslandOrigins.has(publisher.origin) || !link
      || link.origin !== googleOrigin || !/^\/rss\/articles\/[A-Za-z0-9_-]+$/.test(link.pathname)) continue;

    const title = typeof item.title === "string" ? collapseWhitespace(decodeEntities(item.title))
      .replace(/\s+-\s+Migration Queensland$/i, "") : "";
    if (!title || /^(?:Migration Queensland|News(?: from Migration Queensland| for Migration Agents)?)$/i.test(title)) continue;

    // A tracking query can change on the same item. Keep the original Google link for the reviewer.
    const identityKey = QUEENSLAND_LEADS_ID + ":" + sha256(link.pathname);
    if (!leads.has(identityKey)) leads.set(identityKey, { identityKey, title, url: link.href, publisher: publisher.origin });
  }
  return { received: entries.length, leads: [...leads.values()] };
}

export async function collectQueenslandNewsLeads() {
  const [source] = await sql<{ enabled: boolean; kind: string; participation_mode: string }[]>`
    SELECT enabled, kind, participation_mode FROM sources WHERE id=${QUEENSLAND_LEADS_ID}`;
  if (!source || source.kind !== "external" || source.participation_mode !== "isolated") {
    throw new Error("Queensland RSS requires an isolated external source");
  }
  const skipped = { status: "skipped" as const, received: 0, found: 0, created: 0 };
  if (!source.enabled) return skipped;

  const [run] = await sql<{ id: number }[]>`
    INSERT INTO fetch_runs(source_id,detail) VALUES(${QUEENSLAND_LEADS_ID},${sql.json({ owner: await runOwner() })}) RETURNING id`;
  try {
    const response = requireOk(await guardedFetch(QUEENSLAND_NEWS_RSS, {
      headers: { accept: "application/rss+xml, application/xml;q=0.9" },
      timeoutMs: 25_000, maxBytes: 1024 * 1024, redirectPolicy: "same-origin",
    }), "Queensland news RSS");
    const { received, leads } = readLeads(response.text());

    return await sql.begin(async tx => {
      const [active] = await tx`
        SELECT id FROM sources WHERE id=${QUEENSLAND_LEADS_ID} AND enabled
          AND kind='external' AND participation_mode='isolated' FOR UPDATE`;
      if (!active) {
        await tx`UPDATE fetch_runs SET status='skipped',finished_at=now() WHERE id=${run!.id}`;
        return skipped;
      }
      const existing = await tx<{ identity_key: string }[]>`
        SELECT identity_key FROM articles WHERE identity_key=ANY(${leads.map(lead => lead.identityKey)}::text[])`;
      const known = new Set(existing.map(item => item.identity_key));
      let created = 0;
      for (const { identityKey, title, url, publisher } of leads) {
        if (known.has(identityKey)) continue;
        const material = await upsertMaterial({
          sourceId: QUEENSLAND_LEADS_ID, identityKey, title, url,
          language: "en", publishedAt: null, bodyStatus: "unconfirmed", via: "qld-google-news-rss",
          raw: { qldNewsLead: { publisher, feedUrl: QUEENSLAND_NEWS_RSS, publicationDateUnknown: true } },
        }, tx);
        if (material.created) created++;
      }
      await tx`UPDATE fetch_runs SET status='ok',finished_at=now(),found_count=${leads.length},new_count=${created},
        detail=detail || ${tx.json({ received })}::jsonb WHERE id=${run!.id}`;
      await tx`UPDATE sources SET health='ok',last_fetch_at=now(),last_ok_at=now(),last_error=NULL,fail_count=0,
        next_fetch_at=now()+make_interval(mins=>interval_minutes),updated_at=now() WHERE id=${QUEENSLAND_LEADS_ID}`;
      return { status: "ok" as const, received, found: leads.length, created };
    });
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error).slice(0, 1000);
    await sql.begin(async tx => {
      await tx`UPDATE fetch_runs SET status='failed',finished_at=now(),error=${message} WHERE id=${run!.id}`;
      await tx`UPDATE sources SET health=CASE WHEN NOT enabled THEN 'paused' WHEN fail_count>=4 THEN 'failing' ELSE 'degraded' END,
        last_fetch_at=now(),last_error=${message},fail_count=fail_count+1,
        next_fetch_at=now()+make_interval(mins=>interval_minutes),updated_at=now() WHERE id=${QUEENSLAND_LEADS_ID}`;
    });
    throw error;
  }
}
