# Contributing to PHPLens

Thanks for helping. PHPLens is small on purpose: no build framework, no runtime
dependencies, plain scripts that load unchanged in every browser. Please keep it that way.

## Ground rules

1. **Passive only.** PHPLens reads what the browser already received. The single HEAD
   request for the current page (switchable, documented) is the only active behaviour and
   it stays that way. Pull requests that probe, fuzz, send payloads or try to *trigger*
   anything will be closed.
2. **Verdicts must be explainable.** Every verdict shows its evidence lines. A new signal
   must add an evidence line a user can read and check.
3. **Facts come from php.net.** Fixed versions and advisories are anchored to php.net and
   the GHSA advisories, never to blog posts.

## Setup

```bash
git clone https://github.com/Haniamin90/phplens.git
cd phplens
npm test            # unit tests (node:test, no install step)
npm run build       # icons + dist/chromium + dist/firefox + zips
npm run demo        # http://127.0.0.1:8099/ – one page per verdict state
```

Load `dist/chromium` as an unpacked extension (Chrome/Edge/Brave) or
`dist/firefox/manifest.json` as a temporary add-on (Firefox), then walk through the demo
pages. `npm run lint:firefox` runs Mozilla's `web-ext lint` (downloads it via npx).

## Where things live

| Area | File |
|---|---|
| Version parsing, verdicts, release table, reconcile, confidence | `src/lib/php-check.js` (pure functions, fully unit-tested) |
| Settings, levels, snooze helpers | `src/lib/common.js` |
| Header observation, per-tab state, badge, notifications, messaging | `src/background.js` |
| Page hints, HEAD fallback, in-page dialog | `src/content/content.js` |
| Popup / settings UI | `src/popup/`, `src/options/` |
| Icons, build, zip writer, demo server | `tools/` |

## Adding a detection signal

- Header-based: add a rule to `APP_HEADERS` or extend `inspectResponse` in
  `src/lib/php-check.js`, and add a case to `tests/php-check.test.mjs`.
- Page-based: extend `collect()` in `src/content/content.js`; if it needs a regex, put the
  regex in `php-check.js` so it can be unit-tested.
- Document it in `PRIVACY.md` (what is read) and the README's "How it works".

## Adding an advisory

Append to `VERSION_TABLE.advisories` in `src/lib/php-check.js` with per-branch `fixed`
versions, bump the version in `manifest.json` and `package.json`, add a changelog entry.

## Style

Two-space indent, single quotes, semicolons, no transpilation. Keep files loadable as
plain scripts (no `import`/`export` in `src/`; `tools/` and `tests/` are ES modules).

## Releasing

See [docs/PUBLISHING.md](docs/PUBLISHING.md). In short: bump both versions, update
`CHANGELOG.md`, `npm run release`, tag `vX.Y.Z` and push the tag. The release workflow
attaches the zips to a GitHub release; store uploads are manual.
