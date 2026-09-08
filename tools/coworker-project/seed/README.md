# Seed data

`project-stages.json` is the stage-config sheet the app reads: one row per
step (columns `template`, `stage`, `stageIndex`, `stepIndex`, `step`,
`displayName`). It holds the `SEO` workflow (7 stages, 20 steps).

The app reads this sheet from **DA source**, not from the repo. This file is
the version-controlled source of truth. To seed it into DA source, POST it
with an IMS bearer token:

```
curl -X POST -H "Authorization: Bearer <TOKEN>" \
  -F "data=@project-stages.json;type=application/json" \
  "https://admin.da.live/source/exp-workspace/cxcfrescopa/docs/library/project-stages.json"
```

The reader (`../stages.js`) first looks for a `coworker` config sheet row
`project-stages` that points at this sheet, and falls back to the known path
above when that row is absent.
