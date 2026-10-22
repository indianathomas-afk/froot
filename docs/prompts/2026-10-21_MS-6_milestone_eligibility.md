Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/2026-10-21_MS-6_milestone_eligibility.md and follow it exactly.

# MS-6 — Milestone eligibility per staff member + rename "Labor" → "Labor Settings"

**TIER 3** (one additive column). Declare the tier before writing anything.
Flow: audit → STOP for Gary → build → generate migration → STOP for Gary to
apply it to dev → run fixture → commit. Never push.

Repo: `/Users/garythomas/Claude_Projects/Froot/froot`, branch `staging`.

## 0. Gate

1. Report `git branch --show-current`, `git status --short`, `git log --oneline -3`.
   STOP if not on `staging` or the tree is dirty.
2. Read `/Users/garythomas/Claude_Projects/Froot/froot/docs/ROADMAP.yaml` and
   confirm `MS-6` is free. If taken, STOP and report the next free MS id —
   never assume (DEBT-84).

## 1. What Gary wants (plain English)

Salaried and executive people (Kelton, Kristie, Karson, Taylin, Jennifer, and
likely the owner/admin accounts) are never in line for a raise, so Milestones
is noise for them. Give each person a **Milestones** on/off switch in the
Positions table on the Labor page. Off = that person drops out of Milestones
everywhere, for every role.

Also rename the "Labor" page to **"Labor Settings"** (sidebar label and page
heading). The route `/settings/labor` does NOT change.

## 2. Draft rulings (ratified at PRE-PUSH-CHECK, in Gary's words)

- **R1 — one flag per person.** `StaffMember.milestoneEligible Boolean
  @default(true)` (NOT NULL — avoids the `{ not: true }` NULL trap). Default
  true means nothing changes for anyone until Gary flips someone off.
- **R2 — off hides everything Milestones.** For an ineligible member: no
  On-Time badge, no Raise badge on `/staff`; no Milestones tab on
  `/staff/[id]`; not listed on `/staff/milestones/report`; no tenure or
  checklist milestones; no milestone emails (MS-4b) about them; not counted in
  any report totals.
- **R3 — off is hide, not delete.** WageSnapshot, last-raise date, schedule
  and attendance data keep being written as today. Flipping back on restores
  everything as if it had never been off.
- **R4 — who flips it:** `milestones.manage` (ADMIN only). Route refuses
  everyone else with 403; 404 when Milestones is off for the org.
- **R5 — the column shows only when Milestones is active for the org.** Header
  `MILESTONES`, placed after `CONFID.`, same toggle component and save
  behaviour as `CONFID.`.
- **R6 — one person, every store.** A person on several store rosters shows the
  same value on each; flipping it on one store's roster changes it everywhere.
- **R7 — "Not in Froot" rows** (no StaffMember) get a disabled toggle with a
  tooltip: "Add to Froot to set milestones."
- **R8 — Square sync never touches the flag.** Froot stays read-only from
  Square; no auto-default from Square pay type (Jennifer is $0.00/hr, so pay
  type can't identify these people).

## 3. Audit (read-only) — then STOP

Report, with file paths and line numbers:

1. How Positions rows on `/settings/labor` map to `StaffMember` (via the Square
   team member id?) and where the `CONFID.` toggle reads/writes
   (`compConfidential`) — the route to copy for shape.
2. **Every Milestones read path** that must honour the flag: `/staff` badge
   gate (`showOnTime`), `getRaiseEligibility` in `src/lib/raise-eligibility.ts`,
   On-time (`getOnTimeForStaff`), the `/staff/[id]` tab gate
   (`showMilestonesTab`), `/staff/milestones/report`, tenure/checklist
   milestone computation, MS-4b milestone email selection, and any count or
   total. Lean: filter once at the shared roster/eligibility layer rather than
   per page — say whether that's possible.
3. Every place the word "Labor" labels this page (sidebar nav config, page
   heading, `<title>`, help guide under `docs/guide/`, search entries). Don't
   rename "Labor" where it means the Square labor overlay or the Forecasting
   concept.
4. Anything that breaks R1–R8 or would need schema beyond the one column.

STOP. Gary rules on any fork before building.

## 4. Build (after Gary says go)

- Schema: the one column per R1. Generate the migration with
  `prisma migrate diff` only. **STOP after generating it** — Gary applies it
  to dev himself with `npx prisma migrate deploy` and says go. No commit until
  then.
- Route: `PUT` for the flag, shaped like the `CONFID.` route, gated per R4,
  writes an AuditLog row (who, member, old → new).
- UI: column per R5–R7.
- Reads: apply the flag per the audit's §2 list.
- Rename per §3.
- Fixture `scripts/verify-ms6.ts` (name every test principal "MS-6 …", clean
  up after): default true on create; ADMIN flips off/on; MANAGER, STORE, STAFF
  → 403; Milestones off → 404; an ineligible member returns no raise result,
  no on-time result, no tab, no report row, no milestone email; flip back on
  restores all; Square roster resync leaves the flag untouched; "Not in Froot"
  row can't be set. Re-run verify-ms1/2/3/3b and the MS-4/5 fixtures — all
  must stay green.

## 5. Commit

Stage only the files this session touched (no `git add -A`). Work commit, then
a docs commit: ROADMAP row `MS-6` (`in_progress`), DECISIONS.md draft entry
with R1–R8, MIGRATIONS.md line (dev only, applied by Gary), help guide update.
Report SHAs, fixture counts, and prisma commands run (verbatim; note
`npm run build` runs `prisma generate`).

## 6. Staging test list for Gary (put in the report)

1. Neon console `_prisma_migrations` on `br-square-feather` before/after push.
2. `/settings/labor` sidebar and heading read "Labor Settings"; URL unchanged.
3. MILESTONES column visible; flip Kelton off on Cafe De Keva Cart → off on his
   other stores' rosters too.
4. Flip off Kelton, Kristie, Karson, Taylin, Jennifer → no On-time/Raise badges
   on `/staff`, no Milestones tab, absent from the Milestone Report.
5. Flip one back on → everything returns.
6. Tommy (STORE) and gary@keva.com (MANAGER) console `PUT` → 403.
7. Phone width on `/settings/labor`.
