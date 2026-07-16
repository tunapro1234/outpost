import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const TOKEN_PATH = '/srv/browser/.ws_token';
const DEFAULT_BROWSER_SERVER = 'ws://127.0.0.1:3333';

export async function connectBrowser() {
  let endpoint = process.env.BROWSER_WS?.trim();

  if (!endpoint) {
    const token = (await readFile(TOKEN_PATH, 'utf8')).trim();
    if (!token) {
      throw new Error(`Browser token is empty: ${TOKEN_PATH}`);
    }
    endpoint = `${DEFAULT_BROWSER_SERVER}/${token}`;
  }

  return chromium.connect(endpoint, { timeout: 30_000 });
}

export async function newHumanContext(browser) {
  return browser.newContext({
    locale: 'tr-TR',
    timezoneId: 'Europe/Istanbul',
    userAgent:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
    screen: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
    extraHTTPHeaders: {
      'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
    },
  });
}

export async function humanDelay(min = 2_000, max = 5_000) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max < min) {
    throw new RangeError('humanDelay requires 0 <= min <= max');
  }

  const duration = Math.floor(min + Math.random() * (max - min + 1));
  await new Promise((resolve) => setTimeout(resolve, duration));
}

export async function politeGoto(page, url) {
  await humanDelay(2_000, 5_000);
  return page.goto(url, {
    waitUntil: 'domcontentloaded',
    timeout: 45_000,
  });
}
