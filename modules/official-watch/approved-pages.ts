import { guardedFetch, requireOk } from "@aihot/backend/lib/http-fetch";
import { contentDocument } from "@aihot/backend/lib/page-content";
import { collapseWhitespace, stripTags } from "@aihot/backend/lib/text";
import { jinaRead } from "@aihot/backend/providers/jina";
import { ministerialDirectionLinks, type EnrichedWatch } from "./government-snapshots.ts";

export const PROVIDER_PRIORITIES = "https://www.education.gov.au/managed-system-international-education/resources/visa-prioritisation-status";
export const EMPLOYER_SALARIES = "https://immi.homeaffairs.gov.au/employer-subsite/Pages/salary-requirements.aspx";
export const VICTORIAN_POINTS_TEST = "https://liveinmelbourne.vic.gov.au/migrate/skilled-migration-visas/vpt";
export const SKILLED_PROCESSING_PRIORITIES = "https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-processing-times/visa-processing-priorities/skilled-visa";
export const NSW_SKILLS_LISTS = "https://www.nsw.gov.au/visas-and-migration/skilled-visas/nsw-skills-lists";
export const TRA_FEES = "https://www.tradesrecognitionaustralia.gov.au/fees-1";

const clean = (value: string) => collapseWhitespace(value.replace(/[\u200b-\u200d\ufeff]/g, ""));

export async function readProviderPriorities(html: string): Promise<EnrichedWatch> {
  const links = [...contentDocument(html).querySelectorAll("main a[href]")];
  const files = links.map(link => new URL(link.getAttribute("href")!, PROVIDER_PRIORITIES));
  const pdf = files.find(url => url.origin === new URL(PROVIDER_PRIORITIES).origin && !url.username && !url.password
    && /^\/download\/\d+\/visa-prioritisation-status\/\d+\/current-snapshot\/pdf\/?$/i.test(url.pathname));
  if (!pdf) throw new Error("Education Department page has no current snapshot PDF");
  const resource = pdf.toString();
  const { markdown } = await jinaRead(resource, {
    purpose: "education_provider_priorities", subject: "source:au-education-provider-priorities",
    anonymous: true, cacheToleranceSeconds: 900,
  });
  const records = new Set([...markdown.matchAll(/^\s*\|?\s*(\d{5}[A-Z])(?:\s+|\s*\|).+?\bPriority\s+[123]\b/gim)].map(match => match[1]));
  if (!/International Education Providers/i.test(markdown)
    || !/Progress Against Indicative Allocations/i.test(markdown) || records.size < 10) {
    throw new Error("Education Department PDF has no readable provider priority rows");
  }
  return { text: resource + "\n\n" + markdown.trim(), evidence: { resources: [resource], records: records.size } };
}

export function readEmployerSalaries(html: string, pageText: string): EnrichedWatch {
  // SharePoint renders these public tabs from JSON embedded in the page.
  const schema = contentDocument(html).querySelector('input[id$="PageSchemaHiddenField_Input"]')?.getAttribute("value");
  const content: unknown = schema ? JSON.parse(schema).content : undefined;
  const tabs = Array.isArray(content) ? content.flatMap(tab =>
    typeof tab?.text === "string" && typeof tab?.block === "string"
      ? [clean(tab.text), clean(stripTags(tab.block))] : []) : [];
  const text = [pageText, ...tabs].join("\n");
  const thresholds = ["CSIT", "SSIT", "TSMIT"];
  const amounts = [...new Set(text.match(/(?:AUD\s*\$?|\$)\s*\d[\d,]*/g))];
  if (!thresholds.every(term => text.includes(term)) || !/Annual Market Salary Rate/i.test(text) || amounts.length < 3) {
    throw new Error("Home Affairs page is missing employer salary thresholds");
  }
  return { text, evidence: { resources: [EMPLOYER_SALARIES], records: amounts.length } };
}

export function readVictorianPointsTest(_html: string, text: string): EnrichedWatch {
  if (!/Victorian Points Test/i.test(text) || !/Registrations of Interest/i.test(text)
    || !/subclass 190/i.test(text) || !/subclass 491/i.test(text) || !/weighted factors/i.test(text)) {
    throw new Error("Victoria page is missing VPT ranking criteria");
  }
  return { text, evidence: { resources: [VICTORIAN_POINTS_TEST] } };
}

export function readSkilledPriorityRules(html: string, text: string): EnrichedWatch {
  const resources = ministerialDirectionLinks(html, SKILLED_PROCESSING_PRIORITIES);
  if (!/Temporary Skilled visa applications/i.test(text) || !/permanent Skilled visa applications/i.test(text)
    || !/order of priority/i.test(text) || resources.length < 2) {
    throw new Error("Home Affairs page is missing skilled visa priority rules or their direction links");
  }
  return { text: [text, ...resources].join("\n"), evidence: { resources } };
}

export function readNswSkillsLists(html: string, text: string): EnrichedWatch {
  const rows = [...contentDocument(html).querySelectorAll("main table tr")].flatMap(row => {
    const cells = [...row.querySelectorAll("td")].map(cell => clean(cell.textContent));
    return /^\d{4}$/.test(cells[0] ?? "") && cells[1] ? [cells.join(" | ")] : [];
  });
  if (!/ANZSCO/i.test(text) || !/subclass 190/i.test(text) || !/subclass 491/i.test(text) || !rows.length) {
    throw new Error("NSW page is missing ANZSCO entries or its 190/491 guidance");
  }
  return { text: [text, ...rows].join("\n"), evidence: { resources: [NSW_SKILLS_LISTS], records: rows.length } };
}

export function readTraFees(html: string, text: string): EnrichedWatch {
  const images = [...contentDocument(html).querySelectorAll("main article img[alt][src]")];
  const table = images.find(image => /assessment service fees in AUD/i.test(image.getAttribute("alt")!));
  const fees = clean(table?.getAttribute("alt") ?? "");
  const amounts = fees.match(/\$\s*[\d,]+/g) ?? [];
  if (!table || !/Job Ready Employment/i.test(fees) || !/Workplace Assessment/i.test(fees)
    || !/Final Assessment/i.test(fees) || amounts.length < 3) {
    throw new Error("TRA page is missing the Job Ready fee table text");
  }
  const image = new URL(table.getAttribute("src")!, TRA_FEES);
  if (image.origin !== new URL(TRA_FEES).origin) throw new Error("TRA fee table has an unexpected image origin");
  return { text: [text, fees, image.toString()].join("\n"), evidence: { resources: [TRA_FEES, image.toString()], records: amounts.length } };
}

function cricosInstitution(code: string) {
  return "https://cricos.education.gov.au/Institution/InstitutionDetails.aspx?ProviderCode=" + code;
}

export const CRICOS_PRIMARY = cricosInstitution("00586B");
export const TRAINING_REGISTER_RTO = "https://training.gov.au/organisation/details/90003";

export function cricosRecord(html: string, code: string) {
  const doc = contentDocument(html);
  const field = (suffix: string) => clean(doc.querySelector(`[id$="_${suffix}"]`)?.textContent ?? "");
  const name = field("institutionDetail_lblInstitutionName");
  if (field("institutionDetail_lblProviderCode") !== code || !name || !doc.querySelector('[id$="_locationList_gridSearchResults"]')) {
    throw new Error("CRICOS returned no public registration record for " + code);
  }
  const rows = (section: string) => [...doc.querySelectorAll(`[id$="_${section}_gridSearchResults"] tr`)].flatMap(row => {
    const cells = [...row.querySelectorAll("td")].map(cell => clean(cell.textContent));
    return cells.length === 3 && /^\d+$/.test(cells[2]!) ? [cells.join(" | ")] : [];
  }).sort();
  const locations = rows("locationList");
  const courses = rows("courseList");
  return [
    name + " | CRICOS " + code,
    field("lblNationalRego"),
    "Institution type: " + field("institutionDetail_lblInstitutionType"),
    "Total capacity: " + field("institutionDetail_lblLocationCapacity"),
    "Locations (name | state | course count)", ...locations,
    "Courses displayed (name | level | duration in weeks)", ...courses,
  ].filter(Boolean).join("\n");
}

export async function readCricosRecords(primaryHtml: string): Promise<EnrichedWatch> {
  const secondaryCode = "00591E";
  const secondaryUrl = cricosInstitution(secondaryCode);
  const response = requireOk(await guardedFetch(secondaryUrl, { timeoutMs: 20_000, redirectPolicy: "same-origin" }));
  return {
    text: [cricosRecord(primaryHtml, "00586B"), cricosRecord(response.text(), secondaryCode)].join("\n\n"),
    evidence: { resources: [CRICOS_PRIMARY, secondaryUrl], records: 2 },
  };
}

export function readTrainingRegister(html: string): EnrichedWatch {
  const doc = contentDocument(html);
  const fields = new Map([...doc.querySelectorAll("#summaryTab table tr")].flatMap(row => {
    const cells = [...row.querySelectorAll("td")].map(cell => clean(cell.textContent));
    return cells.length === 2 ? [[cells[0]!, cells[1]!] as const] : [];
  }));
  const decisions = clean(doc.querySelector("#ASQARegDecInfo")?.textContent ?? "");
  const scope = doc.querySelector('[role="tabpanel"][id^="scope_overviewtab_"]');
  const scopeCounts = [...(scope?.querySelectorAll("li") ?? [])].map(item => clean(item.textContent))
    .filter(label => /^[\d,]+\s+accredited (?:courses|units)\b/i.test(label));
  const scopeRows = [...(scope?.querySelectorAll("tbody tr") ?? [])].flatMap(row => {
    const cells = [...row.querySelectorAll("td")].map(cell => clean(cell.textContent));
    return cells.length > 1 && cells[0] ? [cells.join(" | ")] : [];
  }).sort();
  if (fields.get("Code") !== "90003" || !fields.get("Legal name") || !fields.get("Status")
    || !fields.get("Registration manager") || !decisions || !scope || !(scopeRows.length || scopeCounts.length)) {
    throw new Error("National Training Register returned no verified registration, decisions and scope for RTO 90003");
  }
  const labels = ["Code", "Legal name", "Business name(s)", "Status", "Registration manager", "Initial registration date",
    "Start date", "End date", "Legal authority", "Exerciser"];
  return {
    text: [...labels.filter(label => fields.has(label)).map(label => label + ": " + fields.get(label)),
      decisions, ...scopeCounts, ...scopeRows].join("\n"),
    evidence: { resources: [TRAINING_REGISTER_RTO], records: 1 },
  };
}
