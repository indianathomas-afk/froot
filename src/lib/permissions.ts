// ─────────────────────────────────────────────────────────────────────────────
// PERM-1 CAPABILITY SHIM — hardcoded role logic, zero behavior change.
//
// This file is a SHIM: it reproduces, capability by capability, exactly what
// the scattered role checks inventoried in docs/PERMISSIONS_INVENTORY.md
// enforce today. It reads no database and stores nothing. It is replaced in
// stages by the later PERM- phases: call-site migration (Phase 2), permission
// sets stored in the database (Phase 3), an admin UI over them (Phase 4), and
// only then actual restriction changes (Phase 5).
//
// ZERO-BEHAVIOR-CHANGE holds only while call sites are UNMIGRATED. The
// codebase contains enforcement points that contradict each other (§3 of
// docs/PERMISSIONS_INVENTORY.md) and API routes that under-enforce relative
// to their pages (§2). A capability here necessarily encodes ONE answer, so
// migrating a contradicted call site onto can() changes which of today's
// disagreeing answers that call site gives. Each contradicted call site in §3
// therefore requires an explicit ruling from Gary before Phase 2 migrates it —
// do not migrate them onto this shim as if the mapping were neutral.
//
// Rules this module must keep as it evolves:
// - DENY BY DEFAULT: an unrecognized or ungranted capability is false / no
//   access. Never invert this.
// - Permission sets RESTRICT BELOW the Clerk role ceiling and never elevate
//   above it: a future stored permission set may remove capabilities from a
//   role's baseline below, but nothing here or in later phases may grant a
//   user something their role does not already allow today.
// - can()/scope() sit BESIDE the other enforcement layers, not above them:
//   module gates (requireModule, hrModuleAvailable, laborModuleAvailable),
//   org scoping, store scoping (getUserStoreScope and friends), self-scope
//   (getActiveStaffSelf), and webhook/cron secrets all remain the call site's
//   responsibility. A true from can() answers "does this role have this
//   capability" — nothing else.
// ─────────────────────────────────────────────────────────────────────────────

export type PermissionRole = "ADMIN" | "MANAGER" | "STORE" | "STAFF"

// Minimal caller shape: works with a Prisma User, a getUserStoreScope()
// result, or a client component's role prop. Null/undefined/unknown role
// strings deny (a session with no User row has no capabilities).
export type PermissionUser = { role: PermissionRole | string | null | undefined }

// The full registry from docs/PERMISSIONS_INVENTORY.md §5. A typo is a build
// error. Derived from what the code enforces TODAY — no speculative entries.
export type Capability =
  | "dashboard.view"
  | "dashboard.goal.edit"
  | "checklists.view"
  | "checklists.execute"
  | "checklists.create"
  | "checklists.create.bulk"
  | "messages.use"
  | "messages.moderate"
  | "corporate.updates.manage"
  | "templates.manage"
  | "stores.view"
  | "stores.manage"
  | "users.manage"
  | "staff.view"
  | "staff.manage"
  | "staff.sync.square"
  | "staff.documents.manage"
  | "staff.notes.use"
  | "reports.view"
  | "forecasting.view"
  | "forecasting.edit"
  | "storeview.access"
  | "instagram.view"
  | "instagram.manage"
  | "square.manage"
  | "settings.access"
  | "inventory.nav.view"
  | "inventory.assets.view"
  | "inventory.assets.manage"
  | "inventory.costs.view"
  | "inventory.import"
  | "inventory.storage.manage"
  | "inventory.counts.execute"
  | "inventory.counts.finalize"
  | "inventory.po.view"
  | "inventory.po.manage"
  | "inventory.adjustments.record"
  | "inventory.analytics.view"
  | "labor.view"
  | "labor.manage"
  | "labor.toggle"
  | "hr.access"
  | "hr.documents.view"
  | "hr.documents.manage"
  | "hr.sign.self"
  | "hr.sign.attest"
  | "hr.records.view"
  | "hr.records.download"
  | "hr.forms.manage"
  | "hr.forms.execute"
  | "hr.training.author"
  | "hr.training.manage"
  | "hr.compliance.view"
  | "hr.toggle"
  | "my.access"

const ALL: readonly PermissionRole[] = ["ADMIN", "MANAGER", "STORE", "STAFF"]
const MANAGE: readonly PermissionRole[] = ["ADMIN", "MANAGER"]
const OPERATIONAL: readonly PermissionRole[] = ["ADMIN", "MANAGER", "STORE"]
const ADMIN_ONLY: readonly PermissionRole[] = ["ADMIN"]

// Role baseline per capability — today's enforcement, verbatim from the
// inventory. Where a capability's inventory row also carries store-/self-
// scoping ("MANAGER in-scope"), that scoping stays at the call site (see
// header); the entry here is the ROLE tier only.
const GRANTS: Record<Capability, readonly PermissionRole[]> = {
  "dashboard.view": ALL,
  // PERM-2 §3 #6 (Gary, 2026-07-26): was MANAGE. A manager could set the
  // dashboard goal that overrides the Forecasting plan they cannot touch
  // (forecasting.edit is ADMIN-only), so the weaker permission won and the
  // stricter one was decorative. ADMIN only; Forecasting stays ADMIN only.
  "dashboard.goal.edit": ADMIN_ONLY,
  // STAFF's nav entry additionally requires the staffHasChecklists store-proxy
  // (SH-3) — a data condition, not a role grant; it stays in the sidebar.
  "checklists.view": ALL,
  "checklists.execute": ALL,
  // PERM-2 §3 #4 (Gary, 2026-07-26): POST /api/checklists INSTANTIATES a
  // store's checklist for today from a template — it does not create a
  // definition. ADMIN-only would take the floor's "Start checklist" tap away,
  // so the tier is operational; the call site additionally requires the target
  // store to be in getUserStoreScope().storeIds (ADMIN unrestricted). Was ALL
  // and org-wide — that was the §2 gap #4 security hole, now closed.
  "checklists.create": OPERATIONAL,
  // The same endpoint's second mode: fan out today's instances across EVERY
  // active store × applicable template in the org. Inherently org-wide — it
  // cannot be store-scoped — so it is ADMIN only (Gary, 2026-07-26).
  "checklists.create.bulk": ADMIN_ONLY,
  "messages.use": ALL,
  "messages.moderate": MANAGE, // delete additionally allows the author (PL-7)
  "corporate.updates.manage": ADMIN_ONLY,
  "templates.manage": ADMIN_ONLY, // §3 #2: templates layout admits MANAGER — needs ruling at migration
  "stores.view": MANAGE,
  "stores.manage": ADMIN_ONLY,
  "users.manage": ADMIN_ONLY,
  "staff.view": MANAGE, // §2 #6: GET /api/staff currently serves any member — needs ruling at migration
  "staff.manage": MANAGE, // §2 #1: POST /api/staff currently unguarded — needs ruling at migration
  "staff.sync.square": ADMIN_ONLY,
  "staff.documents.manage": MANAGE,
  "staff.notes.use": MANAGE, // delete = author or ADMIN (PL-21)
  "reports.view": MANAGE,
  "forecasting.view": MANAGE,
  "forecasting.edit": ADMIN_ONLY,
  "storeview.access": OPERATIONAL, // §2 #10: page itself serves any member — needs ruling at migration
  "instagram.view": ALL, // feature gate (connected+enabled) stays at the call site
  "instagram.manage": ADMIN_ONLY,
  // Today ANY member can connect/disconnect Square (§2 gap #2); catalog syncs
  // are ADMIN. Recorded as today's dominant answer — the whole surface needs
  // Gary's ruling before migration.
  "square.manage": ALL,
  "settings.access": ADMIN_ONLY,
  // PERM-2 §3 #5 (Gary, 2026-07-26): inventory is not one permission — it
  // splits by DATA SENSITIVITY. Operational data (counts, adjustments, pars,
  // item names and units — what a person on the floor with a clipboard needs)
  // is granted to every role; commercial data (vendor prices, COGS, margin,
  // valuation, turnover, variance, vendor spend) is ADMIN/MANAGER via
  // inventory.analytics.view and inventory.costs.view below.
  //
  // NAV VISIBILITY AND API ACCESS ARE DELIBERATELY SEPARATE. The operational
  // grants are ALL because that is what the APIs actually serve — but STAFF-1
  // decided inventory is not part of the staff sidebar, so the nav entries ask
  // inventory.nav.view instead. Keeping them apart is what lets the coming
  // per-user override layer grant one staff member the inventory nav without
  // touching anyone's API access, and vice versa. Do not collapse them back
  // into one capability.
  "inventory.nav.view": OPERATIONAL,
  "inventory.assets.view": ALL,
  "inventory.assets.manage": MANAGE,
  // Commercial: cost and pricing data wherever it is served — vendor prices,
  // recipe costs and cost %, the order guide's case pricing. Separate from
  // analytics.view so the override layer can grant cost visibility without
  // granting the reports surface (Gary, Q6).
  "inventory.costs.view": MANAGE,
  "inventory.import": ADMIN_ONLY,
  "inventory.storage.manage": MANAGE,
  "inventory.counts.execute": ALL,
  "inventory.counts.finalize": MANAGE,
  "inventory.po.view": OPERATIONAL, // includes receiving (IV-7) by design
  "inventory.po.manage": MANAGE,
  "inventory.adjustments.record": ALL,
  // Commercial: the reports surface plus expected stock and low-stock alerts,
  // and the finalized-count summary (valuation / variance / cost drift) whose
  // reviewers are the ADMIN/MANAGER who finalize. Was served to any member —
  // §2 gap #8, closed by PERM-2.
  "inventory.analytics.view": MANAGE,
  // PERM-2 §3 #8 (Gary, 2026-07-26): was MANAGE (nav tier) while
  // requireLaborView and the /labor page have always served any member
  // read-only — the read-only viewer design simply never got an entry point.
  // ALL adds the nav entry; the guard stays read-only for non-managers
  // (labor.manage below is unchanged, and §3 #7 stays deliberately
  // unharmonized).
  "labor.view": ALL,
  "labor.manage": MANAGE,
  "labor.toggle": ADMIN_ONLY,
  "hr.access": ALL, // HR availability + org-toggle gates stay at the call site
  "hr.documents.view": ALL,
  "hr.documents.manage": ADMIN_ONLY,
  // Role tier only — the linked-ACTIVE-StaffMember predicate lives in
  // getActiveStaffSelf / findStaffMemberForUser at the call site.
  "hr.sign.self": ALL,
  "hr.sign.attest": MANAGE,
  // Per-record tier (HR-5/6): ADMIN, or MANAGER with the staff member in
  // scope. The /hr/signed-records LIST page (PG-30) is ADMIN-only today —
  // that page keeps its own check until its migration is ruled on.
  "hr.records.view": MANAGE,
  "hr.records.download": MANAGE,
  "hr.forms.manage": ADMIN_ONLY,
  "hr.forms.execute": MANAGE,
  "hr.training.author": ADMIN_ONLY,
  "hr.training.manage": MANAGE, // manager limited to staff/modules in scope (HR-11, PG-29)
  "hr.compliance.view": MANAGE,
  "hr.toggle": ADMIN_ONLY,
  // Role tier only — the linked-ACTIVE-staff predicate is getActiveStaffSelf's.
  "my.access": ALL,
}

function isPermissionRole(role: unknown): role is PermissionRole {
  return role === "ADMIN" || role === "MANAGER" || role === "STORE" || role === "STAFF"
}

// Boolean capability check. Deny by default: unknown role or unregistered
// capability → false.
export function can(user: PermissionUser, capability: Capability): boolean {
  if (!isPermissionRole(user.role)) return false
  const granted = GRANTS[capability]
  if (!granted) return false
  return granted.includes(user.role)
}

// Scoped/valued capability — returns the LIMIT, not a yes/no. Most granted
// capabilities are unrestricted; today's data scoping (store lists, manager
// training scope) still lives at the call sites (see header). PERM-3 added the
// first genuine limit: a "window" variant carrying how many months past the
// current one a role may see.
//
// "window" is a DISPLAY restriction, not a confidentiality boundary — see
// DECISIONS.md "Forecast read window is a display restriction". Callers null
// out-of-window values; they do not treat them as secrets.
export type CapabilityScope =
  | { access: "none" }
  | { access: "unrestricted" }
  // monthsAhead: 0 = current month only, 1 = current + next.
  | { access: "window"; monthsAhead: number }

// Per-role narrowing BELOW the GRANTS ceiling. A role absent here gets
// { access: "unrestricted" } when can() allows the capability. This table is
// where PERM-5's per-user overrides hook in — one place, as designed.
const SCOPE_OVERRIDES: Partial<Record<Capability, Partial<Record<PermissionRole, CapabilityScope>>>> = {
  // PERM-3 (Gary, 2026-07-26): a manager budgets for the month they are in and
  // the one after it. Forward FORECAST values outside that horizon are hidden
  // so tentative numbers are not presented as authoritative; historical ACTUAL
  // sales stay fully visible (a manager needs last July to budget this July).
  // The window is enforced per request from the store's timezone — see
  // src/lib/forecast-window.ts.
  "forecasting.view": { MANAGER: { access: "window", monthsAhead: 1 } },
}

export function scope(user: PermissionUser, capability: Capability): CapabilityScope {
  // can() first: deny-by-default, and an override can never elevate a role
  // that lacks the capability outright.
  if (!can(user, capability)) return { access: "none" }
  const override = isPermissionRole(user.role) ? SCOPE_OVERRIDES[capability]?.[user.role] : undefined
  return override ?? { access: "unrestricted" }
}
