import { strFromU8, unzipSync } from "fflate";
import { guardedFetch, requireOk } from "@aihot/backend/lib/http-fetch";
import { contentDocument } from "@aihot/backend/lib/page-content";
import { collapseWhitespace, stripTags } from "@aihot/backend/lib/text";
import { ministerialDirectionLinks, type EnrichedWatch } from "./government-snapshots.ts";

export const PROVIDER_PRIORITIES = "https://www.education.gov.au/managed-system-international-education/resources/visa-prioritisation-status";
export const EMPLOYER_SALARIES = "https://immi.homeaffairs.gov.au/employer-subsite/Pages/salary-requirements.aspx";
export const VICTORIAN_POINTS_TEST = "https://liveinmelbourne.vic.gov.au/migrate/skilled-migration-visas/vpt";
export const SKILLED_PROCESSING_PRIORITIES = "https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-processing-times/visa-processing-priorities/skilled-visa";
export const NSW_SKILLS_LISTS = "https://www.nsw.gov.au/visas-and-migration/skilled-visas/nsw-skills-lists";
export const TRA_FEES = "https://www.tradesrecognitionaustralia.gov.au/fees-1";

const clean = (value: string) => collapseWhitespace(value.replace(/[\u200b-\u200d\ufeff]/g, ""));

type AustralianResource = "provider-index" | "provider-document" | "tra-fees";

const australianOrigin = process.env.RADAR_AU_COLLECTOR_ORIGIN;
const australianCollectorKey = process.env.RADAR_AU_COLLECTOR_KEY;

async function australianDocument(resource: AustralianResource, publisherUrl: string) {
  const options = { timeoutMs: 25_000, maxBytes: 2 * 1024 * 1024, redirectPolicy: "same-origin" as const };
  if (!australianOrigin && !australianCollectorKey) {
    return requireOk(await guardedFetch(publisherUrl, { ...options, headers: { "accept-language": "en-AU,en;q=0.9" } }), resource);
  }
  const relay = australianOrigin ? new URL(australianOrigin) : null;
  if (!relay || relay.protocol !== "https:" || !relay.hostname.endsWith(".vercel.app")
    || relay.port || relay.username || relay.password || !australianCollectorKey) {
    throw new Error("Australian government collector requires a Vercel HTTPS origin and an automation secret");
  }
  const target = new URL("/api/official-source", relay);
  target.searchParams.set("resource", resource);
  if (resource === "provider-document") target.searchParams.set("path", new URL(publisherUrl).pathname);
  return requireOk(await guardedFetch(target.toString(), {
    ...options, maxRedirects: 0,
    headers: { authorization: "Bearer " + australianCollectorKey, "x-vercel-protection-bypass": australianCollectorKey },
  }), resource);
}

export const australianWatchTransport = australianOrigin ? "regional-https" : "direct-https";

export function providerPriorityDocument(archive: Uint8Array, resource: string): EnrichedWatch {
  const wordPath = "word/document.xml";
  const xml = unzipSync(archive, { filter: item => item.name === wordPath && item.originalSize <= 4 * 1024 * 1024 })[wordPath];
  if (!xml) throw new Error("Education Department DOCX has no readable document XML");
  const document = contentDocument(strFromU8(xml));
  const line = (node: { querySelectorAll(selector: string): Iterable<{ textContent: string }> }) =>
    clean([...node.querySelectorAll("w\\:t")].map(part => part.textContent).join(""));
  const text = [...document.querySelectorAll("w\\:p, w\\:tr")].flatMap(node => {
    if (node.localName === "w:tr") {
      return [[...node.querySelectorAll("w\\:tc")].map(line).join(" | ")];
    }
    return node.closest("w\\:tr") ? [] : [line(node)];
  }).filter(Boolean).join("\n");
  const records = new Set([...text.matchAll(/^\s*(\d{5}[A-Z])\s*\|.+?\bPriority\s+[123]\b/gim)].map(match => match[1]));
  if (!/International Education Providers/i.test(text)
    || !/Progress Against Indicative Allocations/i.test(text) || records.size < 10) {
    throw new Error("Education Department DOCX has no readable provider priority rows");
  }
  return { text: resource + "\n\n" + text, evidence: { resources: [PROVIDER_PRIORITIES, resource], records: records.size } };
}

export async function readProviderPriorities() {
  const index = await australianDocument("provider-index", PROVIDER_PRIORITIES);
  const links = [...contentDocument(index.text()).querySelectorAll("main a[href]")];
  const files = links.map(link => new URL(link.getAttribute("href")!, PROVIDER_PRIORITIES));
  const docx = files.find(url => url.origin === new URL(PROVIDER_PRIORITIES).origin && !url.username && !url.password
    && /^\/download\/\d+\/visa-prioritisation-status\/\d+\/current-snapshot\/docx\/?$/i.test(url.pathname));
  if (!docx) throw new Error("Education Department page has no current snapshot DOCX");
  const resource = docx.toString();
  const document = await australianDocument("provider-document", resource);
  return { ...providerPriorityDocument(document.body, resource), title: "Visa Prioritisation Status – Current snapshot" };
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

export async function readTraFeesSnapshot() {
  const response = await australianDocument("tra-fees", TRA_FEES);
  const html = response.text();
  const page = contentDocument(html);
  const title = page.querySelector("h1")?.textContent.trim() || "Trade Recognition Australia fees";
  const main = page.querySelector("main");
  main?.querySelectorAll("script,style,nav,footer,header,form").forEach(node => node.remove());
  return { ...readTraFees(html, clean(main?.textContent ?? title)), title };
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

const TRAINING_ORGANISATION = "https://training.gov.au/api/organisation/90003?include=all";
const TRAINING_SCOPE = "https://training.gov.au/api/organisation/90003/scopesummary";

type RegisterEntry = { startDate: string; endDate?: string };
type TrainingOrganisation = {
  code: string;
  isRto: boolean;
  rtoStatusLabel: string;
  legalNames: (RegisterEntry & { name: string })[];
  tradingNames: (RegisterEntry & { name: string })[];
  registrationManagers: (RegisterEntry & { name: string })[];
  registrations: (RegisterEntry & { legalAuthority: string; exerciser: string })[];
  regulatoryDecisions: { isHistoric: boolean; reference: string; decision: string; effectiveDate: string }[];
};
type TrainingScope = {
  accreditedCourses: number;
  accreditedUnitsExplicit: number;
  accreditedUnitsImplicit: number;
  trainingPackages: { code: string; title: string; qualifications: number; skillSets: number; unitsExplicit: number; unitsImplicit: number }[];
};

export function readTrainingRegister(organisation: TrainingOrganisation, scope: TrainingScope): EnrichedWatch {
  const latest = <T extends RegisterEntry>(entries: T[] | undefined) =>
    entries?.reduce<T | undefined>((record, entry) => !record || entry.startDate > record.startDate ? entry : record, undefined);
  const name = latest(organisation.legalNames)?.name;
  const tradingName = latest(organisation.tradingNames)?.name;
  const manager = latest(organisation.registrationManagers)?.name;
  const registration = latest(organisation.registrations);
  if (organisation.code !== "90003" || !organisation.isRto || !name || !manager || !registration?.startDate
    || !organisation.rtoStatusLabel || !Number.isInteger(scope.accreditedCourses)
    || !Number.isInteger(scope.accreditedUnitsExplicit) || !Number.isInteger(scope.accreditedUnitsImplicit)
    || !Array.isArray(organisation.regulatoryDecisions) || !Array.isArray(scope.trainingPackages)
    || scope.trainingPackages.some(item => !item.code || !item.title
      || ![item.qualifications, item.skillSets, item.unitsExplicit, item.unitsImplicit].every(Number.isInteger))
    || organisation.regulatoryDecisions.some(item => typeof item.isHistoric !== "boolean" || !item.reference || !item.decision)) {
    throw new Error("National Training Register returned no verified registration, decisions and scope for RTO 90003");
  }
  const decisions = organisation.regulatoryDecisions.map(item =>
    [item.isHistoric ? "Historic" : "Current", item.reference, item.effectiveDate, clean(item.decision)].join(" | ")).sort();
  const packages = scope.trainingPackages.map(item =>
    [item.code, clean(item.title), item.qualifications, item.skillSets, item.unitsExplicit, item.unitsImplicit].join(" | ")).sort();
  const text = [
    "Code: " + organisation.code,
    "Legal name: " + name,
    tradingName ? "Business name: " + tradingName : "",
    "Status: " + organisation.rtoStatusLabel,
    "Registration manager: " + manager,
    "Start date: " + registration.startDate,
    registration.endDate ? "End date: " + registration.endDate : "",
    registration.legalAuthority ? "Legal authority: " + registration.legalAuthority : "",
    registration.exerciser ? "Exerciser: " + registration.exerciser : "",
    organisation.regulatoryDecisions.some(item => !item.isHistoric) ? "" : "No current regulatory decisions",
    ...decisions,
    "Accredited courses: " + scope.accreditedCourses,
    "Accredited units (explicit): " + scope.accreditedUnitsExplicit,
    "Accredited units (implicit): " + scope.accreditedUnitsImplicit,
    "Training packages (code | title | qualifications | skill sets | explicit units | implicit units)",
    ...packages,
  ].filter(Boolean).join("\n");
  return { text, evidence: { resources: [TRAINING_REGISTER_RTO, TRAINING_ORGANISATION, TRAINING_SCOPE], records: 1 } };
}

export async function readTrainingRegisterSnapshot() {
  const fetchJson = async (url: string) => JSON.parse(requireOk(await guardedFetch(url, {
    headers: { accept: "application/json" }, redirectPolicy: "same-origin", timeoutMs: 20_000,
  }), "training register data").text());
  const [organisation, scope] = await Promise.all([fetchJson(TRAINING_ORGANISATION), fetchJson(TRAINING_SCOPE)]);
  return { ...readTrainingRegister(organisation, scope), title: "National Training Register – RTO 90003 (TAFE NSW)" };
}
