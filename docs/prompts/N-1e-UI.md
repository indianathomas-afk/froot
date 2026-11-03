# N-1e-UI — Label inbox: searchable ingredient picker — TIER 2

TIER 2: one UI component change on the label inbox; no schema, no routes, no
permission changes. One work commit, one docs commit citing it. `npm run build`
gates commits. Never push.

Saved as `/Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/N-1e-UI.md`.

## Why

Gary's staging test of N-1e (2026-11-03, `/nutrition/labels`): the inbox works,
but the per-row **"Pick the ingredient…"** picker
- **can't be typed into** — with ~225 ingredients he has to scroll the whole
  list to find one; and
- **opens a list he can't scroll upward with the mouse** — the open list is
  cut off at the top of the window (it opened upward and clipped).

Matching is the step every file needs, so this blocks the batch workflow.

## Phase 0 — repo gate (one command at a time)

`pwd` ends in `Froot/froot` (capital-F: STOP and tell Gary). `git status`: on
`staging`, clean apart from untracked prompts. HEAD should be the N-1e
PRE-PUSH-CHECK commit `bb26400` or later. `git log --oneline -3`.

## Build

1. Replace the inbox row's ingredient picker with a **searchable combobox**:
   type to filter (case- and accent-insensitive, matching brand + name and
   name alone, the same display name the rest of Nutrition uses), arrow keys +
   Enter to choose, Escape to close. **Reuse** an existing searchable picker if
   the app has one (the recipe editor's "Search ingredients and sub-recipes…"
   is the obvious candidate) rather than writing a second one; say which you
   reused.
2. The open list has a **max height with its own scroll**, stays inside the
   viewport (opens downward, or flips upward only when there isn't room below,
   and never clips off-screen), and scrolls with the mouse wheel/trackpad.
3. Keep today's behaviour: the suggestion stays a suggestion (never assigned
   without Confirm), PREPARED and not-food ingredients stay excluded exactly as
   they are now, and Confirm is still required.
4. Same picker in the review queue card if the queue has an ingredient
   selector too.
5. No other changes.

## Check

- Run `npx tsx scripts/verify-n1e.ts` (must still pass 84/84) and
  `npm run build`.
- If a local dev check is possible without signing in, render the picker on a
  temporary page with sample ingredients and confirm typing filters and the
  list scrolls; delete the temp page before committing. Otherwise say so —
  the staging pass will cover it.

## Commits

Work commit (picker only; stage only touched files). Docs commit citing it: a
dated rider on the N-1e ROADMAP row ("inbox picker made searchable; list scroll
fixed — from Gary's staging test 2026-11-03"), and this prompt. No DECISIONS
entry (no ruling).

## Report and stop

Work SHA, docs SHA, files touched, which picker was reused, fixture + build
results. Do not push.
