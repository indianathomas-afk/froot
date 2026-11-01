# STAMP-62b9d86 — promotion stamp for BEV-1b + count-sheet typo — TIER 1

TIER 1: docs stamp plus a one-string copy fix. One commit on `staging`. Never
commit on `main`. Never push.

Saved as `/Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/STAMP-62b9d86.md`.

## Repo gate (one command at a time)

`pwd` ends in `Froot/froot` (capital-F: STOP and tell Gary). `git status`: on
`staging`, clean apart from untracked prompts in `docs/prompts/`, HEAD
`62b9d86`.

## 1. Promotion stamp

Gary promoted on 2026-11-01: merge `62b9d86` (`--no-ff`), main
`39b7ad2..62b9d86`, staging fast-forwarded. Carried `690c994` (39b7ad2 stamp),
`d876146` + `376440a` (BEV-1b), `a82bf18` (BEV-1b PRE-PUSH-CHECK). No
migration.

Production evidence (Neon `br-sparkling-block`, org
`cf888f2d-f234-48c7-8097-fd5b44b5b3dd`): after BEV-1b the Las Brisas preview
showed 30 recipes ready and no new prep recipes; Gary applied them
(424 → 454 menu recipes expected). Remaining skips are hand fixes (27 BevSpot
duplicates, 15 whole-package, 3 missing ingredients, 2 All That Razz) and 491
Square modifiers (the N-5 row).

Follow `docs/WORKFLOW.md` § 2 and `docs/prompts/PROMO-STAMP_39b7ad2.md` as the
pattern: stamp the UNPROMOTED DEPLOY_LOG entry for BEV-1b as promoted in
`62b9d86`; BEV-1b ROADMAP row → `shipped` with the SHA and a dated rider with
the evidence above. Keep it short. Preserve-and-mark.

## 2. Copy fix

On the count sheet's unassigned-ingredients banner the text reads
"225 ingredientscan't be counted yet" — missing space. Find the string
(`src/app/(app)/inventory/counts/`) and fix the spacing, including the
singular case if there is one. Nothing else.

## Commit, report, stop

One commit (docs + the one-line fix + this prompt). `npm run build` must pass.
Report the SHA and files touched. Do not push.
