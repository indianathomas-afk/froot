# STAMP-bdbeb47-317ce2c — promotion stamps for N-1/N-1a and N-1b, plus two small fixes — TIER 1

TIER 1: two promotion stamps (docs) and two cosmetic/no-behaviour code fixes.
Two commits: work (the two fixes), then docs (stamps + this prompt) citing the
work SHA. `npm run build` gates commits. Never commit on `main`. Never push.

Saved as `/Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/STAMP-bdbeb47-317ce2c.md`.

## Repo gate (one command at a time)

`pwd` ends in `Froot/froot` (capital-F: STOP and tell Gary). `git status`: on
`staging`, clean apart from untracked prompts. HEAD `317ce2c`.
`git log --oneline -3`.

## 1. Fix — count-sheet heading spacing

On the count sheet's unassigned-ingredients banner the **rendered** heading
reads "225 ingredientscan't be counted yet" (seen in Gary's screenshot,
2026-11-01). STAMP-62b9d86 found the space present in source and compiled
output (`draft-counting.tsx:742`, same pattern at `storage-areas-client.tsx:154`)
and committed no fix. Likely cause: the heading's parent is a flex container,
so the count and the text render as separate flex items and the leading space
collapses. Fix by rendering the whole sentence as **one** text node/element
(e.g. a single template string inside one `<span>`), in both places. No other
change to either component. Note in the report what the parent's display was.

## 2. Fix — unused import lint warning

N-1a's fixture `scripts/verify-n1a-template.ts` has an unused `Allergen`
import that went into `b0bc473` with a lint warning. Remove it. Run that
fixture afterwards — it must still pass 25/25.

## 3. Promotion stamps (docs commit)

Follow `docs/WORKFLOW.md` § 2 and `docs/prompts/STAMP-62b9d86.md` as the
pattern. Stamp each UNPROMOTED DEPLOY_LOG entry; move ROADMAP rows to
`shipped` with the promotion SHA and a dated rider carrying the evidence.
Keep it short. Preserve-and-mark. Read the files for conventions — never
assume.

**Promotion `bdbeb47`** (2026-11-01, `--no-ff`, main `62b9d86..bdbeb47`,
staging fast-forwarded). Carried `8e37495` (62b9d86 stamp), N-1 (`70baf2f`,
`2c2c0fa`, `a6a33bf`), N-1a (`b0bc473`, `bc3d621`, `b143e5f`). Migration
`20261101210000_n1_ingredient_nutrition`: production `finished_at`
2026-11-01 23:49:42 UTC (Neon `br-sparkling-block-a620qvg4`). Then Gary turned
the nutrition module on for Keva org `cf888f2d-f234-48c7-8097-fd5b44b5b3dd`
(`activeModules` now `{inventory,hr,labor,nutrition}`, branch literal in the
same output). Staging evidence before promotion: Liquid Olympian Smoothie (M)
computed 395 kcal / 102 g carb / 78.8 g sugars, matching hand math; unedited
N-1a template re-imported as 0 ready / 225 unchanged. → N-1 and N-1a rows
`shipped`.

**Promotion `317ce2c`** (2026-11-01, `--no-ff`, main `bdbeb47..317ce2c`,
staging fast-forwarded). Carried N-1b (`0962d72`, `50ef062`, `2979f1c`).
Migration `20261101230000_n1b_nutrition_proof`: production `finished_at`
2026-11-02 02:49:41 UTC (`br-sparkling-block-a620qvg4`). Staging evidence:
label upload, view, Mark verified, "Still verified?" → Estimated, and the
"N of M items verified" line all worked. Production evidence: Gary imported
planning chat's estimated nutrition file for Keva (all records Estimated), then
verified **Almond Milk** against the Almond Breeze Original spec sheet
(04/04/23) — label numbers entered per 8 fl. oz, PDF uploaded, link saved,
Verified by gary@kevajuice.com. → N-1b row `shipped`.

## Commits, report, stop

Work commit (two fixes), then docs commit (stamps + this prompt) citing it.
`npm run build` passes before each. Report both SHAs, files touched, the
fixture result, and what the banner's parent display was. Do not push.
