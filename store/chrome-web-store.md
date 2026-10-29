# Chrome Web Store – field-by-field submission sheet

Dashboard: https://chrome.google.com/webstore/devconsole (Google account; one-time USD 5
registration fee on first use; enable 2-step verification on the account).

Package to upload: `dist/phplens-chromium-1.1.0.zip` (built by `npm run build`).

## 1. New item → upload the zip

## 2. Store listing tab

| Field | Value |
|---|---|
| Title (from manifest) | PHPLens – PHP Patch Check |
| Summary (from manifest) | Warns you when a website runs an unpatched or end-of-life PHP version (CVE-2026-109618). Reads server headers only – never attacks. |
| Description | paste `store/amo-description.txt` (plain text; Chrome renders no formatting either) |
| Category | Privacy & Security |
| Language | English (United States) |
| Store icon | `icons/icon-128.png` (128×128 with the 16 px margin Chrome asks for) |
| Screenshots (1280×800) | `store/screenshots/1-unpatched-popup.png`, `2-warning-dialog.png`, `3-patched-popup.png`, `4-settings.png` |
| Small promo tile (440×280) | `store/screenshots/promo-small-440x280.png` |
| Marquee promo tile (1400×560) | `store/screenshots/promo-marquee-1400x560.png` |
| Official URL | https://haniamin90.github.io/phplens/ (verify the site under Account → Verified sites, or leave blank) |
| Homepage URL | https://github.com/Haniamin90/phplens |
| Support URL | https://github.com/Haniamin90/phplens/issues |

## 3. Privacy practices tab

**Single purpose description**

> Warn the user when the website they are visiting is served by an unpatched or end-of-life PHP version, based on headers the browser already received.

**Permission justifications**

- `webRequest`: Needed to observe (read-only, non-blocking) the response headers of the pages the user loads, in order to read the PHP version the server advertises. No request is modified or blocked.
- Host permission `<all_urls>`: The extension cannot know in advance which sites run PHP, so it must be able to observe headers and run its passive page check on any site the user visits. It reads only the headers and page hints listed in the privacy policy.
- `storage`: Stores the user's settings, the list of silenced sites, a cached copy of the PHP release table and per-tab results (session storage, cleared on exit).
- `notifications`: Shows a one-line desktop alert when the current site is unpatched.

**Are you using remote code?** No, I am not using remote code. (Justification if asked: all code is packaged; the daily request to php.net returns version numbers as JSON data only.)

**Data usage**: tick none of the data types (no personally identifiable information, health, financial, authentication, personal communications, location, web history, user activity or website content is collected or transmitted).

**Certifications**: tick all three (not sold to third parties; not used for purposes unrelated to the core functionality; not used to determine creditworthiness or for lending).

**Privacy policy URL**: https://haniamin90.github.io/phplens/PRIVACY

## 4. Distribution tab

- Visibility: Public
- Distribution: all regions
- Payments: free

## 5. Submit for review

Leave "Publish automatically after review" on. Review for an extension with `<all_urls>` +
`webRequest` typically takes a few days. If a reviewer asks why broad host access is needed,
answer with the host-permission justification above. The extension ID shown after upload is
permanent; note it in this file.

Extension ID: cofggkmjamhnfgehicdcjdiolfmcigoh
Store URL: https://chromewebstore.google.com/detail/cofggkmjamhnfgehicdcjdiolfmcigoh
