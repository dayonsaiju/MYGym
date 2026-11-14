import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

let appVersion = '8.0.0';
const appJsPath = path.join(rootDir, 'app.js');
if (fs.existsSync(appJsPath)) {
  const m = fs.readFileSync(appJsPath, 'utf8').match(/const APP_VERSION = ['"]([^'"]+)['"]/);
  if (m) appVersion = m[1];
}

const files = [
  'manifest.json',
  'index.html',
  'shell.js',
  'style.css',
  'calc.js',
  'ai-config.js',
  'vendor/three.module.js',
  'app.js',
  'sw.js',
  'CHANGELOG.md',
  'scripts/bump-version.js',
  'scripts/generate-exercise-kinds.js',
  'scripts/capture-screens.js',
  'scripts/check-css-classes.js',
  'scripts/check-no-ui-emoji.js',
  'scripts/layout-audit.js',
  'scripts/consolidate.js',
  'tests/test_production_issues.js'
];

let toc = 'TABLE OF CONTENTS:\n';
const fileContents = [];

files.forEach((relPath, idx) => {
  const fullPath = path.join(rootDir, relPath);
  if (fs.existsSync(fullPath)) {
    const stats = fs.statSync(fullPath);
    const kb = (stats.size / 1024).toFixed(1);
    toc += `${idx + 1}. ${relPath} (${kb} KB)\n`;
    fileContents.push({
      relPath,
      content: fs.readFileSync(fullPath, 'utf8')
    });
  }
});

const header = `================================================================================
MYGYM PWA - COMPLETE CONSOLIDATED SOURCE CODEBASE (v${appVersion})
Generated at: ${new Date().toISOString()}
Architecture: Zero-Backend Offline-First Progressive Web App
================================================================================

${toc}================================================================================
`;

let output = header;
for (const file of fileContents) {
  output += `\n================================================================================\n`;
  output += `>>> START FILE: ${file.relPath}\n`;
  output += `================================================================================\n`;
  output += file.content;
  if (!file.content.endsWith('\n')) output += '\n';
  output += `================================================================================\n`;
  output += `<<< END FILE: ${file.relPath}\n`;
  output += `================================================================================\n`;
}

const targetPath = path.join(rootDir, 'MYGYM_CONSOLIDATED_CODEBASE.txt');
fs.writeFileSync(targetPath, output, 'utf8');
console.log(`✓ Updated ${targetPath} (${(fs.statSync(targetPath).size / 1024).toFixed(1)} KB)`);

