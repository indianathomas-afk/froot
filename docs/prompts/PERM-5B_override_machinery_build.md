# PERM-5 Session B — Override machinery + grid UI (THE BUILD)

**Track:** PERM (permissions)
**Branch:** staging
**Type:** Implementation (schema + capability layer + UI)
**Size:** M-L (Session C, the call-site migration sweep, is split out)
**Supersedes:** Tasks 2–4 of `docs/prompts/PERM-5_per_user_capability_overrides.md`.
Its rulings still govern; its facts and open questions are settled below.
**Prerequisites, all satisfied:** PERM-1/2/3/6/7 shipped; the PERM-5A audit
(`docs/prompts/PERM-5A_toggle_inventory_audit.md`, run 2026-08-03 at eabf779)
delivered the toggle inventory; DEBT-53 (org guard) and DEBT-54
(accept-invite default) are on staging and verified; production restricted
mode is ON and production Clerk holds no duplicate identities (DECISIONS.md
2026-08-04), which is what makes the storage ruling below clean.
**Created:** 2026-08-04

---

## RULINGS ALREADY MADE — do not reopen these

1. **THE ONE RULE stands:** a stored permission set RESTRICTS BELOW the Clerk
   role ceiling and NEVER elevates above it. Structural, not conventional.
2. **The seam is `can()` itself** (src/lib/permissions.ts:233), NOT the
   `SCOPE_OVERRIDES` table — the audit established can() never reads that
   table, it is role-keyed not user-keyed, and 39/41 call sites use can().
   The ceiling check evaluates FIRST and returns before the override is
   consulted; there must be no code path by which an override turns false
   into true. scope() routes through can(), so one insertion covers both.
3. **Storage: a column on `User`** — `deniedCapabilities String[]` (or
   equivalent), nullable, additive-only. The DEBT-50 evidence run closed
   this shape's one known hole: production has no duplicate identities and
   restricted mode now prevents new ones. The dev-instance duplicate pair
   is a known artifact and does not gate this. Note in the schema comment
   that the row survives same-Clerk-account membership churn (upsert UPDATE
   branch writes email only) and is lost only with a new clerkUserId —
   which restricted mode now makes an admin-visible event.
4. **Failure mode: three-state deny-list.** The loaded override must be
   `{ loaded: boolean, denied: Set<Capability> }` in shape: if loading
   FAILED, can() returns false for everything. An override that fails to
   load must restrict, never open. A bare array whose load failure yields
   [] silently restores the full role baseline — that shape is forbidden.
5. **The grid renders ONLY load-bearing capabilities.** The audit found 24
   registry entries with zero call sites and 15 that are nav-only. A toggle
   that does nothing is worse than no toggle — an admin who flips it
   believes they restricted someone. Derive the grid rows from a
   maintained list of server-enforced capabilities (the audit's Class A,
   17 entries), NOT from the full registry. Structure it so Session C's
   migrations ADD rows to the grid by updating that list — one place.
6. **Nav-only capabilities may appear ONLY as a visually distinct
   "hides the menu link" tier if you include them at all** — never
   presented as access control. Recommend: omit in Session B, revisit in C.
7. **The footer fix is IN SCOPE** (UX-1a): scoped to user-actions.tsx, not
   dialog.tsx — move overflow to the body div, footer stays visible, add
   the dirty-state guard intercepting onOpenChange with an AlertDialog
   confirm. The audit sized it ~30 lines, 1 file. The stale-reopen bug
   (state not reset on close) rides along. UX-1b/c stay out.
8. **UM-2 stays separate. DEBT-49 (isCorporate) stays OUT of the modal.**
   Do not add it while you are in there.
9. **Per-user-per-store granularity is OUT** — recorded limitation. The
   live example: kevajuice14@icloud.com is one MANAGER device account
   assigned to Las Brisas + South Reno; "no labor at one store, yes at the
   other" is not expressible per-user. The v1 answer is two device
   accounts. State this limitation in the grid UI copy (one line), so an
   admin dialling a multi-store device down knows the override follows the
   account everywhere.

---

## Task B1 — schema

Additive migration adding the override column to `User`, following the
hand-authored `migrate diff` flow in `CLAUDE.md`. Present the SQL and echo
the database host BEFORE anything runs; Gary approves and runs migrations
per house rule. Default null/empty = no overrides = pure role baseline.

## Task B2 — the capability layer

- Widen `can()` per ruling 2. `PermissionUser` grows an optional override
  member; absent = no restriction (backward compatible with every existing
  `{ role }` call site so Session C can migrate incrementally).
- The audit named the real cost: can() is synchronous, overrides live in
  the DB. Load the override set ONCE per request alongside the existing
  user resolution (getCurrentUser / getUserStoreScope are the natural
  points) and thread it. For this session, thread it through the
  ALREADY-LOAD-BEARING surfaces (the audit's Class A set — forecasting,
  inventory analytics/costs, dashboard goal, checklist create, staff sync,
  and the sidebar's server-provided props). Do NOT attempt all 41 call
  sites' callers if some are unreachable without Session C migrations —
  report which were threaded and which await C.
- The sidebar receives role as a prop from (app)/layout.tsx; the denied
  set rides the same prop path, serialized. Note the audit's caveat that
  sidebar filtering is UX, not enforcement — enforcement is the server
  checks.
- Deny-by-default and ruling 4's fail-closed shape enforced in code.
  Elevation impossibility must be demonstrable by pointing at the code:
  ceiling first, early return, override can only subtract.

## Task B3 — the grid UI

In the Edit User modal (user-actions.tsx), below role and stores:
- One row per load-bearing capability (ruling 5's list), grouped by
  feature area, each a toggle. Everything the role grants renders ON;
  denied entries OFF; capabilities the role does NOT grant render as
  locked-off (visible, disabled, "not granted by role") — the UI-level
  expression of restrict-only. There is no control that grants.
- Per ruling 7, fix the footer/scroll/dirty-state in the same file first,
  then add the grid — do not add rows to a broken form.
- Save path: extend the existing PATCH /api/users/[id] (it already
  validates org-scoped storeIds — follow its shape). Server-side, reject
  any submitted capability not in the registry, and IGNORE (do not store)
  denials of capabilities the role does not grant — denying what you
  never had is a no-op, storing it is clutter with future-role landmines.
  Decide and state: does a role CHANGE clear stored denials that the new
  role does not grant? Recommend yes, with the reasoning in a comment.
- ADMIN self-lockout guard: an admin must not be able to deny themselves
  users.manage-equivalent access... except users.manage is not yet
  load-bearing (Session C). Check the Class A list for any capability
  whose self-denial by the acting admin would strand them, and block that
  case server-side. If none exists yet, note it as a Session C
  requirement instead of building speculative guards.

## Task B4 — acceptance test (staging checklist for Gary)

The audit's Class A set means the honest acceptance test today is
forecasting + inventory analytics, on a real device account:
1. Baseline: kevajuice06@icloud.com (MANAGER, South Reno) sees inventory
   analytics and forecasting per MANAGER baseline.
2. Gary (ADMIN) opens Edit User for kevajuice06, toggles OFF
   inventory.analytics.view. Save.
3. As kevajuice06: analytics nav gone, analytics pages refuse, the 12
   gated APIs 403. Forecasting unchanged. (Include exact URLs.)
4. Toggle back ON; confirm restoration.
5. The negative: verify by inspection AND by attempted request that no
   input exists — UI or API — that grants a capability above the role
   ceiling. Constructing an elevating override must be impossible, not
   merely rejected.
6. Browser evidence names its org id; any DB check names its branch.

## Constraints

- Every decision routes through can()/scope(). No inline role checks
  added anywhere, including the new UI's server actions.
- Additive-only schema. Migration SQL approved before running.
- Do not touch ../froot_docs/. Commit when asked; never push.
- npm run lint is not a gate (DEBT-33). next build must pass.
- Out-of-scope findings: triage per the standing FIX NOW / RULING NOW /
  COMMENT / ROW protocol before the report. A row is the last resort.

## Explicitly NOT in scope

- Session C: the ~45-site migration sweep (Staff ~18, Users 8, Templates
  7, Stores 5, Settings 2, Dashboard 2, Reports 1) that makes Gary's two
  motivating examples ("inventory yes / staff no" and "staff view /
  no edit") expressible. B ships the machinery; C makes it reach.
- HR migration (35 routes, 13 pages — its own future row per the audit).
- UM-2, DEBT-49, DEBT-55 (the org-guard sweep), per-store granularity.

## Report back

1. SHA before/after; migration SQL as approved and the DB host echo.
2. The exact can() diff and where the override set is loaded and threaded;
   which Class A surfaces are covered and anything deferred to C.
3. How elevation is impossible, by construction — point at the lines.
4. The fail-closed behavior: what a load failure looks like to the user.
5. The grid's capability list source and the role-change/denial-clearing
   decision with reasoning.
6. The footer/dirty-state diff summary.
7. The staging checklist (Task B4) ready for Gary.
8. Triage buckets with counts; commit SHAs; explicit unpushed line.
