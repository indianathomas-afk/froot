TIER 2 — contained (escalate to TIER 3 and STOP if the audit finds a schema, API-permission, or shared-data change is needed)

# TAB-13 — Tablet Home: checklist switcher on the hero (Design Option 1)

> TAB-12 already exists, so this is TAB-13. Before anything else, confirm TAB-13 is free in `docs/ROADMAP.yaml`. If it is taken too, use the next free id and rename this file to match.

## Why

On the tablet Home screen, the big checklist card (the "hero") shows only one checklist, and the app picks which one. Staff can't see that other checklists are waiting. Example from Carson, 2026-11-11: Home showed CLEANING while MID-SHIFT was also not started. Staff had no way to know Mid-Shift existed without leaving Home.

Option 1 adds a row of tabs above the hero, one tab per checklist for today:

- The app still auto-picks the most urgent checklist, so there is still one obvious thing to do.
- The other checklists are one tap away.
- Each checklist type gets its own color and icon, so staff recognize it at a glance.

## Design source

The attached PDF, "Froot Tablet — Checklists", is the source of truth for the look. Use only these two boards:

- **"Home · Option 1 — Switcher on the hero"**: what to build.
- **"Checklist type key"**: the color and icon map.

Ignore the other boards:

- "Home · Option 2" was not chosen.
- Both "Checklists ·" boards are a later phase. Do not touch the Checklists page in this session.

The mock is drawn at 1194×834 (iPad landscape). If the existing tablet hero uses a different scale, keep the existing scale. Match the mock's hierarchy and proportions, not its raw px values.

## Standing rules (CLAUDE.md wins on any conflict)

- **Repo:** the root is `~/Claude_Projects/Froot/froot` (lowercase). The capital-F parent is not the repo.
- **Branch and scope:** work on staging. One phase per session, no riders.
- **Verify everything:** treat every claim in this prompt and in the ROADMAP as unverified until you re-check it at file:line.
- **Gates:** audit first. At each STOP gate, wait for Gdogg's "go".
- **Causes:** before writing any causal explanation, state the evidence that would disprove it.
- **DB evidence:** any DB result must show the Neon branch column in the same output.
  - Branches: dev `br-broad-wave`, staging `br-square-feather`, production `br-sparkling-block`.
  - Never query the preview/main fossil branch.
  - No `vercel env pull`.
- **Browser evidence:** browser observations must name the org id (`org_3G02wO4QlVVSWppi8aqlnSZnsDa`) and the Clerk instance (`verified-snapper-7`), captured before testing.
- **Commits:**
  - Always run `npm run build && git commit` chained; lint does not gate.
  - Two-commit pattern: the work first, then docs citing the work SHA.
  - Commit only when asked. Never push; Gdogg runs all pushes.
- **Desktop untouched:** tablet mode only. Desktop Home must look and behave exactly as it does now.
- **Reports:** every STOP report opens with a 3–5 line plain-English summary before the technical detail.

## Proposed rulings (ratify, amend, or strike at Gate 1)

**R1 — Scope.** Tablet-mode Home only: the hero and the new tab row. Out of scope:

- the Checklists page
- the Messages panel
- the stats row
- the sidebar
- the overdue banner
- desktop mode
- any schema change

**R2 — Which checklists get a tab.** Every checklist the current user can already see for the selected store today, using the same visibility rule the Checklists page uses. No new permission logic. Completed checklists stay in the row, at the end.

**R3 — Auto-pick.** Runs on load and whenever the store changes, in this order:

1. In progress.
2. Not started with a due time, earliest due first.
3. Not started with no due time.
4. Completed.

Ties keep the existing order. Tapping a tab only changes local UI state: no URL change, no saving, no refetch. The selection resets to auto-pick on reload or store change.

**R4 — Type map.** Put it in one shared module, because the Checklists page phase will reuse it.

| Type | Fill | Ink | Icon |
|---|---|---|---|
| Opener | `--color-amber-400` | `--color-amber-950` | sunrise |
| Mid-Shift | `--color-primary` | white | sun |
| Cleaning | `--color-cal-cleaning` | white | sparkles |
| Closing | `--color-cal-ordering` | white | moon |
| Management | `--color-slate-800` | white | briefcase |
| Anything else | `--color-cal-other` | white | clipboard-check |

Key the match on the structured type/category field the audit finds (case-insensitive), not on parsing the checklist's display name. If no structured field exists, that is a **RULING NOW**.

**R5 — Hero.**

- **Color:** it takes the selected type's fill and ink instead of always being orange.
- **Title:** the type name only: "MID-SHIFT", not "MID-SHIFT CHECKLIST".
- **Body:** task count and status, plus an "X of Y done" progress bar.
- **Chips:** the existing Due chip when there is a due time; a "Completed" chip when the checklist is done.
- **Button:** reads Start, Continue or View. It goes where the current Start button goes; View opens the existing read-only view.

**R6 — Tab row.**

- **Tab contents:** a type icon chip, the type name (uppercase, bold), and "X of Y" or "Done".
- **Selected state:** the selected tab is filled with its type color. The others use the card background with a border.
- **One checklist today:** no tab row; the hero looks as it does now.
- **No checklists:** the existing empty state, unchanged.
- **More than 4:** the row scrolls sideways. No wrapping and no shrinking text.

**R7 — Icons and colors.** Use the project's existing icon library (expected to be lucide-react; verify) and the existing `--color-*` tokens. No new dependencies and no raw hex.

**R8 — Accessibility.**

- Tabs use `role="tablist"` / `role="tab"` with `aria-selected`.
- Touch targets are at least 44px; the mock's tabs are 84px.
- White text on orange or teal passes only as large text (24px+, or 19px+ bold).
- The mock's 15px sub-text on a filled tab ("12 of 31") fails contrast. On a filled tab, make it at least 19px bold.

## Gate 0 — Preflight (read-only)

- Confirm the repo root, branch = staging, a clean working tree, and the next free TAB id.
- Read CLAUDE.md, plus TAB-11's ROADMAP notes and DECISIONS entries, to learn how tablet mode is detected and where tablet components live.

## Gate 1 — Audit (read-only) → STOP

Report with file:line:

a. **The current pick.** Find the tablet Home hero component and exactly how it picks today's single checklist. Explain the Carson case (why Cleaning was shown over Mid-Shift), stating disconfirming evidence first.
b. **The data source.** Where the hero's data comes from. Does that source already return all of today's checklists for the store, with status, task count, done count and due time? If not, what does the Checklists page use, and can Home reuse it without new queries?
c. **The type field.** The checklist type field (model, column or enum) and the values actually in use. Any DB evidence must come from the staging branch, with the branch column shown.
d. **Icons and tokens.** The icon library and how tablet components use the tokens.
e. **Navigation.** Where Start currently navigates, and the View route for completed checklists.
f. **The plan.** A file-by-file change plan, where the shared type-map module will live, and any RULING NOW items.

**STOP.** Wait for "go" and for R1–R8 to be ratified.

## Gate 2 — Build

Implement the approved plan only. Match the PDF's Option 1 board for hierarchy, colors, spacing, radii and type weights.

## Gate 3 — Verify → STOP

Run `npm run build` and confirm it passes.

Then run these browser checks in tablet mode, naming the org id and Clerk instance first:

1. **Tab order:** in a store with several checklists today (Carson, if the data allows), tabs appear in R3 order and the most urgent is selected on load.
2. **Switching:** tapping each tab swaps the hero's color, icon, name, counts and button label, with no navigation and no network request. Confirm in the Network tab.
3. **Button target:** the hero button opens the right checklist for each state: Start, Continue and View.
4. **Store switch:** switching stores in the header resets the selection to auto-pick.
5. **Edge counts:** a store with one checklist shows no tab row; a store with none shows the existing empty state, unchanged.
6. **Unmapped type:** a type not in the map renders gray with the clipboard-check icon.
7. **Desktop:** desktop-mode Home is unchanged. Show before and after screenshots side by side.
8. **Portrait:** in portrait tablet, the tab row and hero still fit with no clipped type names. Report what you see; don't redesign.

Report the results with screenshots. **STOP.**

## Gate 4 — Commit (only when Gdogg says "commit")

- **Commit 1:** the work, via `npm run build && git commit`.
- **Commit 2:** the docs, citing the commit-1 SHA:
  - a ROADMAP entry for this TAB id (status: staged, not promoted)
  - DECISIONS entries for the ratified rulings
  - a note that the type map is ready for the Checklists page phase
- Do not push.
