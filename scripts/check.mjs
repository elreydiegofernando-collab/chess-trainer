// Checks that site/ is complete and the offline cache list matches it:
//  - every file listed in site/sw.js exists,
//  - every file the app loads is listed (so it also works offline),
//  - every file index.html and the manifest point to exists,
//  - sw.js still has the VERSION line the deploy workflow stamps.
// Run with `npm run check`. Exits non-zero on any problem.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = resolve(fileURLToPath(new URL('../site/', import.meta.url)));
const problems = [];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(relative(SITE, full).split(sep).join('/'));
  }
  return out;
}

// Files the browser never needs at run time: the service worker itself,
// robots.txt, and the license and source notes kept next to vendored files.
const NOT_CACHED = /^(sw\.js|robots\.txt)$|(^|\/)(Copying\.txt|OFL\.txt|SOURCE\.md)$/;

const sw = readFileSync(join(SITE, 'sw.js'), 'utf8');
if (!/^const VERSION = 'dev';$/m.test(sw)) problems.push("sw.js: missing the line `const VERSION = 'dev';` that the deploy workflow stamps");
const listMatch = sw.match(/const FILES = \[([\s\S]*?)\];/);
if (!listMatch) problems.push('sw.js: FILES list not found');
const listed = listMatch ? [...listMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : [];

for (const f of listed) {
  if (f === './') continue;
  if (!existsSync(join(SITE, f))) problems.push(`sw.js lists ${f}, which does not exist`);
}
const listedSet = new Set(listed);
for (const f of walk(SITE)) {
  if (NOT_CACHED.test(f)) continue;
  if (!listedSet.has(f)) problems.push(`${f} is not in the sw.js FILES list (it would not work offline)`);
}

// Local references in index.html and the manifest.
const html = readFileSync(join(SITE, 'index.html'), 'utf8');
for (const m of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
  const ref = m[1];
  if (/^(https?:|mailto:|#|data:)/.test(ref)) continue;
  if (!existsSync(join(SITE, ref))) problems.push(`index.html points to ${ref}, which does not exist`);
}
const manifest = JSON.parse(readFileSync(join(SITE, 'manifest.webmanifest'), 'utf8'));
for (const icon of manifest.icons || []) {
  if (!existsSync(join(SITE, icon.src))) problems.push(`manifest icon ${icon.src} does not exist`);
}

if (problems.length) {
  console.error('Problems found:\n- ' + problems.join('\n- '));
  process.exit(1);
}
console.log(`OK: ${listed.length} cached paths, all site files accounted for.`);
