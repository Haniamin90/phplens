// Renders the store screenshots (1280x800 PNG) and promo tiles with headless Edge/Chrome
// from the real popup, settings page and in-page dialog, driven by tools/screenshots/mock-api.js.
// Usage: node tools/screenshots.mjs   -> store/screenshots/*.png
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, copyFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TMP = join(ROOT, 'tools', 'screenshots', '.tmp');
const OUT = join(ROOT, 'store', 'screenshots');
const W = 1280, H = 800;

const BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'
];
const browser = process.env.BROWSER_BIN || BROWSERS.find((p) => existsSync(p));
if (!browser) { console.error('No Edge/Chrome found; set BROWSER_BIN'); process.exit(1); }

rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });
mkdirSync(OUT, { recursive: true });

const abs = (p) => pathToFileURL(join(ROOT, p)).href;
const mockTag = () => `<script src="${abs('tools/screenshots/mock-api.js')}"></script>`;

/** Copy a real extension page into TMP with absolute asset paths and the mock API injected. */
function stagePage(src, name, scenario) {
  let html = readFileSync(join(ROOT, src), 'utf8');
  html = html
    .replace('href="popup.css"', `href="${abs('src/popup/popup.css')}"`)
    .replace('href="options.css"', `href="${abs('src/options/options.css')}"`)
    .replace(/src="\.\.\/\.\.\/icons\//g, `src="${abs('icons')}/`)
    .replace('src="../lib/common.js"', `src="${abs('src/lib/common.js')}"`)
    .replace('src="../lib/php-check.js"', `src="${abs('src/lib/php-check.js')}"`)
    .replace('src="popup.js"', `src="${abs('src/popup/popup.js')}"`)
    .replace('src="options.js"', `src="${abs('src/options/options.js')}"`)
    .replace('<script', mockTag() + '\n  <script');
  const file = join(TMP, name);
  writeFileSync(file, html);
  return pathToFileURL(file).href + '#' + scenario;
}

const popupDanger = stagePage('src/popup/popup.html', 'popup-danger.html', 'danger');
const popupSafe = stagePage('src/popup/popup.html', 'popup-safe.html', 'safe');
const options = stagePage('src/options/options.html', 'options.html', 'options');

const base = `
  * { box-sizing: border-box; } html, body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; }
  body { font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #eef2ff;
         background: radial-gradient(900px 500px at 15% 10%, rgba(99,102,241,.35), transparent 70%), radial-gradient(700px 500px at 95% 100%, var(--glow), transparent 70%), linear-gradient(180deg, #121b36, #0b1020 60%); }
  .cap { position: absolute; left: 80px; top: 180px; width: 560px; }
  .eyebrow { display: inline-flex; align-items: center; gap: 10px; font-size: 13px; letter-spacing: .14em; text-transform: uppercase; font-weight: 800; color: #9aa5c4; }
  .eyebrow img { width: 28px; height: 28px; }
  h1 { margin: 18px 0 14px; font-size: 46px; line-height: 1.1; font-weight: 800; letter-spacing: -.01em; }
  p { margin: 0; font-size: 20px; line-height: 1.5; color: #c7d2fe; max-width: 520px; }
  .pill { display: inline-block; margin-top: 26px; font-size: 13px; font-weight: 700; padding: 8px 14px; border-radius: 999px; background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.12); color: #9aa5c4; }
  .frame { position: absolute; border: 0; border-radius: 18px; box-shadow: 0 40px 90px -30px rgba(0,0,0,.9), 0 0 0 1px rgba(255,255,255,.08); transform-origin: top left; background: #0b1020; }
`;

function framed(name, { title, sub, pill, url, glow, width = 380, height = 600, scale = 1.3, left = 720, top = 30 }) {
  const html = `<!doctype html><meta charset="utf-8"><style>${base} :root { --glow: ${glow}; }</style>
  <div class="cap"><div class="eyebrow"><img src="${abs('store/listing-icon-128.png')}"> PHPLens</div><h1>${title}</h1><p>${sub}</p>${pill ? `<span class="pill">${pill}</span>` : ''}</div>
  <iframe class="frame" src="${url}" style="left:${left}px;top:${top}px;width:${width}px;height:${height}px;transform:scale(${scale})"></iframe>`;
  const file = join(TMP, name + '.html');
  writeFileSync(file, html);
  return pathToFileURL(file).href;
}

function dialogPage() {
  const html = `<!doctype html><meta charset="utf-8"><title>Example shop</title>
  <style>
    * { box-sizing: border-box; } html, body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; }
    body { font: 16px/1.6 system-ui, "Segoe UI", Roboto, sans-serif; color: #1e293b; background: #f8fafc; }
    header { display: flex; align-items: center; gap: 24px; padding: 18px 48px; background: #fff; border-bottom: 1px solid #e2e8f0; }
    header b { font-size: 20px; } header nav { display: flex; gap: 22px; color: #475569; }
    main { max-width: 1100px; margin: 36px auto; padding: 0 48px; display: grid; grid-template-columns: 1.2fr 1fr; gap: 40px; }
    .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
    .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px; }
    .thumb { height: 110px; border-radius: 8px; background: linear-gradient(135deg, #e2e8f0, #cbd5e1); margin-bottom: 10px; }
    .price { color: #0f172a; font-weight: 700; }
    aside .card { padding: 22px; } aside h3 { margin: 0 0 12px; }
    .btn { display: block; margin-top: 16px; padding: 12px; border-radius: 8px; background: #4f46e5; color: #fff; text-align: center; font-weight: 700; }
  </style>
  <header><b>Example Shop</b><nav><span>Home</span><span>Catalogue</span><span>Cart (3)</span><span>Account</span></nav></header>
  <main>
    <section><h2 style="margin:0 0 16px">Your cart</h2><div class="grid">
      ${['Headphones', 'Keyboard', 'Monitor', 'Webcam', 'Mouse', 'Desk lamp'].map((n, i) => `<div class="card"><div class="thumb"></div><div>${n}</div><div class="price">€${(39 + i * 31).toFixed(2)}</div></div>`).join('')}
    </div></section>
    <aside><div class="card"><h3>Checkout</h3><div>Subtotal: €412.00</div><div>Shipping: €4.90</div><div style="margin-top:8px;font-weight:700">Total: €416.90</div><span class="btn">Pay now</span></div></aside>
  </main>
  ${mockTag()}
  <script src="${abs('src/lib/common.js')}"></script>
  <script src="${abs('src/lib/php-check.js')}"></script>
  <script src="${abs('src/content/content.js')}"></script>`;
  const file = join(TMP, 'dialog.html');
  writeFileSync(file, html);
  return pathToFileURL(file).href + '#dialog';
}

/** Promo tile (Chrome Web Store small tile 440x280, marquee 1400x560). */
function tile(name, w, h, big) {
  const html = `<!doctype html><meta charset="utf-8"><style>
    * { box-sizing: border-box; } html, body { margin: 0; width: ${w}px; height: ${h}px; overflow: hidden; }
    body { display: flex; align-items: center; gap: ${big ? 56 : 28}px; padding: 0 ${big ? 110 : 34}px; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #eef2ff;
           background: radial-gradient(60% 120% at 0% 0%, rgba(99,102,241,.45), transparent 70%), radial-gradient(50% 100% at 100% 100%, rgba(239,68,68,.25), transparent 70%), linear-gradient(135deg, #141d3b, #0b1020 70%); }
    img { width: ${big ? 260 : 120}px; height: ${big ? 260 : 120}px; flex: none; filter: drop-shadow(0 20px 40px rgba(0,0,0,.5)); }
    h1 { margin: 0; font-size: ${big ? 76 : 40}px; font-weight: 800; letter-spacing: -.02em; line-height: 1; }
    p { margin: ${big ? 18 : 10}px 0 0; font-size: ${big ? 30 : 17}px; line-height: 1.35; color: #c7d2fe; max-width: ${big ? 820 : 270}px; }
    .tag { display: inline-block; margin-top: ${big ? 26 : 12}px; font-size: ${big ? 18 : 11.5}px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; padding: ${big ? '10px 18px' : '5px 10px'}; border-radius: 999px; background: rgba(34,197,94,.15); border: 1px solid rgba(34,197,94,.45); color: #86efac; }
  </style>
  <img src="${abs('store/listing-icon-512.png')}">
  <div><h1>PHPLens</h1><p>Know if the website's PHP server is patched – before you log in or pay.</p><span class="tag">Passive · reads headers only</span></div>`;
  const file = join(TMP, name + '.html');
  writeFileSync(file, html);
  return pathToFileURL(file).href;
}

const shots = [
  ['1-unpatched-popup', framed('shot1', {
    title: 'Know when a server is unpatched', sub: 'PHPLens reads the PHP version the server advertises and compares it with the fixed releases for CVE-2026-109618. Red means unpatched or end-of-life.',
    pill: 'Passive · no probing, ever', url: popupDanger, glow: 'rgba(239,68,68,.35)', height: 690, scale: 1.1
  })],
  ['2-warning-dialog', dialogPage()],
  ['3-patched-popup', framed('shot3', {
    title: 'Green when the server is current', sub: 'Patched against the advisory and on the latest release of its branch, with the evidence lines the verdict is based on.',
    pill: 'Confidence rating on every verdict', url: popupSafe, glow: 'rgba(34,197,94,.35)', height: 630, scale: 1.2
  })],
  ['4-settings', options],
  ['promo-small-440x280', tile('tile-small', 440, 280, false), 440, 280],
  ['promo-marquee-1400x560', tile('tile-marquee', 1400, 560, true), 1400, 560]
];

for (const [name, url, w = W, h = H] of shots) {
  const out = join(OUT, name + '.png');
  execFileSync(browser, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
    '--allow-file-access-from-files', `--window-size=${w},${h}`, '--force-device-scale-factor=1',
    '--virtual-time-budget=4000', `--screenshot=${out}`, url
  ], { stdio: 'ignore', timeout: 60000 });
  console.log('wrote', out);
}
copyFileSync(join(ROOT, 'store', 'listing-icon-128.png'), join(OUT, 'icon-128.png'));
rmSync(TMP, { recursive: true, force: true });
