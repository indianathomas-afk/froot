# N-1a — Nutrition "Download template" (round-trip CSV) — TIER 2

TIER 2: one new ADMIN read route + a button on the Import Nutrition page. No
schema, no permission changes (reuses `nutrition.manage`). Work commit, then
docs commit citing it. `npm run build` gates commits; lint does not (DEBT-33).
Never push.

Saved as `/Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/N-1a.md`.

## Why

N-1 is confirmed on staging (2026-11-01, Keva Juice (staging) org
`cmr54z65v000105jxczpt72w1`): Liquid Olympian Smoothie (M) computed 395 kcal,
102 g carbs, 78.8 g sugars, 38.3 g added sugars, 8.8 g fiber, 3.9 g protein,
0.5 g fat — matching chat's hand math line by line; vitamin D / calcium / iron
/ potassium shown as dashes (blank in the file, never zero); Cup Kit - 24oz
contributed 0 and showed OK (cups/lids/straws marked not food).

Gary's request: rather than typing ingredient names into a nutrition CSV, he
wants to **export the ingredient list as the import template**, fill in the
numbers, and import it back — every name, brand and unit exact, so nothing is
skipped as "no matching ingredient". N-1a ships with N-1 in the same
promotion.

## Phase 0 — repo gate (one command at a time)

`pwd` ends in `Froot/froot` (capital-F: STOP and tell Gary). `git status`: on
`staging`, clean apart from untracked prompts. HEAD `a6a33bf` (N-1
PRE-PUSH-CHECK) or later. `git log --oneline -3`.

## Build

1. **Route** `GET /api/nutrition/template` — ADMIN (`nutrition.manage`), both
   modules (same gate as the import). Returns a CSV download
   (`Content-Disposition: attachment; filename="froot-nutrition-template-<org-slug>-<YYYY-MM-DD>.csv"`).
2. **Rows:** every active, non-deleted, non-archived ingredient in the org,
   excluding PREPARED ingredients (they take nutrition from their recipe —
   N-1 implementation choice). Sorted by category, then display name.
3. **Columns:** exactly the import's columns in the import's order
   (`name, brand, basis_amount, basis_unit, calories, … , allergens, not_food,
   source`), so the file imports back with no editing of headers. Pre-fill:
   - `name`, `brand` exactly as stored (the import's matcher must resolve
     every exported row to its own ingredient — assert this in the fixture).
   - `basis_unit`: the ingredient's existing nutrition basis unit if it has a
     record, else its reporting unit. `basis_amount`: existing, else `1`.
   - Nutrients, `allergens` (`; `-separated, the import's spelling),
     `not_food` (`yes` when flagged, else blank), `source`: existing values,
     else blank. Blank stays blank — never `0`.
4. **Helper columns** (category, reporting unit, a "has nutrition" yes/no) only
   if the import parser already ignores unknown columns. Check the parser; if
   it rejects or warns on unknown columns, leave helpers out and say so. Do not
   change the parser in this session.
5. **Button** on `/nutrition/import`: "Download template" beside "Choose file",
   with one line of copy: "Starts with all your ingredients — fill in the
   numbers and import it back."
6. **Round-trip safety:** importing an unedited template must produce zero
   changes — rows with existing nutrition come back identical, rows without
   nutrition come back as no-ops (no empty records created), not-food rows
   unchanged. If the current import would treat an unedited blank row as a
   write (e.g. create an empty record, or replace a record with blanks), STOP
   and report — RULING NOW, do not change import behaviour without Gary.
7. **Fixture** `scripts/verify-n1a-template.ts` (pure where possible):
   brand+name ingredient, no-brand ingredient, ingredient with full nutrition,
   with partial nutrition (blanks preserved), not-food, PREPARED excluded,
   allergens round-trip; and template → import parser → matcher resolves every
   row to the same ingredient id with no UPDATE/NEW for the unedited file.

## Commits

1. Work commit (route, button, fixture). Stage only touched files. Add the
   route to `docs/PERMISSIONS_INVENTORY.md` in the same commit.
2. Docs commit citing the work SHA: ROADMAP row `N-1a` (read the file for the
   convention and next free ids), this prompt committed.

## Report and stop

Work SHA, docs SHA, files touched, whether helper columns were included and
why, fixture result, the round-trip result. Do not push.
