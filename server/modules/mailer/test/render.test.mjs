import test from "node:test";
import assert from "node:assert/strict";
import { renderMail, messageId, escapeHtml } from "../render.mjs";

const NOW = () => new Date("2026-07-20T09:47:00.000Z");
const TOKEN = "aaaabbbbccccdddd";

test("escapeHtml neutralises markup", () => {
  assert.equal(escapeHtml('<b>"&\'</b>'), "&lt;b&gt;&quot;&amp;&#39;&lt;/b&gt;");
});

test("messageId derives from the token + domain", () => {
  const id = messageId(TOKEN, { now: NOW, domain: "probotstudio.com" });
  assert.match(id, /^<aaaabbbbccccdddd\.\d+@probotstudio\.com>$/u);
});

test("renderMail injects the pixel and wraps links", () => {
  const rendered = renderMail(
    {
      subject: "Merhaba",
      body: "Selam,\n\nŞuna bak https://probotstudio.com/urun\n\nİyi günler",
      track_token: TOKEN,
      to_addr: "ali@x.com",
    },
    {
      from: "destek@probotstudio.com",
      pixelUrl: "https://outpost.tunapro.xyz/t/o/probot/" + TOKEN + ".gif",
      links: ["https://probotstudio.com/urun"],
      clickUrls: ["https://outpost.tunapro.xyz/t/c/probot/" + TOKEN + "/0"],
      now: NOW,
    },
  );
  assert.equal(rendered.subject, "Merhaba");
  assert.equal(rendered.to, "ali@x.com");
  assert.match(rendered.html, /t\/o\/probot\/aaaabbbbccccdddd\.gif/u);
  // Link, tıklama-redirect hedefine sarmalanmış olmalı.
  assert.match(rendered.html, /href="https:\/\/outpost\.tunapro\.xyz\/t\/c\/probot\/aaaabbbbccccdddd\/0"/u);
  // Düz metin izlemesiz kalır (orijinal link).
  assert.match(rendered.text, /https:\/\/probotstudio\.com\/urun/u);
  assert.ok(!rendered.text.includes("/t/o/"));
  assert.deepEqual(rendered.tags, [TOKEN]);
});

test("renderMail without pixel/links still produces valid html", () => {
  const rendered = renderMail({ subject: "x", body: "düz gövde", track_token: TOKEN }, { now: NOW });
  assert.match(rendered.html, /<p>düz gövde<\/p>/u);
  assert.ok(!rendered.html.includes("<img"));
});
