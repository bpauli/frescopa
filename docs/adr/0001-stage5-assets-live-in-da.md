# 1. Stage 5 assets live in DA, not on the Firefly URL

Date: 2026-09-21

## Status

Accepted. Supersedes the Stage 5 map's original "the Firefly output URL goes
into the page doc ... No DA binary upload".

## Context

Stage 5 generates page images with Firefly through Coworker (AO) and puts them
into the page doc that Stage 4 wrote to DA. Firefly answers with a presigned S3
URL. The cheapest design references that URL straight from the page doc: no
upload, no extra bytes through the producer's browser.

Gate #57 measured that design end to end and found a silent failure:

- The presigned URL lives exactly one hour (`X-Amz-Expires=3600`).
- The published page survives the expiry, because the aem.page media bus
  already holds a copy of the bytes.
- The next **re-preview** does not. Stage 6 (Localization) and every content
  edit re-previews. On the probe page the preview call still answered `200`,
  and every image on the page silently became `about:error`. Nothing in any
  API response reports it.

Three options were built and previewed, not argued:

- **A - keep the Firefly URL.** Cheapest, accepts the failure above.
- **B - rewrite the doc to the ingested `./media_<hash>` URL after the first
  preview.** Lossless, but the ingested URL can only be read back from
  `{path}.plain.html` or `{path}.md` on aem.page, and those carry no
  `access-control-allow-origin` header. The app can only read them when it is
  served from the same origin, that is, once it runs on `main` without `?ref=`.
- **C - upload the bytes to DA and reference the DA URL.** Needs no read-back
  and works from any app origin.

Option C rests on three gate-proven facts: the presigned URL is CORS-readable
straight from the browser at `https://da.live`; `POST admin.da.live/source/...`
with a `FormData` blob answers `201` and a `content.da.live` URL; and the
pipeline reads that auth-protected DA URL with the content-source authorization
and ingests it under the **same** media hash as a direct Firefly ingestion,
because the media identifier is a pure content hash of the bytes.

## Decision

The page doc references a permanent DA-hosted copy of every generated image,
never the Firefly presigned URL.

- One asset per slot at a deterministic DA path, `/projects/<slug>/slot-<n>.<ext>`,
  so a Regenerate overwrites that slot instead of littering DA.
- The reference carries the `#width=&height=` fragment. Without it the pipeline
  drops the `width`/`height` attributes from the rendered `<img>`, which is a
  CLS regression.
- The assets sheet keeps both URLs: `sourceUrl` is where the image came from
  (and expires), `mediaUrl` is the durable DA copy the doc points at.
- The page is re-previewed **once, after all slots**. One preview call ingests
  every image on the page in about three seconds, whatever the slot count.

## Consequences

- A swapped page is re-previewable for ever. No image can silently become
  `about:error`.
- Every generated image costs one extra round trip of about 1 MB through the
  producer's browser: read from Firefly, write to DA.
- Stage 5 owns binary content in DA. The producer can see, replace, or delete a
  slot's image in DA like any other asset.
- The rendered result is byte-identical to referencing Firefly directly, so
  nothing downstream has to know which option was taken.

See `tools/coworker-project/asset-swap.js` for the implementation.
