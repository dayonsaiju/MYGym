#!/usr/bin/env node
/**
 * scripts/check-css-classes.js
 * Scans app.js and index.html for class names and verifies they exist in style.css.
 * Exits with code 1 if any undefined CSS class is found.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const cssPath = path.join(rootDir, 'style.css');
const appPath = path.join(rootDir, 'app.js');
const htmlPath = path.join(rootDir, 'index.html');

if (!fs.existsSync(cssPath) || !fs.existsSync(appPath) || !fs.existsSync(htmlPath)) {
  console.error('Error: Required files (style.css, app.js, index.html) not found.');
  process.exit(1);
}

const cssCode = fs.readFileSync(cssPath, 'utf8');
const appCode = fs.readFileSync(appPath, 'utf8');
const htmlCode = fs.readFileSync(htmlPath, 'utf8');

// 1. Extract defined classes from style.css
// Remove comments
const cssWithoutComments = cssCode.replace(/\/\*[\s\S]*?\*\//g, '');
const definedClasses = new Set();

// Extract classes: .class-name where dot is not a decimal number (like .5s or 0.5px)
const cssClassRegex = /(?<![0-9])\.([a-zA-Z_-][a-zA-Z0-9_-]*)/g;
let cssMatch;
while ((cssMatch = cssClassRegex.exec(cssWithoutComments)) !== null) {
  definedClasses.add(cssMatch[1]);
}

// 2. Extract referenced classes from app.js and index.html
const referencedClasses = new Set();
const classLocations = new Map(); // className -> array of snippets/files

function recordClass(cls, file, snippet) {
  if (!cls || typeof cls !== 'string') return;
  cls = cls.trim();
  // If token ends with hyphen (e.g. prefix before ${...}), ignore prefix fragment
  if (cls.endsWith('-')) return;

  // Valid CSS class identifier: starts with letter/underscore/hyphen, followed by alphanum/underscore/hyphen
  if (!/^[a-zA-Z_-][a-zA-Z0-9_-]*$/.test(cls)) return;

  // Filter out JS keywords or template literal artifacts if any accidentally match
  if (['true', 'false', 'null', 'undefined', 'return', 'let', 'const', 'var', 'if', 'else'].includes(cls)) return;

  referencedClasses.add(cls);
  if (!classLocations.has(cls)) {
    classLocations.set(cls, []);
  }
  const locs = classLocations.get(cls);
  if (locs.length < 3) {
    locs.push(`${file}: ${snippet.trim()}`);
  }
}

function scanFile(content, fileName) {
  // Regex 1: class="..." or class='...' or class=`...`
  // We handle multi-line template strings as well
  const classAttrRegex = /class\s*=\s*(["'`])([\s\S]*?)\1/g;
  let match;
  while ((match = classAttrRegex.exec(content)) !== null) {
    let raw = match[2];
    // Strip template expressions: ${...}
    // Simple matching for non-nested or single-level nested curlies
    raw = raw.replace(/\$\{[^{}]*(\{[^{}]*\}[^{}]*)*\}/g, ' ');

    const tokens = raw.split(/[\s,]+/);
    for (const t of tokens) {
      if (t) recordClass(t, fileName, match[0].slice(0, 60));
    }
  }

  // Regex 2: classList.add('...'), classList.toggle('...'), etc.
  const classListRegex = /classList\.(?:add|remove|toggle|contains)\(\s*(['"`])([a-zA-Z0-9_-]+)\1/g;
  while ((match = classListRegex.exec(content)) !== null) {
    recordClass(match[2], fileName, match[0]);
  }

  // Regex 3: className = '...'
  const classNameRegex = /className\s*=\s*(['"`])([a-zA-Z0-9_\s-]+)\1/g;
  while ((match = classNameRegex.exec(content)) !== null) {
    const tokens = match[2].split(/\s+/);
    for (const t of tokens) {
      if (t) recordClass(t, fileName, match[0]);
    }
  }

  // Regex 4: querySelector('.foo') and querySelectorAll('.foo')
  const qsRegex = /querySelector(?:All)?\(\s*(['"`])([^\1]*?)\1/g;
  while ((match = qsRegex.exec(content)) !== null) {
    const selector = match[2];
    const dotMatches = selector.matchAll(/(?<![0-9])\.([a-zA-Z_-][a-zA-Z0-9_-]*)/g);
    for (const dm of dotMatches) {
      recordClass(dm[1], fileName, match[0]);
    }
  }
}

scanFile(htmlCode, 'index.html');
scanFile(appCode, 'app.js');

console.log(`CSS Check: Found ${definedClasses.size} defined classes in style.css`);
console.log(`CSS Check: Found ${referencedClasses.size} referenced classes in app.js and index.html\n`);

const missing = [];
for (const cls of referencedClasses) {
  if (!definedClasses.has(cls)) {
    missing.push(cls);
  }
}

missing.sort();

if (missing.length > 0) {
  console.error(`❌ FAILED: ${missing.length} CSS class(es) used in app.js/index.html are NOT defined in style.css:\n`);
  for (const cls of missing) {
    const locs = classLocations.get(cls) || [];
    console.error(`  - .${cls}`);
    for (const loc of locs) {
      console.error(`      at ${loc}`);
    }
  }
  console.error(`\nPlease define these classes in style.css or fix typos.\n`);
  process.exit(1);
} else {
  console.log(`✓ PASSED: All ${referencedClasses.size} referenced CSS classes are defined in style.css.`);
  process.exit(0);
}
