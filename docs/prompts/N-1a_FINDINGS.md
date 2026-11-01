# N-1a — findings at the step 6 stop (RULING NOW)

Session: TIER 2, 2026-11-01. Repo gate passed: `froot/`, branch `staging`, level
with `origin/staging`, HEAD `a6a33bf`. **Nothing was built and nothing was
committed.** The prompt's step 6 says: if the current import would treat an
unedited blank row as a write, stop and report. It does.

Read at `a6a33bf`: `src/lib/nutrition-import.ts` (`planNutritionImport`),
`src/app/api/nutrition/import/apply/route.ts`, `src/lib/recipe-nutrition.ts`.
No database was queried. Every finding below comes from reading the code, not
from running it.

## F1 — an unedited row with no nutrition CREATES AN EMPTY RECORD (the stop)

The template pre-fills `basis_amount = 1` and `basis_unit = <reporting unit>` on
every row (prompt step 3). For an ingredient with no `IngredientNutrition`, the
planner sees a basis given, `not_food` blank and every nutrient blank, and
returns **`NEW`** with the detail "No nutrient values — every nutrient stays
unknown" (`nutrition-import.ts:186-196`). Apply then upserts an
`IngredientNutrition` row whose 15 nutrients are all null (`apply/route.ts:46-55`).

This is a visible change, not a harmless one. `recipe-nutrition.ts:217` decides
"missing" by whether a record EXISTS (`!ing.nutrition`). An empty record moves
the ingredient from **"No nutrition"** to **"Some values missing"** on
`/nutrition/menu`. It drops out of `missingIngredientIds`, so
`withNutritionCount` goes up for every item that uses it, and its "To fix" entry
changes kind and ranking (`recipe-nutrition.ts:283-309`). Importing the
unedited template would make every ingredient without nutrition look as if it
has nutrition.

Leaving the basis blank on those rows avoids the write, but every such row then
comes back **`INVALID`** ("basis_amount and basis_unit are required",
`:186`). That is a no-op, but it is reported as an error on most of the file.
So the current import does not support the round-trip either way.

## F2 — an unedited not-food row comes back INVALID if the basis is pre-filled

Not-food rows with any basis cell filled are rejected: "Not-food rows carry no
nutrition — clear the values or not_food" (`:171-172`). Step 3's "basis
existing, else 1 / reporting unit" therefore makes every not-food row INVALID
unless it already has a record. **This can be fixed in the template alone,
without a ruling:** leave the basis and nutrient cells blank on not-food rows.
A not-food ingredient that still has an old nutrition record from before it was
flagged would also export values and come back INVALID. That case needs a
decision: blank them, or export them and accept INVALID.

## F3 — an unedited row WITH nutrition is an UPDATE, not a no-op

`status: ing.hasNutrition ? "UPDATE" : "NEW"` (`:191`). The planner never
compares a row against the stored values. So an identical row counts as an
UPDATE in the preview summary, and apply rewrites the record, including
`updatedByUserId` and `updatedAt`. When the file has an `allergens` column,
every matched row also rewrites `Ingredient.allergens`. Blank parses to `[]`,
which matches the stored value when there are no allergens, but it is still a
write (`apply/route.ts:39-45`). One `nutrition.import.applied` audit row lists
every ingredient. The VALUES survive the round-trip, as long as the export
writes the stored numbers back out losslessly. The "zero changes" summary step
6 asks for does not.

## F4 — helper columns (step 4): the parser keeps unknown columns silently

`parseNutritionCsv` folds every header into `cells` and never checks it against
a known list. Nothing reads `category`, `reporting_unit` or `has_nutrition`, and
there is no warning (`:30-41`). So helper columns would be safely ignored.
Nothing was built, so this is noted, not acted on.

## What needs a ruling

Making an unedited template import as zero changes needs the import to change.
The prompt says not to do that without Gary. The candidate shapes:

- **A.** A row with every nutrient blank on an ingredient with no record is a
  no-op: a new `SKIP` status, or a NEW that apply does not write. That fixes F1.
- **B.** A row identical to the stored record (values, basis, source, and
  allergens where the column is present) is planned as `UNCHANGED` and not
  written. That fixes F3, and the summary then reads as zero changes.
- **C.** Ship the template without changing the import, and live with F1/F3.
  **Not recommended:** F1 corrupts the menu page's "missing" signal on the first
  unedited import.

Recommendation: A + B together, in `planNutritionImport` only. Apply already
writes only `APPLYABLE` statuses, so a non-applyable status needs no change
there. Plus F2's template-side fix. A + B changes N-1's import behaviour and
makes this a parser change, so it was left for Gary.
