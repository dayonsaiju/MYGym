#!/usr/bin/env node
/**
 * Single-source version updater for MyGyM PWA
 * Updates app.js, index.html, sw.js, manifest.json, and tests
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const targetVersion = process.argv[2];
const shellSuffix = process.argv[3] || '';

if (!targetVersion) {
  console.error('Usage: node scripts/bump-version.js <new_version> [shell_suffix]');
  process.exit(1);
}

const shellVersion = `mygym-core-v${targetVersion}${shellSuffix ? '-' + shellSuffix : ''}`;

console.log(`Bumping MyGyM version to ${targetVersion} (Shell: ${shellVersion})...`);

// 1. app.js
const appPath = path.join(rootDir, 'app.js');
let appCode = fs.readFileSync(appPath, 'utf8');
appCode = appCode.replace(/const APP_VERSION = ['"][^'"]+['"];/, `const APP_VERSION = '${targetVersion}';`);
appCode = appCode.replace(/const SHELL_VERSION = ['"][^'"]+['"];/, `const SHELL_VERSION = '${shellVersion}';`);
appCode = appCode.replace(/navigator\.serviceWorker\.register\(['"]\.\/sw\.js\?v=[^'"]+['"]\)/, `navigator.serviceWorker.register('./sw.js?v=${targetVersion}')`);
fs.writeFileSync(appPath, appCode);
console.log('✓ Updated app.js');

// 2. index.html
const htmlPath = path.join(rootDir, 'index.html');
let htmlCode = fs.readFileSync(htmlPath, 'utf8');
htmlCode = htmlCode.replace(/href=["']\.\/style\.css\?v=[^"']+["']/, `href="./style.css?v=${targetVersion}"`);
htmlCode = htmlCode.replace(/var SHELL_VERSION = ['"][^'"]+['"];/, `var SHELL_VERSION = '${shellVersion}';`);
htmlCode = htmlCode.replace(/src=["']\.\/calc\.js\?v=[^"']+["']/, `src="./calc.js?v=${targetVersion}"`);
htmlCode = htmlCode.replace(/src=["']\.\/ai-config\.js\?v=[^"']+["']/, `src="./ai-config.js?v=${targetVersion}"`);
htmlCode = htmlCode.replace(/src=["']\.\/app\.js\?v=[^"']+["']/, `src="./app.js?v=${targetVersion}"`);
fs.writeFileSync(htmlPath, htmlCode);
console.log('✓ Updated index.html');

// 3. sw.js
const swPath = path.join(rootDir, 'sw.js');
let swCode = fs.readFileSync(swPath, 'utf8');
swCode = swCode.replace(/const C = ['"][^'"]+['"];/, `const C = '${shellVersion}';`);
swCode = swCode.replace(/['"]\.\/style\.css\?v=[^'"]+['"]/, `'./style.css?v=${targetVersion}'`);
swCode = swCode.replace(/['"]\.\/calc\.js\?v=[^"']+['"]/, `'./calc.js?v=${targetVersion}'`);
swCode = swCode.replace(/['"]\.\/ai-config\.js\?v=[^"']+['"]/, `'./ai-config.js?v=${targetVersion}'`);
swCode = swCode.replace(/['"]\.\/app\.js\?v=[^"']+['"]/, `'./app.js?v=${targetVersion}'`);
fs.writeFileSync(swPath, swCode);
console.log('✓ Updated sw.js');

// 4. manifest.json
const manifestPath = path.join(rootDir, 'manifest.json');
let manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
manifest.version = targetVersion;
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log('✓ Updated manifest.json');

// 5. tests/test_production_issues.js
const testPath = path.join(rootDir, 'tests', 'test_production_issues.js');
if (fs.existsSync(testPath)) {
  let testCode = fs.readFileSync(testPath, 'utf8');
  testCode = testCode.replace(/sw\.js cache key is bumped to [^,]+,/, `sw.js cache key is bumped to ${shellVersion},`);
  testCode = testCode.replace(/const C = ['"][^'"]+['"];/, `const C = '${shellVersion}';`);
  testCode = testCode.replace(/sw\.js must use [^ ]+ cache name/, `sw.js must use ${shellVersion} cache name`);
  testCode = testCode.replace(/style\.css\?v=[^'"]+/g, `style.css?v=${targetVersion}`);
  testCode = testCode.replace(/app\.js\?v=[^'"]+/g, `app.js?v=${targetVersion}`);
  testCode = testCode.replace(/calc\.js\?v=[^'"]+/g, `calc.js?v=${targetVersion}`);
  testCode = testCode.replace(/SHELL_VERSION = ['"][^'"]+['"]/, `SHELL_VERSION = '${shellVersion}'`);
  testCode = testCode.replace(/index\.html must use [^'\)]+/, `index.html must use ${shellVersion}`);
  testCode = testCode.replace(/assert\.equal\(api\.APP_VERSION, ['"][^'"]+['"]\);/, `assert.equal(api.APP_VERSION, '${targetVersion}');`);
  testCode = testCode.replace(/assert\.equal\(api\.SHELL_VERSION, ['"][^'"]+['"]\);/, `assert.equal(api.SHELL_VERSION, '${shellVersion}');`);
  fs.writeFileSync(testPath, testCode);
  console.log('✓ Updated tests/test_production_issues.js assertions');
}

console.log(`\nSuccessfully bumped version everywhere to ${targetVersion} (${shellVersion})!`);
