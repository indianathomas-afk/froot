# BEV-1b — BevSpot import: prep rows that other recipes use always import as sub-recipes — TIER 2

TIER 2: one planner rule in `src/lib/bevspot/plan-import.ts` plus fixture cases.
No schema, no route or permission changes, no UI changes. Work commit, then
docs commit citing it. `npm run build` gates commits; lint does not (DEBT-33).
Never push.

Saved as `/Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/BEV-1b.md`.

## Why

Gary ran BEV-1 on production (www.usefroot.com, Keva Juice org
`cf888f2d-f234-48c7-8097-fd5b44b5b3dd`) on 2026-11-01. Applied: 424 menu
recipes + 9 prep recipes (Neon `br-sparkling-block`: menu_recipes 424,
prep_recipes 14, sales_mapped 424). The remaining "To fix" list is led by prep
rows the planner discarded, not missing data:

| Blocker | Shown as | Recipes blocked | Why (measured in chat from the export) |
|---|---|---|---|
| Cup Kit - 20oz | Needs an ingredient | 108 (now resolved by hand) | Its only definition row (export row 1766) sits in the **Unassigned** block, which F3 drops first. Gary built `Cup Kit - 20oz` by hand as a prep recipe; the planner reused it by exact name and the 108 imported. The rule below must still cover this case. |
| Juice - Carrot 1 oz | Not one of your Square items | 21 | Defined in "Juice Fresh" with a Square ID (`KY4B3YT5FCIZRISEJA4ZU6AI`) that isn't a Froot sales item, so F7 skips the row, and every recipe using it as prep skips with it. |
| Pressed Lemon | Not one of your Square items | 7 | Same pattern ("Custom Juice Recipe", `2FSETHL5…`). |
| 1oz Wheatgrass / 1oz Ginger | Not one of your Square items | 2 / 1 | Same pattern. |

Gary also hand-built prep recipes named `Juice - Carrot 1 oz`, `Pressed Lemon`,
`1oz Wheatgrass`, and `1oz Ginger`. They did NOT unblock anything: when the
export defines a prep name itself, the planner uses the export's row, skips it
for its non-Froot Square ID, and never falls back to Froot's existing prep.
31 recipes remain blocked by those four.

F3 and F7 were written about **sales-item** rows: which BevSpot row's recipe
attaches to a Square item. They were never meant to stop a row from serving
as **prep** for other recipes. That's a gap in the rulings, not a data
problem.

## The rule (Gary's ruling — record in DECISIONS.md in his words below)

> "BEV-1b: A BevSpot row that another importable recipe references as a
> sub-recipe is imported as a prep recipe (no sales item) even if it is in the
> Archived or Unassigned group, or its own Square ID isn't one of my sales
> items. F3 and F7 still decide whether that row's recipe attaches to a Square
> item; they no longer stop it being used as prep. If two rows define the same
> prep name differently, prefer the one outside Archived/Unassigned; if that
> still leaves two different definitions, skip as ambiguous (F11)."

## Phase 0 — repo gate (one command at a time, paste results)

```
pwd
```
→ must end in `Froot/froot`. If it ends in capital-F `Froot`, STOP and tell Gary.

```
git status
```
→ on `staging`, tree clean. HEAD should be the promotion stamp commit for
`39b7ad2` (PROMO-STAMP_39b7ad2). Anything uncommitted: STOP.

## Build

1. In the planner, before F3/F7 skipping removes rows from consideration as
   prep definitions, build the prep-definition index from **all** parsed rows
   (Archived and Unassigned included), with the precedence in the rule above.
   F3/F7/F6 still govern sales-item attachment exactly as today.
2. A prep row imported this way never sets a sales item's recipe and never
   changes any `SalesItem.recipeStatus`. If its own Square ID *is* a Froot
   sales item, that attachment is still decided by the existing rules,
   separately.
3. Precedence for a prep name: (1) an existing Froot prep recipe
   (`salesItemId` null, active) with the exact name is reused and never
   overwritten (F6) — this includes the five Gary built by hand on production:
   `Cup Kit - 20oz`, `Juice - Carrot 1 oz`, `Pressed Lemon`,
   `1oz Wheatgrass`, `1oz Ginger`; (2) otherwise the export's definition per
   the rule above. No duplicate prep recipe is ever created for a name Froot
   already has.
4. Fixture `scripts/verify-bev1-import.ts`: add cases for (e) an existing
   Froot prep with the same name as an export-defined prep row that has a
   non-Froot Square ID → existing prep reused, dependents import, no new prep
   created, plus (a) a prep row only
   in Unassigned used by a sales item → imports, (b) a prep row with a
   non-Froot Square ID used by a sales item → imports as prep, and its own row
   still reports NOT_IN_SQUARE for attachment, (c) the same prep name in
   Archived and in an active group with different lines → active wins,
   (d) two active rows defining the same prep name differently → ambiguous
   skip. All existing cases must still pass.
5. Throwaway read-only run (`/tmp`, nothing written, no DB) of the planner over
   `/Users/garythomas/Downloads/Keva_Las_Brisas_#14_sales_items_2026-10-31.xlsx`
   with an ingredient list built from the two CSVs Gary imported:
   `/Users/garythomas/Downloads/Keva_Meadowood_ingredients_FROOT_IMPORT.csv` and
   `/Users/garythomas/Downloads/Keva_LasBrisas_13_missing_ingredients_FROOT_IMPORT.csv`.
   If either CSV isn't there, skip this step and say so. Sales items aren't
   available offline, so report only: how many prep definitions are now
   available that weren't before, and confirm Cup Kit - 20oz, Juice - Carrot
   1 oz, Pressed Lemon, 1oz Wheatgrass, and 1oz Ginger each resolve (treat the
   five as existing Froot preps for this run).

## Commits

1. Work commit: planner + fixture only. Stage only those files.
2. Docs commit citing the work SHA: `docs/DECISIONS.md` entry with Gary's
   words above marked DRAFT (ratified at PRE-PUSH-CHECK); ROADMAP row
   `BEV-1b` (read the file for the convention and next free ids; never
   assume); this prompt committed.

## Report and stop

Work SHA, docs SHA, files touched, fixture result (count), the step 5 numbers,
`npm run build` result. Do not push.
