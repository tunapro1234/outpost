// settle sonrası arama ile hub'a odaklan, yakın plan screenshot
import { chromium } from "/srv/outpost/scraper/node_modules/playwright/index.mjs";

const token = "XPiwp7BU78w7uz6zhWKz16KDsl5t0tnS";
const query = process.argv[2] ?? "Fikret";
const tag = process.argv[3] ?? "hub";
const OUT = "/tmp/claude-0/-srv-outpost/348439bb-e481-433f-9d89-6ac305b5f2c1/scratchpad";

const browser = await chromium.connect(`ws://127.0.0.1:3333/${token}`);
const ctx = await browser.newContext({
  httpCredentials: { username: "tuna", password: "tunapro1234" },
  viewport: { width: 1680, height: 1000 },
});
const page = await ctx.newPage();
await page.goto("https://outpost.tunapro.xyz/network", { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(16000);

const search = page.getByPlaceholder(/search/i).first();
await search.click();
await search.fill(query);
await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}/net-${tag}-dropdown.png` });
await page.keyboard.press("Enter");
await page.waitForTimeout(2500);
// hover-dim olmasın diye fareyi boş yere çek + seçimi kapatmadan çek
await page.mouse.move(1600, 950);
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/net-${tag}-close.png` });
// seçimi kaldır (Esc) → dim'siz hâli
await page.keyboard.press("Escape");
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/net-${tag}-clean.png` });
// bir kademe uzaklaş
await page.mouse.move(840, 520);
await page.mouse.wheel(0, 480);
await page.waitForTimeout(300);
await page.mouse.move(1600, 950);
await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}/net-${tag}-mid.png` });
await ctx.close();
await browser.close();
console.log("ok", tag);
