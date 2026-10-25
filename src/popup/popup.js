(function () {
  'use strict';
  const GL = globalThis.PHPLens;
  const { api, LEVELS, el } = GL;
  const $ = (id) => document.getElementById(id);
  const ICONS = { danger: '!', caution: '!', unknown: '?', safe: '✓', none: '·' };

  let currentTab = null;
  let currentState = null;
  let pollTimer = null;

  function setLevel(level) {
    document.body.dataset.level = level;
    $('level-pill').textContent = LEVELS[level] ? LEVELS[level].label : level;
    $('status-icon').textContent = ICONS[level] || '·';
  }

  function chip(label, value, cls) {
    return el('span', { class: 'chip ' + (cls || '') }, [label + ' ', el('b', { text: value })]);
  }

  function fillList(id, items) {
    const list = items || [];
    $(id).replaceChildren(...list.map((x) => el('li', { text: typeof x === 'string' ? x : x.text })));
    return list.length;
  }

  function sourceLine(state) {
    const parts = [];
    if (state.responses) parts.push(state.responses + ' response' + (state.responses === 1 ? '' : 's') + ' observed');
    if (state.version) {
      if (state.versionSource === 'main') parts.push('version from the main page' + (state.mainFromCache ? ' (cached)' : ''));
      else if (state.versionSource === 'sub') parts.push('version from a sub-request');
      else if (state.versionSource === 'head') parts.push('version from a HEAD re-check');
      else if (state.versionSource === 'page') parts.push('version from phpinfo() output');
    }
    if (state.updatedAt) parts.push('updated ' + GL.formatAgo(state.updatedAt));
    return parts.join(' · ');
  }

  function render(state) {
    currentState = state;
    if (!state || !state.verdict) {
      setLevel('none');
      $('title').textContent = 'Listening for server headers…';
      $('summary').textContent = 'Nothing observed for this page yet. If the page was loaded before PHPLens was installed, reload it.';
      $('host').textContent = currentTab ? GL.hostOf(currentTab.url) : '';
      $('source').textContent = '';
      return;
    }
    const v = state.verdict;
    setLevel(state.ignored ? 'none' : v.level);
    $('level-pill').textContent = state.ignored ? 'Ignored' : LEVELS[v.level].label;
    $('title').textContent = v.title;
    $('host').textContent = state.host;
    $('summary').textContent = state.ignored ? 'You chose to ignore warnings for this site. ' + v.summary : v.summary;
    $('source').textContent = sourceLine(state);

    const chips = [];
    if (v.version) {
      const cls = v.level === 'safe' ? 'ok' : v.level === 'danger' ? 'bad' : v.level === 'caution' ? 'warn' : '';
      chips.push(chip('Detected', 'PHP ' + v.version + (v.distro ? ' (distro)' : '') + (v.cached ? ' (cached)' : ''), cls));
    }
    if (v.latest) chips.push(chip('Latest ' + v.branch, v.latest, 'ok'));
    if (v.fixed && v.status !== 'patched' && v.status !== 'newer') chips.push(chip('Fixed in', v.fixed, 'ok'));
    if (!v.version && state.phpDetected) chips.push(chip('Version', 'hidden', ''));
    if (v.mixed) chips.push(chip('Mixed', (state.seen || []).length + ' versions seen', 'warn'));
    if (v.confidence) chips.push(chip('Confidence', v.confidence, v.confidence === 'high' ? 'ok' : v.confidence === 'low' ? 'warn' : ''));
    if (v.app || state.app) chips.push(chip('App', (v.app || state.app).slice(0, 40), ''));
    if (v.displayErrors) chips.push(chip('display_errors', 'on', 'bad'));
    if (state.server) chips.push(chip('Server', state.server.slice(0, 40), ''));
    $('chips').replaceChildren(...chips);

    const showAdv = ['vulnerable', 'vulnerable-distro', 'eol', 'outdated', 'partial', 'hidden'].includes(v.status);
    $('advisory-card').classList.toggle('hidden', !showAdv);
    if (showAdv) {
      $('adv-id').textContent = v.advisory.id + ' · CVSS ' + v.advisory.cvss + (v.advisory.exploited ? ' · exploited in the wild' : '');
      $('adv-title').textContent = v.advisory.title;
      $('adv-link').href = v.advisory.url;
    }

    $('advice-card').classList.toggle('hidden', !fillList('advice', v.advice));
    $('notes-card').classList.toggle('hidden', !fillList('notes', v.notes));

    const n = fillList('evidence', state.evidence);
    $('evidence-count').textContent = n;
    $('evidence-empty').classList.toggle('hidden', n > 0);

    $('btn-ignore').textContent = state.ignored ? 'Stop ignoring' : 'Ignore site ▾';
    if (state.ignored) {
      $('host').textContent = state.host + ' · ' + GL.describeSnooze(state.ignoredUntil);
      $('snooze-menu').classList.add('hidden');
    }
  }

  function buildSnoozeMenu() {
    const row = $('snooze-menu').querySelector('.snooze-row');
    row.replaceChildren(...GL.SNOOZE_OPTIONS.map((o) =>
      el('button', { 'data-hours': o.hours, class: o.hours === 0 ? 'forever' : '', text: o.label })));
    row.querySelectorAll('button').forEach((b) => b.addEventListener('click', async () => {
      const host = currentState && currentState.host ? currentState.host : GL.hostOf(currentTab.url);
      await api.runtime.sendMessage({ type: 'setSnooze', host, hours: Number(b.dataset.hours) });
      $('snooze-menu').classList.add('hidden');
      fetchState();
    }));
  }

  async function fetchState() {
    const res = await api.runtime.sendMessage({ type: 'getState', tabId: currentTab.id });
    render(res && res.state);
    $('notif-warn').classList.toggle('hidden', !(res && res.settings && res.settings.notifications && res.notifPermission === 'denied'));
    return !!(res && res.state && res.state.verdict);
  }

  async function load() {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    currentTab = tab;
    if (!tab || !GL.isWebUrl(tab.url)) {
      setLevel('none');
      $('title').textContent = 'Not a web page';
      $('summary').textContent = 'PHPLens checks http(s) sites only.';
      $('host').textContent = '';
      $('source').textContent = '';
      $('btn-reload').disabled = true;
      $('btn-ignore').classList.add('hidden');
      return;
    }
    const got = await fetchState();
    // The page may still be loading: poll briefly until a verdict exists.
    if (!got) {
      let tries = 0;
      pollTimer = setInterval(async () => {
        if (++tries > 12 || await fetchState()) clearInterval(pollTimer);
      }, 700);
    }
  }

  // Live updates pushed by the background while the popup is open.
  api.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'stateUpdated' && currentTab && msg.tabId === currentTab.id) render(msg.state);
  });

  $('btn-options').addEventListener('click', () => api.runtime.sendMessage({ type: 'openOptions' }));
  $('btn-reload').addEventListener('click', async () => {
    if (!currentTab) return;
    await api.runtime.sendMessage({ type: 'reloadTab', tabId: currentTab.id });
    window.close();
  });
  buildSnoozeMenu();
  $('btn-ignore').addEventListener('click', async () => {
    if (currentState && currentState.ignored) {
      await api.runtime.sendMessage({ type: 'setSnooze', host: currentState.host, hours: -1 });
      fetchState();
      return;
    }
    $('snooze-menu').classList.toggle('hidden');
  });
  $('evidence-toggle').addEventListener('click', () => {
    const open = $('evidence-toggle').getAttribute('aria-expanded') === 'true';
    $('evidence-toggle').setAttribute('aria-expanded', String(!open));
    $('evidence').classList.toggle('hidden', open);
  });

  load().catch((e) => {
    $('title').textContent = 'Could not read state';
    $('summary').textContent = String(e && e.message || e);
  });
})();
