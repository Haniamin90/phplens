# Store listing copy

Paste these into the developer dashboards. Length limits are noted where the stores enforce them.

## Name (≤ 45 chars for Chrome Web Store)

PHPLens – PHP Patch Check

## Summary (≤ 132 chars, shown in search results)

Warns you when a website runs an unpatched or end-of-life PHP version (CVE-2026-109618). Reads server headers only – never attacks.

## Detailed description

PHPLens tells you, as you browse, whether the server behind a website runs a PHP version
that is unpatched against CVE-2026-109618 / CVE-2026-109619 (session.upload_progress
use-after-free – unauthenticated remote code execution, CVSS 9.2, exploited in the wild)
or a PHP branch that no longer receives security fixes.

How it works
• It reads the response headers your browser already received (Server, X-Powered-By,
  cookies, CMS headers) and a few hints in the page (generator tag, .php URLs, visible PHP
  errors, phpinfo pages).
• It compares the advertised version with the patched releases (8.2.35, 8.3.36, 8.4.27,
  8.5.12) and the latest release per branch, refreshed daily from php.net.
• It never probes, never sends payloads and never attempts to trigger anything. The only
  request it can make to a site is a single HEAD request for the page you are already on,
  and only when the passive check saw no version (you can switch that off).

What you see
• A coloured toolbar badge: red = unpatched or end-of-life, amber = behind the latest
  release or a distro build that may hide backported fixes, grey = PHP detected but version
  hidden, green = patched.
• A popup with the evidence, the advisory, a confidence rating and advice.
• A one-line desktop notification and a centered in-page dialog when a site is unsafe.
• Per-site silencing: snooze for an hour, a day, a week, or ignore for good.

Read the verdict correctly
• A hidden version (expose_php=Off) is reported as unverified, not as safe.
• Distribution builds (Debian, Ubuntu, RHEL) backport fixes without changing the version
  number, so they are shown as Caution by default.
• Proxies and CDNs can strip or cache headers; the popup tells you when a result came from
  a cache and lowers the confidence accordingly.

Privacy
No accounts, no analytics, no telemetry. Nothing about the sites you visit is sent
anywhere. Full policy: PRIVACY.md in the repository.

Open source under the MIT licence.

## Status

| Store | Status | Listing |
|---|---|---|
| Firefox Add-ons (AMO) | 1.1.0 submitted 2026-10-25 via `npm run sign:firefox`, in review | https://addons.mozilla.org/firefox/addon/phplens/ · manage: https://addons.mozilla.org/developers/addon/phplens/edit |
| Chrome Web Store | not yet submitted | – |
| Microsoft Edge Add-ons | not yet submitted | – |
| Opera Add-ons | not yet submitted | – |
| Safari App Store | not yet submitted | – |

## URLs

- Privacy policy: https://haniamin90.github.io/phplens/PRIVACY
- Homepage: https://haniamin90.github.io/phplens/
- Support: https://github.com/Haniamin90/phplens/issues

## Category

- Chrome Web Store: Privacy & Security (fallback: Productivity › Developer Tools)
- Microsoft Edge Add-ons: Developer tools
- Firefox Add-ons: Privacy & Security
- Opera: Privacy & Security

## Single purpose statement (Chrome Web Store)

Warn the user when the website they are visiting is served by an unpatched or end-of-life
PHP version, based on headers the browser already received.

## Permission justifications (Chrome Web Store "Privacy practices" tab)

- **webRequest**: Needed to observe (read-only, non-blocking) the response headers of the
  pages the user loads, in order to read the PHP version the server advertises. No request
  is modified or blocked.
- **Host permissions (<all_urls>)**: The extension cannot know in advance which sites run
  PHP, so it must be able to observe headers and run its passive page check on any site the
  user visits. It reads only the headers and page hints listed in the privacy policy.
- **storage**: Stores the user's settings, the list of silenced sites, a cached copy of the
  PHP release table and per-tab results (session storage, cleared on exit).
- **notifications**: Shows a one-line desktop alert when the current site is unpatched.
- **Remote code**: None. All code is packaged; the daily php.net request returns JSON data
  only.

## Data usage disclosure (Chrome Web Store)

- Collects: none of the listed categories (no personally identifiable information, health,
  financial, authentication, personal communications, location, web history, user
  activity or website content is collected or transmitted).
- Certify: data is not sold, not used for unrelated purposes, not used for creditworthiness.

## Firefox Add-ons (AMO) specifics

- Data collection permissions: `none` (declared in the manifest).
- Source code: the package is unminified; no separate source upload is required.
- Tags: security, php, vulnerability, headers.

## Microsoft Edge Add-ons specifics

- Same package as Chrome (`dist/phplens-chromium-<version>.zip`).
- Privacy policy URL: required; host PRIVACY.md (e.g. on GitHub Pages) and paste the URL.

## Assets checklist

| Asset | Size | Required by |
|---|---|---|
| Icon | 128×128 PNG (`icons/icon-128.png`, has the 16 px margin) | all stores |
| Screenshots | 1280×800 or 640×400 PNG/JPEG, 1–5 | Chrome, Edge, Opera |
| Screenshots | any size, ≤ 10 | Firefox |
| Small promo tile | 440×280 PNG | Chrome (optional) |
| Marquee | 1400×560 PNG | Chrome (optional, featured placement) |

Suggested screenshots (take them with the demo server, `npm run demo`, at 1280×800):
1. The popup on an unpatched site (red).
2. The centered dialog with Details open.
3. The popup on a patched site (green).
4. The settings page with the release table.
