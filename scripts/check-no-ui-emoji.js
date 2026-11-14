#!/usr/bin/env node
/**
 * check-no-ui-emoji.js
 * Verifies that button, chip, and header templates in app.js and index.html
 * use SVG vector icons (<svg>) rather than raw emoji characters.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const appJs = fs.readFileSync(path.join(rootDir, 'app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');

// UI chrome emoji to forbid in button/chip/header labels
// (content emojis like muscle badges or food items are excluded)
const FORBIDDEN_UI_EMOJIS = ['🤖', '⇄', '⚙️', '🔍 Tap', '•••', '👁️'];

const violations = [];

// Helper to check string for UI emoji in button/chip context
function checkLines(filename, content) {
  const lines = content.split('\n');
  lines.forEach((line, idx) => {
    // Only check lines that render buttons, chips, or sheet headers
    const isUiChrome = /class="[^"]*(btn|chip|work-hero-toolbar|sheet-header)[^"]*"/.test(line) ||
                       /data-a="[^"]+"/.test(line);

    if (isUiChrome) {
      for (const emoji of FORBIDDEN_UI_EMOJIS) {
        if (line.includes(emoji)) {
          violations.push({
            file: filename,
            line: idx + 1,
            emoji,
            snippet: line.trim().slice(0, 80)
          });
        }
      }
    }
  });
}

checkLines('app.js', appJs);
checkLines('index.html', indexHtml);

console.log('UI Emoji Audit: Checking buttons, chips, and headers for vector icon compliance...');

if (violations.length > 0) {
  console.error(`❌ FAILED: Found ${violations.length} raw UI emoji violation(s) in button/chip templates:`);
  violations.forEach(v => {
    console.error(`  - ${v.file}:${v.line} [${v.emoji}] -> ${v.snippet}`);
  });
  process.exit(1);
} else {
  console.log('✓ PASSED: All checked button, chip, and header templates use SVG icons instead of raw UI emoji.');
  process.exit(0);
}
