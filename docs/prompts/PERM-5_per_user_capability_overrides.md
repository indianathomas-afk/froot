# PERM-5 — Per-user capability overrides (the toggle layer)

**Track:** PERM (permissions)
**Branch:** staging
**Type:** Implementation (schema + capability layer + UI)
**Size:** L
**Depends on:** PERM-1 (prod), PERM-2 (prod), PERM-6 (**clears this phase's
blocker — hard prerequisite**), PERM-7 (its device accounts are the first real
consumer)
**Created:** 2026-07-27 (prompt); phase logged earlier

---

## THE ONE RULE THIS PHASE EXISTS UNDER

**A stored permission set RESTRICTS BELOW the Clerk role ceiling and NEVER
elevates above it.**

This is not an implementation preference. It is a recorded ruling
(`DECISIONS.md`, 2026-07-27) and it is what makes the whole model reasonable
about: a user's role tells you their maximum, and overrides can only subtract.
Lose that and "what can this person do?" becomes unanswerable without reading a
database row.

### The distinction that was argued wrong once — do not repeat it

During scoping, **role choice at provisioning** and **capability override** were
argued as if they were the same mechanism. They are not:

- **Role choice at provisioning** (PERM-7): an admin creates a store device
  account with role ADMIN. Nothing is elevated — the Clerk role *is* ADMIN, so
  the ceiling *is* ADMIN. This is the ordinary invite flow. **PERM-5 is not
  involved.**
- **Capability override** (this phase): a stored set that subtracts from what a
  role already grants.

**If you find yourself asking PERM-5 to grant something a role does not already
have, the answer is a different role, not a wider override.**

---

## BLOCKER — do not start before PERM-6

`ForecastContext.isAdmin` is literally `can(actor, "forecasting.edit")`
(`src/lib/forecasting-access.ts:51`), and `requireForecastStore` **skips the
`StoreUserAssignment` check whenever `isAdmin` is true.** One flag does two
unrelated jobs: *may edit goals* and *is exempt from store scoping*.

These coincide correctly today only because `forecasting.edit` is ADMIN_ONLY.
**The moment this phase grants `forecasting.edit` to a single MANAGER — the exact
per-user grant this phase exists to enable — that user silently also gains
unscoped cross-store forecast reads.** Nobody reading the grant "give Maria
goal-edit access" would predict it hands her every sibling store's forecast, and
it would defeat the scoping PERM-3 shipped and the 2026-07-27 pass verified.

This is not a bug today. It is a trap armed for the first override. **PERM-6
Task 5 defuses it.** Confirm that landed and the blocker is cleared before
writing any code here.

---

## Task 1 — AUDIT AND STOP

Before designing storage or UI, establish and report:

1. **Where the override hooks in.** PERM-3 added a `SCOPE_OVERRIDES` table in
   `src/lib/permissions.ts` and the roadmap says that is "where PERM-5's per-user
   overrides will hook in." Confirm that is still true and still the right seam,
   or say why not.
2. **The membership-churn constraint.** Per `DECISIONS.md` 2026-07-25, the Clerk
   `organizationMembership.created` handler re-creates the `User` row from
   defaults, so **anything stored on `User` resets when a member is removed and
   re-added.** Either store overrides somewhere churn cannot reach, or teach the
   webhook's create path to restore them. Decide this in Task 1 — it is a
   storage-shape decision, not an implementation detail.
3. **The population.** With PERM-7, the realistic population is *one device
   account per store* plus a handful of exceptional humans — not a rare
   exception. Twelve stores means twelve override targets. Does that change the
   UI shape from "an exceptions list" to "a grid"?

**Report and wait for approval before building.**

---

## Task 2 — storage + enforcement

Whatever Task 1 concludes. Constraints that hold regardless:

- Every decision continues to route through `can()` / `scope()`. No inline role
  checks, no bypass.
- The override layer must be **impossible to use for elevation** — enforce it in
  code, not by convention. If the shape allows expressing a grant above the role
  ceiling, the shape is wrong.
- Deny-by-default survives. An override that fails to load must restrict, never
  open.

## Task 3 — the UI

Per-user overrides belong in the **Edit User modal**; the role **baseline** stays
on UM-2's global capability-matrix page. Build so a per-user diff can sit beside
the baseline.

**UM-2 becomes close to required rather than nice-to-have** once this ships — a
matrix rendered **from the live registry** (never hand-maintained, which would
drift from enforcement the first time a capability moves). Confirm whether UM-2
should be pulled into this phase or stay separate; say which and why.

Mind UX-1: the Edit User modal already has a Save button below the fold with no
dirty-state guard. **Adding a capability grid to that modal makes an existing UX
bug materially worse.** Either UX-1 lands first or this phase fixes the footer as
part of its own work — do not add rows to a form whose save button is already
hard to reach.

## Task 4 — the first real consumer

The motivating case is an admin dialling one store's device **down** from the
STORE baseline: this location's iPad does not get labor, that one does not get
inventory counts. Restrict-only is exactly right for it.

Use it as the acceptance test. If the design cannot express that cleanly, it is
the wrong design.

---

## Constraints

- Do not touch `../froot_docs/`.
- If this adds schema, follow the hand-authored `migrate diff` flow in
  `CLAUDE.md`.
- Commit when asked; **never push**.

## Done criterion

`next build` green, PERM-5 row updated with its commit SHA, and a staging pass
proving both directions: an override that restricts takes effect, and **an
override that would elevate is not expressible** — not merely rejected at
runtime, but impossible to construct.

## Report back

1. Task 1's findings and the storage-shape decision, with the churn rationale.
2. How elevation is made impossible, structurally.
3. The UM-2 and UX-1 sequencing calls.
4. Anything in this prompt that contradicted the repo.
5. The explicit unpushed-commits line.
