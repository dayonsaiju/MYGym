/**
 * scripts/capture-screens.js
 * Captures responsive view screenshots across 320px, 390px, and 768px viewports.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const outDir = path.join(rootDir, 'screenshots');

const viewports = [
  { name: 'mobile-small-320', width: 320, height: 640 },
  { name: 'mobile-iphone-390', width: 390, height: 844 },
  { name: 'tablet-ipad-768', width: 768, height: 1024 }
];

const views = [
  { tab: 'train', name: '01-train' },
  { tab: 'active', name: '02-active-workout' },
  { tab: 'lib', name: '03-library' },
  { tab: 'cal', name: '04-calendar' },
  { tab: 'body', name: '05-body-nutrition' }
];

async function capture() {
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  let playwright;
  try {
    playwright = await import('playwright');
  } catch {
    console.log('Playwright is not installed in local environment.');
    console.log('To run screen captures: npx playwright test or npm i -D playwright && node scripts/capture-screens.js');
    console.log(`Configured captures for viewports: ${viewports.map(v => v.width + 'px').join(', ')}`);
    console.log(`Configured capture targets for views: ${views.map(v => v.name).join(', ')}`);
    return;
  }

  const browser = await playwright.chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  const fileUrl = 'file://' + path.join(rootDir, 'index.html');
  await page.goto(fileUrl);

  for (const vp of viewports) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    for (const v of views) {
      if (v.tab === 'active') {
        await page.evaluate(() => {
          if (window.__MYGYM__ && window.__MYGYM__.S) {
            window.__MYGYM__.S.act = {
              id: 'sample_workout',
              name: 'Push Hypertrophy',
              t0: Date.now() - 1800000,
              curEx: 0,
              ex: [{ id: '0025', sets: [{ w: 80, r: 8, done: true }, { w: 80, r: 8, done: false }] }]
            };
            window.__MYGYM__.render();
          }
        });
      } else {
        await page.evaluate((tabKey) => {
          const tabBtn = document.querySelector(`[data-k="${tabKey}"]`);
          if (tabBtn) tabBtn.click();
        }, v.tab);
      }
      await page.waitForTimeout(200);
      const outPath = path.join(outDir, `${v.name}-${vp.name}.png`);
      await page.screenshot({ path: outPath, fullPage: false });
      console.log(`✓ Captured ${outPath}`);
    }
  }

  await browser.close();
  console.log('Finished capturing all screen viewports.');
}

capture().catch(err => {
  console.error('Screen capture error:', err.message);
  process.exit(1);
});
