# PROMO-STAMP_39b7ad2 — post-promotion stamp for the 2026-11-01 promotion — TIER 1

TIER 1: docs only, one commit on `staging`. Never commit on `main`. Never push.

Saved as `/Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/PROMO-STAMP_39b7ad2.md`.

## What happened

Gary promoted staging → main on 2026-11-01. Merge commit `39b7ad2`
(`--no-ff`), `main` moved `0ff5628..39b7ad2`, staging fast-forwarded to it.
No migration (nothing under `prisma/` changed). Carried: BUG-17 docs
(`6089816`, `4dcbe71`), BEV-1 pause (`eb01bf5`), ING-UI-1 (`8d440c3`,
`4fdc65e`, `a8dcf6b`, `c5c25dc`), BEV-1 (`95c336b`, `9a06f92`, `bbc87c8`).

Production evidence Gary gathered after deploy (Neon `br-sparkling-block`,
org `cf888f2d-f234-48c7-8097-fd5b44b5b3dd`, Keva Juice):
- Ingredients: 225 active (CSV import: Meadowood library 212 + 13 Las Brisas
  items), 8 fixture ingredients archived.
- BEV-1 applied: menu_recipes 424, prep_recipes 14 (9 imported + 5 Gary built
  by hand), sales_mapped 424.
- Staging checks before promotion: forecasting import preview from an .xlsx
  passed (F8 rider). Count weigh dialog not exercised — no storage areas
  assigned on staging; Gary waived it (no live store counts real ingredients
  yet).

## Do

Follow the post-promotion stamp pattern in
`/Users/garythomas/Claude_Projects/Froot/froot/docs/WORKFLOW.md` § 2 and the
precedent `docs/prompts/BUG-17_PROMOTION-STAMP.md`:

1. Repo gate, one command at a time: `pwd` ends in `Froot/froot` (if capital-F,
   STOP and tell Gary); `git status` on `staging`, clean, HEAD `39b7ad2`.
2. `docs/DEPLOY_LOG.md`: stamp the UNPROMOTED entries for ING-UI-1 and BEV-1
   (and the BEV-1 pause entry if one exists) as promoted in `39b7ad2` on
   2026-11-01. Keep it short — blast radius is small. Insertions/edits only to
   those entries; verify the diff.
3. `docs/ROADMAP.yaml`: ING-UI-1 and BEV-1 rows → `shipped` with the
   promotion SHA, per convention. On BEV-1, add a dated rider with the
   production evidence above and close the production blocker. Preserve-and-mark;
   nothing deleted.
4. Commit this prompt with the docs. `npm run build` must pass. One commit.

## Report and stop

SHA, files touched, diff summary. Do not push.
