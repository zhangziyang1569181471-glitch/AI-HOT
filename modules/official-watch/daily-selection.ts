import { audit } from "@aihot/backend/audit";
import { sql } from "@aihot/backend/db";
import { collapseWhitespace } from "@aihot/backend/lib/text";
import { normalizeUrl } from "@aihot/backend/lib/url";
import { emit } from "@aihot/backend/modules";
import { publishArticleTx } from "@aihot/backend/publication/publish";

const STATE_HOSTS: Record<string, string> = {
  "au-nsw-news": "nsw.gov.au",
  "au-vic-news": "liveinmelbourne.vic.gov.au",
  "au-sa-news": "migration.sa.gov.au",
  "au-wa-news": "migration.wa.gov.au",
  "au-tas-news": "migration.tas.gov.au",
  "au-nt-migration": "nt.gov.au",
};

const FEDERAL_HOSTS: Record<string, string> = {
  "au-home-affairs-news": "homeaffairs.gov.au",
  "au-home-affairs-portfolio": "homeaffairs.gov.au",
  "au-home-affairs-minister": "homeaffairs.gov.au",
  "au-immigration-assistant-minister": "homeaffairs.gov.au",
  "au-international-education-minister": "homeaffairs.gov.au",
  "au-education-news": "education.gov.au",
  "au-education-ministers": "education.gov.au",
  "au-teqsa-news": "teqsa.gov.au",
  "au-asqa-news": "asqa.gov.au",
  "au-federal-legislation": "legislation.gov.au",
};

const VISA_SOURCES = new Set(Object.keys(FEDERAL_HOSTS).filter(id =>
  id.startsWith("au-home-affairs") || id === "au-immigration-assistant-minister" || id === "au-federal-legislation"));

type Rule = { category: string; label: string; tag: string; topic: RegExp; action: RegExp; visaSource?: true };
const STATE_RULE: Rule = {
  category: "state-nomination", label: "州担保与邀请", tag: "项目更新",
  topic: /\b(?:state nominat(?:ed|ion)|general skilled migration|skilled nomination|skilled migration program(?:me)?|(?:registration of interest|ROI) system|canberra matrix|subclass (?:190|491))\b/i,
  action: /\b(?:update[ds]?|reopen(?:s|ed|ing)?|open(?:s|ed|ing)?|closed?|clos(?:es|ing|ure)|offline|back online|pause[ds]?|allocations?|quota|occupation lists?|invitation rounds?|invitations issued|defence industry stream)\b/i,
};
const FEDERAL_RULES: readonly Rule[] = [
  {
    category: "industry", label: "监管公告", tag: "监管执法",
    topic: /\b(?:registered migration agents?|prohibited employer register|migrant workers?|CRICOS|ESOS)\b/i,
    action: /\b(?:sanction(?:ed|s)?|cancel(?:led|lation)|suspend(?:ed|s|ing)|suspension|ban(?:ned|s)?|enforcement|registration revocation|prosecute[ds]?|amendment|reform)\b/i,
  },
  {
    category: "employer-sponsored", label: "雇主担保公告", tag: "政策变化", visaSource: true,
    topic: /\b(?:employer.sponsor(?:ed|ship)?|sponsor(?:ed|ship) employers?|DAMA|designated area migration agreement|(?:subclass )?(?:482|186|494) visas?)\b/i,
    action: /\b(?:amendment|changes?|reform|new|update[ds]?|requirements?|thresholds?|opened?|closing|extends?)\b/i,
  },
  {
    category: "study-graduates", label: "留学与毕业生公告", tag: "政策变化",
    topic: /\b(?:student visas?|temporary graduate visas?|international education|international students?|overseas students|genuine student|subclass (?:500|485))\b/i,
    action: /\b(?:allocations?|ministerial direction|processing priorit(?:y|ies)|fees?|caps?|amendment|reform|new rules?|changes? (?:to|from|for)|requirements? (?:change|update))\b/i,
  },
  {
    category: "migration-policy", label: "移民政策公告", tag: "政策变化", visaSource: true,
    topic: /\b(?:migration program(?:me)?|skilled migration|permanent migration)\b/i,
    action: /\b(?:planning levels?|amendment|allocations?|quota|occupation lists?|eligibility|reform)\b/i,
  },
  {
    category: "visa-process", label: "签证办理公告", tag: "费用与审理", visaSource: true,
    topic: /\b(?:visas?|SkillSelect|ImmiAccount|Working Holiday Maker)\b/i,
    action: /\b(?:moving to ImmiAccount|service (?:outage|disruption)|maintenance|(?:application )?fees?|charges?|processing priorit(?:y|ies)|processing times|amendment|reform|rules? (?:are )?chang(?:e|ing|ed)|application requirements? (?:change|update))\b/i,
  },
];

const BACKGROUND = /\b(?:interview|transcript|speech|doorstop|webinar|podcast|case study|holiday greetings|success story|newsletter)\b/i;
const RULE_VERSION = "radar-official-daily-selection-v1";
const RECENT_MS = 48 * 60 * 60_000;
const SOURCES = [...Object.keys(STATE_HOSTS), ...Object.keys(FEDERAL_HOSTS)];

type Candidate = {
  id: string; source_id: string; revision: number; url: string; title: string; body_text: string;
  published_at: Date; publication_time: string;
};

function headlineKey(title: string) {
  return title.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function noticeRule({ source_id: source, url, title, body_text: body }: Candidate): Rule | undefined {
  const original = new URL(url);
  if (original.protocol !== "https:" || original.username || original.password || original.port || original.pathname === "/") return;
  const host = STATE_HOSTS[source] ?? FEDERAL_HOSTS[source];
  if (!host || !(original.hostname === host || original.hostname.endsWith("." + host)) || BACKGROUND.test(title)) return;
  const rules = STATE_HOSTS[source] ? [STATE_RULE] : FEDERAL_RULES;
  return rules.find(rule => (!rule.visaSource || VISA_SOURCES.has(source))
    && rule.topic.test(title) && rule.action.test(title) && rule.topic.test(body));
}

/** The collection job may be retried, and an editor may already have decided on a candidate. */
export async function selectOfficialDaily({ dryRun = false, now = new Date() } = {}) {
  const recent = new Date(now.getTime() - RECENT_MS);
  return sql.begin(dryRun ? "read only" : "read write", async tx => {
    if (!dryRun) await tx`SELECT pg_advisory_xact_lock(hashtext('radar-official-daily-selection'))`;
    const candidates = await tx<Candidate[]>`
      SELECT a.id, a.source_id, a.revision, a.url, a.title, a.body_text, a.published_at, a.publication_time
      FROM articles a JOIN sources s ON s.id=a.source_id
      WHERE s.id=ANY(${SOURCES}) AND s.enabled AND s.kind IN ('rss','web_list','json_list')
        AND s.tier='T1' AND s.participation_mode='editorial' AND NOT s.site_fulltext
        AND NOT a.backfill AND a.body_status='ok' AND btrim(coalesce(a.body_text,''))<>''
        AND a.published_at BETWEEN ${recent} AND ${now} AND nullif(a.publication_time,'') IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM analyses WHERE article_id=a.id)
        AND NOT EXISTS (SELECT 1 FROM editorial_overrides WHERE article_id=a.id)
        AND NOT EXISTS (SELECT 1 FROM publications WHERE article_id=a.id AND (selected OR visibility<>'public'))
      ORDER BY a.published_at DESC, a.id
      ${dryRun ? tx`` : tx`FOR UPDATE OF a`}`;
    const published = await tx<{ title: string; url: string }[]>`
      SELECT a.title, p.url FROM publications p JOIN articles a ON a.id=p.article_id
      WHERE p.selected AND p.visibility='public' AND (p.published_at >= ${recent} OR p.visible_after >= ${recent})`;
    const urls = new Set(published.map(row => normalizeUrl(row.url)));
    const headlines = new Set(published.map(row => headlineKey(row.title)));
    const selectedIds: string[] = [];
    let duplicates = 0;
    for (const row of candidates) {
      const url = normalizeUrl(row.url);
      if (!url) continue;
      const rule = noticeRule(row);
      if (!rule) continue;
      const headline = headlineKey(row.title);
      if (urls.has(url) || headlines.has(headline)) {
        duplicates++;
        continue;
      }
      if (!dryRun) {
        // The article lock may have waited for an editor or another analysis to commit.
        const [decided] = await tx`
          SELECT 1 FROM editorial_overrides WHERE article_id=${row.id}
          UNION ALL SELECT 1 FROM analyses WHERE article_id=${row.id} LIMIT 1`;
        if (decided) continue;
      }
      urls.add(url);
      headlines.add(headline);
      selectedIds.push(row.id);
      if (dryRun) continue;

      const title = collapseWhitespace(row.title);
      const reason = "有明确日期的官方公告，标题和正文均涉及日榜关注的政策事项。";
      await tx`UPDATE articles SET processing_state='analyzed', processing_error=NULL, processing_retry_at=NULL,
        grouping_status='complete', grouped_at=now(), selection_adds_value=true, updated_at=now() WHERE id=${row.id}`;
      await tx`INSERT INTO analyses(article_id,input_revision,origin,prompt_version,relevance,category,tags,title_zh,summary_zh,reason_zh,selected,output)
        VALUES(${row.id},${row.revision},'rule',${RULE_VERSION},'pass',${rule.category},${[rule.tag]},
        ${title},${rule.label + "。具体适用范围、日期和要求见官网原文。"},${reason},true,
        ${tx.json({ mode: RULE_VERSION, sourceDate: row.publication_time, sourceUrl: row.url })})`;
      const { selected, visibility } = await publishArticleTx(tx, row.id, { releasedAt: now }) ?? {};
      if (!selected || visibility !== "public") throw new Error("Could not publish official daily selection: " + row.id);
      await audit("radar-daily-selection", "content.rule-selected", "content:" + row.id, reason, null,
        { rule: RULE_VERSION, category: rule.category, revision: row.revision }, { db: tx });
      await emit("articleChanged", { id: row.id, kind: "content", reduced: false, reason }, tx);
    }
    return { examined: candidates.length, selected: selectedIds.length, duplicates, selectedIds };
  });
}
