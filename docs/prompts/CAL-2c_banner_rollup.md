TIER 2 session. Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/CAL-2c_banner_rollup.md and execute it. Repo gate first, one command at a time. Stop where it says stop.

# CAL-2c — Calendar due banner: rollup (collapse / expand) — TIER 2

Contained UI change to one client component. No schema, no capability, no
cron, no new dependency. One work commit, one docs commit citing the work
SHA. You never push. No `&&` chains. Scope `git add` to the files you touch.

**Created:** 2026-09-20 (planning chat)

## Repo gate
`pwd` must be `/Users/garythomas/Claude_Projects/Froot/froot`. `git status`:
on `staging`, clean, up to date with `origin/staging`. `git log --oneline -3`
must show the 2026-09-20 promotion docs commit (`a9534ed`, "DEPLOY_LOG +
ROADMAP: 2026-09-20 production promotion") in staging's history — if it is
not there, main was never merged back; STOP and tell Gary. Confirm `CAL-2c`
is a free id in `/Users/garythomas/Claude_Projects/Froot/froot/docs/ROADMAP.yaml`
(read the file; never assume). If taken, say so and stop.

## Why
The due banner on `/dashboard` and `/checklists` lists every due + overdue
occurrence as its own row. An all-stores reminder fans out to one row per
store, so after a busy weekend an admin's dashboard is a wall of red before
any business data shows. Gary wants the banner to roll up into one or two
rows, with a chevron to expand, so the desktop stays clean while the work is
still visibly owed.

## Ruling (Gary, planning chat 2026-09-20) — DRAFT for DECISIONS.md, ratified in PRE-PUSH-CHECK
> 2026-09-20 — Calendar banner rollup (CAL-2c). Collapse is not dismiss. The
> banner can be rolled up to a summary by anyone who sees it, and the rolled-up
> row always carries the count due, the count overdue, the "N days overdue"
> figure and the red surface. There is still no dismiss control: the banner
> clears on completion and on nothing else (CAL-1 B7 / SELF-1, unchanged).

## Brief read first (report file:line, no separate audit file)
1. `/Users/garythomas/Claude_Projects/Froot/froot/src/components/calendar-due-banner.tsx`
   — the current headline string, the item row (inline Complete vs "Open
   checklist" link), the pulse, the all-caught-up transition, both mounts.
2. `/Users/garythomas/Claude_Projects/Froot/froot/src/app/api/calendar/due/route.ts`
   — confirm each item carries a store id and store name. If the name is
   missing, add it to the existing `select` and map. No query-shape change.
3. What the NAV-1 sidebar accordion uses (shadcn Accordion / Radix Collapsible
   / hand-rolled) and the `accordion-down` / `accordion-up` keyframes in
   `globals.css`. Reuse whichever exists. Add nothing to `package.json`.

## Build — all in `calendar-due-banner.tsx`
**Row 1, always visible (the rollup).** Same shell and same surface colours
as today. Icon · the existing headline wording, extended only as needed to
read like "7 reminders due · 4 overdue · 3 days overdue" (numbers from
`items.length`, `overdueCount`, `maxDaysOverdue`; singular forms correct; no
overdue clause when nothing is overdue). Right edge: a chevron button that
rotates 180° when open. `aria-expanded`, `aria-controls`, tap target ≥ 44px,
`title` "Show reminders" / "Hide reminders".

**Row 2, only when the items span more than one store.** A wrapping strip of
store chips — "Las Brisas 3" — overdue stores first, then by count. A chip
whose store has anything overdue is bold. Clicking a chip opens the list
filtered to that store; clicking it again clears the filter. If the filtered
store's last item is completed, clear the filter.

**Expanded list.** Today's rows, unchanged in behaviour (inline Complete for
reminders, "Open checklist" link for template-backed). When items span more
than one store, group under a small store subheading. Height animates with
the existing accordion keyframes; `prefers-reduced-motion` gets no animation.

**Default state.** More than 3 items → starts collapsed. 3 or fewer → starts
expanded, so a store with one reminder sees exactly what it sees today. Once
a person clicks the chevron, their choice wins over the threshold and is
remembered per browser: `localStorage` key `froot.calBanner.open` = "1"/"0",
read inside `useEffect` after mount, every access in try/catch, storage
failure falls back to the threshold. No DB column — that would be TIER 3 for
a cosmetic preference.

**Must not change.** No dismiss. The one-shot pulse still fires once on
mount in the overdue state, collapsed or open. "You're all caught up" still
fires only on non-empty → empty within a session. Renders nothing when the
list is empty, the fetch fails, or the module is off. Both mounts get the
change for free — do not fork the component per page.

## STOP conditions
- The due feed cannot give store identity per item without a query-shape
  change.
- Doing this needs a new dependency.
- The banner is not the single shared component this prompt assumes.
Report and stop; do not improvise.

## Gates
`npm run build` exit 0, no pipe. Scoped eslint on touched files only. No
fixture is touched; if you extract a pure helper into `src/lib/`, say so in
the report and do not add a fixture unasked.

## Docs commit (cites the work SHA)
- ROADMAP.yaml: `CAL-2c` row written from what was actually done, status
  `in_progress` (PRE-PUSH-CHECK flips it). Prepend a dated rider to `CAL-1`
  (banner gained a rollup). Prepend one dated line to `DEBT-100`: the rollup
  shortens the calendar banner; two stacked banners is still open.
- DECISIONS.md: the ruling above, verbatim, headed "DRAFT — pending
  ratification".
- This prompt file committed.
DEPLOY_LOG is PRE-PUSH-CHECK's job, not yours.

## Report and stop
Work SHA, docs SHA, files touched, the final headline strings for 1 / many /
overdue / not-overdue, anything classified FIX NOW / RULING NOW / COMMENT /
ROW. Do not push. Do not suggest further work.
