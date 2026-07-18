import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../../../app.mjs";
import { temporaryDirectory } from "../../../test-support/helpers.mjs";
import { closeWorkspaceDb } from "../../../lib/db.mjs";
import { insertMail } from "../store.mjs";
import {
  extractLinks,
  summarizeEvents,
  trackingUrls,
  isTrackToken,
  newToken,
  brevoToken,
  recordOpen,
  recordClick,
  ingestBrevo,
  trackingRows,
} from "../tracking.mjs";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_WORKSPACES = path.join(TEST_DIRECTORY, "fixtures/workspaces");
const TOKEN = "aaaabbbbccccdddd";

async function seededWorkspace(t, mail = {}) {
  const directory = await temporaryDirectory("outpost-track-");
  const workspace = { id: "probot", directory, index: { entities: new Map() } };
  t.after(() => { closeWorkspaceDb(workspace); return fs.rm(directory, { recursive: true, force: true }); });
  insertMail(workspace, {
    id: "outbox--x", person_id: "p1", to_addr: "ali@x.com", subject: "Merhaba",
    track_token: TOKEN, links: ["https://probotstudio.com"], approved_at: "2026-07-18T10:00:00Z",
    ...mail,
  });
  return workspace;
}

test("extractLinks dedupes and strips trailing punctuation", () => {
  assert.deepEqual(
    extractLinks("Bak https://probotstudio.com/u. yine https://probotstudio.com/u, son https://x.co/a"),
    ["https://probotstudio.com/u", "https://x.co/a"],
  );
});

test("isTrackToken / newToken", () => {
  assert.ok(isTrackToken(newToken()));
  assert.equal(isTrackToken("ZZZ"), false);
});

test("trackingUrls builds pixel + one click url per link", () => {
  const urls = trackingUrls("probot", TOKEN, 2);
  assert.match(urls.pixel, /\/t\/o\/probot\/aaaabbbbccccdddd\.gif$/u);
  assert.equal(urls.clicks.length, 2);
  assert.match(urls.clicks[0], /\/t\/c\/probot\/aaaabbbbccccdddd\/0$/u);
});

test("summarizeEvents status precedence: clicked > opened > proxy > delivered", () => {
  assert.equal(summarizeEvents([]).status, null);
  assert.equal(summarizeEvents([{ type: "delivered" }]).status, "delivered");
  assert.equal(summarizeEvents([{ type: "open", bot: true }]).status, "proxy_open");
  const opened = summarizeEvents([
    { type: "open", bot: true, at: "2026-07-18T09:00:00Z" },
    { type: "open", bot: false, at: "2026-07-18T10:00:00Z" },
  ]);
  assert.equal(opened.status, "opened");
  assert.equal(opened.open_count, 1);
  assert.equal(opened.proxy_open_count, 1);
  assert.equal(summarizeEvents([{ type: "click", at: "x" }]).status, "clicked");
  assert.equal(summarizeEvents([{ type: "bounce" }, { type: "open", bot: false }]).status, "bounced");
});

test("brevoToken finds the token from tags or fields", () => {
  assert.equal(brevoToken({ tags: [TOKEN] }), TOKEN);
  assert.equal(brevoToken({ tag: TOKEN }), TOKEN);
  assert.equal(brevoToken({ token: TOKEN }), TOKEN);
  assert.equal(brevoToken({ tags: ["newsletter"] }), null);
});

test("recordOpen logs a DB event and proxy UA is marked bot", async (t) => {
  const workspace = await seededWorkspace(t);
  assert.equal(recordOpen(workspace, TOKEN, { ua: "Thunderbird" }).bot, false);
  assert.equal(recordOpen(workspace, TOKEN, { ua: "via ggpht.com GoogleImageProxy" }).bot, true);
  assert.equal(recordOpen(workspace, "deadbeefdeadbeef", {}).ok, false);
  const { rows } = trackingRows(workspace);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "opened");
  assert.equal(rows[0].open_count, 1);
  assert.equal(rows[0].proxy_open_count, 1);
});

test("recordClick resolves the stored url and escalates status", async (t) => {
  const workspace = await seededWorkspace(t, {
    id: "outbox--y", track_token: TOKEN, links: ["https://probotstudio.com/a", "https://probotstudio.com/b"],
  });
  const click = recordClick(workspace, TOKEN, 1, {});
  assert.equal(click.ok, true);
  assert.equal(click.url, "https://probotstudio.com/b");
  assert.equal(trackingRows(workspace).rows[0].status, "clicked");
});

test("ingestBrevo maps events to the token", async (t) => {
  const workspace = await seededWorkspace(t);
  assert.equal(ingestBrevo(workspace, { event: "delivered", tags: [TOKEN] }).ok, true);
  assert.equal(ingestBrevo(workspace, { event: "opened", tags: [TOKEN] }).ok, true);
  assert.equal(ingestBrevo(workspace, { event: "spam-report" }).ok, false);
  const { rows } = trackingRows(workspace);
  assert.equal(rows[0].status, "opened");
  assert.equal(rows[0].delivered, true);
});

// --- integration: public pixel route + owner tracking endpoint ---
async function copiedApp(t) {
  const root = await temporaryDirectory("outpost-track-app-");
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.cp(path.join(FIXTURE_WORKSPACES, "fixture"), path.join(root, "fixture"), { recursive: true });
  const app = await createApp({
    workspacesPath: root, outpostVault: null, watch: false,
    mailSchedule: false, followupSchedule: false, defaultUser: "tuna",
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
