(function () {
  'use strict';
  const GL = globalThis.PHPLens;
  const { api, el } = GL;
  const $ = (id) => document.getElementById(id);
  const BOOLS = ['badge', 'notifications', 'banner', 'distroAsCaution', 'liveVersions', 'activeFallback'];
  let savedTimer = null;

  function flashSaved() {
    $('saved').classList.add('show');
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => $('saved').classList.remove('show'), 1200);
  }

  async function persist(patch) {
    await GL.saveSettings(patch);
    flashSaved();
    api.runtime.sendMessage({ type: 'settingsChanged' }).catch(() => {});
  }

  function renderTable(res) {
    const table = res.table;
    const adv = table.advisories[0];
    const rows = Object.keys(table.branches).sort(GL.php.compareVersions).map((b) => {
      const info = table.branches[b];
      return el('tr', {}, [
        el('td', { class: 'mono', text: 'PHP ' + b }),
        el('td', { class: 'mono' }, [el('span', { class: 'ok', text: info.latest })]),
        el('td', { class: 'mono', text: adv.fixed[b] || '–' }),
        el('td', { text: info.securityUntil || '–' })
      ]);
    });
    $('table').querySelector('tbody').replaceChildren(...rows);
    const src = table.source === 'php.net' ? 'php.net (live)' : 'bundled';
    let meta = `Source: ${src} · table date ${table.updated}`;
    if (res.fetchedAt) meta += ` · last check ${GL.formatAgo(res.fetchedAt)}`;
    if (res.error) meta += ` · last fetch failed: ${res.error}`;
    $('table-meta').textContent = meta;
  }

  function renderSnoozed(snoozed) {
    const entries = Object.entries(snoozed || {}).sort((a, b) => a[0].localeCompare(b[0]));
    const rows = entries.map(([host, until]) => {
      const when = until === 0 ? 'for good' : new Date(until).toLocaleString();
      const remove = el('button', { type: 'button', text: 'Remove' });
      remove.addEventListener('click', async () => {
        const res = await api.runtime.sendMessage({ type: 'setSnooze', host, hours: -1 });
        renderSnoozed(res && res.snoozed);
        flashSaved();
      });
      return el('tr', {}, [el('td', { class: 'mono', text: host }), el('td', { text: when }), el('td', {}, [remove])]);
    });
    $('snoozed').querySelector('tbody').replaceChildren(...rows);
    $('snoozed-empty').classList.toggle('hidden', entries.length > 0);
    $('snoozed').classList.toggle('hidden', entries.length === 0);
  }

  async function load() {
    const s = await GL.getSettings();
    for (const k of BOOLS) $(k).checked = !!s[k];
    $('bannerLevel').value = s.bannerLevel || 'danger';
    $('notifyLevel').value = s.notifyLevel || 'danger';
    $('add-hours').replaceChildren(...GL.SNOOZE_OPTIONS.map((o) => el('option', { value: o.hours, text: o.label })));
    $('add-hours').value = '0';
    renderSnoozed(s.snoozed);
    const res = await api.runtime.sendMessage({ type: 'getTable' });
    if (res && res.table) renderTable(res);
  }

  for (const k of BOOLS) $(k).addEventListener('change', () => persist({ [k]: $(k).checked }));
  $('bannerLevel').addEventListener('change', () => persist({ bannerLevel: $('bannerLevel').value }));
  $('notifyLevel').addEventListener('change', () => persist({ notifyLevel: $('notifyLevel').value }));

  $('add-snooze').addEventListener('click', async () => {
    const host = $('add-host').value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!host) return;
    const res = await api.runtime.sendMessage({ type: 'setSnooze', host, hours: Number($('add-hours').value) });
    $('add-host').value = '';
    renderSnoozed(res && res.snoozed);
    flashSaved();
  });
  $('add-host').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('add-snooze').click(); });

  $('test-notify').addEventListener('click', async () => {
    const out = $('notify-result');
    out.textContent = 'Sending…';
    const res = await api.runtime.sendMessage({ type: 'testNotification', level: 'danger' }).catch((e) => ({ ok: false, error: String(e) }));
    if (res && res.ok) {
      out.textContent = 'Sent. If nothing appeared, your OS or browser is hiding notifications from this browser (Windows: Focus Assist, or Settings → System → Notifications).';
    } else {
      out.textContent = 'Failed: ' + (res && res.error || 'unknown error') + (res && res.permission ? ' (permission: ' + res.permission + ')' : '');
    }
  });

  $('refresh').addEventListener('click', async () => {
    $('refresh').disabled = true;
    const res = await api.runtime.sendMessage({ type: 'refreshTable' });
    if (res && res.table) renderTable(res);
    $('refresh').disabled = false;
    flashSaved();
  });

  load();
})();
