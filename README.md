# PHPLens – PHP Patch Check

[![CI](https://github.com/Haniamin90/phplens/actions/workflows/ci.yml/badge.svg)](https://github.com/Haniamin90/phplens/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/Haniamin90/phplens?label=release)](https://github.com/Haniamin90/phplens/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Manifest V3](https://img.shields.io/badge/manifest-v3-6366f1)
![No dependencies](https://img.shields.io/badge/dependencies-none-22c55e)

A small, cross-browser extension that **passively** reads the PHP version a website's
server advertises and warns you when it is **unpatched against CVE-2026-109618 /
CVE-2026-109619** (session.upload_progress use-after-free, unauthenticated RCE, CVSS 9.2,
exploited in the wild) or running an **end-of-life** PHP branch.

It only observes. It never probes, never sends payloads, never attempts to trigger anything.

| State | When | Badge |
|---|---|---|
| **Danger** | version below the fixed release (8.2.35 / 8.3.36 / 8.4.27 / 8.5.12), or an EOL branch (≤ 8.1) | red `!` |
| **Caution** | patched for the advisory but behind the latest release, or a distro build whose version string may hide backported fixes | amber `!` |
| **Unverified** | PHP detected but version hidden (`expose_php=Off`), or only the branch is shown | grey `?` |
| **Patched** | at or above the latest release of its branch | green `OK` |
| *(no badge)* | no sign of PHP on the pages you loaded | – |

## How it works

1. `webRequest` (non-blocking, read-only) watches responses of the **site you are on**:
   `X-Powered-By`, `Server`, `Set-Cookie` (`PHPSESSID`, `laravel_session`, WordPress,
   Drupal, Magento, TYPO3 … cookies), `X-Generator`, `X-Pingback`, `X-Redirect-By`,
   `X-Drupal-*`, `X-Powered-CMS`, `X-Debug-Token`, the WordPress `Link` header, `.php`
   URLs, and cache markers (`Age`, `X-Cache`, `CF-Cache-Status`) that lower confidence.
   Third-party resources (CDNs, ads) are ignored so you are judged on *this* server only.
2. A content script adds passive page hints: generator meta tag, CMS/framework resource
   paths (WordPress, Drupal, Joomla, TYPO3, Magento, Laravel Livewire, Composer `vendor/`),
   RSD / REST links, "powered by" footers, template comments, non-HttpOnly PHP cookies,
   **PHP error output rendered into the page** (display_errors=On – the configuration the
   public exploit relies on) and **phpinfo() pages**, which give the exact version.
   This is all that is available on Safari.
   Active fallback (on by default, switchable in settings): one HEAD request to the current
   page when passive observation revealed no version (cache-only loads, Safari). It is a
   plain request for the page you are already on; nothing else is ever sent.
3. `src/lib/php-check.js` parses the banner (`PHP/8.4.26`, `PHP/8.1.2-1ubuntu2.19`,
   `PHP/8.5.0RC1` …) and compares it with the bundled release table.
4. Result → toolbar badge + icon colour, popup with evidence, a one-line desktop
   notification ("example.com – PHP 8.4.26 unpatched, fix 8.4.27"; one per page load while
   the site is affected, Danger only by default) and an in-page dialog for Danger (or
   Caution if you choose).
   Closing the banner with ✕ hides it for that page view only.
5. Silencing is always your call, per site: snooze for 1 hour, 1 day, 1 week, or ignore for
   good – from the notification's buttons (Chromium), the popup, the banner, or Settings.
   There is no hidden global cooldown.

Not seeing notifications? Open *Settings → Send test notification*. If the test reports
"Sent" but nothing appears, the OS is hiding them: on Windows check Focus Assist / Do Not
Disturb and *Settings → System → Notifications → your browser*; in Chrome also
`chrome://settings/content/notifications`.

The **only outbound request** the extension ever makes is an optional once-a-day fetch of
`https://www.php.net/releases/active.php` to learn the newest release per branch. The site
you are visiting is never sent anywhere. Per-tab results live in session storage and vanish
when the browser closes.

## Build

```bash
npm run build
```

Creates `dist/chromium/`, `dist/firefox/` and a zip for each. (`npm test` runs the unit
tests; `npm run icons` regenerates the PNG icons from `tools/gen-icons.mjs`.)

## Install

| Browser | Where |
|---|---|
| Firefox (desktop and Android) | [addons.mozilla.org/firefox/addon/phplens](https://addons.mozilla.org/firefox/addon/phplens/) – submitted, awaiting Mozilla's review |
| Chrome, Edge, Brave, Opera | store submissions pending |

Until the listings are live, download the latest `phplens-chromium-*.zip` or
`phplens-firefox-*.zip` from the [Releases page](https://github.com/Haniamin90/phplens/releases),
unzip it, and load it as described below.

**Chrome / Edge / Brave / Opera / Vivaldi**
1. Open `chrome://extensions` (Edge: `edge://extensions`), enable *Developer mode*.
2. *Load unpacked* → pick `dist/chromium`.

**Firefox (128+)**
1. Open `about:debugging#/runtime/this-firefox` → *Load Temporary Add-on…* → pick
   `dist/firefox/manifest.json`. (For a permanent install use the zip with Firefox
   Developer Edition / Nightly and `xpinstall.signatures.required=false`, or submit it to AMO.)
2. Firefox treats host permissions as optional in Manifest V3: open *Add-ons Manager →
   PHPLens → Permissions* and allow **Access your data for all websites**, otherwise the
   header observer never fires.

**Safari (macOS 14+ / iOS 17+)**
```bash
xcrun safari-web-extension-converter dist/chromium --project-location ./safari
```
Open the generated Xcode project and run it. Safari has no `webRequest` API, so only the
page hints work there: PHP sites show as *Unverified* rather than as a concrete version.

## Try it locally

```bash
npm run demo
```
Then browse `http://127.0.0.1:8099/`. Each link imitates a server with a different banner
(unpatched 8.4.26, EOL 7.4, distro 8.1.2-1ubuntu, patched 8.4.27, hidden version, no PHP…)
so you can see every state, the banner and the notification without touching a real site.

## Why verdicts stay consistent

- Every top-level navigation starts a fresh state; only a redirect chain shares one. A
  verdict from the previous page never leaks into the next.
- The **main document's** version decides. Sub-requests (API calls, scripts) fill in only
  when the main page shows nothing; if they disagree, the popup says *Mixed*, lists them,
  and a dangerous one raises the result to at least *Caution*.
- Responses served from the **browser cache** are observed too and labelled *(cached)*;
  "Reload & re-check" bypasses the cache so you see the server as it is now.
- All updates for one tab are serialized, and the popup refreshes live while open.
- Every verdict carries a **confidence** (high / medium / low) based on where the version
  came from: the main document or phpinfo is high; a sub-request is medium; anything from
  the browser cache, a CDN cache, or a site that showed several versions is lowered.

## Read the verdict correctly

- **Hidden version ≠ safe.** `expose_php=Off` is good practice, but then nobody can tell
  from the outside. PHPLens says *Unverified* on purpose.
- **Distro builds** (`8.2.28-1~deb12u1`, `8.1.2-1ubuntu2.19`) often carry backported
  security fixes without a version bump. They are shown as *Caution* by default
  (switchable to *Danger* in settings); only the package changelog can confirm.
- **A banner can lie.** Proxies, WAFs and CDNs may strip, cache or rewrite headers, and an
  operator can set any `X-Powered-By`. Treat the result as a strong hint, not proof.
- **Headers show up on PHP-generated responses only.** A static front page behind a cache
  may show nothing until you open a dynamic page (login, search, cart).

## Publishing

See [docs/PUBLISHING.md](docs/PUBLISHING.md) for the release checklist and step-by-step
instructions for the Chrome Web Store, Microsoft Edge Add-ons, Firefox Add-ons, Opera and
Safari (App Store). Listing copy and permission justifications are in
[store/listing.md](store/listing.md); the privacy policy is [PRIVACY.md](PRIVACY.md).

## Project layout

```
manifest.json            Chromium manifest (MV3, service worker)
manifest.firefox.json    Firefox overrides merged by tools/build.mjs
src/lib/common.js        shared helpers, settings, levels
src/lib/php-check.js     banner parsing, version compare, verdict, live-table merge
src/background.js        header observer, badge/icon, notifications, messaging
src/content/content.js   page hints + in-page banner (shadow DOM)
src/popup/               toolbar popup
src/options/             settings page (alerts, release table, ignored sites)
tools/gen-icons.mjs      PNG icon generator (no dependencies)
tools/build.mjs          builds dist/ + zips     tools/zip.mjs: tiny zip writer
tools/demo-server.mjs    local server imitating PHP banners
tests/                   node:test unit tests
```

## Updating the release table

The fixed versions for the advisory live in `VERSION_TABLE` in
`src/lib/php-check.js`. When a new PHP release ships, bump the `latest` entries there (or
simply let the daily php.net refresh pick it up); when a new advisory is published, add it
to `advisories` with its per-branch `fixed` versions. Sites that are patched for the
advisory but below `latest` are reported as *Caution*, so a stale table never hides a
genuinely unpatched server.

## Contributing and security

Bug reports, wrong-verdict reports and new passive detection ideas are welcome through the
issue templates. Read [CONTRIBUTING.md](CONTRIBUTING.md) first; the one hard rule is that
PHPLens stays passive. Security issues in the extension itself go through
[SECURITY.md](SECURITY.md), not the public tracker.

## License

MIT – see [LICENSE](LICENSE).
