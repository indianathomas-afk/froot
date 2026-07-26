# PERM-2 — Resolve permission contradictions

**Track:** PERM (permissions)
**Branch:** staging
**Type:** Implementation
**Depends on:** PERM-1 (shipped to production 2026-07-26)
**Source:** `docs/PERMISSIONS_INVENTORY.md` §2 and §3
**Created:** 2026-07-26

---

## Governing rule (read first)

**Every permission decision in this session goes through the PERM-1 `can()` /
`scope()` capability layer. Do not add a single inline `role === "ADMIN"` or
`role === "MANAGER"` check anywhere.**

Reason: the next phase after this adds *per-user capability overrides* — e.g. one
staff member granted inventory-count access while others are not. A capability
check has one place to hook that override layer. Scattered inline role checks
have none, and every one added here becomes something a future session has to
hunt down. If a needed capability does not exist in the §5 registry, add it to
the registry and use it — do not bypass.

---

## Task 1 — AUDIT AND STOP: what does `POST /api/checklists` actually do?

**Do this before any other work, and report before proceeding.**

The codebase uses "checklist" for two different things:

- `/templates` — the definition: sections, tasks, wording, formatting
- `/checklists` — the working instance a store completes, with task-log,
  handoff-messages, and submit

Gary's four-verb model maps across both:

| Verb | Meaning | Object |
|---|---|---|
| View | see it, no changes | instance and/or template |
| Edit | change formatting and wording | template |
| Use | work through it, check off tasks, submit | instance |
| Create | make a brand new one | template (and possibly instance) |

Read `src/app/api/checklists/route.ts` and determine precisely what `POST` does:

- **(A)** Instantiates a checklist for a store on a given day from a template
- **(B)** Creates a new checklist definition
- **(C)** Something else — describe it

Also determine whether instances are auto-generated on a schedule, or only ever
created by this endpoint.

**STOP AND REPORT after this task.** Do not apply any checklist permission
change until Gary confirms.

Why: if `POST` is (A), locking it to ADMIN would prevent a store from starting
its daily opening checklist — turning off floor operations at Las Brisas to
close a permission hole. If it is (B), ADMIN-only is correct and harmless.

Proposed handling, for Gary to confirm after the audit:

- If **(A)**: `POST` allowed for ADMIN, MANAGER, STORE — **store-scoped**, i.e.
  only for a store the user is assigned to. Never org-wide.
- If **(B)**: ADMIN only, consistent with templates.

Either way the current state — org-wide creation by any member, including STAFF
— is a security gap and must not survive this session.

---

## Rulings to implement

These are decided. Implement them via `can()`.

### #2 — Templates: ADMIN only, all three layers agree

Currently: nav ADMIN (NV-4), layout allows MANAGER (PG-4), list page and every
API ADMIN (PG-5, PL-10). A MANAGER can open detail/edit/new pages where every
action 403s.

**Ruling:** ADMIN only. Close the layout to match. Templates are corporate-
controlled so procedures stay consistent across stores.

### #3 — Staff surface: ADMIN/MANAGER throughout

Currently: pages ADMIN/MANAGER (PG-9), `GET /api/staff` any member (PL-15),
`POST /api/staff` **unguarded** (PL-16), per-record routes correctly tiered
(PL-17).

**Ruling:** `GET /api/staff` → ADMIN/MANAGER, matching the pages. A STAFF-role
user has no need to see a coworker directory; if they need that information it
is available in Square directly.

`POST /api/staff` → ADMIN/MANAGER. This is currently unguarded and is a
security fix, not a preference.

Leave the correctly-tiered per-record routes alone.

### #4 — Checklists: pending Task 1

`GET` is store-scoped (PL-1); `POST` is org-wide for any member (PL-2). The
`POST` gap is a security fix regardless of tier. Apply only after Gary confirms
the Task 1 finding.

Store-scoping rule where it applies: a MANAGER assigned to multiple stores may
view and use checklists at any store they are assigned to, and no others.

### #5 — Inventory: split by data sensitivity

Currently: PG-22 pages redirect non-managers while their data APIs (IV-10) serve
any member; PG-21 pages do not redirect at all.

**Ruling:** inventory is not one permission. Split it:

- **Operational** — counts, adjustments, and the routes a person on the floor
  with a clipboard needs → available to STAFF/STORE
- **Commercial** — vendor prices, COGS, profitability, valuation, turnover,
  variance, vendor spend, and comparable cost/margin data → ADMIN/MANAGER

**Present the full route-by-route mapping for approval before implementing.**
Do not guess the boundary for ambiguous routes (ingredients, pars, order guide,
purchase orders) — list them with your recommendation and wait.

Pages and their data APIs must agree once you are done. A page that redirects
while its API serves anyone is the bug being fixed.

### #6 — Dashboard goal write: ADMIN only

Currently: dashboard manual monthly goal `PUT` = ADMIN/MANAGER (PL-9), while
every Forecasting goal write = ADMIN only (FC-2). A manager can set the
dashboard goal that overrides the plan they cannot touch — the weaker permission
wins, making the stricter one decorative.

**Ruling:** dashboard goal `PUT` → ADMIN only. Forecasting stays ADMIN only.

**Scope boundary:** Gary also ruled that MANAGER and STORE should only *see*
current-month and next-month forecast/sales. That is a read-window restriction
across multiple forecasting and dashboard endpoints, not a contradiction fix.
**It is PERM-3 and is out of scope here.** Record it in ROADMAP; do not
implement it.

### #8 — Weekly Plan: add the viewer entry point

Currently: nav ADMIN/MANAGER (NV-13) vs guard any-member read-only (PG-17,
LB-1). The read-only viewer design never got an entry point.

**Ruling:** add the nav entry for all roles. Keep the guard read-only for
non-managers. Staff seeing their own schedule is intended.

---

## Explicitly NOT in scope — do not touch

- **#1** — resolved on the Square side by SEC-1. The residue is Instagram now
  being the weaker flow; tracked as SEC-2 / §2 item 17. Leave alone.
- **#7** — Labor writes ADMIN+MANAGER vs Forecasting writes ADMIN-only is
  **deliberate** per the decision log (`labor-access.ts` comment). It is listed
  in §3 specifically so the registry does not harmonize it by accident. **Do not
  harmonize it.**
- **#9** — `ensureTrainingCertPdf` using `fullName ?? displayName` is a
  documented scope boundary (DECISIONS, "Staff Display Name vs Full Name" f).
  Intentional. Leave alone.
- **Default / primary store selection.** Gary's rule is that a multi-store
  manager's default is "the first store on their profile." `StoreUserAssignment`
  has no primary flag and no ordering column, so "first" is currently whatever
  Postgres returns and can vary between queries. Making this deterministic
  requires a schema change, which is gated on BUILD-1. **Out of scope.** If any
  code in this session needs to pick a store, use a deterministic sort (store
  number, then name) and note it as a placeholder. Record the real fix as its
  own phase.
- **PERM-3** — the current/next-month read window from #6.

---

## Hard constraints

- **Staging branch only. Do not push.** Gary runs all git commands.
- **NO SCHEMA CHANGES. NO MIGRATIONS OF ANY KIND.** BUILD-1 removed
  `migrate deploy` from the local build, but local `.env` still points at the
  **production** Neon branch — the `.env` repoint has not happened yet. Any
  migration created here is a production risk.
- **Every change goes through `can()` / `scope()`.** No inline role checks. See
  the governing rule above.
- **Audit first.** Read `src/lib/permissions.ts`, `src/lib/auth.ts`, and the
  affected routes and pages. Present a complete plan and wait for explicit
  approval before editing.
- Store scoping must come from `StoreUserAssignment`, never from a URL parameter
  or request body.
- Out-of-scope findings: write them down as text. Do not fix them.

---

## Report back

- **Task 1 finding** — what `POST /api/checklists` does, with the route code that
  proves it (reported and confirmed before any checklist change)
- The full inventory route-by-route mapping (operational vs commercial), approved
  before implementation
- Every capability added to or reused from the §5 registry
- Confirmation that no inline role check was introduced — state how you verified
- Each contradiction (#2, #3, #4, #5, #6, #8) with before/after enforcement
- Confirmation that #1, #7 and #9 were left untouched
- Anything that turned out to need a schema change, deferred not implemented
- Out-of-scope findings, as text

---

## Roadmap update

`docs/ROADMAP.yaml`:

- PERM-2 → `staging` once verified
- **PERM-3** → `planned`: MANAGER/STORE read window limited to current and next
  month across forecasting and dashboard endpoints
- **New phase** → `planned`: deterministic default/primary store for multi-store
  users; requires a schema change; **gated on BUILD-1**
- **New phase** → `planned`: per-user capability overrides (the toggle layer —
  e.g. granting one staff member inventory-count access). Note that PERM-1's
  `can()` layer plus PERM-2's discipline is the substrate this depends on.
- Update `docs/PERMISSIONS_INVENTORY.md` §3 to mark resolved items, and correct
  the `robots.txt` note: production returns **404**, not a 307 to sign-in as
  previously recorded.

Additive only. Use the documented status vocabulary.

---

## Done criterion

`next build` passes. Task 1 answered and confirmed. All six in-scope
contradictions resolved through the capability layer. `docs/ROADMAP.yaml` and
`docs/PERMISSIONS_INVENTORY.md` updated. Nothing committed, nothing pushed.
