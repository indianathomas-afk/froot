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

// PERM-5. A per-user override, loaded from User.deniedCapabilities. THREE
// STATES by construction — absent, loaded, or failed — and the third one is
// the whole point. A bare `Capability[]` cannot express "the load failed", so
// a failure yields [] and SILENTLY RESTORES THE FULL ROLE BASELINE: the user
// gets more than the admin granted, at exactly the moment something is wrong.
// That shape is forbidden. Build one of these with overridesFrom() below.
export type CapabilityOverride =
  | { loaded: true; denied: ReadonlySet<Capability> }
  | { loaded: false }

// Minimal caller shape: works with a Prisma User, a getUserStoreScope()
// result, or a client component's role prop. Null/undefined/unknown role
// strings deny (a session with no User row has no capabilities).
export type PermissionUser = {
  role: PermissionRole | string | null | undefined
  // PERM-5. ABSENT means "no override layer consulted" — the role baseline,
  // which is what every pre-PERM-5 `{ role }` call site keeps getting. That
  // backward compatibility is deliberate: Session C migrates the remaining
  // inline role checks onto can() incrementally, and an unthreaded call site
  // must not change behaviour on the day this ships.
  overrides?: CapabilityOverride | null
}

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
  | "forecasting.scope.all"
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
  // PERM-6 Task 5: "is exempt from StoreUserAssignment scoping on forecasting
  // reads". Split OUT of forecasting.edit, which was doing both jobs under the
  // name `isAdmin`. They coincide today because both are ADMIN_ONLY — the point
  // is that PERM-5 can now grant one without the other. Granting a MANAGER
  // forecasting.edit used to hand them every sibling store's forecast silently.
  "forecasting.scope.all": ADMIN_ONLY,
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

export function isCapability(value: unknown): value is Capability {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(GRANTS, value)
}

// PERM-5. The ONE place a stored column becomes a CapabilityOverride — every
// load point goes through here so the fail-closed rule is written once.
//
// `undefined` means the column was NOT SELECTED by the query, and it fails
// CLOSED. That is the case worth being loud about: a `select` that forgets
// deniedCapabilities looks identical to a user with no denials, so the quiet
// reading of undefined would hand back the full role baseline and nothing
// would ever look wrong. `null` (a pre-migration row) and [] are genuine
// absences of denials and load normally.
//
// Unregistered strings are DROPPED rather than failing the load: a row naming
// a capability that has since been renamed or removed should not be able to
// deny anything, and should not brick the user either.
export function overridesFrom(stored: string[] | null | undefined): CapabilityOverride {
  if (stored === undefined) return { loaded: false }
  return { loaded: true, denied: new Set((stored ?? []).filter(isCapability)) }
}

// Boolean capability check. Deny by default: unknown role or unregistered
// capability → false.
//
// PERM-5 — THE SEAM. Read the order of the returns below, because it is the
// enforcement of THE ONE RULE (a stored set restricts below the Clerk role
// ceiling and never elevates above it) and it is structural, not conventional:
//
//   * The CEILING is evaluated FIRST and returns before any override is read.
//   * The only `return true` in this function sits AFTER the ceiling check.
//   * The override block below contains no `true` literal at all — it can
//     return false, or defer to a set-membership test whose true case is
//     reachable only once the ceiling has already said yes.
//
// So there is no code path by which an override turns false into true. Adding
// one would mean adding a `return true` above the ceiling check, which is a
// visible, reviewable act rather than an accident. scope() calls can() first,
// so this single insertion covers the scoped/valued path too.
export function can(user: PermissionUser, capability: Capability): boolean {
  // ── Ceiling. Every return below this line is false. ──
  if (!isPermissionRole(user.role)) return false
  const granted = GRANTS[capability]
  if (!granted) return false
  if (!granted.includes(user.role)) return false
  // ── The role allows it. From here an override may only SUBTRACT. ──
  const override = user.overrides
  if (!override) return true // absent → pure role baseline
  if (!override.loaded) return false // fail closed: a failed load restricts
  return !override.denied.has(capability)
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

// ─────────────────────────────────────────────────────────────────────────────
// PERM-5 — THE GRID LIST. The per-user override grid in the Edit User modal
// renders THIS array, not the registry above.
//
// Why not the registry: of its entries, 24 have zero call sites and 15 are
// nav-only. A toggle that does nothing is WORSE than no toggle — an admin who
// flips it believes they restricted someone, and nobody finds out otherwise
// until it matters. Every entry below is enforced server-side, on both the API
// and the page wherever both exist.
//
// B held TWO CAPABILITIES OUT deliberately — `templates.manage` and
// `inventory.po.manage` were enforced only by a page redirect while the APIs
// behind them stayed on inline requireAdmin / requireManagerOrAdmin, so
// denying one would have hidden the page while its endpoints kept answering.
// PERM-5C migrated those routes and both are now in the list below. The
// protocol worked exactly as B wrote it: the grid grew by appending here, in
// one place.
//
// PERM-5C ALSO MIGRATED CAPABILITIES THAT ARE STILL HELD OUT, for the same
// reason B held those two — the enforcement is real but incomplete, and a
// toggle would promise more than it delivers:
//   * stores.view — GET /api/stores is the shared store-list endpoint every
//     page in the app reads, and it serves any member BY DESIGN. Denying
//     stores.view removes the nav entry and the /stores page; that endpoint
//     would keep answering. stores.manage covers the writes and IS below.
//   * settings.access — /settings is a page of toggles whose APIs each carry
//     their own capability (hr.toggle, labor.toggle, instagram.manage,
//     square.manage) and keep their inline checks, because MODULE GOVERNANCE
//     owns them rather than this page. Denying settings.access would hide the
//     page, not the toggles. Note the asymmetry with the others in this list:
//     here the enforcement gap is by design and permanent, so promotion is not
//     a matter of finishing a migration — it would need the toggles to be
//     re-parented under Settings first, which is a different argument.
//   * dashboard.view — see the redirect-target comment in
//     (app)/dashboard/page.tsx. There is no safe destination to bounce a
//     denied user to, because /dashboard is where everything else bounces.
//   * labor.manage — Labor governance is its own ruling (Session C ruling 5).
// PATCH /api/users/[id] enforces this list as the DENIABLE set, so none of the
// four can be denied by a hand-rolled request either. Promoting any of them
// means fixing the gap named above it first, then appending here.
export type EnforcedCapability = {
  capability: Capability
  area: string
  label: string
  // What the admin is actually taking away, in the admin's words. Rendered
  // under the toggle — the capability id means nothing to whoever is reading.
  removes: string
}

export const ENFORCED_CAPABILITIES: readonly EnforcedCapability[] = [
  {
    capability: "dashboard.goal.edit",
    area: "Dashboard",
    label: "Set the daily sales goal",
    removes: "The goal editor on the dashboard, and PATCH /api/dashboard/goal.",
  },
  {
    capability: "checklists.create",
    area: "Checklists",
    label: "Start a checklist",
    removes: "Starting today's checklist for a store from a template.",
  },
  {
    capability: "checklists.create.bulk",
    area: "Checklists",
    label: "Start checklists for every location",
    removes: "The org-wide fan-out that instantiates every store's checklists at once.",
  },
  {
    capability: "stores.manage",
    area: "Stores",
    label: "Import and re-sync locations from Square",
    removes: "Reading the Square location list and re-syncing a store from Square.",
  },
  // PERM-5C append. COARSE BY RULING (Gary, 2026-08-04): one capability covers
  // seeing the member list, inviting, changing roles and stores, removing a
  // member and revoking an invitation. /users IS the management surface and GET
  // /api/users serves nothing else, so a read-only tier would grant "look at
  // the roster and do nothing". Denying this removes all of it, and the copy
  // below says so rather than implying a view tier that does not exist.
  // Self-denial is impossible: PATCH /api/users/[id] refuses caller === target
  // outright — see the lockout argument at that line.
  {
    capability: "users.manage",
    area: "Users",
    label: "Users and invitations",
    removes: "The Users section entirely — the member list, invitations, role and location changes, and removals.",
  },
  // PERM-5C append — B's first held-out capability, released now that
  // /api/templates, /[id], /export and /import all ask it.
  {
    capability: "templates.manage",
    area: "Templates",
    label: "Templates",
    removes: "The Templates section entirely — the page, editing, and import/export.",
  },
  {
    capability: "staff.view",
    area: "Staff",
    label: "Read the staff directory",
    removes: "GET /api/staff — the staff roster.",
  },
  {
    capability: "staff.manage",
    area: "Staff",
    label: "Add and edit staff members",
    removes: "Creating staff records.",
  },
  {
    capability: "staff.sync.square",
    area: "Staff",
    label: "Import team members from Square",
    removes: "Reading the Square team list and running the staff sync.",
  },
  // PERM-5C appends. Both had ZERO call sites when B wrote the list — the state
  // ruling 5 calls worse than no toggle — and both became load-bearing through
  // a single shared guard: api/staff/access.ts for documents (five handlers),
  // api/staff/[id]/notes/access.ts for notes (three).
  {
    capability: "staff.documents.manage",
    area: "Staff",
    label: "Staff document files",
    removes: "Uploading, downloading and deleting files on a staff member's record.",
  },
  {
    capability: "staff.notes.use",
    area: "Staff",
    label: "Manager notes",
    removes: "The Notes tab on a staff member, and writing or editing notes.",
  },
  // PERM-5C append. The only area in the sweep with no API at all — the page
  // is a server component reading Prisma directly — so nav + page is the whole
  // surface and one layout guard closes it completely.
  {
    capability: "reports.view",
    area: "Reports",
    label: "Reports",
    removes: "The Reports section — completion rates and the seven-day checklist rollup.",
  },
  {
    capability: "forecasting.view",
    area: "Forecasting",
    label: "Open Forecasting",
    removes: "The Forecasting page and every /api/forecasting read.",
  },
  {
    capability: "forecasting.edit",
    area: "Forecasting",
    label: "Edit forecast goals",
    removes: "Every forecasting write. Reads are unaffected.",
  },
  {
    capability: "forecasting.scope.all",
    area: "Forecasting",
    label: "Read every location's forecast",
    removes: "Exemption from location scoping — they keep their assigned stores only.",
  },
  {
    capability: "inventory.analytics.view",
    area: "Inventory",
    label: "Inventory reports and stock alerts",
    removes: "Reports, Expected Stock, Alerts, the finalized-count summary, and the 12 APIs behind them.",
  },
  {
    capability: "inventory.costs.view",
    area: "Inventory",
    label: "Costs and vendor pricing",
    removes: "Vendor prices, recipe costs and the order guide.",
  },
  {
    capability: "inventory.assets.view",
    area: "Inventory",
    label: "Ingredient reference data",
    removes: "Ingredient categories, storage areas and pars.",
  },
  {
    capability: "inventory.assets.manage",
    area: "Inventory",
    label: "Edit recipes and vendors",
    removes: "Recipe and vendor editing, and the deleted/duplicate ingredient tools.",
  },
  {
    capability: "inventory.adjustments.record",
    area: "Inventory",
    label: "Record inventory adjustments",
    removes: "Loss, transfer and prep adjustments.",
  },
  // PERM-5C append — B's second held-out capability, released now that the five
  // write endpoints (create, edit, submit, cancel, invoice upload) ask it. The
  // READ tier, inventory.po.view, is OPERATIONAL and untouched: the floor keeps
  // seeing and receiving orders it cannot raise.
  {
    capability: "inventory.po.manage",
    area: "Inventory",
    label: "Raise and edit purchase orders",
    removes: "Creating, editing, submitting and cancelling POs, and invoice uploads. Viewing and receiving are unaffected.",
  },
]

// Feature-area order for the grid, derived from the list so a new area cannot
// be added above and then silently fail to render.
export const ENFORCED_CAPABILITY_AREAS: readonly string[] = [
  ...new Set(ENFORCED_CAPABILITIES.map((e) => e.area)),
]

export function scope(user: PermissionUser, capability: Capability): CapabilityScope {
  // can() first: deny-by-default, and an override can never elevate a role
  // that lacks the capability outright. PERM-5 rides in on this line too — a
  // per-user denial makes can() false, so the scoped path answers "none"
  // without SCOPE_OVERRIDES needing to know the override layer exists.
  if (!can(user, capability)) return { access: "none" }
  const override = isPermissionRole(user.role) ? SCOPE_OVERRIDES[capability]?.[user.role] : undefined
  return override ?? { access: "unrestricted" }
}
