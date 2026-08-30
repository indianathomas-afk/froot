# NAV-1 — Sidebar restructure + dashboard Daily Tasks button — TIER 2

TIER 2: contained. Two UI touches: (1) the sidebar nav component and its
config/data source, (2) the /dashboard page header (one new button).
No route changes. No schema changes. No API changes. Brief audit, then build.

---

## Repo gate (run first, paste results, one command at a time — no `&&` chains)

```
pwd
```
Must end in `Froot/froot` (lowercase froot — the capital-F parent is a trap).

```
git remote -v
```
Must show `indianathomas-afk/froot`.

```
git status
```
Tree must be clean and on `staging`. If anything is off, STOP and report.

---

## Phase A — brief audit (report before building)

1. Locate the sidebar nav component and its item list. Report the file path(s)
   and how items are currently filtered by role/capability (the `can()` call
   sites from PERM-1).
2. Confirm the existing INVENTORY group's expand/collapse implementation —
   we reuse that exact pattern, not a new one.
3. **Daily Tasks check:** confirm the "Daily Tasks" button does NOT currently
   exist on the /dashboard header (Gary confirmed the live page lacks it —
   a screenshot showing one was a mockup). If you find an existing Daily Tasks
   button in the dashboard code, STOP and report — the premise of this prompt
   is wrong.
4. Capture the current per-role visible-URL sets (see Evidence, below) BEFORE
   any change. This is the baseline for the done criterion.

Then build. No STOP between A and B unless item 3 stops you or something in
the audit contradicts this prompt.

## Phase B — build

New sidebar structure (top to bottom). Group headers are expand/collapse
buttons — they never navigate. All URLs are existing routes; nothing is
created or renamed at the route level.

```
Dashboard                    → /dashboard
Checklists            (group)
  Checklists                 → /checklists
  Start Daily Checklist      → /store-view
  Templates                  → /templates
Messages                     → /messages   (highlighted — see below)
Stores                (group)
  Stores                     → /stores
  Users                      → /users
  Staff                      → /staff
Reports                      → /reports
Forecasting           (group)
  Forecasting                → /forecasting
  Weekly Plan                → /labor
  Labor                      → /settings/labor   (labor.access only — see ruling)
HR                           → /hr
INVENTORY             (group — unchanged, do not touch its children)
Settings                     → /settings
```

### Daily Tasks button (/dashboard)

- Add a "Daily Tasks" button in the dashboard page header, immediately left
  of the store selector dropdown, matching Gary's mockup: solid
  `--color-primary` background, primary-foreground text, standard radius.
- Destination: `/checklists`. Plain navigation — no new logic, no new route.
- Visibility: render it with the same `can()` check the sidebar uses for the
  /checklists link. If a role can't see the sidebar link, it doesn't see the
  button. No new capability is introduced.
- Do not move or restyle the store selector.

### Rules

- **Permission filtering is per submenu item**, using the same `can()`
  capability checks each destination already uses in the flat sidebar today.
  Never filter at the group level.
- **A group header hides itself when all of its children are filtered out.**
  No empty accordions.
- **Labor submenu item** renders only for logins holding `labor.access`
  (ruling below). No lock badge, no placeholder — absent entirely.
- **Auto-open:** on load, the group containing the current route is expanded
  and the item highlighted. Open/closed state persists per user in
  localStorage. (Approved in mockup review.)
- **Messages treatment** (approved in mockup review): same font weight as
  group headers (600), persistent soft-primary-tint background with a hairline
  primary border — visibly lighter than the active-page state — and an unread
  count badge in `--color-primary` that renders only when the count is > 0.
  If no unread-count source exists yet, render the style without the badge and
  report it as an out-of-scope finding (COMMENT); do not build a counter.
- Match existing design tokens exactly (`--sidebar-width`, radius, colors).
  No new colors, no new spacing system.

## Ruling to ratify (draft for docs/DECISIONS.md — Gary confirms wording at commit)

> NAV-1 / COMP-1 follow-on: The sidebar link to /settings/labor is hidden
> entirely for logins without the labor.access capability. We do not show a
> locked or disabled state — a visible lock on a compensation page advertises
> what COMP-1 exists to keep confidential. Server-side enforcement at the
> route is unchanged and remains the actual gate.

## Evidence (done criterion)

For each of the four roles — Karson (ADMIN), Tommy Thomas (MANAGER), the
STORE test login, and a STAFF login — capture on staging the full set of
destination URLs visible in the sidebar (expand all groups), before and after.

Pass = the URL sets are identical per role, with exactly one sanctioned
difference: `/settings/labor` disappears for any role/login lacking
`labor.access`. Any other gained or lost URL is a failure of this phase.

This is a URL-set diff, not a button test. Present it as a table, roles as
columns, before/after as rows.

For the Daily Tasks button: evidence is the /dashboard header on staging per
role — button present and navigating to /checklists for roles that see the
/checklists sidebar link, absent for roles that don't.

## Ceremony

- `npm run build` gates the commit. Lint does not (DEBT-33).
- Two-commit pattern: work commit, then docs commit citing the work SHA
  (ROADMAP.yaml row NAV-1 recorded, DECISIONS.md entry per Gary's ratified
  wording, short SHAs quoted in YAML).
- Commit only. Gary runs all pushes.
- Out-of-scope findings: FIX NOW / RULING NOW / COMMENT / ROW triage as usual.
