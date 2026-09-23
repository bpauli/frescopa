# 4. Stage 6 creates a locale's nav and footer

Date: 2026-09-23

## Status

Accepted. Settles the one call gate #74 left open, and corrects research #75's
"the ONLY genuine beyond-translated-copy requirement is the `lang` attribute".

## Context

A localized page is written to the site's own locale prefix - `/drafts/x`
becomes `/fr/drafts/x` - and nothing else about the site is touched. Research
#75 concluded that a translated copy at that path is all a locale needs.

Gate #74 put a real localized page on `aem.page` and disproved it.
`blocks/header/header.js` and `blocks/footer/footer.js` derive a locale root
from the first path segment for `es`, `fr`, `jp` and `de`, and prefix the
nav/footer fragment path with it. So a page at `/fr/...` loads `/fr/nav` and
`/fr/footer`. Neither existed: both answered `404`, and the page rendered its
`<main>` perfectly and its chrome not at all.

```
[error] Failed to load resource: 404
[log]   failed to load module for footer TypeError: Cannot read properties of null
[error] Failed to load resource: 404
[log]   failed to load module for header TypeError: Cannot read properties of null
```

Translating `/nav` and `/footer` through the same structure-preserving prompt
and previewing them fixed it completely, at 122 and 148 tag events identical.
The gate left three options open: (a) locale generation writes the chrome the
first time a locale is used, (b) a separate site-setup ticket seeds `fr`, `es`
and `jp`, (c) accept broken chrome outside `fr`.

Option (c) is a demo with no header. Option (b) leaves the app depending on a
manual step no producer can see, and it has to be redone for every locale root
the site later supports.

## Decision

Stage 6's localization contract ensures the locale's chrome exists: before a
localized page is reported as generated, `/{prefix}/nav` and `/{prefix}/footer`
are read from DA, and a missing one is produced by running the site's root
`/nav` or `/footer` through the SAME translation contract as the page.

- Only the locale roots the header/footer blocks know about get chrome. A page
  under any other prefix is served the site's ROOT chrome by that same block
  code, so there is nothing to create for it.
- A fragment already in DA is left alone, so this costs one read per fragment
  after a locale's first page, and two AO turns exactly once per locale.
- Chrome failure is a SOFT error: the localized page is written, previewed and
  reported as generated, and the row carries the message. A page with English
  chrome is worth having; a page that is not written is not.

## Consequences

- Any locale root the site supports renders with its own header and footer,
  not just the `/fr` the gate seeded by hand.
- The locale's chrome is generated content in DA, so an author can correct it
  in `da.live` like any other fragment, and a correction survives later pages.
- `CHROME_LOCALE_ROOTS` in `localization.js` duplicates the locale list in
  `blocks/header/header.js` and `blocks/footer/footer.js`. A locale added there
  and not here renders with empty chrome - the same failure this ADR fixes. The
  two places must be kept in step.
- Two site facts stay OUT of this decision, both one-per-site rather than
  one-per-page: the `lang` attribute still says `en` (`scripts/scripts.js`
  hardcodes it - ticket #81), and the authored `/nav` uses hrefs without a
  leading slash, so a localized nav inherits locale-blind links. AO reproduces
  them faithfully; the defect is in the source nav and the fix is an edit to
  the locale's own nav doc - ticket #83.

See `tools/coworker-project/localization.js` for the implementation.
