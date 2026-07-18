import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../../../app.mjs";
import { temporaryDirectory } from "../../../test-support/helpers.mjs";
import {
  extractLinks,
  summarizeEvents,
  trackingUrls,
  isTrackToken,
  newToken,
  brevoToken,
  registerTracking,
  recordOpen,
  recordClick,
  ingestBrevo,
  trackingRows,
} from "../tracking.mjs";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_WORKSPACES = path.join(TEST_DIRECTORY, "fixtures/workspaces");

function fakeWorkspace(directory) {
  return { id: "fixture", directory, index: { entities: new Map() } };
}

const FIXED = () => new Date("2026-07-18T10:00:00.000Z");

test("extractLinks dedupes and strips trailing punctuation", () => {
  const links = extractLinks(
    "Bak https://probotstudio.com/urunler. ve tekrar https://probotstudio.com/urunler, son https://x.co/a",
  );
  assert.deepEqual(links, ["https://probotstudio.com/urunler", "https://x.co/a"]);
});

test("isTrackToken / newToken", () => {
  const token = newToken();
  assert.ok(isTrackToken(token));
  assert.equal(isTrackToken("ZZZ"), false);
  assert.equal(isTrackToken(""), false);
});

test("trackingUrls builds pixel + one click url per link", () => {
  const urls = trackingUrls("fixture", "abc123abc123abc1", 2);
  assert.match(urls.pixel, /\/t\/o\/fixture\/abc123abc123abc1\.gif$/u);
  assert.equal(urls.clicks.length, 2);
  assert.match(urls.clicks[0], /\/t\/c\/fixture\/abc123abc123abc1\/0$/u);
});

test("summarizeEvents status precedence: clicked > opened > proxy > delivered", () => {
  assert.equal(summarizeEvents([]).status, null);
  assert.equal(summarizeEvents([{ type: "delivered" }]).status, "delivered");
  assert.equal(
    summarizeEvents([{ type: "open", bot: true }]).status,
    "proxy_open",
  );
  const opened = summarizeEvents([
    { type: "open", bot: true, at: "2026-07-18T09:00:00Z" },
    { type: "open", bot: false, at: "2026-07-18T10:00:00Z" },
  ]);
  assert.equal(opened.status, "opened");
  assert.equal(opened.open_count, 1);
  assert.equal(opened.proxy_open_count, 1);
  const clicked = summarizeEvents([
    { type: "open", bot: false, at: "2026-07-18T10:00:00Z" },
    { type: "click", at: "2026-07-18T10:05:00Z" },
  ]);
  assert.equal(clicked.status, "clicked");
  assert.equal(clicked.click_count, 1);
  assert.equal(summarizeEvents([{ type: "bounce" }, { type: "open", bot: false }]).status, "bounced");
});

test("brevoToken finds the token from tags or fields", () => {
  const token = newToken();
  assert.equal(brevoToken({ tags: [token] }), token);
  assert.equal(brevoToken({ tag: token }), token);
  assert.equal(brevoToken({ token }), token);
  assert.equal(brevoToken({ tags: ["newsletter"] }), null);
});

test("recordOpen logs an event and proxy UA is marked bot", async (t) => {
  const directory = await temporaryDirectory("outpost-track-");
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const workspace = fakeWorkspace(directory);
  const token = newToken();
  await registerTracking(workspace, {
    ws: "fixture", token, outbox_id: "outbox--x", person_id: "p1",
    subject: "Merhaba", links: ["https://probotstudio.com"], now: FIXED,
  });

  const human = await recordOpen(workspace, token, { ua: "Thunderbird", now: FIXED });
  assert.equal(human.ok, true);
  assert.equal(human.bot, false);

  const proxy = await recordOpen(workspace, token, {
    ua: "Mozilla/5.0 (via ggpht.com GoogleImageProxy)", now: FIXED,
  });
  assert.equal(proxy.bot, true);

  const unknown = await recordOpen(workspace, "deadbeefdeadbeef", { now: FIXED });
  assert.equal(unknown.ok, false);

  const { rows } = await trackingRows(workspace);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "opened");
  assert.equal(rows[0].open_count, 1);
  assert.equal(rows[0].proxy_open_count, 1);
});

test("recordClick resolves the stored url and escalates status", async (t) => {
  const directory = await temporaryDirectory("outpost-track-");
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const workspace = fakeWorkspace(directory);
  const token = newToken();
  await registerTracking(workspace, {
    ws: "fixture", token, outbox_id: "outbox--y", person_id: "p2",
    links: ["https://probotstudio.com/a", "https://probotstudio.com/b"], now: FIXED,
  });

  const click = await recordClick(workspace, token, 1, { now: FIXED });
  assert.equal(click.ok, true);
  assert.equal(click.url, "https://probotstudio.com/b");

  const { rows } = await trackingRows(workspace);
  assert.equal(rows[0].status, "clicked");
  assert.equal(rows[0].click_count, 1);
});

test("ingestBrevo maps events to the token", async (t) => {
  const directory = await temporaryDirectory("outpost-track-");
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const workspace = fakeWorkspace(directory);
  const token = newToken();
  await registerTracking(workspace, {
    ws: "fixture", token, outbox_id: "outbox--z", person_id: "p3", links: [], now: FIXED,
  });

  assert.equal((await ingestBrevo(workspace, { event: "delivered", tags: [token] }, { now: FIXED })).ok, true);
  assert.equal((await ingestBrevo(workspace, { event: "opened", tags: [token] }, { now: FIXED })).ok, true);
  assert.equal((await ingestBrevo(workspace, { event: "spam-report" }, { now: FIXED })).ok, false);

  const { rows } = await trackingRows(workspace);
  // Brevo opens are never counted as bot prefetch.
  assert.equal(rows[0].status, "opened");
  assert.equal(rows[0].delivered, true);
});

// --- integration: public pixel route + owner tracking endpoint ---

async function copiedApp(t) {
  const root = await temporaryDirectory("outpost-track-app-");
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.cp(path.join(FIXTURE_WORKSPACES, "fixture"), path.join(root, "fixture"), {
    recursive: true,
  });
  const app = await createApp({
    workspacesPath: root,
    outpostVault: null,
    watch: false,
    mailSchedule: false,
    followupSchedule: false,
    defaultUser: "tuna",
  });
  t.after(() => app.close());
  return app;
}

test("GET /t/o/:ws/:token.gif always returns a GIF", async (t) => {
  const app = await copiedApp(t);
  const res = await app.inject({ method: "GET", url: "/t/o/fixture/deadbeefdeadbeef.gif" });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["content-type"], "image/gif");
  assert.match(res.headers["cache-control"], /no-store/u);
});

test("GET /t/c redirects to the safe base when token is unknown", async (t) => {
  const app = await copiedApp(t);
  const res = await app.inject({ method: "GET", url: "/t/c/fixture/deadbeefdeadbeef/0" });
  assert.equal(res.statusCode, 302);
  assert.ok(res.headers.location);
});

test("GET /mailtracking returns rows + counts", async (t) => {
  const app = await copiedApp(t);
  const res = await app.inject({ method: "GET", url: "/api/ws/fixture/mailtracking" });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.ok(Array.isArray(body.rows));
  assert.ok(body.counts && typeof body.counts.total === "number");
});
