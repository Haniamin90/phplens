# Security policy

## Reporting a vulnerability in PHPLens

Please report privately through
[GitHub security advisories](https://github.com/Haniamin90/phplens/security/advisories/new).
Do not open a public issue. You should get an acknowledgement within a few days; fixes
ship as a new store release and are credited in `CHANGELOG.md` unless you prefer otherwise.

In scope: anything that makes the extension read, store or send more than
[`PRIVACY.md`](PRIVACY.md) says, lets a web page influence the extension's UI or
verdicts beyond its own headers and page hints (for example HTML injection into the
dialog or popup), or lets a page detect or disable the extension.

## Reporting a vulnerable website

PHPLens tells **you** that a site runs unpatched PHP. It is not a channel to the site's
operator and we do not collect or publish such findings. If you want to help the
operator, contact them directly; the "What to do" section in the popup has the versions
they need to upgrade to.

## What PHPLens will never do

It will not probe, fuzz, send payloads or attempt to trigger CVE-2026-109618 or any other
vulnerability, in a release or in a pull request. See `CONTRIBUTING.md`.
