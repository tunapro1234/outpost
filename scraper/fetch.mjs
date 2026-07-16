import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectBrowser, newHumanContext, politeGoto } from './lib.mjs';

const scraperDir = path.dirname(fileURLToPath(import.meta.url));

function parseTarget(value) {
  if (!value) {
    throw new Error('Usage: node fetch.mjs <url>');
  }

  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Only http:// and https:// URLs are supported');
  }
  return url;
}

function slugFor(url) {
  const source = `${url.hostname}${url.pathname === '/' ? '' : url.pathname}`;
  return (
    source
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 100) || 'page'
  );
}

let browser;

try {
  const target = parseTarget(process.argv[2]);
  browser = await connectBrowser();
  const context = await newHumanContext(browser);
  const page = await context.newPage();

  await politeGoto(page, target.href);

  const result = await page.evaluate(() => {
    const text = (document.body?.innerText ?? '')
      .replace(/\r/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .trim()
      .slice(0, 5_000);

    const links = Array.from(document.querySelectorAll('a[href]'), (link) => ({
      text: (link.innerText || link.textContent || '').replace(/\s+/g, ' ').trim(),
      href: link.href,
    }));

    return {
      url: location.href,
      title: document.title,
      text,
      links,
    };
  });

  const outDir = path.join(scraperDir, 'out');
  await mkdir(outDir, { recursive: true });
  await page.screenshot({
    path: path.join(outDir, `${slugFor(target)}.png`),
    fullPage: true,
  });

  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  process.stderr.write(`FETCH FAIL: ${error.message}\n`);
  process.exitCode = 1;
} finally {
  if (browser) {
    await browser.close();
  }
}
