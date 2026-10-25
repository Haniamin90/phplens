// Builds unpacked folders and zips for Chromium (Chrome/Edge/Brave/Opera) and Firefox.
// Usage: node tools/build.mjs   (run tools/gen-icons.mjs first, or `npm run build`)
import { rmSync, mkdirSync, cpSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { zipDirectory } from './zip.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

const base = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
const ffOverrides = JSON.parse(readFileSync(join(ROOT, 'manifest.firefox.json'), 'utf8'));
delete ffOverrides.__comment;

if (!existsSync(join(ROOT, 'icons', 'icon-128.png'))) {
  console.error('icons missing – run `node tools/gen-icons.mjs` first');
  process.exit(1);
}

// Release sanity checks: keep package.json in step and respect store limits.
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const problems = [];
if (pkg.version !== base.version) problems.push(`package.json version ${pkg.version} != manifest version ${base.version}`);
if (!/^\d+(\.\d+){1,3}$/.test(base.version)) problems.push('version must be 1–4 dot-separated integers');
if (base.name.length > 45) problems.push(`name is ${base.name.length} chars (Chrome Web Store max 45)`);
if (base.description.length > 132) problems.push(`description is ${base.description.length} chars (Chrome Web Store max 132)`);
if (problems.length) {
  for (const p of problems) console.error('release check: ' + p);
  process.exit(1);
}

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

function stage(target, manifest) {
  const dir = join(DIST, target);
  mkdirSync(dir, { recursive: true });
  cpSync(join(ROOT, 'src'), join(dir, 'src'), { recursive: true });
  cpSync(join(ROOT, 'icons'), join(dir, 'icons'), { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  const zip = join(DIST, `phplens-${target}-${manifest.version}.zip`);
  const n = zipDirectory(dir, zip);
  console.log(`${target}: ${n} files -> ${zip}`);
}

// Chromium: manifest as-is.
stage('chromium', base);

// Firefox: replace background (event page scripts instead of service worker) and add gecko settings.
const ff = structuredClone(base);
delete ff.minimum_chrome_version; // Chromium-only key; keeps the AMO linter quiet
ff.background = ffOverrides.background;
ff.browser_specific_settings = ffOverrides.browser_specific_settings;
stage('firefox', ff);

console.log('done');
