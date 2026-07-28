# PERM-6 — Store-assignment integrity

**Track:** PERM (permissions)
**Branch:** staging
**Type:** Implementation (5 independent fixes)
**Size:** S — no schema, no migration, no new capability
**Depends on:** PERM-1 (prod), PERM-2 (prod), PERM-3 (prod)
**Blocks:** PERM-7 (do not start PERM-7 first)
**Created:** 2026-07-27

---

## Governing rule (read first)

**Every permission decision goes through the PERM-1 `can()` / `scope()` layer.
Do not add a single inline `role === "…"` check.** If a needed capability does
not exist in the `PERMISSIONS_INVENTORY.md` §5 registry, add it there and use
it — never bypass.

**Read the PERM-6 row in `docs/ROADMAP.yaml` before starting.** It carries the
full finding for each item with file:line. This prompt is the task order and the
traps; the row is the evidence. Do not duplicate the row's detail back into this
file — if they drift, the row wins.

---

## Why this is sequenced before PERM-7

PERM-7 adds a **new** write path that creates users and store assignments.
Building it on top of the unvalidated paths in Tasks 1 and 2 would replicate the
hole into a new surface instead of closing it. Fix the foundation first.

---

## Task 1 — `POST /api/staff` accepts foreign `storeIds` (highest severity)

`src/app/api/staff/route.ts:46-68`. The request body's `storeIds` flow straight
into the nested `storeAssignments.create` with **no org-ownership query
anywhere**, and the route is MANAGER-reachable via `can(role, "staff.manage")`.

This is **cross-tenant**, not merely cross-store: a `storeId` belonging to
another organization is accepted today.

The fix already exists in this repo — copy the shape from
`src/app/api/users/[id]/route.ts:56-63`, which counts matching stores scoped by
`organizationId` and rejects on mismatch.

**Also add the caller-scope check** that PERM-2's deferred note asked for: a
non-admin may only assign stores within their own `StoreUserAssignment` set. Org
membership is the floor, not the ceiling.

## Task 2 — `POST /api/users` (invite) has the same gap

`src/app/api/users/route.ts:88-91`. `storeIds` are written to
`PendingInvite.storeIds` unvalidated, and the Clerk webhook later materialises
them via `storeUserAssignment.createMany` with **no re-check**
(`src/app/api/webhooks/clerk/route.ts:126`).

ADMIN-only, so lower severity than Task 1 — but its sibling `PATCH` route
validates correctly, so this is an asymmetry with no reason to exist.

**Decide and record:** validate at the invite (preferred — fail fast, at the
point of admin intent) or at the webhook (catches any future writer of
`PendingInvite`), or both. State the choice in `DECISIONS.md`. Validating only
at the webhook means the admin gets no error and the invite silently
half-applies.

## Task 3 — `PATCH /api/staff/[id]` validates org but not caller scope

`src/app/api/staff/[id]/route.ts:55-63`. The target staff member must be in the
caller's scope to reach the edit, but once inside, a MANAGER can set
`storeIds` / `primaryStoreId` to **any** org store. Same class as Task 1,
narrower blast radius.

## Task 4 — `GET /api/square/locations` has no role gate (cheapest fix)

`src/app/api/square/locations/route.ts:7-8` — only `auth()`. Any authenticated
org member including STORE and STAFF can read the org's full Square location
list.

Worse than it first looks: the route spreads the **entire** Square object
(`...loc`), so `business_email`, coordinates and every other field reach the
client. Gate it through `can()` at the same tier as the store-management UI.

**Do not simply narrow the spread and call it fixed** — the missing authorization
is the finding; the over-broad payload is a second, separate improvement worth
making at the same time.

## Task 5 — split the forecasting `isAdmin` fusion (clears PERM-5's blocker)

`src/lib/forecasting-access.ts:51` sets `isAdmin: can(actor, "forecasting.edit")`,
and `requireForecastStore` skips the `StoreUserAssignment` check whenever
`isAdmin` is true. One flag is doing two unrelated jobs: *may edit goals* and
*is exempt from store scoping*.

Harmless today only because `forecasting.edit` is ADMIN_ONLY. The moment PERM-5
grants it to one MANAGER, that user silently gains unscoped cross-store forecast
reads — defeating the scoping PERM-3 shipped and the 2026-07-27 pass verified
via check S4.

Give `requireForecastStore` its own capability (e.g. `forecasting.scope.all`) or
an explicit unscoped flag on the context.

**Verified scope — this is a ONE-FILE fix.** `labor-access.ts` derives
`LaborContext.isAdmin` from `dbUser.role === "ADMIN"`, not from a capability, so
it does **not** have this coupling. Every other scoping helper
(`requireLaborStore`, `requireManageableStaff`, `findManageableStaffMember`,
`requireNoteAccess`, `requireCount`) was audited on 2026-07-27 and found
structurally identical and correct. **Do not "harmonise" them** — they are
already right, and touching them is scope creep with regression risk.

After this lands, clear PERM-5's blocker in `ROADMAP.yaml`.

---

## Moved out — do NOT do this here

The `StoreStaffAssignment.isPrimary` constraint question **now lives on
BUILD-2**, which is already the migration phase. That keeps PERM-6 no-schema and
size S, and batches both DDL changes into one deploy.

**This phase must not author a migration.** If one seems necessary, stop and
re-scope.

Two corrections carried over, so nobody re-litigates them here:

1. An earlier draft claimed a **race** between two concurrent PATCHes on the
   two-step false-then-true branch could produce two primaries. **Overstated** —
   the two-step runs inside `$transaction` and Postgres row locks serialise the
   second writer, so it resolves to one primary correctly. Don't hunt that race.
2. The real risk is a **future writer** doing the obvious
   `storeStaffAssignment.update({ ..., data: { isPrimary: true } })`, which sets
   the new primary without clearing the old. The existing chip-click path only
   avoids this because someone wrote the two-step deliberately — reasoning that
   lives in code, not the schema, so a new writer can't inherit it.

---

## Constraints

- No schema change for Tasks 1–5. The only candidate migration is the open
  question above, and that is a deliberate decision, not a default.
- Do not touch `../froot_docs/`.
- Commit when asked; **never push** (CLAUDE.md Git Rules).

## Done criterion

All five tasks fixed, `next build` green, PERM-6 row updated to `staging` with
its commit SHA, PERM-5's blocker cleared, and PERM-2's `deferred:` entry marked
resolved.

## Report back

1. Each task: the guard before → after, with file:line.
2. The Task 2 decision (invite vs webhook vs both) and why.
3. The `isPrimary` constraint decision.
4. Anything in this prompt that contradicted the repo — say so rather than
   silently reconciling it.
5. The explicit unpushed-commits line.
