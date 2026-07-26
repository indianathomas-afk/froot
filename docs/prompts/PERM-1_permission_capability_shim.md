# PERM-1 — Permission capability shim (behavior-preserving)

**Track:** `PERM-` (new track — permissions/authorization). If you'd rather fold this under
the existing `UM-` user-management track, say so before starting; don't decide silently.
**Modules:** Users/roles (primary); read-only survey across all modules
**Roadmap:** New entry `PERM-1` — "Permission capability shim" — status `in_progress`.
Match the existing entry shape in `docs/ROADMAP.yaml`; don't invent new fields.
**Target:** staging only. Do not push. I run all git commands.

---

## Read first

- `docs/MODULES.md` — module-to-path map
- `docs/ROADMAP.yaml`
- `docs/WORKFLOW.md`
- `docs/DECISIONS.md`
- `CLAUDE.md` / `AGENTS.md`

---

## Why this exists

Permission logic today is scattered: role arrays in the sidebar, role checks in route guards,
role comparisons inside server actions and API handlers. Before any of it can be made
configurable, it needs to run through one function.

This phase builds that function and proves it returns exactly what the current scattered logic
returns. **Nothing about what any user can see or do may change in this phase.**

Later phases (not this session): migrate call sites, back the function with database-stored
permission sets, build an admin UI, then actually restrict things. Do not do any of that now.

---

## Hard constraints

- **No schema changes. No Prisma migration. No SQL.** If your plan contains a schema change,
  stop and tell me why instead of proceeding — it means we've misjudged the phase boundary.
- **Zero behavior change.** Every user must see and be able to do exactly what they can today.
- No new dependencies.
- Staging only. Never push.
- Out-of-scope findings: write them in the report-back as text. Do not fix them inline.
- Never write to the sibling `froot_docs/` folder.

---

## Audit-first

Read, present a plan, **wait for my explicit approval before editing anything.**

### Deliverable 1 — the enforcement inventory (this is the real value of the session)

Survey the whole codebase and give me a table of **every** place a permission decision is made:

| File path | What it guards | Roles allowed today | Enforcement type |
|---|---|---|---|

Enforcement types to distinguish:
- **Server route guard** (layout/page-level redirect or throw)
- **Server action / API handler** check
- **Data-layer scoping** (query filtered by store assignment, org, etc.)
- **Client-side conditional render** (button hidden, tab hidden)
- **Nav filtering only** (sidebar `roles: [...]` arrays and similar)

Search for role checks in every form they take — `role ===`, `role !==`, `.includes(role)`,
`roles: [...]` arrays, `ADMIN`/`MANAGER`/`STORE`/`STAFF` string literals, and any helper in
`src/lib/auth.ts` or equivalent.

**Flag separately and prominently:** any route reachable by URL whose only protection is nav
filtering or client-side rendering. That is a live security gap, not a refactor concern.
List them. Do not fix them this session.

**Also flag:** any place where two enforcement points disagree about the same thing (e.g. nav
allows a role the route guard rejects, or two API handlers on the same resource allow different
roles). Inconsistencies are expected — I want the list, not a fix.

### Deliverable 2 — the capability registry

From the inventory, derive a typed capability registry. Naming convention:
`domain.resource.action` — e.g. `forecast.view`, `budget.edit`, `staff.notes.view`,
`staff.terminate`, `training.assign`, `labor.view`, `users.manage`.

- Capabilities are a **TypeScript union type**, not free-text strings. A typo must be a build
  error.
- Derive the list from what the code actually enforces today. Don't speculatively add
  capabilities for restrictions we've discussed but haven't built.
- Where today's logic is coarse (a whole page gated by role), one page-level capability is
  correct for now. Don't pre-decompose.

### Deliverable 3 — the shim

`src/lib/permissions.ts` (confirm the path against `MODULES.md` conventions):

```ts
// Boolean capability check
can(user, capability): boolean

// Scoped/valued capability — returns the limit, not a yes/no.
// Every capability returns its unrestricted value in this phase.
scope(user, capability): unknown
```

- Implementation is **hardcoded role logic** that reproduces today's behavior exactly. No
  database reads, no new tables.
- Include `scope()` in the signature now even though every capability is currently
  unrestricted. Retrofitting valued permissions later is the expensive version.
- **Deny by default:** an unrecognized or ungranted capability returns `false` / no access.
- Document at the top of the file that this is a shim, what phase replaces it, and the rule
  that permission sets restrict below the Clerk role ceiling and never elevate above it.

### Deliverable 4 — one pilot call site (last, and only if 1–3 are clean)

Migrate **the sidebar nav filter only** to use `can()`. Nothing else.

Rationale: a shim with zero callers is unverifiable dead code. The sidebar is display-only and
the lowest-risk possible proof that the function returns correct answers. If migrating it would
require touching anything beyond the sidebar component and the permissions module, stop and
report instead.

### Also check

Confirm the Clerk webhook handler (`/api/webhooks/clerk`) writes only `role` and does not
touch — or would not clobber — any future permission-assignment column on `User`. Report what
you find. Don't change it.

---

## Report back

1. The full enforcement inventory table.
2. Routes protected only by nav filtering or client-side rendering — the security gap list.
3. Enforcement points that contradict each other.
4. The final capability registry, with which inventory rows each capability came from.
5. Confirmation that `next build` passes.
6. Confirmation that the sidebar renders identically for ADMIN, MANAGER, STORE, and STAFF
   before and after the pilot migration.
7. Out-of-scope findings (text only).
8. Any judgment calls you made.

---

## Done criterion

- `next build` passes.
- `docs/ROADMAP.yaml` `PERM-1` entry updated.
- Verified on staging: no visible or functional difference for any role. If anything looks
  different, that is a failure of this phase, not a feature.
