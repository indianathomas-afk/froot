# N-5b follow-up — why production has 0 add-on recipes linked

Read-only investigation, 2026-11-04, on `staging` at `1bc285e`, at Gary's
request ("Yes, look into it"). No source file was edited and no database was
queried by this session for it. Production figures are Gary's.

## The contradiction

- **Gary, query A, production `br-sparkling-block-a620qvg4`, 2026-11-04:**
  595 add-ons, **0 with a recipe**, 15 on by default, 0 on by default with a
  recipe.
- **DEPLOY_LOG `3ea8112` entry, "Production evidence (Gary, as relayed,
  after promotion)", 2026-11-03:** BevSpot preview (Las Brisas file) "31
  recipes ready + 127 modifier recipes (+6 prep)"; "Gary applied **158**";
  spot checks "No Banana (add 2oz juice)" = Bananas −1.6 oz and "Add Peanut
  Butter" = +1 oz; "Menu Nutrition → Modifiers showed signed calories".

The spot checks and the Modifiers nutrition section can only show a value if
a modifier recipe exists. So on whichever branch Gary was looking at on
2026-11-03, add-on recipes existed.

## What the code rules out (read at `1bc285e`)

| Path | Can it produce "applied, then 0 linked"? | Evidence |
|---|---|---|
| BevSpot apply | **No** — writes `Recipe.squareModifierId` for every modifier recipe and marks the modifier MAPPED in one transaction; a count mismatch rolls the whole apply back (409) | `src/app/api/inventory/import/bevspot/apply/route.ts:37-70` |
| Planner input | **No** — preview and apply both call `planForOrg`, which loads live (`isDeleted: false`) modifiers | `src/lib/bevspot/import-server.ts:67-103` |
| Modifier re-sync | **No** — inserts new rows, `UPDATE`s changed ones in place (same `id`), sweeps unseen ones to `isDeleted`; never deletes a `SquareModifier` | `src/lib/square-modifier-sync.ts:130-215` |
| FK `Recipe.squareModifierId` → `SquareModifier` `ON DELETE SET NULL` | Would silently unlink — but **nothing in `src/` deletes a `SquareModifier`** (grep of `squareModifier.delete*` and raw `DELETE FROM "SquareModifier"`: no hits) | `prisma/migrations/20261103020000_n5_square_modifiers/migration.sql:79` |
| Recipe edit | **No** — `squareModifierId` is omitted from the PATCH schema ("fixed at creation") | `src/app/api/inventory/recipes/[id]/route.ts:21` |
| Recipe delete | **Yes, by hand** — deletes the recipe and resets the modifier to UNMAPPED. **Not written to AuditLog.** | `src/app/api/inventory/recipes/[id]/route.ts:272-279` |
| Undo of an import | No such route exists (only `preview`, `apply`) | `src/app/api/inventory/import/bevspot/` |

So the code offers no automatic way to lose the links. The live hypotheses
are about data and environment, not code:

- **H1 — the apply never ran on production.** The 158 may have been applied
  on staging (whose evidence came first), or what was read was the preview's
  "ready" count.
- **H2 — the apply ran in a different production org** from the one holding
  the 595 modifiers (§ Database Evidence: org names are not identifiers).
- **H3 — the apply ran with 0 modifier recipes** (e.g. before that org's
  modifier sync, so its add-on rows planned as "not one of your Square items").
- **H4 — the recipes were created, then deleted by hand** (unaudited).
- **H5 — they exist but are unlinked** — only possible via a `SquareModifier`
  delete outside the app (console SQL). Would show as recipes that look like
  modifier recipes (negative lines) with both link columns null.

## Queries for Gary (read-only, Neon console)

Run on **production**; branch identity from the server (R4). Running the same
three on **staging** (`br-square-feather-a63z92vz`) tells H1 apart.

```sql
-- 1. Every BevSpot apply ever recorded, and what it says it created
SELECT current_setting('neon.branch_id', true) AS branch_id,
       a."organizationId", a."createdAt",
       a.metadata->>'fileName'                          AS file,
       (a.metadata->>'salesRecipeCount')::int           AS sales_recipes,
       (a.metadata->>'modifierRecipeCount')::int        AS modifier_recipes,
       (a.metadata->>'subRecipeCount')::int             AS sub_recipes,
       jsonb_array_length(a.metadata->'createdRecipeIds') AS created_ids
FROM "AuditLog" a
WHERE a.action = 'bevspot.recipes.applied'
ORDER BY a."createdAt";

-- 2. Of the recipes each apply created, how many still exist, and how linked
WITH ids AS (
  SELECT a.id AS apply_id, a."createdAt",
         jsonb_array_elements_text(a.metadata->'createdRecipeIds') AS recipe_id
  FROM "AuditLog" a WHERE a.action = 'bevspot.recipes.applied'
)
SELECT current_setting('neon.branch_id', true) AS branch_id,
       ids.apply_id, ids."createdAt",
       count(*)                    AS created,
       count(r.id)                 AS still_exist,
       count(r."squareModifierId") AS linked_to_modifier,
       count(r."salesItemId")      AS linked_to_sales_item,
       count(r.id) FILTER (WHERE r."squareModifierId" IS NULL AND r."salesItemId" IS NULL) AS linked_to_neither
FROM ids LEFT JOIN "Recipe" r ON r.id = ids.recipe_id
GROUP BY ids.apply_id, ids."createdAt"
ORDER BY ids."createdAt";

-- 3. Per org: where the modifiers live vs where the recipes and applies are
SELECT current_setting('neon.branch_id', true) AS branch_id,
       o.id AS org_id, o.name,
       (SELECT count(*) FROM "SquareModifier" m WHERE m."organizationId" = o.id) AS modifiers,
       (SELECT count(*) FROM "SquareModifier" m WHERE m."organizationId" = o.id AND m."recipeStatus" = 'MAPPED') AS modifiers_mapped,
       (SELECT count(*) FROM "Recipe" r WHERE r."organizationId" = o.id AND r."squareModifierId" IS NOT NULL) AS modifier_recipes,
       (SELECT count(*) FROM "Recipe" r WHERE r."organizationId" = o.id AND r."salesItemId" IS NOT NULL) AS sales_recipes,
       (SELECT count(*) FROM "AuditLog" a WHERE a."organizationId" = o.id AND a.action = 'bevspot.recipes.applied') AS applies
FROM "Organization" o
WHERE EXISTS (SELECT 1 FROM "SquareModifier" m WHERE m."organizationId" = o.id)
   OR EXISTS (SELECT 1 FROM "AuditLog" a WHERE a."organizationId" = o.id AND a.action = 'bevspot.recipes.applied');
```

## Reading the answers

| Result | Means |
|---|---|
| Query 1 empty on production, rows on staging | **H1** — applied on staging only. Fix: run the BevSpot apply on production (preview first). |
| Query 1 row with `modifier_recipes = 0` | **H3** — fix: re-run preview + apply; already-created sales recipes are skipped, never overwritten (BEV-1). |
| Query 3: applies and modifiers in different orgs | **H2** — name both org ids; decide which org is real before re-applying. |
| Query 2: `still_exist` < `created` | **H4** — deleted by hand after the apply. |
| Query 2: `linked_to_neither` > 0 among modifier-shaped recipes | **H5** — unlinked outside the app. Would need its own ruling (relink by name is a write). |

Nothing here needs code. Every fix above is an in-app action or a ruling.
