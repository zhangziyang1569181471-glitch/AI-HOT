import "../../../tests/setup.ts";
import assert from "node:assert/strict";
import { syncBuiltinESMExports } from "node:module";
import { after, mock, test } from "node:test";
import timersPromises from "node:timers/promises";
import { MockAgent, getGlobalDispatcher, setGlobalDispatcher } from "undici";
import { config } from "@aihot/backend/config";
import { closeDb, sql } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { watchOfficialPage } from "../watch.ts";
import { parseTasmaniaRound } from "../tasmania.ts";
import { readStudentPriorityRules } from "../government-snapshots.ts";
import { cricosRecord, readEmployerSalaries, readTraFees, readTrainingRegister } from "../approved-pages.ts";

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
  assert.throws(() => readTrainingRegister("<main>National Training Register</main>"), /no verified registration/);
});
