Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/STAFF_terminated_toggle_sort.md and follow it.

# STAFF — hide terminated by default + per-store sort on /staff

**TIER 2** — contained UI change on one page. No schema, no migration, no new API route unless the audit proves one is needed (if so, STOP and report before building).

Declare the tier before writing anything.

## Repo gate

1. Confirm you are in `/Users/garythomas/Claude_Projects/Froot/froot` (lowercase), on branch `staging`, tree clean. If not, STOP and report.
2. Read `/Users/garythomas/Claude_Projects/Froot/froot/CLAUDE.md` and `/Users/garythomas/Claude_Projects/Froot/froot/docs/ROADMAP.yaml`. Pick the next free `STAFF-n` id by reading the file (never assume). Use it as this phase's id everywhere below.

## What Gary wants

The `/staff` page shows every staff member per store card, including terminated ones. As turnover grows, terminated people clutter the list.

1. **Terminated hidden by default.** Each store card shows active staff only.
2. **"Show terminated" toggle** in the store card header (top right, where Gary's mockup puts it). ADMIN and MANAGER only.
3. **Sort control** in each store card header: Name, Pay, Compliance.

## Brief audit (report in a few lines, no separate file)

- Path(s) of the `/staff` page and its store card / row components.
- How "terminated" is determined today (field, status, HR-15b rehire state) — use the same source as the existing red "Terminated" badge so the two can never disagree.
- Is the list server-rendered or client-fetched? Which roles can open `/staff` today?
- How pay visibility is decided (COMP-1 compensation confidentiality) — when does a viewer see `$/hr` vs `—`?
- How the SELF-1 "You" pin is applied.

If anything here contradicts the rulings below, STOP and report before building.

## Rulings to build to (draft — Gary ratifies at PRE-PUSH-CHECK)

1. **Default hidden.** Terminated staff are not shown on load, for every role.
2. **Toggle is per store card, not remembered.** Plain component state; reload returns to hidden. Label: `Show terminated (N)` / `Hide terminated`. The button only renders when that store has at least one terminated member and the viewer is ADMIN or MANAGER.
3. **Other roles never receive terminated rows.** If any role other than ADMIN/MANAGER can open `/staff`, filter terminated out on the server for them — don't ship hidden rows to a browser that has no way to show them.
4. **Header count = active.** `12 team members` normally; when terminated exist and the viewer can toggle: `12 team members · 3 terminated`.
5. **Sort per card**, a small shadcn Select (`Sort: Name`) plus a direction arrow button. Choosing an option applies its default direction; clicking the arrow flips it. Not remembered across reloads.
   - Name: A→Z on Display Name (case-insensitive, `localeCompare`).
   - Pay: high→low.
   - Compliance: low→high (worst first — who needs attention).
   - Blanks (`—`) always sort last in either direction.
6. **Pay sort respects confidentiality.** The Pay option appears only if the viewer can see pay for that store's rows. Sorting by a hidden number leaks it through row order.
7. **"You" pin stays on top** regardless of sort.
8. **When terminated are shown,** they sort among themselves by the same key and sit below all active rows. Existing badges and the delete action unchanged.
9. **Empty state:** a store with zero active staff shows `No active team members` in the card (plus the toggle if terminated exist).

## Build

- Touch only the `/staff` page and its card/row components (plus a server query filter if ruling 3 requires it).
- No new dependencies. Reuse existing shadcn Select/Button.
- Mobile: header controls wrap under the store name on narrow widths — Neesha uses this page on her phone.
- `npm run lint` and `npm run build` green.

## Commits (commit only, never push)

Stage only the files you touched — no `git add -A`.

1. Work commit: `STAFF-n: hide terminated by default, per-store sort on /staff`
2. Docs commit: ROADMAP row for STAFF-n (`status: in_progress`, commits array), and the draft rulings above appended to `/Users/garythomas/Claude_Projects/Froot/froot/docs/DECISIONS.md` marked **DRAFT — awaiting Gary's ratification**.

## Report

- Tier, phase id, audit findings, files changed, both SHAs, lint/build result, any out-of-scope findings classified FIX NOW / RULING NOW / COMMENT / ROW.
- Staging test plan (Gary tests after push, not locally):
  1. `indianathomas` (ADMIN) on `/staff`, Carson card: Aaliyah Rose, Evelyn Serpa, Kaitlyn Jimmy gone; header reads `12 team members · 3 terminated`; toggle shows them at the bottom; reload hides them again.
  2. Sort Name / Pay / Compliance and flip each; blanks stay last; "You" pin stays top.
  3. Tommy as MANAGER: toggle visible on his assigned stores; Pay option present or absent per his pay visibility.
  4. Tommy as STORE and as STAFF (if they can open `/staff`): no toggle, no terminated rows, and the network response contains none.
  5. Phone width: header controls wrap cleanly.
