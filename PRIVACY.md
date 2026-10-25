# PHPLens – Privacy Policy

_Last updated: 2026-10-22_

PHPLens is a browser extension that tells you whether the website you are visiting runs
an unpatched or end-of-life version of PHP. This policy explains what it reads, what it
stores and what it sends.

## What PHPLens reads

- **Response headers** of the pages and same-site resources your browser already loads:
  `Server`, `X-Powered-By`, `Set-Cookie` (cookie *names* only), `X-Generator`,
  `X-Pingback`, `X-Redirect-By`, `X-Drupal-*`, `X-Powered-CMS`, `X-Debug-Token`, `Link`,
  `Age`, `X-Cache`, `CF-Cache-Status`.
- **Page hints** in the current page: URLs ending in `.php`, the generator meta tag,
  CMS resource paths, RSD / REST links, "powered by" text, template comments, names of
  non-HttpOnly cookies, visible PHP error messages and `phpinfo()` output.

PHPLens does not read form contents, passwords, cookie values, page text beyond the
pattern matches above, or anything on pages it is not allowed to run on.

## What PHPLens stores

- **Settings** (badge, notifications, dialog, thresholds, live-table refresh, active
  fallback, ignored sites with their expiry) in the browser's extension storage on your
  device.
- **Per-tab results** (detected version, evidence lines, verdict) in session storage.
  They are deleted when the tab is closed and when the browser exits.
- **A cached copy of the PHP release table** downloaded from php.net.

Nothing is stored on any server. PHPLens has no account system, no analytics and no
telemetry.

## What PHPLens sends

- **To php.net** (optional, on by default): once a day, a request to
  `https://www.php.net/releases/active.php` to learn the latest release of each PHP
  branch. The request carries no information about you or the sites you visit.
- **To the site you are on** (active fallback, on by default, switchable): when the
  passive observation could not see a PHP version, a single `HEAD` request for the page
  you are already viewing, with the same cookies your browser would send for that page.
  No other request, path, method or payload is ever sent.

PHPLens never sends the addresses of the sites you visit, your verdicts or any
personal data to the developer or to any third party.

## Permissions

| Permission | Why |
|---|---|
| `webRequest` | Observe response headers (read-only, non-blocking). |
| Host access to all sites (`<all_urls>`) | Headers and page hints must be read on whatever site you visit; PHPLens cannot know in advance which sites run PHP. |
| `storage` | Settings, cached release table, per-tab results. |
| `notifications` | The one-line desktop alert when a site is unpatched. |

## Contact

Questions about this policy: open an issue in the project repository.
