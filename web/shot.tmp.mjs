// paylaşımlı browser'dan /network screenshot'ı — yeni context açar, Tuna'nın sekmesine dokunmaz
import { chromium } from "/srv/outpost/scraper/node_modules/playwright/index.mjs";

const token = "XPiwp7BU78w7uz6zhWKz16KDsl5t0tnS";
const tag = process.argv[2] ?? "iter";
const OUT = "/tmp/claude-0/-srv-outpost/348439bb-e481-433f-9d89-6ac305b5f2c1/scratchpad";

const browser = await chromium.connect(`ws://127.0.0.1:3333/${token}`);
const ctx = await browser.newContext({
  httpCredentials: { username: "tuna", password: "tunapro1234" },
  viewport: { width: 1680, height: 1000 },
});
const page = await ctx.newPage();
await page.goto("https://outpost.tunapro.xyz/network", { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForTimeout(16000); // simülasyon otursun

// Fit butonu
const fit = page.getByRole("button", { name: /fit/i }).first();
try { await fit.click({ timeout: 3000 }); } catch { console.log("Fit butonu bulunamadı"); }
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/net-${tag}-full.png` });

// hub bölgesine ılımlı zoom; sonra fare boş köşeye (hover-dim tetiklenmesin)
const zx = Number(process.argv[3] ?? 860), zy = Number(process.argv[4] ?? 590);
const steps = Number(process.argv[5] ?? 4);
await page.mouse.move(zx, zy);
for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, -240); await page.waitForTimeout(200); }
await page.mouse.move(1550, 950);
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/net-${tag}-zoom.png` });

await ctx.close();
await browser.close();
console.log("ok:", `${OUT}/net-${tag}-full.png`, `${OUT}/net-${tag}-zoom.png`);
