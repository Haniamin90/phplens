# Changelog

## Unreleased

- Submitted to the Chrome Web Store (2026-10-29), in review.
- Published on Firefox Add-ons (approved 2026-10-29): https://addons.mozilla.org/firefox/addon/phplens/
- All UI (popup, settings, in-page dialog) builds dynamic content with DOM APIs; no untrusted strings reach innerHTML. Firefox add-on linter: 0 warnings.
- Firefox minimum version 140 (desktop) / 142 (Android); Firefox for Android listed.
- AMO submission metadata (`store/amo-metadata.json`) and `npm run sign:firefox`.

## 1.1.0 – 2026-10-25

First store release, under the name **PHPLens** (previously GuardLens; the JS namespace, custom element and Firefox add-on id placeholder changed accordingly).

- Centered warning dialog instead of a top bar; one dialog per page view, closes with ✕, Esc or backdrop.
- One-line desktop notifications ("host – PHP 8.4.26 unpatched, fix 8.4.27") with Snooze / Ignore buttons on Chromium.
- Per-site silencing: 1 hour, 1 day, 1 week or for good, from the notification, popup, dialog or settings. No hidden global cooldown.
- Verdict consistency: fresh state per navigation, cache hits observed and labelled, main document wins over sub-requests, per-tab update queue, live popup.
- New detection sources: WordPress / Drupal / Symfony / Bitrix headers, cache markers, CMS paths, visible PHP error output (display_errors=On), phpinfo() pages, confidence rating.
- Active fallback (on by default, switchable): a single HEAD request to the current page when passive observation found no version.
- Dropped the `tabs` permission (host permissions already expose tab URLs); removed web-accessible icons.
- Safari: guards for the missing webRequest / notifications APIs.
- Store icon with the 16 px transparent margin; release checks in the build.

## 1.0.0 – 2026-10-22

Initial version: passive header observation, bundled release table with daily php.net refresh, badge, popup, options, demo server, unit tests.
