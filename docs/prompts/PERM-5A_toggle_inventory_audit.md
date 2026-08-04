# PERM-5 Session A — Toggle inventory + storage audit (READ-ONLY)

**Track:** PERM (permissions)
**Branch:** staging (read against HEAD; confirm the checked-out SHA in your report)
**Type:** AUDIT ONLY — this session makes ZERO edits. No schema, no code, no
docs changes, no commits. Read, analyze, report, stop.
**Size:** S (the audit); it front-loads Session B, which carries the L build
**Supersedes:** Task 1 of `docs/prompts/PERM-5_per_user_capability_overrides.md`.
Read that file first — its rulings (restrict-only, the provisioning-vs-override
distinction, the churn constraint, the UX-1 footer trap) all still govern.
Where THIS file and that file disagree on facts, this file is current.
**Created:** 2026-08-03

---

## Why this session exists

The PERM-5 build session cannot be scoped until we know **exactly which
capabilities are individually toggleable under the current design**. The
decided UI is a per-user grid of toggles in the Edit User modal — but a grid
can only toggle capabilities that exist in the registry. A feature covered by
one coarse capability cannot express "view but not edit" without registry
surgery first. This session produces the definitive inventory so Session B
builds against facts, not assumptions.

## Corrected facts (the old prompt predates these)

1. **The device population is real, MANAGER-role, and one spans two stores.**
   Production `/users` shows `kevajuice06@icloud.com` (MANAGER, South Reno)
   and `kevajuice14@icloud.com` (MANAGER, Las Brisas + South Reno), both with
   device badges. The old prompt's STORE-baseline framing is fiction — the
   acceptance case is dialing a MANAGER device down.
2. **Per-user overrides follow the user to every assigned store.** kevajuice14
   proves the limitation on day one: "no labor at Las Brisas, yes at South
   Reno" is NOT expressible per-user. The v1 answer is two device accounts.
   Record this as a limitation in your report; do not design around it.
3. **PendingInvite resolution is now deterministic** (d098530, 2026-08-03):
   both role writers resolve by normalised email, newest-createdAt wins, and
   the webhook has a matching orderBy. The create/update branch behaviour of
   `organizationMembership.created` is otherwise unchanged: it still upserts,
   and the CREATE branch still rebuilds a `User` row from defaults.
4. **Still true:** no `user.deleted` and no `organization.deleted` handlers
   (DEBT-47). One email may map to more than one Clerk account (DEBT-50).

---

## Task A1 — THE TOGGLE INVENTORY (the point of this session)

Walk the live capability registry (`docs/PERMISSIONS_INVENTORY.md` §5 and the
grants in `src/lib/permissions.ts`) plus every `can()`/`scope()` call site, and
produce a table with one row per capability:

| Capability | Governs (nav / page / API routes, file:line) | Role baseline | Granularity verdict |

The **granularity verdict** is the deliverable. For each user-facing feature
area (Dashboard, Checklists, Messages, Templates, Stores, Users, Staff,
Reports, Forecasting, Store View, HR, Weekly Plan, Labor, Inventory, Settings),
answer:

- **TOGGLEABLE AS-IS:** denying this one capability cleanly removes the
  feature (nav + page + API together) for one user. Name the capability.
- **PARTIALLY TOGGLEABLE:** view/manage tiers exist (e.g. inventory's cost
  split from PERM-2), so "can see but not edit" is expressible. Name both
  capabilities.
- **COARSE:** one capability covers everything, so "view but not edit" is NOT
  expressible without splitting the capability first. State what a split
  would require and roughly how many call sites it touches.
- **UNGOVERNED:** any surface reached without passing through `can()`/
  `scope()` at all. These are pre-existing gaps; report them, do not fix them.

Test the inventory against Gary's two motivating examples and say explicitly
whether each is expressible today:
- (a) Gary Thomas (MANAGER) keeps `/inventory`, loses `/staff` entirely.
- (b) Gary Thomas keeps `/staff` read access, loses employee editing.

Remember PERM-2's discipline: nav visibility and API access are separate
decisions. A verdict of TOGGLEABLE requires that denying the capability kills
BOTH — a hidden nav entry with a still-answering API is the PERM-2 bug class,
and a 403ing API behind a still-rendered page is its inverse (PERM-3 cleaned
up two of those).

## Task A2 — the override seam

PERM-3 added a `SCOPE_OVERRIDES` table in `src/lib/permissions.ts` and the
roadmap says that is where PERM-5 hooks in. Confirm against HEAD that this is
still true and still the right seam — or say why not. Show the exact
function(s) an override check would live in, and confirm deny-by-default
survives an override that fails to load (must restrict, never open).

## Task A3 — storage shape (analysis only, no decision)

Present the options with their consequences; Gary rules between sessions.
Constraints any shape must satisfy:

1. **Survives membership churn.** The webhook CREATE branch rebuilds `User`
   from defaults on remove-and-re-add. Overrides will not live in
   `PendingInvite`, so there is nothing to restore *from* — which pushes
   toward storage keyed to something churn cannot delete. Note BUILD-2's
   precedent: `defaultStoreId` survives churn because the webhook re-derives
   it; say whether an analogous restore path is even possible for overrides.
2. **Does not grow a new orphan surface.** With no `user.deleted` handler
   (DEBT-47), a durable override table can accumulate rows pointing at users
   who no longer exist — the exact class DEBT-52 just measured. State how
   each candidate shape avoids or bounds this.
3. **Clerk-ID keying caveat:** DEBT-50 means one email can hold two Clerk
   accounts; say what that does to each candidate.
4. **Additive-only schema**, per house rule. Present any SQL for approval;
   nothing runs this session.

## Task A4 — the modal footer

Report the current state of the Edit User modal's Save button (UX-1: below
the fold, no dirty-state guard) with file:line, and estimate what "PERM-5
fixes the footer itself" would touch — so Gary can rule UX-1-first vs
fold-it-in with facts.

---

## Explicitly NOT in scope

- **DEBT-50 / DEBT-52** — duplicate Clerk accounts, org switcher, orphan
  cleanup. Account plumbing, ruled separate.
- **DEBT-49** — isCorporate admin control. Different concern (HR rendering);
  it does NOT ride into the Edit User modal with this work.
- **Per-user-per-store override granularity** — recorded as a limitation only.
- **UM-2** — report facts relevant to the pull-in/stay-separate call; do not
  build it.
- **Fixing anything found.** Out-of-scope findings are text in the report.

## Constraints

- Do not touch `../froot_docs/`.
- ZERO edits of any kind. If you find yourself writing a diff, stop.
- Never push; nothing to commit in an audit session.
- `npm run lint` is not a gate (DEBT-33). No build needed — nothing changes.

## Report back

1. The checked-out SHA the audit ran against.
2. The full toggle-inventory table with granularity verdicts, and the explicit
   yes/no on Gary's two examples.
3. Every COARSE feature with its split cost, and every UNGOVERNED surface.
4. Task A2's seam confirmation.
5. Task A3's storage options with the churn/orphan/DEBT-50 analysis per option.
6. Task A4's footer facts.
7. Anything in this prompt or the old PERM-5 prompt that contradicts the repo.
8. Out-of-scope findings, as text.

## Done criterion

The report above, delivered in-session, with zero edits made. Gary takes it to
planning; Session B (the build) gets its own prompt incorporating the rulings.
