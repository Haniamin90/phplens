(function () {
  'use strict';
  const GL = globalThis.PHPLens;
  const { api, escapeHtml } = GL;
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
      return `<tr><td class="mono">PHP ${escapeHtml(b)}</td><td class="mono"><span class="ok">${escapeHtml(info.latest)}</span></td><td class="mono">${escapeHtml(adv.fixed[b] || '–')}</td><td>${escapeHtml(info.securityUntil || '–')}</td></tr>`;
    });
    $('table').querySelector('tbody').innerHTML = rows.join('');
    const src = table.source === 'php.net' ? 'php.net (live)' : 'bundled';
    let meta = `Source: ${src} · table date ${table.updated}`;
    if (res.fetchedAt) meta += ` · last check ${GL.formatAgo(res.fetchedAt)}`;
    if (res.error) meta += ` · last fetch failed: ${res.error}`;
    $('table-meta').textContent = meta;
  }

  function renderSnoozed(snoozed) {
    const entries = Object.entries(snoozed || {}).sort((a, b) => a[0].localeCompare(b[0]));
    $('snoozed').querySelector('tbody').innerHTML = entries.map(([host, until]) => {
      const when = until === 0 ? 'for good' : new Date(until).toLocaleString();
      return `<tr><td class="mono">${escapeHtml(host)}</td><td>${escapeHtml(when)}</td><td><button data-host="${escapeHtml(host)}">Remove</button></td></tr>`;
    }).join('');
    $('snoozed-empty').classList.toggle('hidden', entries.length > 0);
    $('snoozed').classList.toggle('hidden', entries.length === 0);
    $('snoozed').querySelectorAll('button[data-host]').forEach((b) => b.addEventListener('click', async () => {
      const res = await api.runtime.sendMessage({ type: 'setSnooze', host: b.dataset.host, hours: -1 });
      renderSnoozed(res && res.snoozed);
      flashSaved();
    }));
  }

  async function load() {
    const s = await GL.getSettings();
    for (const k of BOOLS) $(k).checked = !!s[k];
    $('bannerLevel').value = s.bannerLevel || 'danger';
    $('notifyLevel').value = s.notifyLevel || 'danger';
    $('add-hours').innerHTML = GL.SNOOZE_OPTIONS.map((o) => `<option value="${o.hours}">${escapeHtml(o.label)}</option>`).join('');
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
