Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/TAB-3.md and run it.

# TAB-3 — Display settings: Dashboard and Tablet card picker

**TIER 3.** Declare the tier before writing anything. This phase adds a schema change and one settings route. The session runs **audit, then STOP**: Phase 1 is read-only and ends with a written audit. Nothing is built until Gary gives the go.

## 0. Repo gate

1. Confirm the working directory is the git root `/Users/garythomas/Claude_Projects/Froot/froot` (lowercase `froot`).
2. Confirm the branch is `staging`, the tree is clean, and `origin/staging` includes TAB-2b's PRE-PUSH-CHECK commit.
3. Paste `git log --oneline -5`.

If any check fails, STOP and report. `docs/prompts/TAB-3.md` is expected to be untracked; leave it unstaged for PRE-PUSH-CHECK.

## 1. Context

Tablet mode (TAB-1 through TAB-2b) is on staging and verified. **None of it is promoted, and none of it will be until the series is finished (Gary, 2026-11-10).** This phase gives ADMIN control over which cards appear, and in what order, on the desktop dashboard and in Tablet mode. It also builds the tablet stat strip, which was moved here from TAB-2.

**Design reference:** `/Users/garythomas/Claude_Projects/Froot/froot_docs/design/Froot Tablet Mode.pdf`. Use the two Settings artboards (the Tablet tab and the Dashboard tab) for the list style. The live preview shown in the design is out of scope.

**Gary's rulings, 2026-11-10** (he answered "yes to all" to these leans):

1. **Where.** A new **Display** sub-page at `/settings/display`, ADMIN only, following the `/settings/labor` and `/settings/notifications` sub-page pattern. A link card goes on `/settings`. The page has two tabs: **Dashboard** and **Tablet**.
2. **Storage.** One layout per org (TAB-1 ruling 3), stored on the organization. An empty or absent layout means today's defaults, so nothing changes for anyone until an ADMIN edits the layout.
3. **Dashboard tab.**
   - Every current desktop dashboard card gets an on/off toggle and a position.
   - Cards keep their current widths and flow in the chosen order.
   - No card is locked on desktop, but at least one card must stay on.
4. **Tablet tab.**
   - Tasks and Messages are locked on and fixed as the two main columns, with Tasks on the left. (This simplifies TAB-1 ruling 5, which allowed them to be reordered.)
   - Below the two columns sits the slim **stat strip**. Its optional tiles are Sales, Monthly Goal and Labor %. Each tile has a toggle and an order, and all of them are off by default.
5. **Permissions still apply.** Turning a card on never shows it to someone who can't see it today, on either surface.
6. **Reordering.**
   - Up and down arrow buttons on each row, at touch size. No new dependency.
   - If the repo already has a drag-and-drop library, add drag handles as well.
7. **Reset.** A "Reset to defaults" button on each tab, with a confirmation step.
8. **No live preview in v1.** File a ROW for it.

## 2. Phase 1: audit (read-only), then STOP

Write `docs/prompts/TAB-3_AUDIT.md` covering each point below, then STOP and report. Do not build anything, and do not generate a migration.

1. **Card inventory (desktop).** List every card `/dashboard` renders today, in its current order. For each card give:
   - a proposed stable key, for example `sales-performance`
   - the component and its width or grid span
   - the data it fetches
   - any role, capability or module gate that hides it today

   Flag any card whose layout would break if it moved, for example paired half-width cards.
2. **Tablet tiles.** For Sales, Monthly Goal and Labor %, identify which existing endpoint and which existing figure each tile would show, matching the desktop numbers. Give each tile's permission gate. If a tile would need a new endpoint, say so (that's a STOP item).
3. **Settings sub-page pattern.** How `/settings/labor` and `/settings/notifications` are built: the layout, the ADMIN gate, the save route shape (for example `PUT /api/pace-alerts/settings`), and how the link card on `/settings` is added.
4. **Organization model.** Its current fields, and a proposed schema. Lean: two nullable JSON columns, `Organization.dashboardLayout Json?` and `Organization.tabletLayout Json?`. Each holds an ordered array of `{ key, enabled }`. Null means use the defaults. Give the alternative, a separate table, only if JSON is unsuitable here.
5. **Unknown and new keys.** Propose the merge rule for a saved layout that doesn't match the current card list. Lean:
   - unknown keys are dropped
   - a card added to Froot later, and missing from a saved layout, appears in its default position with its default state
   - on the Tablet layout, locked keys are forced on
6. **Validation.** Server-side rules for the save route:
   - ADMIN only
   - known keys only
   - at least one desktop card enabled
   - Tasks and Messages cannot be disabled on Tablet
7. **Drag and drop.** Whether any drag-and-drop library is already a dependency.
8. **Desktop render path.** Where `dashboard-client.tsx` decides card order today, and the smallest change that makes it follow the layout without changing anything when the layout is null.

**STOP after writing the audit.** Report the forks with your lean on each. Gary rules in chat and comes back with the go.

## 3. Phase 2: build (only after Gary's go)

1. **Schema.** Generate the migration with `prisma migrate diff` only. **The migration rule from CLAUDE.md applies.** After generating the migration file, STOP. Make no commit until Gary has applied it to dev himself and the fixture has run. Never run `migrate dev`, `migrate deploy`, `migrate reset` or `db execute`.
2. **Layout module.** A pure module, for example `src/lib/display-layout.ts`, holding:
   - the card registry (keys, defaults, locked flags, the surface each card belongs to)
   - the merge rule
   - the validation rules

   Add a `scripts/verify-tab3-layout.ts` characterization fixture covering:
   - null gives today's defaults
   - reorder
   - disable
   - an unknown key is dropped
   - a new key is appended at its default
   - locked keys stay forced on
   - a payload with zero desktop cards enabled is refused
   - a non-ADMIN save is refused
3. **Settings page.** `/settings/display`, ADMIN only, with Dashboard and Tablet tabs:
   - rows with a toggle and touch-size up/down buttons, plus drag handles only if audit point 7 found a library
   - locked rows shown as locked
   - "Reset to defaults" with a confirmation
   - a link card on `/settings`
4. **Save route.** One route, following the shape audit point 3 found, applying the validation from audit point 6.
5. **Desktop dashboard.** Follows `dashboardLayout`, with permissions unchanged. A null layout must render exactly as today.
6. **Tablet stat strip.** Below the two columns, render the enabled tiles in their saved order, as compact touch-legible tiles using the existing data. Each tile is permission-gated. If no tile is enabled, the strip doesn't render. The strip refreshes on the same visibility-aware timer as the Messages column (TAB-2 ruling 8), so it doesn't go stale on a tablet that's left open.
7. **Checks.**
   - Re-run all fixtures: `verify-tab1-today` 13/13, `verify-tab1c-due-chip` 11/11, `verify-tab2-messages` 23/23, plus the new one.
   - Build and scoped eslint green.
   - A temporary mocked local page for the settings page, the desktop order and the strip, deleted before committing.

## 4. Rules

- TIER 3. The migration STOP rule applies.
- No new dependencies.
- Stage only the files this session touches. Commit, never push.

## 5. Commits (Phase 2)

1. **Work commit**, which includes the migration file.
2. **Docs commit:**
   - **`docs/ROADMAP.yaml`:**
     - the TAB-3 row at the status the file's conventions give a phase that's built but not yet checked
     - a ROW for the live preview (ruling 8)
     - a dated rider on the TAB-1 row recording that ruling 4 here simplifies TAB-1 ruling 5
     - preserve and mark, delete nothing
   - **`docs/DECISIONS.md`:** a DRAFT TAB-3 entry with rulings 1–8, citing Gary's "yes to all", plus the merge rule, the validation rules and any judgement calls, for ratification at PRE-PUSH-CHECK.
   - **`docs/MIGRATIONS.md`:** the new migration, per the file's convention.

## 6. Report

- **After Phase 1:** the audit file path, the card inventory, the proposed schema, and the forks with your leans. Then STOP.
- **After Phase 2:**
  - the tier and both SHAs
  - the migration name, and its exact `prisma migrate diff` command, verbatim
  - the files touched
  - FIX NOW / RULING NOW / COMMENT / ROW findings
  - the staging test list below, unchanged

**Staging test list (Gary, after push):**

1. As `indianathomas`, before touching anything: the desktop dashboard and Tablet mode look exactly as they did before TAB-3.
2. Open `/settings` → Display. The Dashboard and Tablet tabs both load. Sign in as Tommy and confirm `/settings/display` is refused.
3. **Dashboard tab:**
   - Turn off one card and move another up two places, then save.
   - The desktop dashboard reflects both changes, and they persist across a reload.
   - Try to turn every card off. The page refuses.
4. **Tablet tab:**
   - Tasks and Messages show as locked.
   - Turn on Sales and Labor %, put Labor % first, and save.
   - Tablet mode shows the strip with Labor %, then Sales, below the columns.
5. **Permissions:** as Tommy in Tablet mode, the strip shows only the tiles his role could already see on desktop.
6. **Reset to defaults** on each tab, after confirming, returns everything to how it looked in test 1.
