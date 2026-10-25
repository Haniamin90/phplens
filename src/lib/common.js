/*
 * PHPLens – shared helpers.
 * Plain script (no ES modules) so the same file loads in the Chromium service worker
 * (importScripts), Firefox background scripts, content scripts and extension pages.
 */
(function (root) {
  'use strict';
  if (root.PHPLens && root.PHPLens.__common) return;

  const api = root.browser || root.chrome;

  /** Display levels. `none` = no PHP seen, `unknown` = PHP seen but version hidden. */
  const LEVELS = Object.freeze({
    danger:  { label: 'Danger',      color: '#ef4444', badge: '!',  rank: 4 },
    caution: { label: 'Caution',     color: '#f59e0b', badge: '!',  rank: 3 },
    unknown: { label: 'Unverified',  color: '#64748b', badge: '?',  rank: 2 },
    safe:    { label: 'Patched',     color: '#22c55e', badge: 'OK', rank: 1 },
    none:    { label: 'No PHP seen', color: '#475569', badge: '',   rank: 0 }
  });

  const DEFAULT_SETTINGS = Object.freeze({
    badge: true,
    notifications: true,
    notifyLevel: 'danger',      // 'danger' | 'caution'
    banner: true,
    bannerLevel: 'danger',      // 'danger' | 'caution'
    liveVersions: true,         // refresh "latest release per branch" from php.net once a day
    distroAsCaution: true,      // distro builds backport fixes; downgrade Danger -> Caution
    activeFallback: true,       // one HEAD request to the current page when passive observation found no version
    snoozed: {}                 // hostname -> expiry timestamp (ms); 0 = ignored for good
  });

  /** Snooze presets offered everywhere (hours; 0 = forever). */
  const SNOOZE_OPTIONS = Object.freeze([
    { hours: 1, label: '1 hour' },
    { hours: 24, label: '1 day' },
    { hours: 24 * 7, label: '1 week' },
    { hours: 0, label: 'For good' }
  ]);

  /** Returns the expiry (ms timestamp, 0 = forever) if host is silenced, otherwise null. */
  function snoozeFor(host, settings) {
    const map = (settings && settings.snoozed) || {};
    const base = baseDomain(host);
    for (const h of [host, base]) {
      if (!(h in map)) continue;
      const until = map[h];
      if (until === 0 || until > Date.now()) return until;
    }
    return null;
  }

  function describeSnooze(until) {
    if (until === 0) return 'ignored for good';
    if (!until) return '';
    const ms = until - Date.now();
    if (ms <= 0) return '';
    if (ms < 59.5 * 60 * 1000) return 'ignored for ' + Math.max(1, Math.round(ms / 60000)) + ' min';
    if (ms < 36 * 3600 * 1000) return 'ignored for ' + Math.round(ms / 3600000) + ' h';
    return 'ignored until ' + new Date(until).toLocaleDateString();
  }

  function deepMerge(base, extra) {
    if (!extra || typeof extra !== 'object') return structuredClone(base);
    const out = Array.isArray(base) ? [...base] : { ...base };
    const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
    for (const [k, v] of Object.entries(extra)) {
      out[k] = isObj(v) && isObj(base[k]) ? deepMerge(base[k], v) : v;
    }
    return out;
  }

  async function getSettings() {
    try {
      const { settings } = await api.storage.local.get('settings');
      const merged = deepMerge(DEFAULT_SETTINGS, settings || {});
      // Migrate the old plain list of ignored hosts (1.0.0) to permanent snoozes.
      if (Array.isArray(merged.ignored)) {
        for (const h of merged.ignored) if (!(h in merged.snoozed)) merged.snoozed[h] = 0;
        delete merged.ignored;
      }
      // Drop expired entries.
      for (const [h, until] of Object.entries(merged.snoozed)) if (until !== 0 && until <= Date.now()) delete merged.snoozed[h];
      return merged;
    } catch (_) {
      return structuredClone(DEFAULT_SETTINGS);
    }
  }

  async function saveSettings(patch) {
    const next = deepMerge(await getSettings(), patch);
    if (patch && patch.snoozed) next.snoozed = patch.snoozed; // replace, don't merge: removals must stick
    await api.storage.local.set({ settings: next });
    return next;
  }

  function isWebUrl(url) { return /^https?:\/\//i.test(url || ''); }

  function hostOf(url) {
    try { return new URL(url).hostname.toLowerCase(); } catch (_) { return ''; }
  }

  /** Crude registrable-domain guess, good enough to tell first-party from third-party. */
  function baseDomain(host) {
    host = (host || '').toLowerCase();
    if (/^[\d.]+$/.test(host) || host.startsWith('[')) return host; // IPv4 / IPv6 literal
    const parts = host.split('.').filter(Boolean);
    if (parts.length <= 2) return host;
    const twoPartTlds = /^(co|com|net|org|gov|edu|ac|or|ne)\.[a-z]{2}$/i;
    const tail2 = parts.slice(-2).join('.');
    return twoPartTlds.test(tail2) ? parts.slice(-3).join('.') : tail2;
  }

  function sameSite(hostA, hostB) {
    return !!hostA && !!hostB && baseDomain(hostA) === baseDomain(hostB);
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
  }

  /**
   * Tiny DOM builder so UI code never assigns untrusted strings to innerHTML.
   * el('span', { class: 'chip', text: 'x', 'data-hours': 1 }, ['text', otherNode])
   */
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'text') node.textContent = String(v);
      else if (k === 'class') { if (v) node.className = v; }
      else node.setAttribute(k, String(v));
    }
    for (const c of children || []) if (c !== null && c !== undefined && c !== '') node.append(c);
    return node;
  }

  function formatAgo(ts) {
    if (!ts) return 'never';
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return `${Math.round(s / 86400)} d ago`;
  }

  root.PHPLens = Object.assign(root.PHPLens || {}, {
    __common: true,
    api, LEVELS, DEFAULT_SETTINGS, SNOOZE_OPTIONS,
    deepMerge, getSettings, saveSettings, snoozeFor, describeSnooze,
    isWebUrl, hostOf, baseDomain, sameSite, escapeHtml, el, formatAgo
  });
})(globalThis);
