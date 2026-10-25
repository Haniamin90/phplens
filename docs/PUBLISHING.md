# Publishing PHPLens to every browser store

One codebase, two packages:

| Package | Built by `npm run build` | Used for |
|---|---|---|
| `dist/phplens-chromium-<version>.zip` | manifest.json as-is (service worker) | Chrome Web Store, Microsoft Edge Add-ons, Opera Add-ons, Brave/Vivaldi (they install from the Chrome Web Store), Safari (converted with Xcode) |
| `dist/phplens-firefox-<version>.zip` | manifest.json + manifest.firefox.json (event page scripts, gecko id, data-collection declaration) | Firefox Add-ons (AMO) |

The listing copy, permission justifications and asset sizes are in
[`store/listing.md`](../store/listing.md); the privacy policy is [`PRIVACY.md`](../PRIVACY.md).

---

## 0. Release checklist (every release)

1. Bump the version in **both** `manifest.json` and `package.json` (the build refuses to run
   if they differ). Stores require a version strictly higher than the last published one.
2. Add an entry to `CHANGELOG.md`.
3. Run the release build:
   ```bash
   npm run release
   ```
   This runs the unit tests, regenerates the icons, checks the store limits (name ≤ 45,
   description ≤ 132 characters) and writes both zips to `dist/`.
4. Smoke-test each package once:
   - Chromium: `chrome://extensions` → Developer mode → *Load unpacked* → `dist/chromium`.
   - Firefox: `about:debugging#/runtime/this-firefox` → *Load Temporary Add-on* →
     `dist/firefox/manifest.json`; grant *Access your data for all websites* under the
     add-on's Permissions tab.
   - Run `npm run demo` and open `http://127.0.0.1:8099/`; every state should produce the
     right badge, dialog and notification.
5. Lint the Firefox package with Mozilla's tool (needs network access to fetch `web-ext`):
   ```bash
   npm run lint:firefox
   ```
   Warnings about `minimum_chrome_version` or `author` being unknown keys are expected
   and harmless; errors are not.
6. Tag the release in git (`git tag v1.1.0`) so the published package can be reproduced.

Hosting the privacy policy: Chrome, Edge and Opera want a **URL**. The rendered file on
GitHub works as-is:

```
https://github.com/Haniamin90/phplens/blob/main/PRIVACY.md
```

For a cleaner page, enable GitHub Pages (Settings → Pages → *Deploy from a branch* →
`main`, folder `/ (root)`); the policy is then at
`https://haniamin90.github.io/phplens/PRIVACY`.

Pushing a tag `vX.Y.Z` runs `.github/workflows/release.yml`, which re-runs tests and build
and attaches both zips to a GitHub release with the matching `CHANGELOG.md` section. Use
those zips for the store uploads so what you publish is exactly what CI built.

---

## 1. Chrome Web Store (Chrome, Brave, Vivaldi, Arc, …)

**Account**: [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).
One-time registration fee (USD 5). Enable 2-step verification on the Google account.

1. *New item* → upload `dist/phplens-chromium-<version>.zip`.
2. **Store listing**: name, summary, description and category from `store/listing.md`;
   icon is read from the package; add 1–5 screenshots (1280×800). Optional promo tiles.
3. **Privacy practices**:
   - Single purpose: paste the statement from `store/listing.md`.
   - Permission justifications: paste each one (`webRequest`, host permissions,
     `storage`, `notifications`), state *no remote code*.
   - Data usage: tick nothing in the "collects" list, tick all three certifications.
   - Privacy policy URL: your hosted `PRIVACY.md`.
4. **Distribution**: Public (or Unlisted for a soft launch); all regions.
5. *Submit for review*. Reviews for extensions with `<all_urls>` + `webRequest` typically
   take a few days. If the reviewer asks why broad host access is needed, answer with the
   host-permission justification (the extension cannot know in advance which sites run PHP).
6. After approval, the item gets a permanent URL `https://chromewebstore.google.com/detail/<id>`.
   Note the extension ID; it stays the same across versions.

**Updating**: Package → *Upload new package* with a higher version → submit. Users receive
the update automatically within hours.

**Brave, Vivaldi, Arc, Opera (Chromium)** install from the Chrome Web Store; nothing extra
is needed for them.

---

## 2. Microsoft Edge Add-ons

**Account**: [Partner Center – Microsoft Edge program](https://partner.microsoft.com/dashboard/microsoftedge).
Free registration with a Microsoft account.

1. *Create new extension* → upload the **same** `dist/phplens-chromium-<version>.zip`.
2. **Availability**: public, all markets.
3. **Properties**: category *Developer tools*, privacy policy URL, support URL (repository
   issues page), website.
4. **Store listing** (per language): description, short description (summary), 1–10
   screenshots (1280×800 or 640×400), optional promotional tile 300×300, the search terms.
5. **Notes for certification**: write "Passive security check. Reads response headers via
   webRequest (observe only). Test with: `npm run demo` → http://127.0.0.1:8099/ (or any
   PHP site). No login required."
6. *Publish*. Certification usually completes within 1–7 days.

**Updating**: open the extension → *Packages* → upload the new zip → *Publish*.

---

## 3. Firefox Add-ons (AMO)

**Account**: [addons.mozilla.org developer hub](https://addons.mozilla.org/developers/).
Free. Every Firefox extension must be **signed by Mozilla** even if you distribute it
yourself, so AMO is on the path either way.

The add-on ID is permanent once submitted. The Firefox manifest ships
`browser_specific_settings.gecko.id = "phplens@haniamin90.github.io"` (an email-style id
on a host you control; a GUID also works). If you publish under another account, change it
in `manifest.firefox.json` **before** the first submission; it cannot be changed later.

1. *Submit a New Add-on* → *On this site* (listed) → upload `dist/phplens-firefox-<version>.zip`.
   AMO runs the same linter as `npm run lint:firefox`; fix any errors it reports.
2. **Source code**: not required (the package is plain, unminified JavaScript). If asked,
   upload a zip of the repository without `dist/`.
3. **Listing**: name, summary, description, categories (*Privacy & Security*), tags,
   support email/site, license (MIT), privacy policy (paste the text of `PRIVACY.md`),
   screenshots (any size, up to 10).
4. **Data collection**: the manifest already declares `data_collection_permissions:
   { required: ["none"] }`; confirm "no data collected" in the form.
5. *Submit*. Automated review signs most add-ons within minutes; a human review can
   follow and may ask about the `<all_urls>` host permission and `webRequest`. Reply with
   the justification text.
6. Firefox treats host permissions as **optional** in Manifest V3: after installation
   users may need to allow *Access your data for all websites* in the add-on's Permissions
   tab. Say so in the listing description (already included in the copy).

**Updating**: *Upload New Version* on the add-on page with a higher version number.

**Self-distribution / enterprise**: submit as *On your own* (unlisted); AMO returns a signed
`.xpi` you can host anywhere or deploy by policy.

**Firefox for Android**: add `"gecko_android": {}` under `browser_specific_settings` in
`manifest.firefox.json` to opt in; the extension works there because it needs no desktop-only
API (notifications are simply unavailable on Android and are skipped).

---

## 4. Opera Add-ons

**Account**: [Opera Add-ons developer dashboard](https://addons.opera.com/developer/).
Free.

1. *Upload Addon* → upload `dist/phplens-chromium-<version>.zip`.
2. Fill the listing (same copy), category *Privacy & Security*, screenshots, privacy
   policy URL.
3. Submit for moderation (typically 1–2 weeks).

Most Opera users can also install directly from the Chrome Web Store, so this step is
optional.

---

## 5. Safari (macOS, iOS, iPadOS)

Safari does not install web-store zips. The extension must be wrapped in a native app with
Xcode and distributed through the App Store (or notarized for direct download on macOS).

**Requirements**: a Mac with Xcode 15+, an [Apple Developer Program](https://developer.apple.com/programs/)
membership (USD 99/year) for App Store distribution.

1. Build the Chromium package, then convert it:
   ```bash
   npm run build
   xcrun safari-web-extension-converter dist/chromium \
     --project-location ./safari \
     --app-name "PHPLens" \
     --bundle-identifier com.example.phplens \
     --macos-only            # drop this flag to also generate the iOS target
   ```
   The converter prints warnings for unsupported manifest keys (`minimum_chrome_version`,
   `webRequest`); they are expected.
2. Open `safari/PHPLens/PHPLens.xcodeproj`, set your Team under *Signing &
   Capabilities* for both the app and the extension targets, and run it once. In Safari
   enable *Develop → Allow Unsigned Extensions* during development, then turn the extension
   on under *Safari → Settings → Extensions* and allow it for *All Websites*.
3. **Behaviour on Safari**: there is no `webRequest`, so header observation is unavailable
   and `browser.notifications` does not exist. PHPLens relies on page hints and the
   active fallback (a HEAD request to the page) to read the version, and alerts through
   the badge and the in-page dialog. Keep *Active fallback* on for Safari users.
4. **App Store**: in Xcode, *Product → Archive → Distribute App → App Store Connect*.
   In [App Store Connect](https://appstoreconnect.apple.com/) create the app record, add
   screenshots of the Safari extension in use (macOS: 1280×800 or larger; iOS: device
   sizes), the description, the privacy policy URL, and fill the *App Privacy* questionnaire
   with "Data Not Collected". Submit for review (usually 1–3 days). Mention in the review
   notes that the app is a Safari web extension container and how to test it (demo server
   URL, or any PHP site).
5. **Outside the App Store (macOS only)**: *Distribute App → Developer ID*, notarize, and
   ship the `.app`; users install the extension by launching the app once.

---

## 6. Keeping the release table current

The advisory facts (fixed versions 8.2.35 / 8.3.36 / 8.4.27 / 8.5.12) are bundled in
`src/lib/php-check.js`. The *latest* release per branch refreshes daily from php.net, so a
new PHP point release does not require a store update. A **new advisory** does: add it to
`VERSION_TABLE.advisories`, bump the version, and publish through all five channels above.

## 7. Store review answers you will probably need

- *Why do you need access to all websites?* The extension cannot know in advance which
  sites run PHP; it reads only the listed headers and page hints and never modifies
  requests. See `PRIVACY.md`.
- *Does the extension send requests to websites?* Only the optional HEAD request for the
  page the user is already on, when no version was observed; it can be disabled in settings.
  Everything else is read-only observation of responses the browser already received.
- *Does it execute remote code?* No. The daily php.net request returns version numbers as
  JSON data only.
- *How do we test it?* Run `node tools/demo-server.mjs` from the source, open
  `http://127.0.0.1:8099/`, visit each demo state; or open any site that advertises
  `X-Powered-By: PHP/…`.
