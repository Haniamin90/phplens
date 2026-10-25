/*
 * PHPLens – PHP version detection and patch-level verdict.
 * Pure functions, no network, no DOM. Everything here works from strings the
 * server already sent (Server / X-Powered-By / Set-Cookie headers, URLs).
 */
(function (root) {
  'use strict';
  if (root.PHPLens && root.PHPLens.php) return;

  /**
   * Bundled knowledge. `latest` per branch can be refreshed from php.net at runtime;
   * advisory `fixed` versions are fixed facts and stay bundled.
   */
  const VERSION_TABLE = {
    source: 'bundled',
    updated: '2026-10-21',
    minSupportedBranch: '8.2',
    branches: {
      '8.2': { latest: '8.2.35', securityUntil: '2026-12-31' },
      '8.3': { latest: '8.3.36', securityUntil: '2027-12-31' },
      '8.4': { latest: '8.4.27', securityUntil: '2028-12-31' },
      '8.5': { latest: '8.5.12', securityUntil: '2029-12-31' }
    },
    advisories: [
      {
        id: 'CVE-2026-109618 / CVE-2026-109619',
        short: 'CVE-2026-109618',
        title: 'session.upload_progress use-after-free – unauthenticated remote code execution',
        severity: 'critical',
        cvss: '9.2',
        published: '2026-10-21',
        exploited: true,
        fixed: { '8.2': '8.2.35', '8.3': '8.3.36', '8.4': '8.4.27', '8.5': '8.5.12' },
        url: 'https://www.php.net/ChangeLog-8.php'
      }
    ]
  };

  // Suffix is either a distro/build tag ("-1ubuntu2.19", "-1~deb12u1", "+deb.sury.org")
  // or a PHP pre-release tag written without separator ("RC1", "alpha2", "beta1").
  const SUFFIX = '([-+~][\\w.~+-]*|(?:RC|alpha|beta|dev)[\\w.~+-]*)?';
  const VERSION_RE = new RegExp('PHP\\/?\\s*v?(\\d+)\\.(\\d+)(?:\\.(\\d+))?' + SUFFIX, 'i');
  const BARE_RE = new RegExp('^\\s*v?(\\d+)\\.(\\d+)(?:\\.(\\d+))?' + SUFFIX + '\\s*$', 'i');

  /** Parse "PHP/8.4.26", "PHP/8.1.2-1ubuntu2.19", "PHP/8.5.0RC1", "8.3.36", "PHP/8.2" … */
  function parseVersion(input) {
    if (!input) return null;
    let m = VERSION_RE.exec(String(input));
    if (!m) m = BARE_RE.exec(String(input));
    if (!m) return null;
    const major = +m[1], minor = +m[2];
    const patch = m[3] === undefined ? null : +m[3];
    const suffix = m[4] || '';
    const prerelease = /^-?(rc|alpha|beta|dev)/i.test(suffix);
    const distro = !prerelease && /(ubuntu|deb|el\d|rhel|fc\d+|alpine|remi|sury|~|\+|^-\d)/i.test(suffix);
    return {
      raw: m[0].trim(),
      version: patch === null ? `${major}.${minor}` : `${major}.${minor}.${patch}`,
      major, minor, patch,
      branch: `${major}.${minor}`,
      partial: patch === null,
      suffix, prerelease, distro
    };
  }

  function toParts(v) {
    return String(v).split('.').map((x) => parseInt(x, 10) || 0);
  }

  /** Numeric dotted compare: <0, 0, >0. Missing parts count as 0. */
  function compareVersions(a, b) {
    const pa = toParts(a), pb = toParts(b);
    const n = Math.max(pa.length, pb.length);
    for (let i = 0; i < n; i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d) return d < 0 ? -1 : 1;
    }
    return 0;
  }

  const PHP_COOKIES = /^(PHPSESSID|laravel_session|ci_session|symfony|sf_redirect|PrestaShop-|wordpress_|wp-settings|wordpress_test_cookie|Drupal\.visitor|SESS[0-9a-f]{32}|SSESS[0-9a-f]{32}|frontend|adminhtml|phpbb3_|SMFCookie|MoodleSession|TYPO3|fe_typo_user|be_typo_user|OCSESSID|joomla_|craftsessionid|CraftSessionId|BITRIX_SM_|xf_session|ips4_|PHPSESSID_)/i;

  /** Applications and frameworks that run on PHP (used for header values, generator tags, footers). */
  const PHP_APP_RE = /\b(wordpress|woocommerce|drupal|joomla|typo3|prestashop|magento|opencart|moodle|mediawiki|laravel|livewire|symfony|phpbb|craft ?cms|concrete ?(5|cms)|dokuwiki|nextcloud|owncloud|bitrix|xenforo|vbulletin|invision|simple machines|oxid|shopware|sylius|contao|neos|grav|pimcore|october ?cms|silverstripe|kirby|statamic|yii|cakephp|codeigniter|zend|laminas|phalcon|nette|slim framework|w3 total cache|wp rocket|wp engine|litespeed cache|elementor|php)\b/i;

  /** PHP runtime error output rendered into a page (display_errors=On). */
  const PHP_ERROR_RE = /\b(?:PHP )?(?:Warning|Notice|Fatal error|Parse error|Deprecated|Strict Standards|Uncaught (?:Error|Exception|TypeError|ValueError|ArgumentCountError))\b:?[^\n]{0,300}?\b(?:in|at)\s+(?:\/|[A-Za-z]:\\)[^\s:'"<>]+\.php(?:\s+on line\s+\d+|:\d+|\(\d+\))/;

  /** Exact version from a phpinfo() page the user opened. */
  function extractPhpinfoVersion(title, text) {
    const t = String(text || '');
    if (!/phpinfo\(\)/i.test(String(title || '')) && !/PHP License/.test(t)) return null;
    const m = /PHP Version\s+(\d+\.\d+\.\d+[\w.+~-]*)/.exec(t);
    return m ? parseVersion('PHP/' + m[1]) : null;
  }

  const APP_HEADERS = [
    { name: 'x-generator', test: (v) => PHP_APP_RE.test(v), text: (v) => 'X-Generator: ' + v },
    { name: 'x-pingback', test: (v) => /xmlrpc\.php/i.test(v), text: (v) => 'X-Pingback: ' + v + ' (WordPress)' },
    { name: 'x-redirect-by', test: (v) => PHP_APP_RE.test(v), text: (v) => 'X-Redirect-By: ' + v },
    { name: 'x-drupal-cache', test: () => true, text: (v) => 'X-Drupal-Cache: ' + v },
    { name: 'x-drupal-dynamic-cache', test: () => true, text: (v) => 'X-Drupal-Dynamic-Cache: ' + v },
    { name: 'x-powered-cms', test: () => true, text: (v) => 'X-Powered-CMS: ' + v },
    { name: 'x-debug-token', test: () => true, text: () => 'X-Debug-Token (Symfony profiler enabled)' },
    { name: 'link', test: (v) => /api\.w\.org|\/wp-json\//i.test(v), text: () => 'Link header advertises the WordPress REST API' }
  ];

  /**
   * Pull PHP evidence out of one HTTP response.
   * @param {string} url
   * @param {{name:string,value:string}[]} headers
   */
  function inspectResponse(url, headers) {
    const out = { version: null, server: null, poweredBy: null, app: null, cookies: [], phpUrl: false, proxyCached: false, evidence: [] };
    const clip = (s) => String(s).replace(/[\r\n\t]+/g, ' ').slice(0, 160);
    let path = '';
    try { path = new URL(url).pathname; } catch (_) { /* ignore */ }
    if (/\.php\d?(\/|$)/i.test(path)) {
      out.phpUrl = true;
      out.evidence.push({ kind: 'url', text: 'Request to a .php resource: ' + path.slice(0, 80) });
    }
    for (const h of headers || []) {
      const name = (h.name || '').toLowerCase();
      const value = h.value || '';
      if (!value) continue;
      if (name === 'x-powered-by') {
        out.poweredBy = clip(value);
        if (/php/i.test(value)) {
          out.evidence.push({ kind: 'header', text: 'X-Powered-By: ' + clip(value) });
          out.version = out.version || parseVersion(value);
        } else if (PHP_APP_RE.test(value)) {
          out.app = out.app || clip(value);
          out.evidence.push({ kind: 'header', text: 'X-Powered-By: ' + clip(value) + ' (PHP application)' });
        }
      } else if (name === 'server') {
        out.server = clip(value);
        if (/php/i.test(value)) {
          out.evidence.push({ kind: 'header', text: 'Server: ' + clip(value) });
          out.version = out.version || parseVersion(value);
        }
      } else if (name === 'set-cookie') {
        const cookieName = value.split('=')[0].trim().slice(0, 60);
        if (PHP_COOKIES.test(cookieName)) {
          out.cookies.push(cookieName);
          out.evidence.push({ kind: 'cookie', text: 'Cookie typical of PHP apps: ' + cookieName });
        }
      } else if (name === 'age') {
        if (parseInt(value, 10) > 0) out.proxyCached = true;
      } else if (name === 'x-cache' || name === 'cf-cache-status' || name === 'x-cache-status' || name === 'x-proxy-cache') {
        if (/\bhit\b/i.test(value)) out.proxyCached = true;
      } else {
        const ah = APP_HEADERS.find((a) => a.name === name);
        if (ah && ah.test(value)) {
          out.app = out.app || clip(value);
          out.evidence.push({ kind: 'header', text: ah.text(clip(value)) });
        }
      }
    }
    return out;
  }

  /** How much to trust the detected version, given where it came from. */
  function confidenceFor(ctx) {
    if (!ctx || !ctx.version) return null;
    const src = ctx.versionSource;
    let score = src === 'main' || src === 'head' || src === 'page' ? 3 : 2;
    if (ctx.versionFromCache || (src === 'main' && ctx.mainFromCache)) score--;
    if (ctx.proxyCached) score--;
    if (ctx.seen && ctx.seen.length > 1) score--;
    return score >= 3 ? 'high' : score === 2 ? 'medium' : 'low';
  }

  /**
   * Turn accumulated detection into a verdict.
   * @param {{version:object|null, phpDetected:boolean}} det
   * @param {object} table
   * @param {object} settings
   */
  function evaluate(det, table, settings) {
    table = table || VERSION_TABLE;
    settings = settings || {};
    const adv = table.advisories[0];
    const v = det.version;
    const fixedList = Object.values(adv.fixed).join(' / ');

    const base = {
      status: 'none', level: 'none', title: 'No PHP detected', short: 'no PHP seen',
      summary: 'This site did not reveal any sign of PHP on the pages you loaded.',
      version: null, branch: null, latest: null, fixed: null, advisory: adv,
      notes: [], advice: []
    };

    if (!v) {
      if (!det.phpDetected) return base;
      return Object.assign(base, {
        status: 'hidden', level: 'unknown', title: 'PHP detected – version hidden', short: 'PHP version hidden',
        summary: 'The server runs PHP but does not advertise its version (expose_php=Off). That is good hygiene, but it means the patch level cannot be verified from the outside.',
        advice: ['Site owner: confirm with php -v that you run ' + fixedList + ' or newer.',
                 'Visitor: treat it as unverified, not as safe.']
      });
    }

    const branchInfo = table.branches[v.branch];
    const res = Object.assign(base, {
      version: v.version, branch: v.branch,
      latest: branchInfo ? branchInfo.latest : null,
      fixed: adv.fixed[v.branch] || null,
      distro: v.distro, prerelease: v.prerelease, partial: v.partial, raw: v.raw
    });

    if (v.prerelease) res.notes.push(`Pre-release build (${v.suffix}).`);

    // Branch unknown to our table.
    if (!branchInfo) {
      if (compareVersions(v.branch, table.minSupportedBranch) < 0) {
        res.status = 'eol'; res.level = 'danger';
        res.title = `PHP ${v.version} is end-of-life`;
        res.short = `PHP ${v.version} end-of-life, no fix available`;
        res.summary = `The PHP ${v.branch} branch no longer receives security fixes. It is affected by ${adv.short} (${adv.title}) and no patch will be published for it.`;
        res.advice = ['Site owner: migrate to a supported branch (' + fixedList + ' or newer).',
                      'Visitor: avoid entering credentials or payment data until the site is updated.'];
        if (v.distro) res.notes.push('Distro-packaged build: some vendors keep patching EOL branches (Ubuntu ESM, RHEL). The version string alone cannot confirm that.');
        return res;
      }
      res.status = 'newer-branch'; res.level = 'unknown';
      res.title = `PHP ${v.version} – newer than our data`;
      res.short = `PHP ${v.version} not in release table`;
      res.summary = `PHP ${v.branch} is not in the release table (last updated ${table.updated}). Enable live updates in settings or check php.net.`;
      return res;
    }

    if (v.partial) {
      res.status = 'partial'; res.level = 'unknown';
      res.title = `PHP ${v.version} – patch level hidden`;
      res.short = `PHP ${v.version}, patch level hidden`;
      res.summary = `Only the branch is advertised. Branch ${v.branch} is safe from ${res.fixed} upward; the exact patch level cannot be confirmed from the outside.`;
      return res;
    }

    const cmpFixed = compareVersions(v.version, res.fixed);
    const cmpLatest = compareVersions(v.version, res.latest);

    if (cmpFixed < 0) {
      res.status = 'vulnerable'; res.level = 'danger';
      res.title = `PHP ${v.version} is unpatched`;
      res.short = `PHP ${v.version} unpatched, fix ${res.fixed}`;
      res.summary = `Vulnerable to ${adv.short} (${adv.title}, CVSS ${adv.cvss}, exploited in the wild). Fixed in ${res.fixed}.`;
      res.advice = [`Site owner: upgrade to ${res.latest} and restart php-fpm / httpd.`,
                    'Visitor: be careful with logins and payments on this site until it is patched.'];
      if (v.distro && settings.distroAsCaution !== false) {
        res.level = 'caution';
        res.status = 'vulnerable-distro';
        res.title = `PHP ${v.version} (distro build) – possibly unpatched`;
        res.short = `PHP ${v.version} distro build, possibly unpatched`;
        res.notes.push('Distribution package (' + v.suffix + '). Debian/Ubuntu/RHEL backport security fixes without changing the version number, so this may already be patched. Only the package changelog can tell.');
      }
      return res;
    }

    if (cmpLatest < 0) {
      res.status = 'outdated'; res.level = 'caution';
      res.title = `PHP ${v.version} is behind the latest release`;
      res.short = `PHP ${v.version} behind latest ${res.latest}`;
      res.summary = `Patched against ${adv.short}, but ${res.latest} is the current ${v.branch} release and may contain further fixes.`;
      res.advice = [`Site owner: upgrade to ${res.latest}.`];
      return res;
    }

    res.status = cmpLatest === 0 ? 'patched' : 'newer';
    res.level = 'safe';
    res.title = `PHP ${v.version} is patched`;
    res.short = `PHP ${v.version} patched`;
    res.summary = cmpLatest === 0
      ? `Running the latest ${v.branch} release. Not affected by ${adv.short}.`
      : `Newer than the latest ${v.branch} release in our table (${res.latest}). Not affected by ${adv.short}.`;
    if (branchInfo.securityUntil) res.notes.push(`Branch ${v.branch} receives security fixes until ${branchInfo.securityUntil}.`);
    return res;
  }

  const RANK = { danger: 4, caution: 3, unknown: 2, safe: 1, none: 0 };

  /**
   * Add context to a verdict from how the evidence was gathered and from other
   * same-site responses that advertised a different version.
   * @param {object} verdict   result of evaluate() – mutated and returned
   * @param {object} ctx       { versionSource: 'main'|'sub'|null, mainFromCache: bool,
   *                             versionPath: string, seen: [{version, raw, host, path, fromCache}] }
   */
  function reconcile(verdict, ctx, table, settings) {
    ctx = ctx || {};
    verdict.notes = verdict.notes || [];
    verdict.confidence = verdict.version ? confidenceFor(Object.assign({}, ctx, { version: verdict.version })) : null;
    if (ctx.app) verdict.app = ctx.app;
    if (verdict.version) {
      if (ctx.versionSource === 'sub') {
        verdict.notes.push('Version read from a sub-request (' + (ctx.versionPath || 'same site') + '), not from the main page itself.');
      } else if (ctx.versionSource === 'head') {
        verdict.notes.push('Version read via a single HEAD re-check of this page (active fallback enabled in settings).');
      } else if (ctx.versionSource === 'page') {
        verdict.notes.push('Version read from the page content (phpinfo output).');
      }
      if (ctx.mainFromCache || (ctx.versionSource !== 'main' && ctx.versionFromCache)) {
        verdict.notes.push('Read from the browser cache – the server may have been updated since. Use "Reload & re-check" to fetch fresh headers.');
        verdict.cached = true;
      }
      if (ctx.proxyCached) {
        verdict.notes.push('The response came from a CDN or proxy cache (Age / X-Cache HIT), so the banner may predate a server update.');
      }
    }
    const flags = ctx.flags || [];
    if (flags.includes('display_errors')) {
      verdict.notes.push('PHP error messages are rendered into the page (display_errors=On). Besides leaking paths, this is the configuration the public exploit for ' + table.advisories[0].short + ' relies on for full code execution.');
      verdict.displayErrors = true;
    }
    const primary = verdict.version;
    const others = (ctx.seen || []).filter((e) => e && e.version && e.version !== primary);
    if (!others.length) return verdict;

    let worst = null;
    for (const e of others) {
      const v = evaluate({ version: parseVersion(e.raw || 'PHP/' + e.version), phpDetected: true }, table, settings);
      if (!worst || RANK[v.level] > RANK[worst.v.level]) worst = { v, e };
    }
    const where = (e) => e.host + (e.path || '') + (e.fromCache ? ' (cached)' : '');
    verdict.notes.push('Other same-site responses advertised a different PHP version: ' +
      others.map((e) => e.version + ' on ' + where(e)).join(', ') + '. The verdict is based on the main page.');
    verdict.mixed = true;
    if (worst && worst.v.level === 'danger' && RANK[verdict.level] < RANK.caution) {
      verdict.level = 'caution';
      verdict.notes.push(where(worst.e) + ' runs PHP ' + worst.e.version + ': ' + worst.v.title + '.');
    }
    return verdict;
  }

  /**
   * Merge a php.net "active releases" JSON document into a copy of the table.
   * Format: { "8": { "8.3": { "version": "8.3.36", ... }, ... } }
   */
  function mergeLiveTable(table, live) {
    const next = structuredClone(table);
    let changed = 0;
    for (const major of Object.values(live || {})) {
      if (!major || typeof major !== 'object') continue;
      for (const [branch, info] of Object.entries(major)) {
        const ver = info && typeof info.version === 'string' && /^\d+\.\d+\.\d+$/.test(info.version) ? info.version : null;
        if (!ver) continue;
        if (!next.branches[branch]) next.branches[branch] = { latest: ver };
        // Never downgrade: the bundled table may be newer than a cached response.
        if (compareVersions(ver, next.branches[branch].latest) > 0) {
          next.branches[branch].latest = ver;
          changed++;
        }
      }
    }
    next.source = 'php.net';
    next.updated = new Date().toISOString().slice(0, 10);
    next.changed = changed;
    return next;
  }

  root.PHPLens = Object.assign(root.PHPLens || {}, {
    php: { VERSION_TABLE, parseVersion, compareVersions, inspectResponse, evaluate, reconcile, confidenceFor, mergeLiveTable, extractPhpinfoVersion, PHP_COOKIES, PHP_APP_RE, PHP_ERROR_RE, RANK }
  });
})(globalThis);
