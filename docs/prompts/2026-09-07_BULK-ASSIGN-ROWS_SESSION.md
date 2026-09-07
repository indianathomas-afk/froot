# Bulk assign training — recipient rows show position and store

**Written:** 2026-09-07. Short-form session. No audit phase, no stop gate —
every rule below is already settled. Build it, commit it, report.

## PREFLIGHT — one command at a time, no `&&` chains

1. `froot`, then `pwd`. Must print the lowercase `froot` git root.
2. `git status` — tree clean. If `docs/ROADMAP.yaml.bak` or `Claude outputs/`
   are present, STOP and tell Gary; this session runs `git add -A`.
3. No pushes. Commits only.

## THE CHANGE

In the Bulk assign training dialog on `/hr/training`, each person in the
**Individuals** list renders as `Name · Position · Store` instead of name alone.

```
Addison Aland · Shift Supervisor · Sparks
Kelton Thomas · Administrator · Corporate
Jane Doe · Sparks                          (no Square link, so no position)
```

Segments joined by `·`. A missing segment is **omitted** — no placeholder, no
blank, no em-dash. Name is always present.

## RULES

**Position** = `SquareTeamMemberWage.jobTitle`, joined on `squareTeamMemberId`
(nullable on `StaffMember` — a hand-added person has no position, and that is
the normal case, not an error).

**The select on that table is exactly `{ squareTeamMemberId, jobTitle }`.**
Explicit select, never a spread, never `include`. No `hourlyRate`,
`annualRate`, `payType`, or anything else. That table is where pay lives and it
was split off `StaffMember` specifically so a wage column could not leak
through a route that spreads its row. No `labor.costs.view` gate is added — a
job title is not pay.

**Store** = the primary store, always exactly one name.
- `isCorporate` staff render the literal `Corporate` and nothing else. The
  resolver does not run for them — Square expands corporate staff to every
  location, so their assignment rows are a sync artifact, not a home base.
- Everyone else goes through **`primaryStoreName()` in `src/lib/hr.ts`** —
  reused, not reimplemented. It sorts `isPrimary`-desc then name-asc and
  returns `null` when there is nothing. It is the same function that resolves
  the store frozen onto signed documents; a second resolver here would let this
  dialog and the legal record disagree about someone's home store.

**Resolve both server-side, in the route.** The dialog renders what it is told —
that route's header already states the rule. The corporate branch belongs in the
route, not the component.

## WHERE

- `GET /api/hr/training/assignments/bulk/recipients` — two additive selects
  (`jobTitle` via the wage table; `storeAssignments: { isPrimary, store: { name } }`,
  since today's payload carries a flat `storeIds` with no primary flag). Add
  `position` and `store` per person to the response.
- `bulk-assign-dialog.tsx` — the Individuals row render. The right edge already
  carries the `already assigned` state; don't collide with it.

File paths and the current response shape are from planning, not measured at
HEAD. If they don't resolve, say so rather than adapting around it quietly.

## DO NOT TOUCH

The route's guard; the `/hr/training` page gate; every HR-22 recipient rule
(ACTIVE-only, corporate excluded from store expansion, the five-bucket response
and its sum invariant); the Stores half of the dialog and its `expandsTo`
counts; the single-assign path; DEBT-9.

**No role filter or select-all-by-role.** Assigning by role is the motivation
behind this change but it is a separate row — do not build, scaffold, or
half-wire it here.

## DONE

Scoped eslint clean → green `npm run build` → work commit → docs commit citing
the work SHA. Report both SHAs, the unpushed count, and the three row shapes as
actually rendered.

Docs commit: ROADMAP row under the next free id, `status: in_progress` at the
work SHA. DEPLOY_LOG entry scaled to blast radius — one route, one component,
so keep it short. This prompt file rides the docs commit.

Before any DEPLOY_LOG heredoc splice: `grep -c '__'` must return zero.

Commits, never pushed. Gary pushes and verifies on staging.
