import { XMLParser, XMLValidator } from "fast-xml-parser";
import { sql } from "@aihot/backend/db";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { runOwner } from "@aihot/backend/jobs/runs";
import { guardedFetch, requireOk } from "@aihot/backend/lib/http-fetch";
import { sha256 } from "@aihot/backend/lib/ids";
import { collapseWhitespace, decodeEntities } from "@aihot/backend/lib/text";

export const QUEENSLAND_LEADS_ID = "qld-google-news-leads";
export const QUEENSLAND_NEWS_RSS = "https://news.google.com/rss/search?q=site%3Awww.migration.qld.gov.au%2Fnews&hl=en-AU&gl=AU&ceid=AU%3Aen";

export const QUEENSLAND_BACKUP_RSS = "https://visaradar-au.github.io/visaradar/states/qld/news.xml";
const previousSourceName = "昆州移民新闻 · Google 新闻 RSS（待审线索）";
const sourceName = "昆州移民新闻 · RSS（待审线索）";

const feeds = { google: QUEENSLAND_NEWS_RSS, visaradar: QUEENSLAND_BACKUP_RSS };
type Feed = keyof typeof feeds;
const googleOrigin = "https://news.google.com";
const queenslandOrigins = new Set(["https://www.migration.qld.gov.au", "https://migration.qld.gov.au"]);
const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: false, processEntities: false });

type RssItem = { title?: unknown; link?: unknown; source?: { "@_url"?: unknown } };
type Lead = { identityKey: string; title: string; url: string; publisher: string };

function readUrl(value: unknown): URL | null {
  const url = typeof value === "string" ? URL.parse(decodeEntities(value)) : null;
  return url && !url.username && !url.password ? url : null;
}

function readLeads(xml: string, feed: Feed) {
  if (/<!DOCTYPE/i.test(xml) || XMLValidator.validate(xml) !== true) throw new Error("Invalid Queensland news RSS");
  const { rss } = parser.parse(xml) as { rss?: { channel?: { title?: unknown; item?: RssItem | RssItem[] } } };
  const channel = rss?.channel;
  const title = channel?.title;
  if (!channel || typeof title !== "string" || !(feed === "google"
    ? title.includes("site:www.migration.qld.gov.au/news") : title === "VisaRadar: Queensland migration news")) {
    throw new Error("Unexpected Queensland RSS channel");
  }
  const entries = Array.isArray(channel.item) ? channel.item : channel.item ? [channel.item] : [];
  const leads = new Map<string, Lead>();
  for (const item of entries) {
    const link = readUrl(item?.link);
    if (!link) continue;
    const fromGoogle = feed === "google";
    const publisher = fromGoogle ? readUrl(item?.source?.["@_url"]) : link;
    if (!publisher || !queenslandOrigins.has(publisher.origin)) continue;
    if (fromGoogle ? link.origin !== googleOrigin || !/^\/rss\/articles\/[A-Za-z0-9_-]+$/.test(link.pathname)
      : !/^\/news\/[a-z0-9-]+\/?$/i.test(link.pathname)) continue;

    const title = typeof item.title === "string" ? collapseWhitespace(decodeEntities(item.title))
      .replace(/\s+-\s+Migration Queensland$/i, "") : "";
    if (!title || /^(?:Migration Queensland|News(?: from Migration Queensland| for Migration Agents)?)$/i.test(title)) continue;

    // Keep Google identities compatible and fold the official URL's www, query and trailing slash in the backup.
    const pathname = link.pathname.replace(/\/$/, "");
    const identityKey = QUEENSLAND_LEADS_ID + ":" + sha256(pathname);
    const url = fromGoogle ? link.href : link.origin + pathname;
    if (!leads.has(identityKey)) leads.set(identityKey, { identityKey, title, url, publisher: publisher.origin });
  }
  return { received: entries.length, leads: [...leads.values()] };
}

async function readFeed(feed: Feed) {
  const response = requireOk(await guardedFetch(feeds[feed], {
    headers: { accept: "application/rss+xml, application/xml;q=0.9" },
    timeoutMs: 25_000, maxBytes: 1024 * 1024, redirectPolicy: "same-origin",
  }), feed + " Queensland RSS");
  const result = readLeads(response.text(), feed);
  if (!result.leads.length) throw new Error("RSS contained no usable Queensland news links");
  return result;
}

const errorMessage = (error: unknown) => String(error instanceof Error ? error.message : error).slice(0, 350);
const feedStatus = (result: PromiseSettledResult<Awaited<ReturnType<typeof readFeed>>>) =>
  result.status === "fulfilled" ? { status: "ok", found: result.value.leads.length }
    : { status: "failed", error: errorMessage(result.reason) };

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
    const [google, backup] = await Promise.allSettled([readFeed("google"), readFeed("visaradar")]);
    if (google.status === "rejected" && backup.status === "rejected") {
      throw new Error("Google News: " + errorMessage(google.reason) + " | VisaRadar: " + errorMessage(backup.reason));
    }
    const checks = { google: feedStatus(google), visaradar: feedStatus(backup) };
    const feed = google.status === "fulfilled" ? "google" : "visaradar";
    const selected = google.status === "fulfilled" ? google : backup;
    if (selected.status !== "fulfilled") throw new Error("No Queensland feed available");
    const { received, leads } = selected.value;

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
          language: "en", publishedAt: null, bodyStatus: "unconfirmed", via: "qld-" + (feed === "google" ? "google-news" : feed) + "-rss",
          raw: { qldNewsLead: { publisher, feedUrl: feeds[feed], publicationDateUnknown: true } },
        }, tx);
        if (material.created) created++;
      }
      await tx`UPDATE fetch_runs SET status='ok',finished_at=now(),found_count=${leads.length},new_count=${created},
        detail=detail || ${tx.json({ received, feed, checks })}::jsonb WHERE id=${run!.id}`;
      await tx`UPDATE sources SET name=CASE WHEN name=${previousSourceName} THEN ${sourceName} ELSE name END, health='ok',last_fetch_at=now(),last_ok_at=now(),last_error=NULL,fail_count=0,
        next_fetch_at=now()+make_interval(mins=>interval_minutes),updated_at=now() WHERE id=${QUEENSLAND_LEADS_ID}`;
      return { status: "ok" as const, received, found: leads.length, created, feed, checks };
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
