# PERM-8 — Phase A audit: "Import team members from Square" grantable to managers

**Session:** TIER 3, Phase A (read-only). No file outside this one was touched.
**Audited at:** local `HEAD` = `3f917e594391ee61eeccd629339457402f438fe8` (branch `staging`, clean tree apart from the two untracked `docs/prompts/` files).
**Repo gate:** `pwd` = `/Users/garythomas/Claude_Projects/Froot/froot`; remote `origin` = `https://github.com/indianathomas-afk/froot.git` (lowercase `froot`). Gate PASSED.
**Row id:** `PERM-8` is FREE. `docs/ROADMAP.yaml` carries PERM-1 … PERM-7 and no PERM-8.
**No database query was run this session.** No staging observation was made. Every finding below is read from source at the SHA above. Where the report says "measured", it means measured against the code, not against data.

---

## Headline

Three findings decide the size of this work.

1. **The grant direction does not exist.** The per-user override system is denial-only *by construction*, not by omission — `can()` is written so that no code path can turn a role's `false` into `true`, and the file's header states the invariant as a rule the later phases must keep. PERM-8 is the first request to break it.
2. **A grant alone would still not surface the button.** `src/app/(app)/staff/page.tsx:65` reads `isAdmin && can(actor, "staff.sync.square")`. The `isAdmin &&` is deliberate (PERM-5C) and would veto any grant.
3. **RULING NOW — the import cannot determine salaried status at import time, and cannot set `compConfidential` at all.** Gary's ratified addition ("newly imported salaried people default to `compConfidential = ON`") is not implementable as written, because the import never creates the row that column lives on. Detail in §4. This is the item that needs a ruling before Phase B is scoped.

---

## 1. The capability itself

**ID:** `staff.sync.square`
**Baseline:** `ADMIN_ONLY` — `src/lib/permissions.ts:172`
**Declared:** `src/lib/permissions.ts:78`
**Area / label in the grid:** `Staff` / "Import team members from Square" — `src/lib/permissions.ts:557-561`
**Grid `removes:` copy:** "Reading the Square team list and running the staff sync."

It IS in `ENFORCED_CAPABILITIES`, so it is already deniable from the /users grid today. That matters for Phase B: the plumbing that carries this capability from the modal to the database already exists and is exercised. Only the DIRECTION is new.

### Every call site, enumerated

Found by grepping the capability string across `src/` (excluding `src/generated/`), then reading each hit.

| # | Site | What it gates |
|---|---|---|
| 1 | `src/app/api/square/team-members/route.ts:31` | `GET` — reads the Square roster. The import dialog's list. |
| 2 | `src/app/api/staff/sync-square/route.ts:26` | `POST` — the bulk re-sync. |
| 3 | `src/app/(app)/staff/page.tsx:65` | `canSync`, which renders BOTH buttons. |

**Enforcement is at the route, not only the modal — this capability does NOT have `labor.view`'s disease.** Both API routes call `can(actor, "staff.sync.square")` and return 403 before touching Square or Prisma. Verified by reading both routes in full rather than by grepping for the guard's name.

- `team-members/route.ts:29-32` — `getUserStoreScope()` → `can(actor, …)` → 403, placed after the `orgId` check and before the org lookup. This was DEBT-10's fix; the route previously had no role gate at all.
- `sync-square/route.ts:25-26` — the same shape. This was DEBT-20's fix, replacing an inline `isAdmin`. Its own comment (`:21-24`) anticipates PERM-8 exactly: *"on the day someone is granted staff.sync.square by override, this write would 403 while its paired read worked."* That is why the pair is consistent today.

`actor` (not `{ role }`) is passed at both sites, so the per-user override layer IS consulted on both. `actorFor()` at `src/lib/auth.ts:122-126` is the single adapter, and `overridesFrom()` (`permissions.ts:381-384`) fails CLOSED on an unselected column.

**What a failure would have looked like:** either route destructuring `{ isAdmin }` and testing it, or calling `can({ role }, …)` with a bare role object, or the `can()` call sitting after the Square fetch. None of those is present.

---

## 2. Does the grant direction exist? — NO, and it is refused structurally

### How overrides are stored

`User.deniedCapabilities String[]` — `prisma/schema.prisma:156`. The column comment (`:145-155`) states the design: *"capabilities SUBTRACTED from this user's role baseline … Never additive."*

### How they are evaluated

`can()` — `src/lib/permissions.ts:408-419`:

```
if (!isPermissionRole(user.role)) return false
const granted = GRANTS[capability]
if (!granted) return false
if (!granted.includes(user.role)) return false   // ← THE CEILING. MANAGER dies here.
// ── The role allows it. From here an override may only SUBTRACT. ──
const override = user.overrides
if (!override) return true
if (!override.loaded) return false
return !override.denied.has(capability)
```

The header comment at `:399-407` names this as deliberate and load-bearing: the only `return true` sits AFTER the ceiling, and the override block contains no `true` literal at all, *"so there is no code path by which an override turns false into true. Adding one would mean adding a `return true` above the ceiling check, which is a visible, reviewable act rather than an accident."*

`scope()` (`:711-718`) calls `can()` first, so the scoped path inherits the same ceiling.

### The invariant is written down as a rule, not just a behaviour

`src/lib/permissions.ts:23-26`:

> *"Permission sets RESTRICT BELOW the Clerk role ceiling and never elevate above it: a future stored permission set may remove capabilities from a role's baseline below, but **nothing here or in later phases may grant a user something their role does not already allow today**."*

The modal repeats it to the admin in plain words (`user-actions.tsx:355-357`): *"You can restrict below what their role allows, never above it — to give more access, change the role."*

**Confirmed absent:** `grep` for `grantedCapabilities|grantedCaps|extraCapabilities` across `src/` and `prisma/` returns nothing. There is no half-built grant path to finish.

### What Phase B would have to change

This is the honest size of the generalised option:

1. **Schema (additive):** a second column, e.g. `User.grantedCapabilities String[]`. Additive-only, so it satisfies the no-drops rule; needs the hand-authored migration flow (`migrate diff` → review → `db execute` → `migrate resolve` → `generate`).
2. **A second three-state loader** beside `overridesFrom()`. A grant list must fail CLOSED the same way — an unselected column must yield "no grants", which is the safe direction here (the opposite of the denial case, where unselected must yield "deny"). Two adapters with opposite fail-safe directions in one type is the subtle part.
3. **`can()` — a `return true` above the ceiling.** Precedence, spelled out as the prompt requires:

   > `deny` wins over everything. Then: allowed **iff** (role baseline grants it) **OR** (a per-user grant names it) — **minus** any per-user denial. So: `denied → false`, else `baseline || granted`.

   Denial-beats-grant, so revocation is never ambiguous and the existing denial semantics are untouched.
4. **A grantable allow-list**, separate from `ENFORCED_CAPABILITIES`. Without one, the mechanism silently makes *every* registry entry grantable to *every* role — `users.manage`, `settings.access`, `square.manage`, `forecasting.edit`. This list is what implements Gary's scope confirmation (MANAGER only; STORE and STAFF stay locked), and it must be enforced at `PATCH /api/users/[id]`, not only in the modal — mirroring how `DENIABLE` (`api/users/[id]/route.ts:13`) already backstops the denial grid against hand-rolled requests.
5. **`PATCH /api/users/[id]`** — a grant-side twin of the `notDeniable` 400 (`:98-104`) and of the role-change normalisation at `:105` (`nextDenied = registered.filter((c) => can({ role }, c))`, which for grants must invert: keep grants the new role does NOT already have, drop the redundant ones).
6. **The modal** — see §3.
7. **`src/app/(app)/staff/page.tsx:65`** — see §3.

**The lean, stated plainly, as the prompt asks.** Item 3 is a permanent change to the security posture of the whole product: today "MANAGER cannot do X" is guaranteed by one unreachable branch, and afterwards it is guaranteed by a list somebody must maintain correctly forever. Every future reader of `can()` loses the ability to reason "the ceiling is absolute." That is a real and permanent cost, paid once, to buy a capability the product will plausibly want repeatedly.

**The narrow alternative:** a dedicated boolean, e.g. `User.canImportSquareStaff`, checked at the two routes and the page alongside `can()`. It is roughly a third of the work, needs no change to `can()`, and leaves the ceiling invariant intact and true. Its cost is that it is a second permission system — invisible to the override grid's reasoning, and the exact "inline check invisible to the override layer" shape that DEBT-20 was filed to remove. If Gary expects more above-baseline grants later, the boolean is a trap; if this is genuinely a one-off, the boolean is the cheaper and safer change. **This is Gary's call, not the audit's.**

---

## 3. The modal rendering — why Tommy shows a padlock

`src/app/(app)/users/user-actions.tsx:369-397`. One line decides it:

```
const grantedByRole = can({ role }, e.capability)     // :370
```

For `role = "MANAGER"` and `staff.sync.square` (ADMIN_ONLY), this is `false`, and everything downstream follows:

- `:383` `disabled={!grantedByRole}` → the checkbox is immutable
- `:389` `{!grantedByRole && <Lock … />}` → the padlock Gary saw
- `:392` `"Not granted by this role"` → the copy Gary quoted, verbatim

Note `can({ role }, …)` is called with a **bare role object and no overrides** — the modal renders the ROLE CEILING, deliberately, because a denial can only ever be a subtraction from it. A grant model breaks that assumption: the row's state becomes three-valued (baseline-on / granted-on / off) where the checkbox today is two-valued, and `on` at `:371` (`grantedByRole && !denied.has(…)`) plus `effectiveDenied` at `:219-221` both need the grant set threaded in.

**For MANAGER rows only** — the render needs a grantable-list lookup keyed on BOTH capability and the role currently selected in the modal, so the same row still renders as a padlock for STORE and STAFF. The role selector is live in this modal (`effectiveDenied`'s comment at `:214-218` explains that switching role re-computes the ceiling), so this must key off the modal's current `role` state, not the user's saved role.

---

## 4. What the import writes — and the `compConfidential` question

### The import is a TWO-ROUTE flow, and the second route is not the one under audit

Traced end to end from `ImportStaffButton` (`staff-buttons.tsx:150`):

1. `GET /api/square/team-members` (`:167`) — gated `staff.sync.square`. Returns an **allow-list**, built at `team-members/route.ts:62-77`: `id`, `display_name`, `given_name`, `family_name`, `email_address`, plus server-derived `assignedStoreIds` / `primaryStoreId` / `allLocations` / `alreadyImported`. **`wage_setting` is dropped** — explicitly listed among the fields stripped by DEBT-10 (`:50-55`).
2. `POST /api/staff` (`:247`) — gated **`staff.manage`** (`api/staff/route.ts:55`), which is **`MANAGE` — MANAGER already has it**. Body (`:251-256`): `displayName`, `fullName`, `email`, `squareTeamMemberId`, `storeIds`, `primaryStoreId`. Nothing else.

**Tables written by the import:** `StaffMember` (created — `api/staff/route.ts:95-109`) and `StoreStaffAssignment` (nested create, `:104-106`). **That is all.**

### `SquareTeamMemberWage` is NOT on the import path — verified, not assumed

Every access site of the table, enumerated by grepping the Prisma accessor plus the raw-SQL table name across `src/`, `scripts/` and `prisma/`:

| Site | Kind |
|---|---|
| `src/lib/labor-roster.ts:296` (raw `INSERT … ON CONFLICT`) | **WRITE** — the roster sync |
| `src/app/api/square/labor/roster/[id]/route.ts:82` | **WRITE** — the per-member admin edit |
| `labor-roster.ts:356, 451, 487`; `labor-salaried.ts:239, 257`; `api/labor/salaried/route.ts:61, 123, 221, 255` | reads |

The only bulk writer is `writeRoster()`, reached solely from `syncTeamMemberWages()` (`labor-roster.ts:184`), whose only caller is `POST /api/square/labor/roster/sync` (`roster/sync/route.ts:53`) — gated **`square.manage`**, which is `ADMIN_ONLY` and, by design, **NOT in `ENFORCED_CAPABILITIES`**, so it is not deniable and not (under any PERM-8 plan) grantable. That route additionally sits behind `requireSquareLabor()`.

**`compConfidential` is preserved — structurally.** `labor-roster.ts:296-321`: the column is absent from the `INSERT` column list (a new row takes the schema `DEFAULT false`) and absent from the `DO UPDATE SET` list (a resync preserves what an admin set). Both lists are explicit and enumerated. `weeklyHoursOverride` and `isSupervisory` are omitted identically. The comment at `:238-253` states the rule and names the failure mode.

**A manager-triggered import cannot unhide a confidential salary.** It writes neither of the two tables that carry pay, and the payload it consumes has had `wage_setting` stripped server-side before it leaves the API.

**What a failure would have looked like:** `compConfidential` appearing in either SQL list at `labor-roster.ts:305-320`; or `POST /api/staff` accepting a pay field in `postSchema` (`api/staff/route.ts:8-18`); or `writeRoster` being reachable from the import. None is the case.

### ⚠️ RULING NOW — Gary's ratified addition cannot be implemented as written

> *"newly imported salaried people default to `compConfidential = ON`."*

**The import cannot determine salaried status at import time.** Salaried-ness is `payType == "SALARY"` / `annualRate`, which live on `SquareTeamMemberWage` and arrive only via the roster sync. The import's payload has no `wage_setting` (stripped at `team-members/route.ts:62-77`), its POST body has no pay field, and `POST /api/staff` writes no wage row. There is no row on which to set `compConfidential`, and no data from which to decide.

Restated for the decision: **the safety concern the addition was written to answer does not arise on this path.** An import run by a granted manager creates `StaffMember` rows with no compensation data whatsoever. It cannot create a visible salary, because it cannot create a salary.

**One real, narrower effect Gary should still rule on.** `getStoreRoster` (`labor-roster.ts:351-420`) uses `SquareTeamMemberWage` as its row source and left-joins `StaffMember` for a display name (`:373-381`). So for a Square person whose wage row already exists from a prior roster sync:

- **before** the import: the row shows as unnamed (`displayName: null`, rendered "Not in Froot") with its wage governed by `compConfidential`;
- **after** the import: the same row shows **with that person's name attached**.

The money is unchanged — `compVisibleOnRow(viewer, r)` at `:391` still masks `hourlyRate` and `annualRate`, and `compConfidential` is untouched by the import. What changes is that an already-visible wage figure acquires an identity. On a non-confidential row that is an **identity attachment, not a new pay disclosure**, and it is exactly the class of thing Gary said he wants to be present to flag.

**The implementable form of Gary's intent**, if he wants one, is therefore *not* on the import. It would be a rule on the roster sync's INSERT — new wage rows default `compConfidential = true` — which is a **COMP-1 surface and out of PERM-8's scope**, or a deliberate widening Gary would have to authorise. Recorded here; not done.

---

## 5. Blast radius of a grant — the button is not the whole surface

`canSync` (`staff/page.tsx:65`) gates **two** controls at **two** render sites each — `:343-347` (toolbar) and `:359-362` (empty state):

| Control | Route | Effect |
|---|---|---|
| **Import from Square** (`:346`, `:361`) | `GET /api/square/team-members` → `POST /api/staff` | Creates `StaffMember` + `StoreStaffAssignment` rows. |
| **Sync Locations from Square** (`:345`) | `POST /api/staff/sync-square` | **Bulk re-sync. Overwrites every imported member's store assignments, and TERMINATES members Square reports INACTIVE.** |

**The second one is the surface Gary has not yet been asked about.** `api/staff/sync-square/route.ts:57-93`:

- `:60-66` — any member Square lists INACTIVE is passed to `terminateStaffMember()`. Per the route header (`:14-16`) and HR-7 rule 2, that **revokes the person's Clerk login** (records retained, never deleted).
- `:82-91` — `deleteMany` + `createMany` on `StoreStaffAssignment` for every synced member: manual location changes are destroyed. The button's own confirm text says so: *"Manual location changes will be overwritten."*
- `:71-76` — fills a blank `email` from Square. Never clobbers a non-empty one.

So **granting `staff.sync.square` as it stands today hands a manager the power to terminate staff accounts org-wide**, not just to add people. Note also that the re-sync is **org-wide, not store-scoped** — unlike `POST /api/staff`, which restricts a non-admin to their own stores (`api/staff/route.ts:81-83`), `sync-square` iterates every `StaffMember` in the organisation with no store filter.

Enumerated per the guard-coverage rule by searching the COMPONENT names, not the guard: `ImportStaffButton` and `SyncStaffButton` are imported at exactly one place (`staff/page.tsx:4`) and rendered at the three lines above. No importer in another route group; no re-export.

**Also inside the grant, and benign:** `/staff` itself is reachable by MANAGER already (`staff/layout.tsx:18` asks `staff.view`, which is `MANAGE`), so the grant adds no page access. The per-member resync (`api/staff/[id]/resync-square/route.ts:29-32`) is `staff.manage`, deliberately a different capability — a manager already has it, and it is unaffected either way.

**Consequence for the plan:** if Gary wants a granted manager to import but NOT to terminate, `canSync` must be split — the two buttons cannot keep sharing one flag. That is a design decision for him, and it is the main thing §5 exists to surface.

---

## Proposed build plan (NOT started — awaiting approval)

Presented in the shape the prompt asks for. Two open decisions first (§A), then the work (§B).

### A. Decisions needed before Phase B can be scoped

1. **RULING NOW — the salaried default.** The ratified addition is not implementable on the import path (§4). Options: (i) drop it, as the risk it addresses does not exist here; (ii) re-aim it at the roster sync's INSERT default, which is COMP-1 scope and a widening; (iii) something else.
2. **Split `canSync`, or grant both buttons?** Granting as-built includes org-wide staff termination (§5). Recommend splitting so the grant carries Import only.
3. **Generalised grant model, or a dedicated boolean?** The lean and the tradeoff are in §2. Recommend the generalised model **only** if more above-baseline grants are expected; otherwise the boolean.

### B. The work, assuming generalised model + split + MANAGER-only

1. `prisma/schema.prisma` — add `User.grantedCapabilities String[]`. Additive. Hand-authored migration per CLAUDE.md §Database (`migrate diff` → read the SQL → `db execute` → `migrate resolve --applied` → `generate`).
2. `src/lib/permissions.ts` — `grantsFrom()` loader; extend `PermissionUser`; the `return true` above the ceiling in `can()` with the precedence from §2; a `GRANTABLE_CAPABILITIES` list naming `staff.sync.square` and the roles it may be granted to (`MANAGER` only).
3. `src/lib/auth.ts` — thread the new column through `actorFor()`.
4. `src/app/api/users/[id]/route.ts` — accept `grantedCapabilities`; 400 on unregistered, 400 on not-grantable, 400 on a role the capability is not grantable to; normalise against the resulting role. Admin-only write is already guaranteed by `requireUsersManage()` at `:43-45` — **verified, not assumed**; the self-lockout refusal at `:115-138` covers the grant path too since it rejects the whole request before any write.
5. `src/app/(app)/users/user-actions.tsx` — three-valued row for a grantable capability on a MANAGER row; padlock preserved for STORE/STAFF and for every non-grantable capability.
6. **Split `canSync`** in `src/app/(app)/staff/page.tsx:65` into `canImport` (drops `isAdmin &&`, relies on `can()`) and `canSync` (keeps `isAdmin &&`, or its own capability), and update `:343-347` / `:359-362`. **The `isAdmin &&` removal is the single most dangerous line in the plan** — it is the one PERM-5C wrote deliberately, so it needs its own review and its own staging test.
7. **Enforcement is already at both routes** (§1) and needs no change — the 403 for an ungranted manager falls out of `can()`. The acceptance test still exercises it directly.
8. `scripts/verify-comp-confidential.ts` as the regression net; `npm run build` as the gate; two-commit pattern on `staging`; no push.

### Out of scope, recorded not done

F1 (the ungated `defaultHourlyRate` route). Any change to what the import does. COMP-1 surfaces beyond the preservation checks above. The roster-sync `compConfidential` default from §4.
