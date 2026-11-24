import { guardedFetch, requireOk } from "@aihot/backend/lib/http-fetch";
import { contentDocument } from "@aihot/backend/lib/page-content";
import { collapseWhitespace, stripTagMarkup } from "@aihot/backend/lib/text";
import { jinaRead } from "@aihot/backend/providers/jina";

export const ACT_INVITATION_RANKINGS = "https://www.act.gov.au/migration/resources/library-guidelines-and-invitations";
export const VISA_PRICING = "https://immi.homeaffairs.gov.au/visas/getting-a-visa/fees-and-charges/current-visa-pricing/";
export const STUDENT_PROCESSING_PRIORITIES = "https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-processing-times/visa-processing-priorities/student-visa";

export type WatchEvidence = {
  resources: string[];
  records?: number;
  roundDates?: string[];
};

export interface EnrichedWatch {
  text: string;
  evidence: WatchEvidence;
}

const clean = (value: string) => collapseWhitespace(value.replace(/[\u200b-\u200d\ufeff]/g, ""));

export async function readActRankingDocument(html: string): Promise<EnrichedWatch> {
  const links = [...contentDocument(html).querySelectorAll("#main a[href]")];
  const files = links.flatMap(link => {
    const label = clean(link.textContent);
    const year = label.match(/\b(20\d{2})\s*[-–—]\s*\d{2}\s+Invitation round rankings\b/i)?.[1];
    const href = link.getAttribute("href");
    if (!year || !href) return [];
    const url = new URL(href, ACT_INVITATION_RANKINGS);
    if (url.origin !== new URL(ACT_INVITATION_RANKINGS).origin || url.username || url.password
      || !url.pathname.startsWith("/__data/assets/pdf_file/") || !/\.pdf$/i.test(url.pathname)) return [];
    return [{ year, url: url.toString() }];
  }).sort((a, b) => b.year.localeCompare(a.year));
  const file = files[0];
  if (!file) throw new Error("ACT library has no official invitation rankings PDF");
  const { markdown } = await jinaRead(file.url, {
    purpose: "act_invitation_rankings", subject: "source:au-act-invitation-rankings",
    anonymous: true, cacheToleranceSeconds: 900,
  });
  const rankingText = clean(markdown);
  const dates = [...rankingText.matchAll(/ACT INVITATION ROUND\s+(\d{1,2}\s+[A-Za-z]+\s+20\d{2})/gi)].map(match => match[1]!);
  if (!dates.length || !/Minimum Matrix score ranked/i.test(rankingText)
      || !/Canberra resident/i.test(rankingText) || !/Overseas applicant/i.test(rankingText)) {
    throw new Error("ACT document is missing invitation round scores");
  }
  return {
    text: file.url + "\n\n" + rankingText,
    evidence: { resources: [file.url], roundDates: [...new Set(dates)] },
  };
}

const GET_PRICES = "/_layouts/15/api/data.aspx/GetPriceList";
const PRICE_FIELDS = [
  "visaSubclassCode", "visaSubclassText", "streamCode", "streamText", "onShore",
  "basePrice", "over18Price", "under18Price", "nonInternetPrice", "subsequentPrice", "note",
] as const;

/** The pricing widget declares its public read-only POST in the page. Read its JSON settings as data. */
export async function readVisaPriceRows(html: string, pageText: string): Promise<EnrichedWatch> {
  const scripts = [...contentDocument(html).querySelectorAll("main script")];
  const script = scripts.find(node => node.textContent.includes(GET_PRICES));
  const declared = script?.textContent.match(/\b(?:var|const|let)\s+configJson\s*=\s*(\{[\s\S]*?\})\s*;\s*(?:var|const|let)\s+stringifiedConfig\b/)?.[1];
  if (!declared) throw new Error("Visa pricing widget is missing its public table configuration");
  const settings = JSON.parse(declared);
  const params = typeof settings.endpointParm === "string" ? JSON.parse(settings.endpointParm) : settings.endpointParm;
  if (settings.endpointUrl !== GET_PRICES || params?.onshore !== "All" || params?.category !== "Visa") {
    throw new Error("Visa pricing page no longer declares the supported all-visa query");
  }

  const url = new URL(GET_PRICES, VISA_PRICING).toString();
  const response = requireOk(await guardedFetch(url, {
    method: "POST",
    headers: { "user-agent": "node", "content-type": "application/json; charset=utf-8", accept: "application/json",
      "accept-language": "en-AU,en;q=0.9", referer: VISA_PRICING },
    body: JSON.stringify({ onshore: "All", category: "Visa" }),
    redirectPolicy: "same-origin",
    timeoutMs: 25_000,
    maxBytes: 3_000_000,
  }));
  const table = JSON.parse(response.text()).d;
  if (table?.success !== true || !Array.isArray(table.data) || !table.data.length) {
    throw new Error("Official visa pricing response has no charge rows");
  }
  const rows = table.data.map((row: Record<string, unknown>) => {
    if (!row || typeof row.visaSubclassText !== "string" || !clean(row.visaSubclassText)
      || typeof row.basePrice !== "string" || !clean(row.basePrice)) {
      throw new Error("Official visa pricing response contains an incomplete charge row");
    }
    return PRICE_FIELDS.map(field => {
      const raw = row[field];
      const value = typeof raw === "string" ? clean(stripTagMarkup(raw)) : "";
      return field + "=" + value;
    }).join(" | ");
  }).sort();
  const columns = Array.isArray(settings.columns) ? settings.columns.map((column: { name?: string; heading?: string }) =>
    clean((column.name ?? "") + " " + (column.heading ?? ""))).join(" | ") : "";
  return {
    text: [clean(pageText), columns, ...rows].join("\n"),
    evidence: { resources: [url], records: rows.length },
  };
}

export function readStudentPriorityRules(html: string, pageText: string): EnrichedWatch {
  const text = clean(pageText);
  if (!/Student visa processing priorities/i.test(text)
    || !/Applications lodged by students inside Australia/i.test(text)
    || !/Applications lodged by students outside Australia/i.test(text)
    || !/Priority\s+1/i.test(text)) throw new Error("Student visa page is missing its priority rules");

  const resources = ministerialDirectionLinks(html, STUDENT_PROCESSING_PRIORITIES);
  if (!resources.length) throw new Error("Student visa page has no official ministerial direction links");
  return { text: [text, ...resources].join("\n"), evidence: { resources } };
}

export function ministerialDirectionLinks(html: string, pageUrl: string): string[] {
  const links = [...contentDocument(html).querySelectorAll("main a[href]")];
  const directions = links.flatMap(link => {
    const href = link.getAttribute("href");
    if (!href || !/Ministerial Direction\s+\d+/i.test(clean(link.textContent))) return [];
    const url = new URL(href, pageUrl);
    return url.origin === new URL(pageUrl).origin && !url.username && !url.password && /\.pdf$/i.test(url.pathname) ? [url.toString()] : [];
  });
  return [...new Set(directions)].sort();
}
