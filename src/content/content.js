/*
 * PHPLens – content script (top frame only).
 * 1. Collects passive hints that the page is served by PHP: URL shape, generator meta,
 *    framework/CMS paths, REST/RSD links, "powered by" footers, non-HttpOnly cookies,
 *    PHP error output rendered into the page (display_errors=On) and phpinfo() pages.
 *    Needed where header observation is unavailable (Safari) and as extra evidence elsewhere.
 * 2. Active fallback (on by default, switchable): one HEAD request to the current page when
 *    passive observation found no version, so cache-only loads and Safari still read the banner.
 * 3. Renders the centered warning dialog when the background asks for it.
 */
(function () {
  'use strict';
  const GL = globalThis.PHPLens;
  if (!GL || !GL.php || window.top !== window) return;
  const api = GL.api;
  const PHP = GL.php;
  const PHP_PATH = /\.php\d?(\/|$|\?)/i;
  const APP_PATHS = [
    [/\/(wp-content|wp-includes|wp-json|wp-admin)\//i, 'WordPress resource paths (wp-content / wp-includes)'],
    [/\/sites\/(default|all)\/files\//i, 'Drupal resource paths (sites/default/files)'],
    [/\/(core|modules|themes)\/[^/]+\/.+\.(js|css)\?v=\d/i, 'Drupal-style versioned assets'],
    [/\/media\/(jui|system|vendor)\//i, 'Joomla resource paths (media/system)'],
    [/\/typo3(conf|temp)\//i, 'TYPO3 resource paths'],
    [/\/(static|skin)\/(version\d+\/)?frontend\//i, 'Magento resource paths'],
    [/\/livewire\/livewire(\.min)?\.js/i, 'Laravel Livewire script'],
    [/\/vendor\/[a-z0-9_-]+\/[a-z0-9_-]+\//i, 'Composer vendor path exposed'],
    [/\/index\.php\?(option=com_|route=|id=\d|q=)/i, 'CMS-style index.php router URL'],
    [/\/xmlrpc\.php/i, 'xmlrpc.php endpoint (WordPress)']
  ];
  const RANKS = { danger: 4, caution: 3, unknown: 2, safe: 1, none: 0 };

  // ------------------------------------------------------------------ hints

  function detectApp() {
    const gen = document.querySelector('meta[name="generator" i]');
    if (gen && PHP.PHP_APP_RE.test(gen.content || '')) return gen.content.trim().slice(0, 80);
    const wp = document.querySelector('link[rel="https://api.w.org/"], link[rel="EditURI"][href*="xmlrpc.php"]');
    if (wp) {
      const ver = /\/wp-includes\/[^"']+\?ver=(\d+\.\d+(?:\.\d+)?)/.exec(document.documentElement.innerHTML.slice(0, 200000));
      return 'WordPress' + (ver ? ' ' + ver[1] : '');
    }
    if (document.querySelector('script[src*="/livewire/livewire"]') || document.querySelector('[wire\\:id]')) return 'Laravel (Livewire)';
    if (document.querySelector('meta[name="csrf-token"]') && document.querySelector('script[src*="/build/assets/"]')) return 'Laravel';
    return null;
  }

  function collect() {
    const hints = [];
    const flags = [];
    const add = (t) => { if (t && !hints.includes(t) && hints.length < 12) hints.push(t); };

    if (PHP_PATH.test(location.pathname)) add('Page URL ends in .php');
    if (/[?&]PHPSESSID=/i.test(location.search)) add('PHPSESSID passed in the URL');

    const app = detectApp();
    if (app) add('Application: ' + app);

    const rsd = document.querySelector('link[rel="EditURI"]');
    if (rsd && /xmlrpc\.php/i.test(rsd.getAttribute('href') || '')) add('RSD link to xmlrpc.php (WordPress)');
    if (document.querySelector('link[rel="https://api.w.org/"]')) add('REST API link rel="https://api.w.org/" (WordPress)');

    let phpRes = 0;
    const seenPaths = new Set();
    const els = document.querySelectorAll('script[src],link[href],img[src],form[action],a[href],iframe[src]');
    for (let i = 0; i < els.length && i < 800; i++) {
      const el = els[i];
      const u = el.getAttribute('src') || el.getAttribute('href') || el.getAttribute('action') || '';
      if (!u || /^(mailto|tel|javascript|#|data:)/i.test(u)) continue;
      let sameOrigin = true;
      try { sameOrigin = new URL(u, location.href).host === location.host; } catch (_) { continue; }
      if (!sameOrigin) continue;
      if (PHP_PATH.test(u)) phpRes++;
      for (const [re, label] of APP_PATHS) if (!seenPaths.has(label) && re.test(u)) seenPaths.add(label);
    }
    if (phpRes) add(phpRes + ' same-origin link(s)/resource(s) point at .php files');
    for (const label of seenPaths) add(label);

    // Visible text: "powered by", PHP error output, phpinfo.
    let text = '';
    try { text = (document.body && document.body.innerText || '').slice(0, 400000); } catch (_) { /* ignore */ }
    const powered = /powered by\s+([A-Za-z0-9 .]{3,40})/i.exec(text);
    if (powered && PHP.PHP_APP_RE.test(powered[1])) add('Footer: powered by ' + powered[1].trim().slice(0, 40));
    if (PHP.PHP_ERROR_RE.test(text)) { add('PHP error output visible in the page'); flags.push('display_errors'); }
    const info = PHP.extractPhpinfoVersion(document.title, text);
    const pageVersion = info ? 'PHP/' + info.version + (info.suffix || '') : null;
    if (pageVersion) add('phpinfo() page: PHP Version ' + info.version);

    try {
      const names = document.cookie.split(';').map((c) => c.split('=')[0].trim()).filter(Boolean);
      const hit = names.find((n) => PHP.PHP_COOKIES.test(n));
      if (hit) add('Cookie typical of PHP apps: ' + hit);
    } catch (_) { /* cookies may be blocked */ }

    // HTML comments left by CMS templates (<!-- Generated by ... -->, <!-- This website is powered by TYPO3 -->)
    try {
      const head = document.documentElement.innerHTML.slice(0, 60000);
      const c = /<!--[^>]{0,120}?(wordpress|drupal|joomla|typo3|prestashop|magento|phpbb|mediawiki|moodle|bitrix)[^>]{0,120}?-->/i.exec(head);
      if (c) add('HTML comment mentions ' + c[1]);
    } catch (_) { /* ignore */ }

    return { hints, flags, app, pageVersion };
  }

  // ---------------------------------------------------- optional HEAD re-check

  let fallbackDone = false;

  async function activeFallback(state, settings) {
    if (fallbackDone || !settings || !settings.activeFallback) return;
    if (state && (state.version || state.ignored)) return;
    fallbackDone = true;
    try {
      const res = await fetch(location.href, { method: 'HEAD', cache: 'no-store', credentials: 'same-origin', redirect: 'follow' });
      const names = ['server', 'x-powered-by', 'x-generator', 'x-pingback', 'x-redirect-by', 'x-drupal-cache', 'x-drupal-dynamic-cache', 'x-powered-cms', 'x-debug-token', 'link', 'age', 'x-cache', 'cf-cache-status'];
      const headers = [];
      for (const n of names) { const v = res.headers.get(n); if (v) headers.push({ name: n, value: v }); }
      const r = await api.runtime.sendMessage({ type: 'activeHeaders', url: res.url || location.href, headers });
      if (r && r.state) handleState(r.state, r.settings);
    } catch (_) { /* network error, CSP, 405 without headers … nothing to do */ }
  }

  // ----------------------------------------------------------------- dialog

  let host = null;
  let dismissed = false; // "✕" only closes the dialog for this page view; longer silence is the per-site snooze
  let keyHandler = null;

  function shouldShow(state, settings) {
    if (dismissed || !state || !state.verdict || state.ignored || !settings || !settings.banner) return false;
    const lvl = state.verdict.level;
    if (lvl !== 'danger' && lvl !== 'caution') return false;
    return RANKS[lvl] >= RANKS[settings.bannerLevel || 'danger'];
  }

  function removeBanner() {
    // Also sweep dialogs left behind by an earlier instance of this script (extension reload).
    document.querySelectorAll('phplens-banner').forEach((el) => el.remove());
    host = null;
    if (keyHandler) { document.removeEventListener('keydown', keyHandler, true); keyHandler = null; }
  }

  function renderBanner(state) {
    removeBanner();
    const v = state.verdict;
    const danger = v.level === 'danger';
    const color = danger ? '#ef4444' : '#f59e0b';
    const soft = danger ? 'rgba(239,68,68,' : 'rgba(245,158,11,';
    host = document.createElement('phplens-banner');
    host.setAttribute('role', 'dialog');
    host.setAttribute('aria-modal', 'true');
    host.setAttribute('aria-label', 'PHPLens warning');
    const root = host.attachShadow({ mode: 'closed' });
    const esc = GL.escapeHtml;
    const li = (arr) => arr.map((x) => '<li>' + esc(typeof x === 'string' ? x : x.text) + '</li>').join('');
    const chip = (label, value) => value ? `<span class="chip">${esc(label)} <b>${esc(value)}</b></span>` : '';
    root.innerHTML = `
      <style>
        :host { all: initial; position: fixed; inset: 0; z-index: 2147483647; display: grid; place-items: center; padding: 16px;
                font: 14px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #eef2ff; }
        .backdrop { position: absolute; inset: 0; background: rgba(2, 6, 23, .55); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); animation: fade .25s ease-out; }
        @keyframes fade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes pop { from { opacity: 0; transform: translateY(14px) scale(.96); } to { opacity: 1; transform: none; } }
        .card { position: relative; width: min(540px, 100%); max-height: calc(100vh - 32px); overflow: hidden auto; border-radius: 20px;
                background: linear-gradient(180deg, #111a33, #0b1020 70%); border: 1px solid ${soft}.55);
                box-shadow: 0 0 0 1px rgba(255,255,255,.04), 0 30px 80px -20px ${soft}.6), 0 40px 90px -30px rgba(0,0,0,.8);
                animation: pop .3s cubic-bezier(.2,.9,.3,1.2); }
        .glow { position: absolute; inset: -40% -20% auto; height: 60%; background: radial-gradient(closest-side, ${soft}.35), transparent); pointer-events: none; }
        .head { position: relative; z-index: 1; display: flex; gap: 16px; align-items: center; padding: 22px 48px 6px 22px; }
        .head > div:last-child { min-width: 0; flex: 1; }
        .icon { width: 56px; height: 56px; flex: none; border-radius: 18px; background: ${color}; color: #0b1020; display: grid; place-items: center;
                font-weight: 900; font-size: 32px; box-shadow: 0 12px 30px -10px ${color}; animation: pulse 2s ease-in-out infinite; }
        @keyframes pulse { 0%,100% { box-shadow: 0 12px 30px -10px ${color}; } 50% { box-shadow: 0 12px 40px -4px ${color}; } }
        .pill { display: inline-block; font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase; font-weight: 800; color: #0b1020; background: ${color}; border-radius: 999px; padding: 2px 9px; }
        .brand { font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase; font-weight: 800; color: #9aa5c4; margin-left: 8px; }
        h2 { margin: 6px 0 0; font-size: 20px; line-height: 1.2; font-weight: 800; }
        .host { font-size: 12.5px; color: #9aa5c4; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .body { padding: 10px 22px 0; }
        .sum { margin: 0; color: #d6dcf5; }
        .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
        .chip { font-size: 11.5px; padding: 4px 9px; border-radius: 999px; border: 1px solid rgba(255,255,255,.1); background: rgba(255,255,255,.05); color: #9aa5c4; }
        .chip b { color: #eef2ff; font-family: ui-monospace, Menlo, Consolas, monospace; font-weight: 600; }
        .actions { display: flex; gap: 8px; flex-wrap: wrap; padding: 18px 22px 20px; }
        button { all: unset; cursor: pointer; font: inherit; font-size: 13px; font-weight: 700; padding: 10px 14px; border-radius: 11px;
                 background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.12); color: #eef2ff; transition: background .15s, transform .1s; }
        button:hover { background: rgba(255,255,255,.14); } button:active { transform: scale(.98); }
        button.ok { background: ${color}; color: #0b1020; border-color: transparent; box-shadow: 0 10px 24px -12px ${color}; margin-left: auto; }
        button.x { position: absolute; z-index: 3; top: 14px; right: 14px; width: 32px; height: 32px; padding: 0; display: grid; place-items: center; border-radius: 10px; font-size: 14px; color: #9aa5c4; }
        button.x:hover { color: #fff; }
        .panel { display: none; margin: 0 22px; padding: 12px 14px; border-radius: 12px; background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08); font-size: 13px; }
        .panel.open { display: block; }
        .panel h4 { margin: 8px 0 4px; font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #9aa5c4; } .panel h4:first-child { margin-top: 0; }
        .panel ul { margin: 0; padding-left: 18px; } .panel li { margin: 2px 0; }
        .panel li.ev { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 11.5px; color: #c7d2fe; word-break: break-word; }
        .panel a { color: #93c5fd; }
        .snooze { display: none; align-items: center; gap: 8px; flex-wrap: wrap; margin: 0 22px; padding: 12px 14px; border-radius: 12px; background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08); font-size: 13px; }
        .snooze.open { display: flex; }
        .snooze span { color: #9aa5c4; flex-basis: 100%; }
        .snooze button { padding: 7px 12px; font-size: 12.5px; }
        .snooze button.f { border-color: rgba(239,68,68,.6); }
        .foot { padding: 0 22px 16px; font-size: 11px; color: #64748b; }
        @media (max-width: 480px) { .head { padding: 18px 16px 4px; } .body, .actions { padding-left: 16px; padding-right: 16px; } h2 { font-size: 18px; } }
      </style>
      <div class="backdrop"></div>
      <div class="card">
        <div class="glow"></div>
        <button class="x" aria-label="Close">✕</button>
        <div class="head">
          <div class="icon">${danger ? '!' : '?'}</div>
          <div>
            <span class="pill">${danger ? 'Danger' : 'Caution'}</span><span class="brand">PHPLens</span>
            <h2>${esc(v.title)}</h2>
            <div class="host">${esc(location.hostname)}</div>
          </div>
        </div>
        <div class="body">
          <p class="sum">${esc(v.summary)}</p>
          <div class="chips">
            ${chip('Detected', v.version ? 'PHP ' + v.version + (v.distro ? ' (distro)' : '') : '')}
            ${chip('Fixed in', v.fixed)}
            ${chip('Latest ' + (v.branch || ''), v.latest)}
            ${chip('Confidence', v.confidence)}
            ${chip('App', v.app)}
          </div>
        </div>
        <div class="actions">
          <button class="d">Details</button>
          <button class="i">Ignore site…</button>
          <button class="ok">Got it</button>
        </div>
        <div class="snooze">
          <span>Silence warnings for <b>${esc(location.hostname)}</b> for:</span>
          ${GL.SNOOZE_OPTIONS.map((o) => `<button data-hours="${o.hours}" class="${o.hours === 0 ? 'f' : ''}">${esc(o.label)}</button>`).join('')}
          <button class="c">Cancel</button>
        </div>
        <div class="panel">
          ${v.advice && v.advice.length ? '<h4>What to do</h4><ul>' + li(v.advice) + '</ul>' : ''}
          ${v.notes && v.notes.length ? '<h4>Notes</h4><ul>' + li(v.notes) + '</ul>' : ''}
          <h4>Evidence (read from the server's own responses)</h4><ul>${(state.evidence || []).map((e) => '<li class="ev">' + esc(e.text) + '</li>').join('')}</ul>
          <h4>Advisory</h4><ul><li>${esc(v.advisory.id)} – ${esc(v.advisory.title)} · <a href="${esc(v.advisory.url)}" target="_blank" rel="noopener noreferrer">php.net changelog</a></li></ul>
        </div>
        <div class="foot">Passive check – PHPLens only read what this server sent. Closing hides this for the current page only.</div>
      </div>`;
    const close = () => { dismissed = true; removeBanner(); };
    keyHandler = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', keyHandler, true);
    root.querySelector('.backdrop').addEventListener('click', close);
    root.querySelector('button.x').addEventListener('click', close);
    root.querySelector('button.ok').addEventListener('click', close);
    const panel = root.querySelector('.panel');
    const snooze = root.querySelector('.snooze');
    root.querySelector('button.d').addEventListener('click', () => { panel.classList.toggle('open'); snooze.classList.remove('open'); });
    root.querySelector('button.i').addEventListener('click', () => { snooze.classList.toggle('open'); panel.classList.remove('open'); });
    root.querySelector('button.c').addEventListener('click', () => snooze.classList.remove('open'));
    snooze.querySelectorAll('button[data-hours]').forEach((b) => b.addEventListener('click', () => {
      api.runtime.sendMessage({ type: 'setSnooze', host: location.hostname, hours: Number(b.dataset.hours) }).catch(() => {});
      close();
    }));
    (document.body || document.documentElement).appendChild(host);
    root.querySelector('button.ok').focus();
  }

  // Never more than one dialog, even if something re-mounts the DOM.
  const guard = new MutationObserver(() => {
    const all = document.querySelectorAll('phplens-banner');
    if (all.length > 1) all.forEach((el) => { if (el !== host) el.remove(); });
  });
  try { guard.observe(document.documentElement, { childList: true }); } catch (_) { /* ignore */ }
  window.addEventListener('pageshow', (e) => { if (e.persisted) { dismissed = false; fallbackDone = false; removeBanner(); report(); } });

  function handleState(state, settings) {
    try {
      if (shouldShow(state, settings)) {
        const sig = state.verdict.status + '|' + state.verdict.level + '|' + (state.verdict.version || '');
        if (!host || host.dataset.sig !== sig) { renderBanner(state); host.dataset.sig = sig; }
      } else {
        removeBanner();
      }
    } catch (e) {
      console.warn('PHPLens dialog failed:', e);
    }
  }

  api.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'verdict' && msg.state && GL.sameSite(msg.state.host, location.hostname)) handleState(msg.state, msg.settings);
  });

  let lastSent = '';
  function report(final) {
    const data = collect();
    const sig = JSON.stringify(data);
    if (sig === lastSent && !final) return;
    lastSent = sig;
    api.runtime.sendMessage(Object.assign({ type: 'pageHints' }, data)).then((res) => {
      if (res && res.state) handleState(res.state, res.settings);
      // Headers of the main document have been observed by now; if they revealed no version,
      // the HEAD re-check runs immediately alongside the passive evidence.
      if (res) activeFallback(res.state, res.settings);
    }).catch(() => {});
  }

  report(false);
  // Single-page apps and late-loaded content: look once more a little later.
  setTimeout(() => report(true), 2500);
})();
