// Mock of the extension API used only to render store screenshots of the real UI
// outside a browser extension context. Scenario comes from the URL hash.
(function () {
  const scenario = (location.hash || '#danger').slice(1);
  const advisory = {
    id: 'CVE-2026-109618 / CVE-2026-109619',
    short: 'CVE-2026-109618',
    title: 'session.upload_progress use-after-free – unauthenticated remote code execution',
    severity: 'critical', cvss: '9.2', published: '2026-10-21', exploited: true,
    fixed: { '8.2': '8.2.35', '8.3': '8.3.36', '8.4': '8.4.27', '8.5': '8.5.12' },
    url: 'https://www.php.net/ChangeLog-8.php'
  };
  const table = {
    source: 'php.net', updated: '2026-10-25', minSupportedBranch: '8.2',
    branches: {
      '8.2': { latest: '8.2.35', securityUntil: '2026-12-31' },
      '8.3': { latest: '8.3.36', securityUntil: '2027-12-31' },
      '8.4': { latest: '8.4.27', securityUntil: '2028-12-31' },
      '8.5': { latest: '8.5.12', securityUntil: '2029-12-31' }
    },
    advisories: [advisory]
  };
  const now = Date.now();
  const states = {
    danger: {
      url: 'https://shop.example.com/cart.php', host: 'shop.example.com', phpDetected: true,
      version: { version: '8.4.26', branch: '8.4' }, versionSource: 'main', mainFromCache: false, responses: 14, updatedAt: now - 4000,
      server: 'Apache/2.4.62 (Debian)', app: 'WordPress 6.6', seen: [],
      evidence: [
        { kind: 'header', text: 'X-Powered-By: PHP/8.4.26' },
        { kind: 'header', text: 'Server: Apache/2.4.62 (Debian)' },
        { kind: 'url', text: 'Request to a .php resource: /cart.php' },
        { kind: 'cookie', text: 'Cookie typical of PHP apps: PHPSESSID' },
        { kind: 'header', text: 'X-Pingback: https://shop.example.com/xmlrpc.php (WordPress)' },
        { kind: 'page', text: 'Application: WordPress 6.6' }
      ],
      verdict: {
        status: 'vulnerable', level: 'danger', title: 'PHP 8.4.26 is unpatched', short: 'PHP 8.4.26 unpatched, fix 8.4.27',
        summary: 'Vulnerable to CVE-2026-109618 (session.upload_progress use-after-free – unauthenticated remote code execution, CVSS 9.2, exploited in the wild). Fixed in 8.4.27.',
        version: '8.4.26', branch: '8.4', latest: '8.4.27', fixed: '8.4.27', confidence: 'high', app: 'WordPress 6.6', advisory,
        advice: ['Site owner: upgrade to 8.4.27 and restart php-fpm / httpd.', 'Visitor: be careful with logins and payments on this site until it is patched.'],
        notes: []
      }
    },
    safe: {
      url: 'https://docs.example.org/', host: 'docs.example.org', phpDetected: true,
      version: { version: '8.3.36', branch: '8.3' }, versionSource: 'main', mainFromCache: false, responses: 9, updatedAt: now - 2000,
      server: 'nginx/1.26.2', app: 'MediaWiki 1.43', seen: [],
      evidence: [
        { kind: 'header', text: 'X-Powered-By: PHP/8.3.36' },
        { kind: 'url', text: 'Request to a .php resource: /index.php' },
        { kind: 'page', text: 'Generator meta: MediaWiki 1.43.0' }
      ],
      verdict: {
        status: 'patched', level: 'safe', title: 'PHP 8.3.36 is patched', short: 'PHP 8.3.36 patched',
        summary: 'Running the latest 8.3 release. Not affected by CVE-2026-109618.',
        version: '8.3.36', branch: '8.3', latest: '8.3.36', fixed: '8.3.36', confidence: 'high', app: 'MediaWiki 1.43', advisory,
        advice: [], notes: ['Branch 8.3 receives security fixes until 2027-12-31.']
      }
    }
  };
  const settings = {
    badge: true, notifications: true, notifyLevel: 'danger', banner: true, bannerLevel: 'danger',
    liveVersions: true, distroAsCaution: true, activeFallback: false,
    snoozed: { 'intranet.example': 0, 'staging.example.net': now + 6 * 3600e3 }
  };
  const state = states[scenario === 'dialog' ? 'danger' : scenario] || states.danger;
  const api = {
    storage: {
      local: { get: async () => ({ settings }), set: async () => {}, remove: async () => {} },
      session: { get: async () => ({}), set: async () => {}, remove: async () => {} },
      onChanged: { addListener() {} }
    },
    runtime: {
      getURL: (p) => p, lastError: null, openOptionsPage: async () => {},
      onMessage: { addListener() {} },
      sendMessage: async (msg) => {
        switch (msg && msg.type) {
          case 'getState': return { state, settings, table, notifPermission: 'granted' };
          case 'pageHints': return { state, settings };
          case 'getTable': case 'refreshTable': return { table, fetchedAt: now - 5 * 3600e3, error: '' };
          default: return { ok: true };
        }
      }
    },
    tabs: { query: async () => [{ id: 1, url: state.url }] }
  };
  globalThis.chrome = api;
  globalThis.browser = api;
})();
