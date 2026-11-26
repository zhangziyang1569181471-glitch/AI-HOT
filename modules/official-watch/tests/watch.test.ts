import "../../../tests/setup.ts";
import assert from "node:assert/strict";
import { syncBuiltinESMExports } from "node:module";
import { after, mock, test } from "node:test";
import timersPromises from "node:timers/promises";
import { strToU8, zipSync } from "fflate";
import { MockAgent, getGlobalDispatcher, setGlobalDispatcher } from "undici";
import { config } from "@aihot/backend/config";
import { closeDb, sql } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { watchOfficialPage } from "../watch.ts";
import { selectOfficialDaily } from "../daily-selection.ts";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { loadTimeline } from "@aihot/backend/publication/timeline";
import { collectQueenslandNewsLeads, QUEENSLAND_BACKUP_RSS, QUEENSLAND_LEADS_ID, QUEENSLAND_NEWS_RSS } from "../qld-news-leads.ts";
import { parseTasmaniaRound } from "../tasmania.ts";
import { readStudentPriorityRules } from "../government-snapshots.ts";
import { cricosRecord, providerPriorityDocument, readEmployerSalaries, readTraFees, readTrainingRegister } from "../approved-pages.ts";

const sourceId = "au-act-news";
const dispatcher = getGlobalDispatcher();
const previousPrivate = config.allowPrivateNetworkFetch;
const previousProxy = config.egressProxyUrl;
const network = new MockAgent();
network.disableNetConnect();
setGlobalDispatcher(network);
config.allowPrivateNetworkFetch = true;
config.egressProxyUrl = null;
// The provider's pacing is not under test; all requests are local undici fixtures.
mock.method(timersPromises, "setTimeout", async () => undefined);
syncBuiltinESMExports();

after(async () => {
  mock.restoreAll();
  syncBuiltinESMExports();
  config.allowPrivateNetworkFetch = previousPrivate;
  config.egressProxyUrl = previousProxy;
  setGlobalDispatcher(dispatcher);
  await network.close();
  await stopBoss();
  await closeDb();
});

async function enable() {
  await sql`INSERT INTO sources(id,name,kind,tier,first_party,enabled,config,cursor,health,next_fetch_at)
    VALUES(${sourceId},'Official page','external','T1',true,true,'{}',NULL,'unknown','2100-01-01')
    ON CONFLICT(id) DO UPDATE SET kind='external',enabled=true,cursor=NULL,health='unknown',last_error=NULL,fail_count=0`;
}

function page(text: string, chrome = "Navigation") {
  return `<html><head><title>Official migration program</title></head><body><nav>${chrome}</nav>
    <main id="main"><h1>Migration program status</h1><p>${text.repeat(5)}</p></main></body></html>`;
}

function answer(html: string) {
  network.get("https://r.jina.ai").intercept({ path: "/https://www.act.gov.au/migration" }).reply(200, html);
}

test("an undated baseline stays out of publication; real text changes revise the same material once", async () => {
  await enable();
  answer(page("The program is accepting expressions of interest. "));
  const baseline = await watchOfficialPage(sourceId);
  assert.ok(baseline.status === "ok");
  assert.equal(baseline.mode, "baseline");
  const [first] = await sql`SELECT id,revision,published_at,backfill FROM articles WHERE id=${baseline.articleId!}`;
  assert.equal(first.revision, 1);
  assert.equal(first.published_at, null);
  assert.equal(first.backfill, true);
  const [publicCount] = await sql`SELECT count(*)::int AS n FROM publications WHERE article_id=${first.id} AND (selected OR eligible)`;
  assert.equal(publicCount.n, 0, "observing a page does not select or publish it");

  answer(page("The program has paused new expressions of interest. "));
  const changed = await watchOfficialPage(sourceId);
  assert.ok(changed.status === "ok");
  assert.equal(changed.mode, "changed");
  assert.equal(changed.articleId, first.id);
  const [second] = await sql`SELECT revision,published_at FROM articles WHERE id=${first.id}`;
  assert.equal(second.revision, 2);
  assert.equal(second.published_at, null, "a detected change is not a known publication date");

  answer(page("The program has paused new expressions of interest. ", "Changed navigation"));
  const unchanged = await watchOfficialPage(sourceId);
  assert.ok(unchanged.status === "ok");
  assert.equal(unchanged.mode, "unchanged");
  assert.equal(unchanged.articleId, first.id);
  const [kept] = await sql`SELECT revision FROM articles WHERE id=${first.id}`;
  assert.equal(kept.revision, 2);
  const [materials] = await sql`SELECT count(*)::int AS n FROM articles WHERE identity_key=${`official-page:${sourceId}`}`;
  assert.equal(materials.n, 1);
});

test("a CAPTCHA response records failure without advancing a confirmed snapshot or last success", async () => {
  await enable();
  const cursor = { officialWatch: { hash: "confirmed-content", articleId: "confirmed-material", checkedAt: "2026-11-01T00:00:00.000Z" } };
  const lastOk = new Date("2026-11-01T00:00:00Z");
  await sql`UPDATE sources SET cursor=${sql.json(cursor)},health='ok',last_ok_at=${lastOk} WHERE id=${sourceId}`;
  answer('<html><head><title>Just a moment...</title></head><body><h1>Verify you are human</h1><p>Complete the CAPTCHA to continue.</p></body></html>');
  const failed = await watchOfficialPage(sourceId);
  assert.equal(failed.status, "failed");
  const [source] = await sql`SELECT cursor,health,last_ok_at,fail_count,last_error FROM sources WHERE id=${sourceId}`;
  assert.deepEqual(source.cursor, cursor);
  assert.equal(source.last_ok_at.toISOString(), lastOk.toISOString());
  assert.equal(source.health, "degraded");
  assert.equal(source.fail_count, 1);
  assert.ok(source.last_error);
  const [run] = await sql`SELECT status FROM fetch_runs WHERE source_id=${sourceId} ORDER BY id DESC LIMIT 1`;
  assert.equal(run.status, "failed");
});

test("a paused managed source is not fetched and records no fetch run", async () => {
  await enable();
  await sql`UPDATE sources SET enabled=false,health='paused' WHERE id=${sourceId}`;
  const [before] = await sql`SELECT count(*)::int AS n FROM fetch_runs WHERE source_id=${sourceId}`;
  assert.equal((await watchOfficialPage(sourceId)).status, "skipped");
  const [after] = await sql`SELECT count(*)::int AS n FROM fetch_runs WHERE source_id=${sourceId}`;
  assert.equal(after.n, before.n);
  assert.equal((await sql`SELECT health FROM sources WHERE id=${sourceId}`)[0].health, "paused");
});


test("extracts the two Tasmania classes from their named sections without taking the rolling average", () => {
  const sample = [
    "ROIs invited to apply for nomination on 20/11/2026:",
    "Subclass 190 - 36 invitations - 22 Gold invitations and 14 Green invitationsSubclass 491 - 24 invitations",
    "The lowest scores invited:Subclass 190 - 334 pointsSubclass 491 - 300 points",
    "Number of ROIs on hand (submitted):Subclass 190 - 763 ROIsSubclass 491 - 628 ROIs",
    "Nomination places available:Subclass 190 - 767 placesSubclass 491 - 573 places",
    "Nomination applications lodged but not yet decided:",
    "Six-week rolling average invitation point score:Subclass 190 - 319 pointsSubclass 491 - 114 points",
  ].join(" ");
  assert.deepEqual(parseTasmaniaRound(sample), {
    date: "2026-11-20",
    figures: {
      "190": { invitations: 36, lowestScore: 334, roisOnHand: 763, placesAvailable: 767 },
      "491": { invitations: 24, lowestScore: 300, roisOnHand: 628, placesAvailable: 573 },
    },
  });
  assert.equal(parseTasmaniaRound(sample.replace("300 points", "to be advised")), null);
  assert.equal(parseTasmaniaRound(sample.replace("20/11/2026", "31/11/2026")), null);
});

test("the same official pricing page revises its snapshot when a charge row changes", async () => {
  const id = "au-visa-fees";
  const endpoint = "/_layouts/15/api/data.aspx/GetPriceList";
  const path = "/visas/getting-a-visa/fees-and-charges/current-visa-pricing/";
  const origin = network.get("https://immi.homeaffairs.gov.au");
  await sql`INSERT INTO sources(id,name,kind,tier,first_party,enabled,config)
    VALUES(${id},'Official visa charges','external','T1',true,true,'{}')`;
  const settings = { endpointUrl: endpoint, endpointParm: JSON.stringify({ onshore: "All", category: "Visa" }) };
  const html = page("Australian visa prices and charge categories. ").replace("</main>",
    "<script>var configJson = " + JSON.stringify(settings) + "; var stringifiedConfig = JSON.stringify(configJson);</script></main>");
  for (const [price, mode] of [["AUD1,000.00", "baseline"], ["AUD1,050.00", "changed"], ["AUD1,050.00", "unchanged"]] as const) {
    origin.intercept({ path }).reply(200, html);
    origin.intercept({ path: endpoint, method: "POST", body: JSON.stringify({ onshore: "All", category: "Visa" }) }).reply(200,
      { d: { success: true, data: [{ visaSubclassCode: "500", visaSubclassText: "Student (500)", basePrice: price }] } });
    const checked = await watchOfficialPage(id);
    assert.ok(checked.status === "ok");
    assert.equal(checked.mode, mode);
    const [run] = await sql`SELECT detail FROM fetch_runs WHERE source_id=${id} ORDER BY id DESC LIMIT 1`;
    assert.equal(run.detail.evidence.records, 1);
  }
  const [current] = await sql`SELECT body_text,revision,published_at FROM articles WHERE identity_key=${"official-page:" + id}`;
  assert.match(current.body_text, /AUD1,050\.00/);
  assert.equal(current.revision, 2);
  assert.equal(current.published_at, null);
});

test("student priority rules record changes to official direction links", () => {
  const text = "Student visa processing priorities. Applications lodged by students inside Australia. Applications lodged by students outside Australia. Priority 1.";
  const first = readStudentPriorityRules("<main><a href='/files/md115.pdf'>Ministerial Direction 115</a></main>", text);
  const next = readStudentPriorityRules("<main><a href='/files/md115-replacement.pdf'>Ministerial Direction 115</a></main>", text);
  assert.notEqual(first.text, next.text);
  assert.throws(() => readStudentPriorityRules("<main>Student visa processing priorities</main>", "Student visa processing priorities"), /missing/);
});

test("the employer page uses the amounts in its embedded salary tabs", () => {
  const salary = (income: string) => {
    const content = [
      { text: "Core skills", block: `<p>CSIT: AUD${income}</p>` },
      { text: "Specialist skills", block: "<p>SSIT: AUD150,000</p>" },
      { text: "Temporary skilled migration", block: "<p>TSMIT: AUD70,000</p>" },
      { text: "Indexation", block: "<p>Annual market salary rate &amp; indexation</p>" },
    ];
    return `<main><input type="hidden" id="official_PageSchemaHiddenField_Input" value='${JSON.stringify({ content })}'></main>`;
  };
  const first = readEmployerSalaries(salary("80,000"), "Salary requirements");
  const next = readEmployerSalaries(salary("82,000"), "Salary requirements");
  assert.match(next.text, /AUD82,000/);
  assert.notEqual(first.text, next.text);
  assert.throws(() => readEmployerSalaries("<main>Salary requirements</main>", "Salary requirements"), /missing/);
});

test("TRA captures each published fee from the accessible table image", () => {
  const html = `<main><article><img alt="Table showing assessment service fees in AUD: Job Ready Employment $500, Job Ready Workplace Assessment $2,900, Job Ready Final Assessment $80." src="/files/fees.png"></article></main>`;
  assert.match(readTraFees(html, "Job Ready Program").text, /Final Assessment \$80/);
  assert.throws(() => readTraFees(html.replace("assessment service fees", "promotional image"), "Job Ready Program"), /missing/);
});

test("registration watchers reject public search shells as registry data", () => {
  assert.throws(() => cricosRecord("<main>Institution Search</main>", "00586B"), /no public registration record/);
  const organisation = {
    code: "90003", isRto: true, rtoStatusLabel: "Current",
    legalNames: [{ name: "TAFE", startDate: "2025-01-01" }], tradingNames: [],
    registrationManagers: [{ name: "ASQA", startDate: "2025-01-01" }],
    registrations: [{ startDate: "2025-09-02", endDate: "2032-08-31", legalAuthority: "NVR Act", exerciser: "ASQA" }],
    regulatoryDecisions: [{ isHistoric: true, reference: "RD0000652", decision: "Condition met", effectiveDate: "2022-06-06" }],
  };
  const scope = {
    accreditedCourses: 1, accreditedUnitsExplicit: 2, accreditedUnitsImplicit: 3,
    trainingPackages: [{ code: "ACM", title: "Animal Care and Management", qualifications: 6, skillSets: 15, unitsExplicit: 7, unitsImplicit: 163 }],
  };
  assert.throws(() => readTrainingRegister({ ...organisation, code: "90004" }, scope), /no verified registration/);
  const snapshot = readTrainingRegister(organisation, scope);
  assert.match(snapshot.text, /No current regulatory decisions\nHistoric \| RD0000652/);
  assert.match(snapshot.text, /ACM \| Animal Care and Management \| 6 \| 15 \| 7 \| 163/);
});

test("Education snapshot reads provider codes and priorities from the current DOCX", () => {
  const paragraph = (text: string) => "<w:p><w:r><w:t>" + text + "</w:t></w:r></w:p>";
  const cell = (text: string) => "<w:tc>" + paragraph(text) + "</w:tc>";
  const row = (code: string, priority: number) => "<w:tr>" + cell(code) + cell("Test Institute") + cell("Priority " + priority) + "</w:tr>";
  const archive = (count: number) => {
    const rows = Array.from({ length: count }, (_, i) => row((10000 + i) + "A", 2)).join("");
    const xml = "<w:document xmlns:w='http://schemas.openxmlformats.org/wordprocessingml/2006/main'><w:body>"
      + paragraph("International Education Providers – Progress Against Indicative Allocations") + "<w:tbl>" + rows + "</w:tbl></w:body></w:document>";
    return zipSync({ "word/document.xml": strToU8(xml) });
  };
  const resource = "https://www.education.gov.au/download/1/visa-prioritisation-status/2/current-snapshot/docx";
  const document = providerPriorityDocument(archive(10), resource);
  assert.equal(document.evidence.records, 10);
  assert.match(document.text, /10000A \| Test Institute \| Priority 2/);
  assert.throws(() => providerPriorityDocument(archive(1), resource), /no readable provider priority rows/);
});

test("Queensland RSS collects isolated review leads once and ignores index dates", async () => {
  await sql`INSERT INTO sources(id,name,kind,tier,participation_mode,interval_minutes)
    VALUES(${QUEENSLAND_LEADS_ID},'Queensland review leads','external','T2','isolated',240) ON CONFLICT(id) DO NOTHING`;
  const href = new URL(QUEENSLAND_NEWS_RSS);
  const source = "https://www.migration.qld.gov.au";
  const link = "https://news.google.com/rss/articles/aBc01";
  const item = (title: string, url: string, publisher = source) =>
    "<item><title>" + title + " - Migration Queensland</title><link>" + url + "</link>"
    + "<source url='" + publisher + "'>Migration Queensland</source><pubDate>Thu, 19 Nov 2026 13:13:41 GMT</pubDate>"
    + "<description>Google index excerpt</description></item>";
  const reply = (entries: string) => network.get(href.origin).intercept({ path: href.pathname + href.search })
    .reply(200, "<rss version='2.0'><channel><title>site:www.migration.qld.gov.au/news - Google News</title>"
      + entries + "</channel></rss>");
  const backupUrl = new URL(QUEENSLAND_BACKUP_RSS);
  const replyBackup = (entries: string) => network.get(backupUrl.origin).intercept({ path: backupUrl.pathname })
    .reply(200, "<rss version='2.0'><channel><title>VisaRadar: Queensland migration news</title>" + entries + "</channel></rss>");
  const title = "2024–25 State Nominated Migration Program Allocation &amp; eligibility";
  reply(item(title, link + "?oc=5") + item(title, link + "?oc=1")
    + item("News for Migration Agents", "https://news.google.com/rss/articles/nav")
    + item("Other publisher", "https://news.google.com/rss/articles/foreign", source + ".example.com")
    + item("Not a Google news link", "https://example.com/rss/articles/invalid"));
  replyBackup(item("Unrelated site", "https://example.com/news/other"));
  const first = await collectQueenslandNewsLeads();
  assert.ok(first.status === "ok");
  assert.equal(first.feed, "google");
  assert.equal(first.received, 5);
  assert.equal(first.found, 1);
  assert.equal(first.created, 1);
  assert.equal(first.checks.visaradar.status, "failed");
  const [lead] = await sql`SELECT id,title,url,published_at,published_at_claim,body_text,body_status,processing_queued_at,backfill
    FROM articles WHERE source_id=${QUEENSLAND_LEADS_ID}`;
  assert.equal(lead.title, "2024–25 State Nominated Migration Program Allocation & eligibility");
  assert.equal(lead.url, link + "?oc=5");
  assert.equal(lead.published_at, null);
  assert.equal(lead.published_at_claim, null);
  assert.equal(lead.body_text, null);
  assert.equal(lead.body_status, "unconfirmed");
  assert.equal(lead.processing_queued_at, null);
  assert.equal(lead.backfill, true);

  reply(item(title, link + "?oc=7"));
  const officialLink = "https://migration.qld.gov.au/news/queensland-update";
  replyBackup(item("Queensland update", officialLink));
  const again = await collectQueenslandNewsLeads();
  assert.ok(again.status === "ok");
  assert.equal(again.feed, "google");
  assert.equal(again.created, 0);
  assert.equal(again.checks.visaradar.found, 1);
  const [summary] = await sql`SELECT count(*)::int AS n FROM articles WHERE source_id=${QUEENSLAND_LEADS_ID}`;
  assert.equal(summary.n, 1);
  const [visibility] = await sql`SELECT count(*)::int AS n FROM publications WHERE article_id=${lead.id}`;
  assert.equal(visibility.n, 0);
  const [official] = await sql`SELECT count(*)::int AS n FROM fetch_runs WHERE source_id='au-qld-news'`;
  assert.equal(official.n, 0);

  network.get(href.origin).intercept({ path: href.pathname + href.search }).reply(503, "service unavailable");
  replyBackup(item("Queensland update", officialLink)
    + item("Duplicate URL", "https://www.migration.qld.gov.au/news/queensland-update/?tracking=1")
    + item("Landing page", "https://migration.qld.gov.au/news"));
  const fallback = await collectQueenslandNewsLeads();
  assert.ok(fallback.status === "ok");
  assert.equal(fallback.feed, "visaradar");
  assert.equal(fallback.checks.google.status, "failed");
  assert.equal(fallback.found, 1);
  assert.equal(fallback.created, 1);
  const [backupLead] = await sql`SELECT published_at,body_text,body_status,raw FROM articles WHERE url=${officialLink}`;
  assert.equal(backupLead.published_at, null);
  assert.equal(backupLead.body_text, null);
  assert.equal(backupLead.body_status, "unconfirmed");
  assert.equal(backupLead.raw.qldNewsLead.feedUrl, QUEENSLAND_BACKUP_RSS);
});

test("automatic daily selection publishes a dated official notice once and keeps uncertain leads private", async () => {
  const now = new Date("2026-11-26T00:40:00Z");
  const publishedAt = new Date("2026-11-25T03:00:00Z");
  const official = "South Australia’s General Skilled Migration Program Update - November";
  const bodyText = "The General Skilled Migration program will continue to invite eligible candidates during the program year.";
  for (const source of ["au-sa-news", "au-qld-news"]) {
    await sql`INSERT INTO sources(id,name,kind,tier,enabled,participation_mode,site_fulltext)
      VALUES(${source},${source},'web_list','T1',true,'editorial',false)
      ON CONFLICT(id) DO UPDATE SET enabled=true, participation_mode='editorial', site_fulltext=false`;
  }
  function fixture(path: string, extra: Partial<Parameters<typeof upsertMaterial>[0]> = {}) {
    return upsertMaterial({
      sourceId: "au-sa-news",
      url: "https://migration.sa.gov.au/news/" + path,
      title: official, bodyText, bodyStatus: "ok", publishedAt, publicationTime: "2026-11-25",
      discoveredAt: new Date("2026-11-25T03:30:00Z"), via: "fetch", ...extra,
    });
  }
  const selected = await fixture("nov-program");
  const duplicate = await fixture("nov-program-duplicate", {
    title: official.replace(" - ", " — "),
    publishedAt: new Date("2026-11-25T02:59:00Z"),
  });
  const previousDecision = await fixture("manual", { title: "General Skilled Migration Program allocation update" });
  await sql`INSERT INTO editorial_overrides (article_id, visibility) VALUES (${previousDecision.articleId}, 'withdrawn')`;
  const held = await Promise.all([
    fixture("undated", { publishedAt: null, publicationTime: null }),
    fixture("no-body", { bodyStatus: "unconfirmed", bodyText: "" }),
    fixture("old", { publishedAt: new Date("2026-10-25T00:00:00Z"), publicationTime: "2026-10-25" }),
    fixture("webinar", { title: "Webinar: General Skilled Migration Program update" }),
    fixture("irrelevant", { title: "Annual community festival opens" }),
    fixture("unconfirmed-topic", { bodyText: "This page is about the community festival." }),
    fixture("other-domain", { url: "https://migration.sa.gov.au.example.org/news/stale" }),
    fixture("qld", {
      sourceId: "au-qld-news", url: "https://migration.qld.gov.au/news/latest-indexed",
      title: "State Nominated Migration Program allocation",
    }),
  ]);

  const plan = await selectOfficialDaily({ now, dryRun: true });
  assert.deepEqual(plan.selectedIds, [selected.articleId]);
  assert.equal(plan.duplicates, 1);
  assert.equal((await sql`SELECT 1 FROM analyses WHERE article_id=${selected.articleId}`).length, 0);

  assert.deepEqual((await selectOfficialDaily({ now })).selectedIds, [selected.articleId]);
  assert.deepEqual((await selectOfficialDaily({ now })).selectedIds, []);
  const feed = await loadTimeline({ channel: "news", category: null, tag: null, now });
  assert.deepEqual(feed.cards.map(card => card.item.id), [selected.articleId]);
  assert.equal(feed.cards[0]?.item.title, official);
  const [result] = await sql`SELECT p.body_mode,p.published_at,a.origin,a.model,a.score
    FROM publications p JOIN analyses a ON a.id=p.analysis_id WHERE p.article_id=${selected.articleId}`;
  assert.deepEqual(result, { body_mode: "summary", published_at: publishedAt, origin: "rule", model: null, score: null });
  const excluded = [duplicate, previousDecision, ...held].map(row => row.articleId);
  assert.equal((await sql`SELECT 1 FROM publications WHERE article_id=ANY(${excluded}) AND selected`).length, 0);
});
