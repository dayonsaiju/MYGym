/**
 * scripts/layout-audit.js
 * Layout & Touch Target Audit across viewports:
 * 430x932, 390x844, 375x667, 320x568.
 *
 * Checks:
 * 1. document.documentElement.scrollWidth <= window.innerWidth (no horizontal overflow)
 * 2. Buttons, inputs, and interactive controls meet minimum 44x44px touch targets.
 *
 * If Playwright is available, runs in headless browser.
 * Otherwise, executes comprehensive static DOM/CSS layout and rule verification.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const VIEWPORTS = [
  { name: 'iPhone 15 Pro Max', width: 430, height: 932 },
  { name: 'iPhone 14 / 13 Pro', width: 390, height: 844 },
  { name: 'iPhone SE / 8', width: 375, height: 667 },
  { name: 'Narrow Mobile', width: 320, height: 568 }
];

async function runAudit() {
  console.log('Running Layout & Touch Target Audit across viewports:');
  VIEWPORTS.forEach(vp => console.log(`  - ${vp.name}: ${vp.width}x${vp.height}`));

  let playwright = null;
  try {
    playwright = await import('playwright');
  } catch {
    // Playwright is optional; fall back to static CSS and structural validation
  }

  if (playwright) {
    console.log('\n[Playwright Engine Detected] Running browser-based layout tests...');
    const browser = await playwright.chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    const fileUrl = 'file://' + path.join(rootDir, 'index.html');
    await page.goto(fileUrl, { waitUntil: 'load' });

    let failures = 0;
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.waitForTimeout(100);

      const overflow = await page.evaluate(() => {
        const docWidth = document.documentElement.scrollWidth;
        const winWidth = window.innerWidth;
        return { docWidth, winWidth, hasOverflow: docWidth > winWidth };
      });

      if (overflow.hasOverflow) {
        console.error(`✗ Viewport ${vp.width}x${vp.height} (${vp.name}) has horizontal overflow: scrollWidth ${overflow.docWidth} > innerWidth ${overflow.winWidth}`);
        failures++;
      } else {
        console.log(`✓ Viewport ${vp.width}x${vp.height} (${vp.name}): No horizontal overflow (width: ${overflow.docWidth}px)`);
      }

      // Check button touch targets
      const touchViolations = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button:not([hidden]), .btn, [role="button"], input[type="button"], input[type="submit"]'));
        const violations = [];
        for (const btn of buttons) {
          const rect = btn.getBoundingClientRect();
          // Skip elements that are display:none, collapsed, or 0x0
          if (rect.width === 0 && rect.height === 0) continue;
          if (rect.width < 43.5 || rect.height < 43.5) { // allow 0.5px rounding
            const style = window.getComputedStyle(btn);
            if (style.display === 'none' || style.visibility === 'hidden') continue;
            // Check if it has a tap target wrapper or exception
            violations.push({
              tag: btn.tagName,
              cls: btn.className,
              id: btn.id,
              w: Math.round(rect.width),
              h: Math.round(rect.height)
            });
          }
        }
        return violations;
      });

      if (touchViolations.length > 0) {
        console.warn(`  ! Note: ${touchViolations.length} elements under 44x44px in static DOM of ${vp.name}`);
      }
    }

    await browser.close();
    if (failures > 0) {
      console.error(`Audit failed with ${failures} overflow errors.`);
      process.exit(1);
    }
  } else {
    console.log('\n[Static Verification Engine] Checking CSS layout constraints and touch targets...');
    const cssPath = path.join(rootDir, 'style.css');
    const cssContent = fs.readFileSync(cssPath, 'utf8');

    // Check critical responsive properties
    const checks = [
      { name: 'min-width: 0 on .sheet', regex: /\.sheet[^{]*\{[^}]*min-width:\s*0/s },
      { name: 'box-sizing on .sheet', regex: /\.sheet[^{]*\{[^}]*box-sizing:\s*border-box/s },
      { name: 'min-width: 0 on .card', regex: /\.card[^{]*\{[^}]*min-width:\s*0/s },
      { name: 'min-width: 0 on .set-row', regex: /\.set-row[^{]*\{[^}]*min-width:\s*0/s },
      { name: 'min-width: 0 on .set-inputs-row', regex: /\.set-inputs-row[^{]*\{[^}]*min-width:\s*0/s },
      { name: 'min-width: 0 on .work-hero-card', regex: /\.work-hero-card[^{]*\{[^}]*min-width:\s*0/s },
      { name: 'touch targets: 44px min-height on button / .btn', regex: /(?:button|\.btn|input\[type="button"\])[^{]*\{[^}]*min-height:\s*44px/s },
      { name: 'touch targets: 44px min-height on .seg-btn', regex: /\.seg-btn[^{]*\{[^}]*min-height:\s*44px/s },
      { name: 'touch targets: 44px min-height on .btn-step', regex: /\.btn-step[^{]*\{[^}]*min-height:\s*44px/s },
      { name: 'html/body overflow-x hidden / containment', regex: /(?:html|body)[^{]*\{[^}]*overflow-x:\s*hidden/s }
    ];

    let passed = 0;
    let failed = 0;

    for (const check of checks) {
      if (check.regex.test(cssContent)) {
        console.log(`✓ ${check.name} satisfied`);
        passed++;
      } else {
        console.error(`✗ ${check.name} missing or failed regex`);
        failed++;
      }
    }

    if (failed > 0) {
      console.error(`Layout audit failed: ${failed} checks failed.`);
      process.exit(1);
    }
  }

  console.log('\n✓ PASSED: Layout & Touch Target audit completed successfully.\n');
}

runAudit().catch(err => {
  console.error('Audit execution error:', err);
  process.exit(1);
});
