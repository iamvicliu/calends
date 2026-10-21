// Run after build: node scripts/check-base.mjs [/claude]
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
const prefix = (process.argv[2] || '').replace(/\/$/, '');
const check = (path) => assert.ok(path.startsWith(`${prefix}/`), `Missing deployment prefix: ${path}`);
const html = readFileSync('dist/index.html', 'utf8');
for (const [, path] of html.matchAll(/(?:src|href)="(\/[^"\s]+)"/g)) check(path);
assert.ok(html.includes(`${prefix}/assets/`));
const manifest = JSON.parse(readFileSync('dist/manifest.webmanifest', 'utf8'));
check(manifest.start_url);
check(manifest.scope);
assert.equal(manifest.start_url, `${prefix}/`);
assert.equal(manifest.scope, `${prefix}/`);
for (const icon of manifest.icons) check(icon.src);
for (const shortcut of manifest.shortcuts ?? []) check(shortcut.url);
for (const file of readdirSync('dist/assets').filter((f) => f.endsWith('.css'))) {
  for (const [, path] of readFileSync(`dist/assets/${file}`, 'utf8').matchAll(/url\(["']?(\/[^)"']+)/g)) check(path);
}
console.log(`Verified HTML, manifest and CSS asset paths for ${prefix || '/'} deployment`);
