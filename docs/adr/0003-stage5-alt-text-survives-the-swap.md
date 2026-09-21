# 3. Stage 4's ALT text survives the asset swap

Date: 2026-09-21

## Status

Accepted. Settles the Stage 5 map's open item "ALT text after the swap: the
placeholder `alt` is a generation prompt, not necessarily good a11y text for the
final image. Whether it is rewritten on swap is open."

## Context

The map's premise is worth checking before acting on it. Two different strings
are involved, and only one of them ever reaches the page:

- The slot **`alt`**: one sentence AO wrote in Stage 4 to say what the picture
  in this section shows, e.g. "A barista pouring a flat white on a marble
  counter". It sits in the page doc and is what a screen reader reads.
- The **prompt**: `buildAssetPrompt` (#59) builds it FROM the `alt` and adds the
  Stage 2 visual style, the palette colours, the crop and "No text, no
  lettering, no watermark, no logo". This string goes to Firefly and is stored
  in the `assets` row. It never enters the page.

So the `alt` is the SEED of the prompt, not the prompt. It is already a plain
description of the subject, which is what alt text is. The swap (#60) is
surgical by design: it rewrites `<img src>` and touches no other attribute, so
today the `alt` survives untouched.

A rewrite would also cost something real: another AO turn per slot, a second
description of the same picture, and a risk that AO's account of what it drew
("A fresh take on the same counter") replaces the page's description of what
the section needs. AO already returns that account - it is stored as
`description` - so the two strings can be compared without overwriting either.

## Decision

The `alt` is NOT rewritten on the swap. The page keeps the alt text Stage 4
wrote, and the generated image was made from that same sentence, so the two stay
in step by construction.

The detail view (#62) shows **ALT Text** (what the page says) and
**Description** (AO's account of the image it produced) as two separate fields,
so a producer who sees them diverge can act on it.

## Consequences

- No extra AO turn, and no machine-written text silently replacing the page's
  own words.
- Alt text stays a Stage 4 concern: if it is weak, it is weak on the placeholder
  too, and the fix belongs where the page copy is written.
- Editing alt text in the app is deferred, not refused. The detail view surfaces
  the value; a later ticket can make that field editable and write it back with
  the same surgical rewrite the `src` swap uses.
- A regenerated image keeps the row's `alt` (`assetRow` in
  `tools/coworker-project/asset-detail-logic.js`) and drops the previous
  `description`, because that sentence described the previous image.
