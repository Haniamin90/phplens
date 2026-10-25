import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
require('../src/lib/common.js');
require('../src/lib/php-check.js');
const GL = globalThis.PHPLens;
const P = GL.php;

test('parseVersion handles common banner shapes', () => {
  assert.deepEqual(pick(P.parseVersion('PHP/8.4.26')), { version: '8.4.26', branch: '8.4', partial: false, distro: false });
  assert.deepEqual(pick(P.parseVersion('PHP/8.1.2-1ubuntu2.19')), { version: '8.1.2', branch: '8.1', partial: false, distro: true });
  assert.deepEqual(pick(P.parseVersion('Apache/2.4.62 (Debian) PHP/8.2.28-1~deb12u1')), { version: '8.2.28', branch: '8.2', partial: false, distro: true });
  assert.deepEqual(pick(P.parseVersion('PHP/8.3')), { version: '8.3', branch: '8.3', partial: true, distro: false });
  const rc = P.parseVersion('PHP/8.5.0RC1');
  assert.equal(rc.version, '8.5.0');
  assert.equal(rc.prerelease, true, 'PHP writes pre-releases without a separator');
  assert.equal(rc.distro, false);
  assert.equal(P.parseVersion('PHP/8.4.0beta2').prerelease, true);
  assert.equal(P.parseVersion('PHP/8.5.0-RC1').prerelease, true);
  assert.equal(P.parseVersion('nginx/1.25.3'), null);
  assert.equal(P.parseVersion('ASP.NET'), null);
});

test('compareVersions is numeric, not lexical', () => {
  assert.equal(P.compareVersions('8.4.27', '8.4.26'), 1);
  assert.equal(P.compareVersions('8.4.9', '8.4.27'), -1);
  assert.equal(P.compareVersions('8.4', '8.4.0'), 0);
  assert.equal(P.compareVersions('7.4', '8.2'), -1);
});

test('inspectResponse collects version, cookies and .php URLs', () => {
  const r = P.inspectResponse('https://shop.example.com/cart.php?x=1', [
    { name: 'Server', value: 'Apache' },
    { name: 'X-Powered-By', value: 'PHP/8.2.34' },
    { name: 'set-cookie', value: 'PHPSESSID=abc; Path=/; HttpOnly' },
    { name: 'Set-Cookie', value: 'theme=dark' }
  ]);
  assert.equal(r.version.version, '8.2.34');
  assert.deepEqual(r.cookies, ['PHPSESSID']);
  assert.equal(r.phpUrl, true);
  assert.equal(r.evidence.length, 3);
});

test('verdicts against the bundled table', () => {
  const s = { distroAsCaution: true };
  const ev = (banner, settings = s, extra = {}) => P.evaluate({ version: P.parseVersion(banner), phpDetected: true, ...extra }, P.VERSION_TABLE, settings);

  assert.equal(ev('PHP/8.4.26').status, 'vulnerable');
  assert.equal(ev('PHP/8.4.26').level, 'danger');
  assert.equal(ev('PHP/8.4.26').short, 'PHP 8.4.26 unpatched, fix 8.4.27');
  assert.equal(ev('PHP/7.4.33').short, 'PHP 7.4.33 end-of-life, no fix available');
  assert.equal(ev('PHP/8.4.27').short, 'PHP 8.4.27 patched');
  assert.equal(ev('PHP/8.2.34').level, 'danger');
  assert.equal(ev('PHP/8.5.11').level, 'danger');

  assert.equal(ev('PHP/8.4.27').status, 'patched');
  assert.equal(ev('PHP/8.3.36').level, 'safe');
  assert.equal(ev('PHP/8.2.35').level, 'safe');
  assert.equal(ev('PHP/8.5.12').level, 'safe');
  assert.equal(ev('PHP/8.4.28').status, 'newer');

  assert.equal(ev('PHP/7.4.33').status, 'eol');
  assert.equal(ev('PHP/7.4.33').level, 'danger');
  assert.equal(ev('PHP/8.1.33').status, 'eol');
  assert.equal(ev('PHP/5.6.40').level, 'danger');

  assert.equal(ev('PHP/8.4.26-1+ubuntu24.04.1+deb.sury.org+1').status, 'vulnerable-distro');
  assert.equal(ev('PHP/8.4.26-1+ubuntu24.04.1+deb.sury.org+1').level, 'caution');
  assert.equal(ev('PHP/8.4.26-1+ubuntu24.04.1+deb.sury.org+1', { distroAsCaution: false }).level, 'danger');

  assert.equal(ev('PHP/8.3').status, 'partial');
  assert.equal(ev('PHP/8.3').level, 'unknown');
  assert.equal(ev('PHP/8.6.0').status, 'newer-branch');

  const hidden = P.evaluate({ version: null, phpDetected: true }, P.VERSION_TABLE, s);
  assert.equal(hidden.status, 'hidden');
  assert.equal(hidden.level, 'unknown');
  const none = P.evaluate({ version: null, phpDetected: false }, P.VERSION_TABLE, s);
  assert.equal(none.status, 'none');
});

test('outdated when a newer release than the fix exists', () => {
  const table = P.mergeLiveTable(P.VERSION_TABLE, { 8: { '8.4': { version: '8.4.28' } } });
  assert.equal(table.branches['8.4'].latest, '8.4.28');
  assert.equal(table.source, 'php.net');
  const v = P.evaluate({ version: P.parseVersion('PHP/8.4.27'), phpDetected: true }, table, {});
  assert.equal(v.status, 'outdated');
  assert.equal(v.level, 'caution');
  assert.equal(P.evaluate({ version: P.parseVersion('PHP/8.4.26'), phpDetected: true }, table, {}).status, 'vulnerable');
});

test('mergeLiveTable never downgrades and ignores junk', () => {
  const table = P.mergeLiveTable(P.VERSION_TABLE, { 8: { '8.4': { version: '8.4.20' }, '8.3': { version: 'x' }, '8.7': null } });
  assert.equal(table.branches['8.4'].latest, '8.4.27');
  assert.equal(table.branches['8.3'].latest, '8.3.36');
  assert.equal(table.branches['8.7'], undefined);
  assert.equal(table.changed, 0);
});

test('reconcile: main page wins, conflicting sub-requests only add caution', () => {
  const mk = (banner) => P.evaluate({ version: P.parseVersion(banner), phpDetected: true }, P.VERSION_TABLE, {});

  // patched main page, an old cached API response elsewhere on the site -> stays non-danger, becomes caution
  let v = P.reconcile(mk('PHP/8.4.27'), {
    versionSource: 'main', mainFromCache: false,
    seen: [{ version: '8.4.27', raw: 'PHP/8.4.27', host: 'www.example.com', path: '/' },
           { version: '8.4.26', raw: 'PHP/8.4.26', host: 'api.example.com', path: '/v1', fromCache: true }]
  }, P.VERSION_TABLE, {});
  assert.equal(v.status, 'patched');
  assert.equal(v.level, 'caution');
  assert.equal(v.mixed, true);
  assert.ok(v.notes.some((n) => n.includes('api.example.com/v1 (cached)')));

  // unpatched main page is never softened by a patched sub-request
  v = P.reconcile(mk('PHP/8.4.26'), {
    versionSource: 'main',
    seen: [{ version: '8.4.26', raw: 'PHP/8.4.26', host: 'www.example.com', path: '/' },
           { version: '8.4.27', raw: 'PHP/8.4.27', host: 'static.example.com', path: '/x.php' }]
  }, P.VERSION_TABLE, {});
  assert.equal(v.level, 'danger');

  // identical versions -> no mixed flag
  v = P.reconcile(mk('PHP/8.4.27'), { versionSource: 'main', seen: [{ version: '8.4.27', host: 'a', path: '/' }, { version: '8.4.27', host: 'b', path: '/' }] }, P.VERSION_TABLE, {});
  assert.equal(v.mixed, undefined);
  assert.equal(v.level, 'safe');

  // cached / sub-request provenance is explained
  v = P.reconcile(mk('PHP/8.4.26'), { versionSource: 'main', mainFromCache: true, seen: [] }, P.VERSION_TABLE, {});
  assert.equal(v.cached, true);
  assert.ok(v.notes.some((n) => /browser cache/.test(n)));
  v = P.reconcile(mk('PHP/8.3.36'), { versionSource: 'sub', versionPath: 'api.example.com/x.php', seen: [] }, P.VERSION_TABLE, {});
  assert.ok(v.notes.some((n) => n.includes('sub-request (api.example.com/x.php)')));
  assert.equal(v.level, 'safe');
});

test('baseDomain / sameSite distinguish first party from third party', () => {
  assert.equal(GL.baseDomain('www.shop.example.co.uk'), 'example.co.uk');
  assert.equal(GL.baseDomain('cdn.example.com'), 'example.com');
  assert.ok(GL.sameSite('www.example.com', 'api.example.com'));
  assert.ok(!GL.sameSite('www.example.com', 'cdn.other.net'));
});

test('inspectResponse: application headers, cache markers, dev server banner', () => {
  let r = P.inspectResponse('https://blog.example.com/', [
    { name: 'Server', value: 'nginx' },
    { name: 'X-Pingback', value: 'https://blog.example.com/xmlrpc.php' },
    { name: 'Link', value: '<https://blog.example.com/wp-json/>; rel="https://api.w.org/"' },
    { name: 'X-Generator', value: 'Hugo 0.120' },
    { name: 'Age', value: '0' }
  ]);
  assert.equal(r.version, null);
  assert.ok(r.app, 'WordPress headers identify a PHP app');
  assert.equal(r.proxyCached, false);
  assert.equal(r.evidence.length, 2, 'Hugo generator is not PHP and is ignored');

  r = P.inspectResponse('https://x.example/', [
    { name: 'X-Generator', value: 'Drupal 10 (https://www.drupal.org)' },
    { name: 'X-Cache', value: 'HIT from edge' },
    { name: 'X-Powered-By', value: 'W3 Total Cache/2.7.0' }
  ]);
  assert.ok(r.app);
  assert.equal(r.proxyCached, true);
  assert.equal(r.evidence.length, 2);

  r = P.inspectResponse('http://localhost:8000/', [{ name: 'Server', value: 'PHP 8.3.0 Development Server' }]);
  assert.equal(r.version.version, '8.3.0');

  // header values are clipped and newline-stripped before they reach the UI
  r = P.inspectResponse('https://x.example/', [{ name: 'Server', value: 'PHP/8.4.27 ' + 'A'.repeat(500) + '\r\nX-Injected: 1' }]);
  assert.ok(r.server.length <= 160 && !/\n/.test(r.server));
  assert.equal(r.version.version, '8.4.27');
});

test('page signals: PHP error output and phpinfo version', () => {
  assert.ok(P.PHP_ERROR_RE.test('Warning: Undefined variable $x in /var/www/html/index.php on line 12'));
  assert.ok(P.PHP_ERROR_RE.test('PHP Fatal error:  Uncaught Error: Call to undefined function foo() in C:\\inetpub\\site\\app.php:33'));
  assert.ok(P.PHP_ERROR_RE.test('Deprecated: strlen(): Passing null in /srv/app/vendor/x/y.php on line 5'));
  assert.ok(!P.PHP_ERROR_RE.test('A warning: the file index.php is on line 12 of the menu'));
  assert.ok(!P.PHP_ERROR_RE.test('TypeError: x is undefined at app.js:12'));

  const info = P.extractPhpinfoVersion('PHP 8.4.26 - phpinfo()', 'PHP Version 8.4.26\nSystem Linux ...\nPHP License');
  assert.equal(info.version, '8.4.26');
  assert.equal(P.extractPhpinfoVersion('Blog', 'We run PHP Version 8.4.26 and love it'), null, 'needs phpinfo context');
  assert.equal(P.extractPhpinfoVersion('', 'PHP Version 8.1.2-1ubuntu2.19 ... PHP License').version, '8.1.2');
});

test('confidence and reconcile flags', () => {
  const v = P.parseVersion('PHP/8.4.26');
  assert.equal(P.confidenceFor({ version: v, versionSource: 'main' }), 'high');
  assert.equal(P.confidenceFor({ version: v, versionSource: 'page' }), 'high');
  assert.equal(P.confidenceFor({ version: v, versionSource: 'sub' }), 'medium');
  assert.equal(P.confidenceFor({ version: v, versionSource: 'main', mainFromCache: true }), 'medium');
  assert.equal(P.confidenceFor({ version: v, versionSource: 'main', mainFromCache: true, proxyCached: true }), 'low');
  assert.equal(P.confidenceFor({ version: v, versionSource: 'sub', seen: [{}, {}] }), 'low');
  assert.equal(P.confidenceFor({ version: null }), null);

  const verdict = P.evaluate({ version: v, phpDetected: true }, P.VERSION_TABLE, {});
  P.reconcile(verdict, { versionSource: 'main', flags: ['display_errors'], app: 'WordPress 6.6', proxyCached: true, seen: [] }, P.VERSION_TABLE, {});
  assert.equal(verdict.displayErrors, true);
  assert.equal(verdict.app, 'WordPress 6.6');
  assert.equal(verdict.confidence, 'medium');
  assert.ok(verdict.notes.some((n) => /display_errors=On/.test(n)));
  assert.ok(verdict.notes.some((n) => /CDN or proxy cache/.test(n)));
  assert.equal(verdict.level, 'danger');
});

test('baseDomain keeps IP literals intact', () => {
  assert.equal(GL.baseDomain('127.0.0.1'), '127.0.0.1');
  assert.equal(GL.baseDomain('[::1]'), '[::1]');
  assert.ok(GL.sameSite('127.0.0.1', '127.0.0.1'));
  assert.ok(!GL.sameSite('10.0.0.1', '10.0.0.2'));
});

test('snoozeFor honours per-site expiry, base domain and "for good"', () => {
  const now = Date.now();
  const settings = { snoozed: { 'example.com': 0, 'old.test': now - 1000, 'shop.other.net': now + 3600e3 } };
  assert.equal(GL.snoozeFor('www.example.com', settings), 0, 'base-domain entry covers subdomains, for good');
  assert.equal(GL.snoozeFor('old.test', settings), null, 'expired snooze no longer silences');
  assert.equal(GL.snoozeFor('shop.other.net', settings), now + 3600e3);
  assert.equal(GL.snoozeFor('other.net', settings), null, 'a subdomain snooze does not cover the apex');
  assert.equal(GL.snoozeFor('x.com', {}), null);
  assert.equal(GL.describeSnooze(0), 'ignored for good');
  assert.match(GL.describeSnooze(now + 3600e3), /ignored for 1 h/);
  assert.equal(GL.describeSnooze(now - 5), '');
});

function pick(v) {
  return { version: v.version, branch: v.branch, partial: v.partial, distro: v.distro };
}
