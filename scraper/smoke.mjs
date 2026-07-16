import { connectBrowser, newHumanContext, politeGoto } from './lib.mjs';

function normalizeTestName(value) {
  return value.replace(/\s+/g, ' ').replace(/:$/, '').trim();
}

async function readSannysoft(page) {
  await politeGoto(page, 'https://bot.sannysoft.com/');
  await page.waitForSelector('table', { timeout: 30_000 });

  return page.locator('tr').evaluateAll((rows) => {
    const passed = [];
    const failed = [];

    for (const row of rows) {
      const cells = Array.from(row.querySelectorAll('th, td'));
      if (cells.length < 2) continue;

      const name = (cells[0].innerText || cells[0].textContent || '')
        .replace(/\s+/g, ' ')
        .replace(/:$/, '')
        .trim();
      if (!name || /^test name$/i.test(name)) continue;

      const resultCell = cells.at(-1);
      const resultText = (resultCell.innerText || resultCell.textContent || '')
        .replace(/\s+/g, ' ')
        .trim();
      const marker = `${resultCell.className} ${resultText}`.toLowerCase();

      if (marker.includes('failed')) {
        failed.push(name);
      } else if (marker.includes('passed')) {
        passed.push(name);
      }
    }

    return { passed, failed };
  });
}

let browser;

try {
  browser = await connectBrowser();
  const context = await newHumanContext(browser);
  const page = await context.newPage();

  const sannysoft = await readSannysoft(page);
  sannysoft.passed = sannysoft.passed.map(normalizeTestName);
  sannysoft.failed = sannysoft.failed.map(normalizeTestName);

  if (sannysoft.passed.length + sannysoft.failed.length === 0) {
    throw new Error('Sannysoft test table could not be parsed');
  }

  await politeGoto(page, 'https://news.ycombinator.com/');
  const hackerNewsTitle = (await page.title()).trim();
  if (!hackerNewsTitle) {
    throw new Error('Hacker News title is empty');
  }

  process.stdout.write(
    `${JSON.stringify({ sannysoft, hackerNewsTitle }, null, 2)}\nSMOKE OK\n`,
  );
} catch (error) {
  process.stdout.write(`SMOKE FAIL: ${error.message}\n`);
  process.exitCode = 1;
} finally {
  if (browser) {
    await browser.close();
  }
}
