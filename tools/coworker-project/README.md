# Coworker Projects (skateboard)

A DA app: create a Project from a Template and see the template's staged
workflow. Round one covers the project template and the wizard only (no
Coworker AI, no stage execution).

## Launch

DA iframes the app by appending `.html` to the URL path, so the path points at
the file (`coworker-project/coworker-project`), not just the folder.

- Local (needs `aem up` running at localhost:3000):
  `https://da.live/app/exp-workspace/cxcfrescopa/tools/coworker-project/coworker-project?ref=local`
- Branch: append `?ref=<branch>`; on `main`, omit `ref`.

To show the app as a card in the DA UI, add a row to the `apps` config sheet at
`https://da.live/config#/exp-workspace/cxcfrescopa/` (path
`/tools/coworker-project/coworker-project`).

## Structure

- `coworker-project.html` / `.js` - shell + router (list / wizard / project).
- `templates.js` - reads the DA Templates panel config (two-hop lookup).
- `stages.js` - reads the stage-config sheet, grouped into stages/steps.
- `project.js` - slug, uniqueness check, record builder, `createProject`.
- `projects.js` - `listProjects`, `readProject`, `parseProject`.
- `seed/` - the `SEO` stage-config sheet (7 stages / 20 steps) + re-seed note.

## Data in DA source

- Stage config: `docs/library/project-stages.json`.
- Project records: `projects/<slug>.json` (DA multi-sheet: `meta` + frozen
  `stages`/`steps`).
