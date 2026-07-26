# PERM-3 — Forecasting read window and affordance visibility

**Track:** PERM (permissions)
**Branch:** staging
**Type:** Implementation
**Depends on:** PERM-1 (production), PERM-2 (staging)
**Created:** 2026-07-26

---

## Governing rule (read first)

**Every permission decision goes through the PERM-1 `can()` / `scope()`
capability layer. Do not add a single inline `role === "…"` check anywhere.**

PERM-5 will add per-user capability overrides. A capability check has one place
to hook that layer; an inline role check has none. If a needed capability does
not exist in the `PERMISSIONS_INVENTORY.md` §5 registry, add it to the registry
and use it — never bypass.

**Second rule, specific to this phase: every affordance that points at
forecasting must ask the same capability that gates the destination.** PERM-2's
whole purpose was eliminating the "page renders while its API 403s" bug class.
Do not reintroduce it here.

---

## Task 1 — AUDIT AND STOP: what can each role see in Forecasting today?

**Do this before any other work, and report before proceeding.**

The scope of this phase depends on the current state, which is not established.

Determine, per role (ADMIN / MANAGER / STORE / STAFF), for every forecasting
surface:

- `/forecasting` page and layout
- every route under `/api/forecasting/*` (audit, backfill, basis, calendar, day,
  day-report, export, import, month, plan)
- the dashboard Monthly Goal card and its `Forecasting →` link
- the sidebar Forecasting nav entry
- any other affordance that links to a forecasting surface — search for it, do
  not assume the dashboard link is the only one

For each: what is the current guard, and is there any date-range restriction at
all today?

**Report the matrix and STOP.** Then state plainly whether this phase is a
*restriction* (managers currently see more than the ruling allows), a *grant*
(managers currently see less, or nothing), or a mix per route. Do not proceed
until Gary confirms.

---

## The ruling

Gary's decision, option (c):

| Role | Forecast data (forward-looking) | Actual sales data (historical) |
|---|---|---|
| ADMIN | unrestricted | unrestricted |
| MANAGER | **current month + next month only** | **full history** |
| STORE | **no access** | no forecasting-surface access |
| STAFF | **no access** | no forecasting-surface access |

Rationale, so you can resolve ambiguous routes correctly: a manager needs last
July's actuals to budget this July, and there is no reason to hide sales that
already happened from the person who produced them. What is restricted is
forward *speculation* beyond the budgeting horizon, not history.

Writes are unchanged: all forecasting writes remain ADMIN-only (§3 #7 records
the Labor/Forecasting write-tier asymmetry as deliberate — **do not harmonize
it**).

### Affordance visibility

The dashboard Monthly Goal card's `Forecasting →` link must render only for
users who can reach the destination. Same for the sidebar entry and any other
link Task 1 surfaces.

- ADMIN, MANAGER → link visible
- STORE, STAFF → link absent (not disabled, not 403 on click — absent)

---

## The moving window

"Current month and next month" is a moving target and must be computed **per
request**, never hardcoded or cached across a month boundary. Month-end is
precisely when a manager is budgeting, so a stale boundary fails at the worst
time.

**Timezone:** compute the window from the relevant store's timezone
(`Store.timezone`), not server time or UTC.

**Multi-store managers:** BUILD-2 (deterministic primary store) is blocked on
BUILD-1 and not done, so there is no reliable "default store" yet. Use this
fallback and state it in the code comment:

- If the request carries a `storeId` the caller is scoped to, use that store's
  timezone.
- Otherwise, use a deterministic sort of the caller's assigned stores (store
  number, then name) and take the first.
- Note it as a placeholder pending BUILD-2.

**Boundary definition:** state explicitly in the report where the window starts
and ends — first instant of the current month in store time, through the last
instant of next month. Off-by-one at a month boundary is the likely defect here.

---

## Enforcement location

**Enforce server-side, in the API routes.** Filtering in the UI while the API
still serves unrestricted data is not a restriction; it is a hidden field.

If a route accepts a date range, reject or clamp out-of-window requests —
propose which, and be consistent. Report your choice.

Do not rely on the client sending a well-formed range.

---

## Hard constraints

- **Staging branch only. Do not push.** Gary runs all git commands.
- **NO SCHEMA CHANGES. NO MIGRATIONS OF ANY KIND.** Local `.env` still points at
  the **production** Neon branch — the BUILD-1 `.env` repoint has not happened.
  Any migration here is a production risk.
- Everything through `can()` / `scope()`. No inline role checks.
- Store scoping comes from `StoreUserAssignment`, never from a URL parameter or
  request body.
- **Audit first.** Present the full plan and wait for explicit approval before
  editing.
- Out-of-scope findings: write them down as text. Do not fix them. (One
  deliberate exception was made in PERM-2 for a tenant-isolation leak; that was
  logged in DECISIONS.md and should not become a precedent.)

---

## Explicitly NOT in scope

- **UM-1** — the User Management page work (role/permission level column on the
  organization members table, and the role-capability matrix page linked from
  the Edit User modal). Separate phase, separate session. Note: the users page
  already renders role badges via `ROLE_STYLES` in the *pending invitations*
  table — check whether the accepted-members table has the same column before
  treating it as new work.
- **PERM-4** — cost/valuation field redaction for callers without
  `inventory.costs.view`.
- **PERM-5** — per-user capability overrides.
- **BUILD-2** — deterministic primary store.
- **§3 #7** — Labor vs Forecasting write tiers. Deliberate. Leave alone.

---

## Report back

- **Task 1 matrix** — current per-role access across every forecasting surface,
  reported and confirmed before any change
- Whether this phase turned out to be a restriction, a grant, or a mix
- Every capability added to or reused from the §5 registry
- The exact window computation, including timezone source and boundary
  definition
- Clamp vs reject decision for out-of-window requests, and why
- Every affordance found that links to forecasting, and how each is now gated
- Confirmation that no inline role check was introduced, and how you verified it
- Confirmation that forecasting writes remain ADMIN-only and §3 #7 is untouched
- Out-of-scope findings, as text

---

## Verification on staging

Gary will test with a non-admin account. Provide a checklist covering:

1. MANAGER sees current and next month forecast; a request for a month beyond
   that is refused or clamped server-side
2. MANAGER sees full historical actual sales
3. STORE and STAFF: no Forecasting nav entry, no dashboard `Forecasting →` link,
   and direct URL navigation to `/forecasting` is refused
4. No page renders while its API 403s — the PERM-2 bug class
5. Month-boundary behavior: state how to test it without waiting for August 1

---

## Roadmap update

`docs/ROADMAP.yaml`:

- PERM-3 → `staging` once verified
- **UM-1** → `planned`: role column on the organization members table, plus a
  read-only role-capability matrix page rendered **from the live registry**
  (never a hand-maintained table), linked from the Edit User modal. Note that
  PERM-5's per-user overrides belong in the modal while the role baseline stays
  on the global page.

Update `docs/PERMISSIONS_INVENTORY.md` §1f and §5 to reflect the new tiers.

Additive only. Use the documented status vocabulary.

---

## Done criterion

`next build` passes. Task 1 answered and confirmed. Window enforced server-side.
Affordances match their destinations. `docs/ROADMAP.yaml` and
`docs/PERMISSIONS_INVENTORY.md` updated. Nothing committed, nothing pushed.
