/*
 * PHPLens – background (Chromium service worker / Firefox event page).
 *
 * Observes response headers of the pages you visit (webRequest, non-blocking),
 * extracts the PHP version the server advertises, compares it with the patched
 * releases and updates badge / notification / in-page dialog / popup live.
 *
 * It never sends a request of its own to the site you are visiting (the optional
 * HEAD re-check is performed by the page's own content script, only when the user
 * enables it). The only other outbound request is a daily release-table fetch from php.net.
 *
 * Consistency rules:
 *  - every top-level navigation starts a fresh state (redirect chains share one);
 *  - the main document's version wins; sub-requests only fill in when it has none;
 *  - responses served from the browser cache are flagged as such;
 *  - all updates for one tab run through a queue so they never interleave;
 *  - settings and the release table are cached in memory and never block on the network.
 */
'use strict';

if (typeof importScripts === 'function') {
  importScripts('lib/common.js', 'lib/php-check.js');
}

(function () {
  const GL = globalThis.PHPLens;
  const { api, LEVELS } = GL;
  const PHP = GL.php;

  const sessionStore = api.storage.session || api.storage.local;
  const tabCache = new Map();
  const queues = new Map();
  const seenRequests = new Map(); // requestId:url -> true (dedupe headersReceived / responseStarted)
  const TABLE_TTL_MS = 24 * 60 * 60 * 1000;
  const TABLE_RETRY_MS = 60 * 60 * 1000;
  const LIVE_URL = 'https://www.php.net/releases/active.php';

  // ------------------------------------------------------------- per-tab queue

  function enqueue(tabId, fn) {
    const prev = queues.get(tabId) || Promise.resolve();
    const next = prev.then(fn, fn).catch((e) => console.warn('PHPLens', e));
    queues.set(tabId, next);
    next.finally(() => { if (queues.get(tabId) === next) queues.delete(tabId); });
    return next;
  }

  // ----------------------------------------------------------- cached settings

  let settingsCache = null;
  let tableCache = null;
  let tableMeta = { fetchedAt: 0, triedAt: 0, error: '' };

  async function settings() {
    if (!settingsCache) settingsCache = await GL.getSettings();
    return settingsCache;
  }

  if (api.storage.onChanged) api.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.settings) settingsCache = null;
    if (changes.liveTable || changes.liveFetchedAt || changes.liveTriedAt || changes.liveError) tableCache = null;
  });

  // ---------------------------------------------------------------- tab state

  function newState(url, requestId) {
    return {
      url, host: GL.hostOf(url), requestId: requestId || null,
      startedAt: Date.now(), updatedAt: Date.now(), responses: 0,
      phpDetected: false, version: null, versionSource: null, versionPath: '', versionFromCache: false,
      mainFromCache: false, proxyCached: false, server: null, poweredBy: null, app: null,
      notifiedKey: null, badgeKey: null, flags: [],
      cookies: [], evidence: [], hints: [], seen: [], verdict: null, ignored: false, ignoredUntil: null
    };
  }

  async function loadTab(tabId) {
    if (tabCache.has(tabId)) return tabCache.get(tabId);
    try {
      const key = 'tab:' + tabId;
      const r = await sessionStore.get(key);
      if (r && r[key]) { tabCache.set(tabId, r[key]); return r[key]; }
    } catch (_) { /* ignore */ }
    return null;
  }

  async function saveTab(tabId, st) {
    tabCache.set(tabId, st);
    try { await sessionStore.set({ ['tab:' + tabId]: st }); } catch (_) { /* ignore */ }
  }

  async function dropTab(tabId) {
    tabCache.delete(tabId);
    try { await sessionStore.remove('tab:' + tabId); } catch (_) { /* ignore */ }
  }

  function pushEvidence(st, items) {
    const seen = new Set(st.evidence.map((e) => e.text));
    for (const e of items || []) {
      if (!e || seen.has(e.text)) continue;
      seen.add(e.text);
      st.evidence.push(e);
    }
    if (st.evidence.length > 16) st.evidence.length = 16;
  }

  /** Cheap signature of what influences the verdict. */
  function signature(st) {
    return [st.version && st.version.version, st.versionSource, st.phpDetected, st.proxyCached, st.app, st.evidence.length, st.seen.length, st.flags.length].join('|');
  }

  /**
   * @param d { url, type: 'main_frame'|'sub_frame'|'xmlhttprequest'|...|'head'|'page', fromCache }
   */
  function applyInspection(st, insp, d) {
    const host = GL.hostOf(d.url);
    let path = '';
    try { path = new URL(d.url).pathname.slice(0, 60); } catch (_) { /* ignore */ }
    const isMain = d.type === 'main_frame';
    const authoritative = isMain || d.type === 'head' || d.type === 'page';
    const cached = !!d.fromCache;
    st.responses++;
    st.updatedAt = Date.now();

    if (insp.version) {
      st.phpDetected = true;
      const betterThanCurrent = !st.version || (st.version.partial && !insp.version.partial);
      if (isMain) {
        st.version = insp.version; st.versionSource = 'main'; st.versionPath = path; st.versionFromCache = cached;
      } else if (authoritative && st.versionSource !== 'main') {
        st.version = insp.version; st.versionSource = d.type; st.versionPath = path; st.versionFromCache = false;
      } else if (st.versionSource !== 'main' && st.versionSource !== 'head' && st.versionSource !== 'page' && betterThanCurrent) {
        st.version = insp.version; st.versionSource = 'sub'; st.versionPath = host + path; st.versionFromCache = cached;
      }
      const entry = { version: insp.version.version, raw: insp.version.raw, host, path, type: d.type, fromCache: cached };
      if (!st.seen.some((e) => e.version === entry.version && e.host === entry.host)) {
        st.seen.push(entry);
        if (st.seen.length > 8) st.seen.length = 8;
      }
    }
    if (isMain) { st.mainFromCache = cached; st.proxyCached = !!insp.proxyCached; }
    if (insp.server && (authoritative || !st.server)) st.server = insp.server;
    if (insp.poweredBy && (authoritative || !st.poweredBy)) st.poweredBy = insp.poweredBy;
    if (insp.app && !st.app) st.app = insp.app;
    if (insp.cookies.length || insp.phpUrl || insp.app || /php/i.test(insp.poweredBy || '')) st.phpDetected = true;
    for (const c of insp.cookies) if (!st.cookies.includes(c)) st.cookies.push(c);
    const tag = (cached ? ' [cached]' : '') + (d.type === 'head' ? ' [HEAD re-check]' : '') + (isMain || authoritative || host === st.host ? '' : ' [' + host + ']');
    pushEvidence(st, insp.evidence.map((e) => ({ kind: e.kind, text: e.text + tag })));
  }

  // ------------------------------------------------------------ release table

  let refreshing = null;

  /** Never waits on the network: bundled table + cached live data, refreshed in the background when stale. */
  async function getTable() {
    if (!tableCache) {
      let stored = {};
      try { stored = await api.storage.local.get(['liveTable', 'liveFetchedAt', 'liveTriedAt', 'liveError']); } catch (_) { /* ignore */ }
      const base = stored.liveTable && stored.liveTable.branches ? stored.liveTable : PHP.VERSION_TABLE;
      tableCache = Object.assign({}, base, { advisories: PHP.VERSION_TABLE.advisories, minSupportedBranch: PHP.VERSION_TABLE.minSupportedBranch });
      tableMeta = { fetchedAt: stored.liveFetchedAt || 0, triedAt: stored.liveTriedAt || 0, error: stored.liveError || '' };
    }
    const stale = Date.now() - tableMeta.fetchedAt > TABLE_TTL_MS;
    const triedRecently = Date.now() - tableMeta.triedAt < TABLE_RETRY_MS;
    if (stale && !triedRecently) refreshTable(false); // fire and forget
    return tableCache;
  }

  async function refreshTable(force) {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      const s = await settings();
      if (!s.liveVersions && !force) return null;
      tableMeta.triedAt = Date.now();
      try { await api.storage.local.set({ liveTriedAt: tableMeta.triedAt }); } catch (_) { /* ignore */ }
      try {
        const res = await fetch(LIVE_URL, { cache: 'no-store', credentials: 'omit' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const current = tableCache || PHP.VERSION_TABLE;
        const merged = PHP.mergeLiveTable(current, await res.json());
        await api.storage.local.set({ liveTable: merged, liveFetchedAt: Date.now(), liveError: '' });
        tableCache = null;
        if (merged.changed) await reevaluateAll();
        return merged;
      } catch (e) {
        try { await api.storage.local.set({ liveError: String(e && e.message || e) }); } catch (_) { /* ignore */ }
        tableCache = null;
        return null;
      }
    })().finally(() => { refreshing = null; });
    return refreshing;
  }

  async function reevaluateAll() {
    for (const [id, st] of tabCache) await enqueue(id, () => finalize(id, st));
  }

  // ------------------------------------------------------------------ verdict

  function publicState(st) {
    if (!st) return null;
    const { url, host, phpDetected, version, versionSource, versionPath, server, poweredBy, app, flags, cookies, evidence, hints, seen, verdict, ignored, ignoredUntil, startedAt, updatedAt, responses, mainFromCache, proxyCached } = st;
    return { url, host, phpDetected, version, versionSource, versionPath, server, poweredBy, app, flags, cookies, evidence, hints, seen, verdict, ignored, ignoredUntil, startedAt, updatedAt, responses, mainFromCache, proxyCached };
  }

  async function finalize(tabId, st) {
    const s = await settings();
    const table = await getTable();
    const until = GL.snoozeFor(st.host, s);
    st.ignored = until !== null;
    st.ignoredUntil = until;
    st.verdict = PHP.reconcile(PHP.evaluate(st, table, s), st, table, s);
    await saveTab(tabId, st);
    await updateBadge(tabId, st, s);
    if (!st.ignored && s.notifications && wantsNotification(st.verdict.level, s)) await maybeNotify(tabId, st);
    const payload = { type: 'verdict', tabId, state: publicState(st), settings: s };
    try { await api.tabs.sendMessage(tabId, payload); } catch (_) { /* no content script on this page */ }
    try { await api.runtime.sendMessage(Object.assign({}, payload, { type: 'stateUpdated' })); } catch (_) { /* no popup open */ }
    return st;
  }

  async function updateBadge(tabId, st, s) {
    const lvl = st.ignored ? 'none' : (st.verdict ? st.verdict.level : 'none');
    const L = LEVELS[lvl] || LEVELS.none;
    const title = 'PHPLens – ' + (st.ignored ? 'ignored site' : st.verdict.title);
    const key = lvl + '|' + (s.badge ? 1 : 0) + '|' + title;
    if (st.badgeKey === key) return;
    st.badgeKey = key;
    const iconSet = lvl === 'none' ? 'icon' : 'state-' + lvl;
    try {
      await api.action.setBadgeText({ tabId, text: s.badge && L.badge ? L.badge : '' });
      if (L.badge) {
        await api.action.setBadgeBackgroundColor({ tabId, color: L.color });
        if (api.action.setBadgeTextColor) await api.action.setBadgeTextColor({ tabId, color: '#ffffff' });
      }
      await api.action.setTitle({ tabId, title });
      await api.action.setIcon({ tabId, path: { 16: '/icons/' + iconSet + '-16.png', 32: '/icons/' + iconSet + '-32.png', 48: '/icons/' + iconSet + '-48.png' } });
    } catch (_) { /* tab may be gone */ }
  }

  async function clearBadge(tabId) {
    try {
      await api.action.setBadgeText({ tabId, text: '' });
      await api.action.setTitle({ tabId, title: 'PHPLens – PHP patch check' });
      await api.action.setIcon({ tabId, path: { 16: '/icons/icon-16.png', 32: '/icons/icon-32.png', 48: '/icons/icon-48.png' } });
    } catch (_) { /* ignore */ }
  }

  // ------------------------------------------------------------ notifications

  function wantsNotification(level, s) {
    if (level !== 'danger' && level !== 'caution') return false;
    return PHP.RANK[level] >= PHP.RANK[s.notifyLevel || 'danger'];
  }

  async function notificationPermission() {
    try {
      if (api.notifications && api.notifications.getPermissionLevel) return await api.notifications.getPermissionLevel();
    } catch (_) { /* Firefox has no getPermissionLevel */ }
    return api.notifications ? 'granted' : 'unavailable';
  }

  async function sendNotification(id, level, title, message, withButtons) {
    if (!api.notifications) return { ok: false, error: 'notifications API unavailable in this browser' };
    if ((await notificationPermission()) === 'denied') return { ok: false, error: 'notifications are blocked for this extension in the browser' };
    const iconSet = level === 'caution' ? 'state-caution' : level === 'safe' ? 'state-safe' : 'state-danger';
    const minimal = { type: 'basic', iconUrl: api.runtime.getURL('icons/' + iconSet + '-128.png'), title: title.slice(0, 120), message: message.slice(0, 320) };
    const attempts = [];
    if (withButtons) attempts.push(Object.assign({}, minimal, { priority: 2, buttons: [{ title: 'Snooze 1 day' }, { title: 'Ignore site for good' }] }));
    attempts.push(Object.assign({}, minimal, { priority: 2 }));
    attempts.push(minimal); // Firefox rejects unsupported option keys
    let lastErr = null;
    for (const opts of attempts) {
      try {
        const created = await api.notifications.create(id, opts);
        if (api.runtime.lastError) throw new Error(api.runtime.lastError.message);
        return { ok: true, id: created || id };
      } catch (e) { lastErr = e; }
    }
    return { ok: false, error: String(lastErr && lastErr.message || lastErr) };
  }

  /** One notification per page load and verdict; silencing beyond that is the user's per-site choice. */
  async function maybeNotify(tabId, st) {
    const key = st.verdict.status + '|' + (st.verdict.version || '');
    if (st.notifiedKey === key) return;
    st.notifiedKey = key;
    const id = 'phplens-' + tabId + '-' + Date.now();
    try { await sessionStore.set({ ['notif:' + id]: st.host }); } catch (_) { /* ignore */ }
    // Keep it to one glance: "example.com – PHP 8.4.26 unpatched, fix 8.4.27". Details live in the popup.
    const title = st.verdict.level === 'danger' ? 'PHPLens: unsafe PHP server' : 'PHPLens: check this server';
    const res = await sendNotification(id, st.verdict.level, title, st.host + ' – ' + (st.verdict.short || st.verdict.title), true);
    if (!res.ok) console.warn('PHPLens notification failed:', res.error);
  }

  /** hours > 0: snooze for that long; hours === 0: ignore for good; hours < 0: stop ignoring. */
  async function setSnooze(host, hours) {
    const s = await settings();
    const snoozed = Object.assign({}, s.snoozed);
    const base = GL.baseDomain(host);
    if (hours < 0) { delete snoozed[host]; delete snoozed[base]; }
    else snoozed[host] = hours === 0 ? 0 : Date.now() + hours * 3600 * 1000;
    await GL.saveSettings({ snoozed });
    settingsCache = null;
    for (const [id, st] of tabCache) if (GL.sameSite(st.host, host)) await enqueue(id, () => finalize(id, st));
    return snoozed;
  }

  // ----------------------------------------------------------------- listeners

  function rememberRequest(id) {
    if (seenRequests.has(id)) return false;
    seenRequests.set(id, true);
    if (seenRequests.size > 800) seenRequests.delete(seenRequests.keys().next().value);
    return true;
  }

  function onResponse(d) {
    if (d.tabId < 0 || !GL.isWebUrl(d.url)) return;
    if (!rememberRequest(d.requestId + ':' + d.url)) return; // already handled by the other event
    enqueue(d.tabId, async () => {
      const host = GL.hostOf(d.url);
      let st = await loadTab(d.tabId);
      if (d.type === 'main_frame') {
        // A redirect chain shares one requestId: keep its evidence. Anything else is a new page.
        if (st && st.requestId === d.requestId && GL.sameSite(st.host, host)) { st.url = d.url; st.host = host; }
        else st = newState(d.url, d.requestId);
      } else {
        if (!st) return;
        if (!GL.sameSite(st.host, host)) return; // third-party resource: not this site's server
        if (st.requestId && Number(d.requestId) < Number(st.requestId)) return; // straggler from the previous page
      }
      const before = signature(st);
      applyInspection(st, PHP.inspectResponse(d.url, d.responseHeaders), d);
      if (d.type === 'main_frame' || before !== signature(st)) await finalize(d.tabId, st);
      else await saveTab(d.tabId, st);
    });
  }

  const filter = { urls: ['http://*/*', 'https://*/*'], types: ['main_frame', 'sub_frame', 'xmlhttprequest', 'script', 'stylesheet', 'image', 'other'] };
  function listen(event, specs) {
    try { event.addListener(onResponse, filter, specs); }
    catch (_) { event.addListener(onResponse, filter, ['responseHeaders']); }
  }
  // onHeadersReceived: network responses. onResponseStarted: also cache hits (with fromCache).
  // 'extraHeaders' is needed in Chromium to see Set-Cookie; Firefox rejects the flag (caught above).
  // Safari has no webRequest at all: there, page hints and the HEAD fallback are the only sources.
  if (api.webRequest && api.webRequest.onHeadersReceived) {
    listen(api.webRequest.onHeadersReceived, ['responseHeaders', 'extraHeaders']);
    if (api.webRequest.onResponseStarted) listen(api.webRequest.onResponseStarted, ['responseHeaders', 'extraHeaders']);
  }

  api.tabs.onRemoved.addListener((tabId) => { enqueue(tabId, () => dropTab(tabId)); });

  api.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.url && !GL.isWebUrl(changeInfo.url)) enqueue(tabId, async () => { await dropTab(tabId); await clearBadge(tabId); });
  });

  // Chromium prerender / instant pages: the prerendered page lives under a temporary tab id
  // and is swapped in on activation. Carry the state over so the badge does not vanish.
  if (api.tabs.onReplaced) {
    api.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
      enqueue(removedTabId, async () => {
        const st = await loadTab(removedTabId);
        if (!st) return;
        st.badgeKey = null;
        await dropTab(removedTabId);
        await enqueue(addedTabId, () => finalize(addedTabId, st));
      });
    });
  }

  if (api.notifications && api.notifications.onClicked) {
    api.notifications.onClicked.addListener((id) => {
      if (String(id).startsWith('phplens-test-')) { api.notifications.clear(id); return; }
      const tabId = parseInt(String(id).replace('phplens-', ''), 10);
      if (!Number.isNaN(tabId)) api.tabs.update(tabId, { active: true }).catch(() => {});
      api.notifications.clear(id);
    });
    if (api.notifications.onButtonClicked) {
      api.notifications.onButtonClicked.addListener(async (id, index) => {
        api.notifications.clear(id);
        try {
          const r = await sessionStore.get('notif:' + id);
          const host = r && r['notif:' + id];
          if (host) await setSnooze(host, index === 0 ? 24 : 0);
          await sessionStore.remove('notif:' + id);
        } catch (_) { /* ignore */ }
      });
    }
    if (api.notifications.onClosed) {
      api.notifications.onClosed.addListener((id) => { sessionStore.remove('notif:' + id).catch(() => {}); });
    }
  }

  async function handleMessage(msg, sender) {
    const tabId = msg.tabId ?? (sender.tab && sender.tab.id);
    switch (msg.type) {
      case 'getState': {
        const st = tabId != null ? await loadTab(tabId) : null;
        return { state: publicState(st), settings: await settings(), table: await getTable(), notifPermission: await notificationPermission() };
      }
      case 'testNotification': {
        const res = await sendNotification('phplens-test-' + Date.now(), msg.level || 'danger',
          'PHPLens: test', 'example.com – PHP 8.4.26 unpatched, fix 8.4.27');
        res.permission = await notificationPermission();
        return res;
      }
      case 'pageHints': {
        if (tabId == null || !sender.tab || !GL.isWebUrl(sender.tab.url)) return { ok: false };
        return enqueue(tabId, async () => {
          let st = await loadTab(tabId);
          if (!st || !GL.sameSite(st.host, GL.hostOf(sender.tab.url))) st = newState(sender.tab.url, null);
          const before = signature(st) + '|' + st.hints.join(';');
          st.hints = (msg.hints || []).slice(0, 12).map((h) => String(h).slice(0, 160));
          st.flags = Array.isArray(msg.flags) ? msg.flags.filter((f) => typeof f === 'string').slice(0, 8) : [];
          if (msg.app && !st.app) st.app = String(msg.app).slice(0, 80);
          if (st.hints.length || st.app) {
            st.phpDetected = true;
            pushEvidence(st, st.hints.map((h) => ({ kind: 'page', text: h })));
          }
          if (msg.pageVersion) {
            const insp = PHP.inspectResponse(sender.tab.url, [{ name: 'X-Powered-By', value: String(msg.pageVersion).slice(0, 40) }]);
            insp.evidence = [{ kind: 'page', text: 'phpinfo() output: ' + String(msg.pageVersion).slice(0, 40) }];
            applyInspection(st, insp, { url: sender.tab.url, type: 'page', fromCache: false });
          }
          if (!st.verdict || before !== signature(st) + '|' + st.hints.join(';')) await finalize(tabId, st); else await saveTab(tabId, st);
          return { state: publicState(st), settings: await settings() };
        });
      }
      case 'activeHeaders': {
        // Result of the opt-in HEAD re-check that the page's content script performed.
        if (tabId == null || !sender.tab || !GL.isWebUrl(sender.tab.url)) return { ok: false };
        const s = await settings();
        if (!s.activeFallback) return { ok: false };
        return enqueue(tabId, async () => {
          let st = await loadTab(tabId);
          if (!st || !GL.sameSite(st.host, GL.hostOf(sender.tab.url))) st = newState(sender.tab.url, null);
          const url = GL.isWebUrl(msg.url) && GL.sameSite(GL.hostOf(msg.url), st.host) ? msg.url : sender.tab.url;
          const headers = (Array.isArray(msg.headers) ? msg.headers : []).slice(0, 30)
            .map((h) => ({ name: String(h.name || '').slice(0, 60), value: String(h.value || '').slice(0, 400) }));
          const before = signature(st);
          applyInspection(st, PHP.inspectResponse(url, headers), { url, type: 'head', fromCache: false });
          if (before !== signature(st) || !st.verdict) await finalize(tabId, st); else await saveTab(tabId, st);
          return { state: publicState(st), settings: s };
        });
      }
      case 'setSnooze': {
        if (!msg.host) return { error: 'host required' };
        const snoozed = await setSnooze(String(msg.host).toLowerCase(), Number(msg.hours));
        return { ok: true, snoozed };
      }
      case 'settingsChanged':
        settingsCache = null;
        await reevaluateAll();
        return { ok: true };
      case 'refreshTable': {
        await refreshTable(true);
        return { table: await getTable(), fetchedAt: tableMeta.fetchedAt, error: tableMeta.error };
      }
      case 'getTable':
        return { table: await getTable(), fetchedAt: tableMeta.fetchedAt, error: tableMeta.error };
      case 'reloadTab': {
        if (tabId != null) {
          await enqueue(tabId, async () => { await dropTab(tabId); await clearBadge(tabId); });
          try { await api.tabs.reload(tabId, { bypassCache: true }); } catch (_) { await api.tabs.reload(tabId); }
        }
        return { ok: true };
      }
      case 'openOptions':
        await api.runtime.openOptionsPage();
        return { ok: true };
      default:
        return { error: 'unknown message' };
    }
  }

  api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.type === 'stateUpdated' || msg.type === 'verdict') return false; // our own broadcasts
    handleMessage(msg, sender).then(sendResponse, (e) => sendResponse({ error: String(e && e.message || e) }));
    return true; // async response
  });

  api.runtime.onInstalled.addListener(() => { getTable().catch(() => {}); });
  if (api.runtime.onStartup) api.runtime.onStartup.addListener(() => { getTable().catch(() => {}); });
})();
