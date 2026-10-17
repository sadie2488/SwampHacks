// Draws the mockup pages to pictures (needs Google Chrome and an internet connection for fonts and three.js).
// From the project folder:  node docs/design-mockups/render.mjs a-firefly-marsh.html A learn play
//   file    which mockup page, e.g. a-firefly-marsh.html
//   prefix  start of the picture names, e.g. A  ->  A-learn.jpg, A-play.jpg
//   screens learn and/or play (default: both)
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, '..', '..', 'package.json'));
const { chromium } = require('playwright-core');

const [file, prefix, ...screens] = process.argv.slice(2);
if (!file || !prefix) {
  console.log('Usage: node docs/design-mockups/render.mjs <page.html> <prefix> [learn] [play]');
  process.exit(1);
}
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
for (const s of screens.length ? screens : ['learn', 'play']) {
  await page.goto(`${pathToFileURL(join(here, file)).href}?screen=${s}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(here, `${prefix}-${s}.jpg`), type: 'jpeg', quality: 86 });
  console.log('saved', `${prefix}-${s}.jpg`);
}
if (errors.length) console.log('page errors:', errors.slice(0, 5).join(' | '));
await browser.close();
