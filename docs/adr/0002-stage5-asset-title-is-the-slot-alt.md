# 2. An asset's title is its slot ALT text

Date: 2026-09-21

## Status

Accepted. Settles the Stage 5 map's open item "Asset title: the demo shows an
'Image title' per asset; where a title comes from (AO, the alt text, the slot)
is not sharp yet."

## Context

The demo screens show a title over every generated asset. The `assets` sheet
(#58) has no title column, and nothing in the Stage 5 pipeline writes one, so
the detail view (#62) has to derive the title from data that already exists.
Three candidates:

- **AO writes one.** Nothing asks AO for a title today. Adding it means another
  field in the generation answer or another turn, and a name the producer never
  wrote appearing over their page image.
- **The per-run `description`.** AO returns one sentence about the image it just
  drew. It is real data, but it belongs to that RUN: a Regenerate replaces it,
  so the card would rename itself whenever the picture changes, and a failed
  slot has none at all.
- **The slot `alt`.** AO wrote it in Stage 4, it is in the page doc, and the
  Firefly prompt is built from it. It is the page's own words for this picture
  and it survives every Regenerate.

## Decision

The title is the slot's `alt`, shortened to a title: its first sentence, cut at
a word boundary at 72 characters. A row with no `alt` is titled by its position,
`Image <slot + 1>`, which always exists.

The rule lives in `assetTitle` in
`tools/coworker-project/asset-detail-logic.js`, so the grid (#61) and the detail
view name the same asset the same way.

## Consequences

- The title is stable across regenerations: the image changes, the name does
  not.
- No extra AO turn, no new sheet column, and no invented text.
- A long `alt` is truncated in the title, so the full text is still shown as the
  ALT Text field of the detail view, never only as the heading.
- If a later ticket ever gives AO a real title field, `assetTitle` is the one
  place that changes.
