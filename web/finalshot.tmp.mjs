// hub'ı seç + Fit → tam görünümde hub konumu işaretli (selection halo) screenshot
import { chromium } from "/srv/outpost/scraper/node_modules/playwright/index.mjs";

const token = "XPiwp7BU78w7uz6zhWKz16KDsl5t0tnS";
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
await search.fill("Fikret Yüksel");
await page.waitForTimeout(900);
await page.keyboard.press("Enter");
await page.waitForTimeout(2000);
// entity paneli Fit'i örtüyor → DOM click
await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => b.title === "Fit to view");
  btn?.click();
});
await page.waitForTimeout(1500);
await page.mouse.move(1600, 950);
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/net-final-fit-selected.png` });
await ctx.close();
await browser.close();
console.log("ok");
