# Permissions Enforcement Inventory (PERM-1)

Surveyed 2026-07-25 on `staging` for the PERM-1 permission capability shim
(`docs/prompts/PERM-1_permission_capability_shim.md`). This document is the
input for phases 2–5 (call-site migration, DB-backed permission sets, admin UI,
actual restriction). **Nothing in this document is a change — it records what
the code enforces today**, including gaps and contradictions, which are listed
but deliberately not fixed in PERM-1.

Roles: `ADMIN`, `MANAGER`, `STORE`, `STAFF` (Prisma `User.role`; Clerk only
distinguishes `org:admin` vs `org:member` — see UM-1 truth table in
`docs/DECISIONS.md`). "Any member" below = any authenticated user of the org,
regardless of role. "Scoped" = limited to the caller's `StoreUserAssignment`
store list (ADMIN is always org-wide).

Enforcement types:
- **route-guard** — layout/page-level redirect or notFound
- **handler** — server check inside an API route handler
- **data-scope** — query filtered by store assignment / org / self
- **client-render** — button/tab hidden client-side only
- **nav-only** — sidebar `roles: [...]` filtering and similar

---

## 0. Enforcement primitives (where the logic lives)

| Helper | File | What it enforces |
|---|---|---|
| `clerkMiddleware` + `isPublicRoute` | `src/proxy.ts` | Session required everywhere except `/`, sign-in/up, `/accept-invite`, `/api/webhooks/*`, `/api/cron/*`, `/menu` |
| `getOrgId` / `getOrganization` | `src/lib/auth.ts` | Org session + org row exist (throws) |
| `requireModule(m)` | `src/lib/auth.ts` | `activeModules` per-org toggle |
| `hrModuleAvailable` / `laborModuleAvailable` | `src/lib/auth.ts` | Env availability gates (+ internal-org dogfood lists) |
| `getCurrentUser` | `src/lib/auth.ts` | Session + org + db user w/ store assignments |
| `requireAdmin` | `src/lib/auth.ts` | role === ADMIN (throws) |
| `requireManagerOrAdmin` | `src/lib/auth.ts` | role ∈ {ADMIN, MANAGER} (throws) |
| `getUserStoreScope` | `src/lib/auth.ts` | `{isAdmin, storeIds, role}` — store allow-list |
| `getActiveStaffSelf` | `src/lib/auth.ts` | The one `/my/*` gate: HR gates + linked ACTIVE StaffMember (self-scope) |
| `requireCountsContext` / `requireCount` | `src/lib/count-access.ts` | Inventory module + `{isAdmin, canManage, storeIds}`; count resolved in scope |
| `adjustmentRouteContext` / `canAccessStore` | `src/lib/adjustments.ts` | Inventory module + same scope shape (no role floor) |
| `requireForecastContext` / `requireForecastStore` | `src/lib/forecasting-access.ts` | View = ADMIN+MANAGER; `{write:true}` = ADMIN only; org-scoped store |
| `requireLaborView` / `requireLaborContext` / `requireLaborStore` | `src/lib/labor-access.ts` | Labor gates → 404; view = any member; context = ADMIN+MANAGER (write==read); store scoped for non-admin |
| `requireHrDocumentAccess` | `src/app/api/hr/documents/access.ts` | HR gates; read = any member, `{admin:true}` = ADMIN |
| `requireHrTrainingAccess` | `src/app/api/hr/training/access.ts` | HR gates + ADMIN (builder tier) |
| `requireHrTrainingManageAccess` + `findManageableStaffMember` | `src/app/api/hr/training/access.ts` | HR gates + ADMIN/MANAGER; manager limited to staff in own stores |
| `requireManageableStaff` | `src/app/api/staff/access.ts` | HR gates + ADMIN/MANAGER; target staff in scope (404 outside) |
| `requireNoteAccess` | `src/app/api/staff/[id]/notes/access.ts` | HR gates + ADMIN/MANAGER + staff-in-scope |
| `canReadHrSignedRecord` / `canReadHrFile` | `src/lib/hr-files.ts` | Signed-PDF tier: ADMIN, or MANAGER with the staff member in scope |
| `loadSubmissionForManage` | `src/app/api/hr/forms/shared.ts` | ADMIN/MANAGER + staff-in-scope for form submissions |
| `CRON_SECRET` bearer check | `src/app/api/cron/*` | Vercel cron auth (no session) |
| Svix / Square signature verification | `src/app/api/webhooks/*` | Webhook authenticity (no session) |

---

## 1. Enforcement inventory

Row IDs (SH-, NV-, PG-, PL-, IV-, FC-, LB-, HR-, MY-, SQ-, IG-, WH-) are
referenced by the capability registry in §5.

### 1a. Shell & middleware

| ID | File path | What it guards | Roles allowed today | Enforcement type |
|---|---|---|---|---|
| SH-1 | `src/proxy.ts` | Every non-public route | Any signed-in session | route-guard (auth only, no roles) |
| SH-2 | `src/app/(app)/layout.tsx` | Admin shell — STAFF with linked staff profile + HR gates on → `redirect("/my")` | ADMIN/MANAGER/STORE + unlinked/HR-off STAFF | route-guard (UI lock only; STAFF API surface unchanged — HR-9 planned) |
| SH-3 | `src/app/(app)/layout.tsx` | `staffHasChecklists` store-proxy (STAFF checklists nav signal) | STAFF w/ open checklist at assigned store | data-scope (feeds nav-only filter) |
| SH-4 | `src/app/(my)/layout.tsx` | Nothing — presentation only; every `/my` page self-guards | — | none |

### 1b. Sidebar nav (`src/components/layout/sidebar.tsx`) — nav-only

| ID | Item (href) | Roles in `roles: [...]` | Extra condition |
|---|---|---|---|
| NV-1 | /dashboard | ADMIN, MANAGER, STORE, STAFF | — |
| NV-2 | /checklists | ADMIN, MANAGER, STORE, STAFF | STAFF additionally needs `staffHasChecklists` |
| NV-3 | /messages | ADMIN, MANAGER, STORE, STAFF | — |
| NV-4 | /templates | ADMIN | — |
| NV-5 | /stores | ADMIN, MANAGER | — |
| NV-6 | /users | ADMIN | — |
| NV-7 | /staff | ADMIN, MANAGER | — |
| NV-8 | /reports | ADMIN, MANAGER | — |
| NV-9 | /forecasting | ADMIN, MANAGER | — |
| NV-10 | /store-view | ADMIN, MANAGER, STORE | — |
| NV-11 | /instagram | all four | `instagramEnabled` (connected + toggle) |
| NV-12 | /hr | all four | HR gates; STAFF item relabeled "My Documents" → /my/documents |
| NV-13 | /labor (Weekly Plan) | ADMIN, MANAGER | Labor gates |
| NV-14 | /settings/labor (Labor) | ADMIN, MANAGER | Labor gates |
| NV-15 | Inventory section (11 items) | Ingredients/Sales Items/Counts/Adjustments/Purchase Orders: ADMIN, MANAGER, STORE · Recipes/Storage Areas/Vendors/Expected Stock/Alerts/Reports: ADMIN, MANAGER | `activeModules` includes inventory |
| NV-16 | Settings link | ADMIN (`canSeeSettings`) | — |
| NV-17 | Alerts badge fetch | ADMIN, MANAGER (`showAlertBadge`) | inventory active |

### 1c. Pages & layouts (server route guards)

| ID | File path | What it guards | Roles allowed today | Enforcement type |
|---|---|---|---|---|
| PG-1 | `(app)/dashboard/page.tsx` | Dashboard | Any member; stores scoped; counts card data ADMIN/MANAGER | data-scope |
| PG-2 | `(app)/checklists/page.tsx` | Checklist list | Any member, scoped | data-scope |
| PG-3 | `(app)/messages/page.tsx` | Messages | Any member, scoped | data-scope |
| PG-4 | `(app)/templates/layout.tsx` | All /templates/* pages | ADMIN + **MANAGER** (redirect otherwise) | route-guard |
| PG-5 | `(app)/templates/page.tsx` | Template list | ADMIN (redirect) | route-guard |
| PG-6 | `(app)/templates/[id]`, `[id]/edit`, `new` pages | Template detail/edit/new | Layout tier only → ADMIN+MANAGER reachable | route-guard (layout only) |
| PG-7 | `(app)/stores/layout.tsx` + `page.tsx` | Stores | ADMIN+MANAGER; list scoped; add/edit buttons ADMIN | route-guard + data-scope + client-render |
| PG-8 | `(app)/users/page.tsx` | Users admin | ADMIN (redirect) | route-guard |
| PG-9 | `(app)/staff/layout.tsx` + `page.tsx` | Staff directory | ADMIN+MANAGER; list scoped; add/import ADMIN-only buttons | route-guard + data-scope + client-render |
| PG-10 | `(app)/staff/[id]/page.tsx` | Staff detail | ADMIN org-wide, MANAGER in-scope (404 outside); HR gates; notes tab ADMIN/MANAGER | route-guard + data-scope |
| PG-11 | `(app)/reports/layout.tsx` + `page.tsx` | Reports | ADMIN+MANAGER; data scoped | route-guard + data-scope |
| PG-12 | `(app)/forecasting/page.tsx` | Forecasting | ADMIN+MANAGER (redirect); edit UI ADMIN (`isAdmin` prop) | route-guard + client-render |
| PG-13 | `(app)/store-view/page.tsx` | Store View | **Any member** (incl. STAFF), scoped | data-scope (role restriction is nav-only) |
| PG-14 | `(app)/store-view/checklist/[id]/page.tsx` | Checklist execution | Any member, store-scoped (404 outside) | data-scope |
| PG-15 | `(app)/settings/page.tsx` | Settings hub | ADMIN (redirect) | route-guard |
| PG-16 | `(app)/settings/labor/page.tsx` | Labor config | Labor gates + ADMIN/MANAGER (redirect); stores scoped | route-guard + data-scope |
| PG-17 | `(app)/labor/page.tsx` | Weekly Plan page | Labor gates; **any member** (role restriction is nav-only); stores scoped | route-guard (gates) + data-scope |
| PG-18 | `(app)/instagram/page.tsx` | Instagram feed page | Any member when connected+enabled | route-guard (feature gate only) |
| PG-19 | `(app)/items/page.tsx` | Menu Items (Square catalog metadata) | Any member (page not in nav at all); sync button ADMIN | client-render only |
| PG-20 | `(app)/inventory/ingredients`, `sales-items`, `counts`, `counts/[id]`, `adjustments`, `purchase-orders`, `purchase-orders/[id]` pages | Inventory operational surfaces | Any member (module-gated), scoped; manage affordances via `canManage`/`isAdmin` props | data-scope + client-render |
| PG-21 | `(app)/inventory/recipes`, `recipes/[id]`, `storage-areas`, `vendors` pages | Inventory asset surfaces | **Any member** (nav says ADMIN/MANAGER; no server role check); manage UI `canManage` | data-scope + client-render (role restriction nav-only) |
| PG-22 | `(app)/inventory/expected`, `alerts`, `reports`, `orders/new`, `purchase-orders/new`, `ingredients/deleted`, `ingredients/duplicates` pages | Inventory manager surfaces | ADMIN+MANAGER (redirect) | route-guard |
| PG-23 | `(app)/hr/page.tsx` | HR hub | HR gates; any member; cards conditional (compliance ADMIN/MANAGER; documents/forms/training links ADMIN) | route-guard (gates) + client-render |
| PG-24 | `(app)/hr/documents/page.tsx` | Document library | HR gates; any member; manage buttons ADMIN | route-guard + client-render |
| PG-25 | `(app)/hr/documents/[id]/page.tsx` | Document config (checkpoints/anchors) | ADMIN (notFound) | route-guard |
| PG-26 | `(app)/hr/forms/page.tsx`, `forms/[id]/page.tsx` | Form builder | ADMIN (notFound) | route-guard |
| PG-27 | `(app)/hr/forms/[id]/submit/page.tsx` | Supervised form execution | ADMIN/MANAGER; manager limited to staff in own stores (notFound) | route-guard + data-scope |
| PG-28 | `(app)/hr/training/page.tsx`, `new`, `[id]/edit` | Training builder | ADMIN (redirect) | route-guard |
| PG-29 | `(app)/hr/training/[id]/preview/page.tsx` | Training preview (HR-17) | ADMIN org-wide; MANAGER for modules applying to their stores | route-guard + data-scope |
| PG-30 | `(app)/hr/signed-records/page.tsx` | Signed-records list | ADMIN (notFound) | route-guard |
| PG-31 | `(app)/hr/compliance/page.tsx` | Compliance rollup | ADMIN org-wide; MANAGER scoped (notFound otherwise) | route-guard + data-scope |
| PG-32 | `(app)/hr/acknowledge/[documentId]/page.tsx` | Signing ceremony (self or attest) | Self: any member w/ staff link; attest (`?staff=`): ADMIN/MANAGER, manager in-scope | route-guard + data-scope |
| PG-33 | `(my)/my/*` pages (home, documents, records, training, messages, instagram) | Staff portal | Linked ACTIVE staff member only (`getActiveStaffSelf`); everything self-scoped | route-guard + data-scope |
| PG-34 | `src/app/print/template/[id]`, `print/checklist/[id]` | Print views | Any member (org-scoped only) | data-scope (org only) |
| PG-35 | `src/app/page.tsx`, `(auth)/*` | Landing/sign-in/up | Public | — |

### 1d. Platform APIs

| ID | File path (`src/app/api/`) | What it guards | Roles allowed today | Enforcement type |
|---|---|---|---|---|
| PL-1 | `checklists` GET | Checklist list | Any member, scoped | data-scope |
| PL-2 | `checklists` POST | Checklist creation | **Any member; any org store** (store checked org-owned but NOT against caller's scope) | handler (org only) |
| PL-3 | `checklists/[id]/submit`, `task-log`, `handoff-messages` | Checklist execution/logs | Any member, store-scoped | handler + data-scope |
| PL-4 | `corporate-updates` GET | Corporate updates feed | Any member, scoped | data-scope |
| PL-5 | `corporate-updates` POST; `corporate-updates/[id]` PATCH/DELETE | Corporate updates manage | ADMIN | handler |
| PL-6 | `messages` GET/POST; `[id]/reactions`; `mark-read` | Team messaging | Any member, store-scoped | handler + data-scope |
| PL-7 | `messages/[id]` PATCH/DELETE | Message edit/status/ack/delete | Store-scoped; status+ack changes ADMIN/MANAGER; delete author or ADMIN/MANAGER | handler + data-scope |
| PL-8 | `dashboard/summary`, `sales`, `rollup`, `comms` GET | Dashboard cards | Any member, store-scoped | handler + data-scope |
| PL-9 | `dashboard/goal` PUT | Manual monthly goal | ADMIN/MANAGER + store scope | handler |
| PL-10 | `templates` GET/POST/PATCH/DELETE, `templates/[id]`, `export`, `import` | Template CRUD + transfer | ADMIN (every method) | handler |
| PL-11 | `stores` GET | Store list | Any member, scoped | data-scope |
| PL-12 | `stores` POST; `stores/[id]` PATCH/DELETE | Store CRUD | ADMIN | handler |
| PL-13 | `stores/[id]/templates` GET | Store's templates | Any member, store-scoped | handler |
| PL-14 | `users` GET/POST; `users/[id]` PATCH/DELETE; `users/invitations/[id]` DELETE | User management + invites | ADMIN (+ server-side self-role-change, last-admin, self-removal, STAFF-link guards — UM-1) | handler |
| PL-15 | `staff` GET | Staff directory list | **Any member** (scoped for non-admin) | data-scope (no role floor) |
| PL-16 | `staff` POST | Staff member creation | **Any member — no role check at all** | handler (org only) |
| PL-17 | `staff/[id]` GET/PATCH; `terminate`; `reactivate`; `resync-square`; `square-writeback`; `invite` | Staff record lifecycle | ADMIN org-wide; MANAGER in-scope | handler + data-scope |
| PL-18 | `staff/sync-square` POST | Bulk Square staff sync | ADMIN | handler |
| PL-19 | `staff/[id]/documents*` (list/upload-url/create/[docId] PATCH/DELETE) | Manager-uploaded staff docs | ADMIN/MANAGER in-scope (`requireManageableStaff`, HR gates) | handler + data-scope |
| PL-20 | `staff/[id]/documents/[docId]/download` | Staff doc download | Manage tier; OR the staff member themself when `teamVisible` | handler + data-scope |
| PL-21 | `staff/[id]/notes*` | Manager notes CRUD | ADMIN/MANAGER in-scope (HR gates); delete = author or ADMIN | handler + data-scope |
| PL-22 | `upload/message-attachment` POST | Message attachment upload | Any member | handler (org only) |
| PL-23 | `upload/task-attachment` POST, `[taskId]` DELETE | Template-task attachments | **Any member** (org-scoped task) — templates otherwise ADMIN | handler (org only) |
| PL-24 | `upload/po-invoice` POST | PO invoice upload | ADMIN/MANAGER + module + PO in store scope | handler + data-scope |
| PL-25 | `cron/pace-alerts`, `cron/sales-reconcile` | Cron jobs | `CRON_SECRET` bearer (no session) | handler (secret) |
| PL-26 | `webhooks/clerk`, `webhooks/square` | Webhooks | Svix / Square signature (no session) | handler (signature) |
| PL-27 | `../accept-invite/route.ts` | Invite landing router | Public (forwards Clerk ticket) | — |

### 1e. Inventory APIs (all behind `requireModule("inventory")`)

| ID | Route(s) | What it guards | Roles allowed today | Enforcement type |
|---|---|---|---|---|
| IV-1 | `ingredients` GET, `[id]` GET, `vendor-prices` GET, `duplicates` GET, `ingredient-categories` GET, `loss-reasons` GET, `recipes` GET, `recipes/[id]` GET, `vendors` GET, `vendors/[id]` GET + `[id]/adjustments` GET, `sales-items` (via pages), `[id]/weights` | Inventory reads (asset data) | Any member (org-scoped; not store-scoped — assets are org-level) | handler (module) |
| IV-2 | `ingredients` POST/PATCH/DELETE, `restore`, `bulk`, `merge`, `duplicates/dismiss`, `ingredient-categories` writes, `loss-reasons` POST, `sales-items/[id]` + `bulk`, `recipes` writes + `duplicate`, `vendors` writes + `adjustments` POST, `variance-adjustments` POST, `items/[id]/metadata` | Inventory asset writes | ADMIN/MANAGER | handler |
| IV-3 | `ingredients/import` (CSV), `storage-areas/copy` | Bulk import / cross-store copy | ADMIN | handler |
| IV-4 | `storage-areas` GET/POST, `[id]` writes, `assign`, `reorder`, `[id]/ingredients` | Storage areas | Reads any member store-scoped; writes ADMIN/MANAGER + store scope | handler + data-scope |
| IV-5 | `counts` GET/POST, `counts/[id]` GET/PATCH, `lines`, `summary`, `resort-area` | Count execution | Any member, store-scoped (STORE role counts by design) | handler + data-scope |
| IV-6 | `counts/[id]/finalize`, `corrections` | Count finalize/corrections | ADMIN/MANAGER (+ store scope via `requireCount`) | handler + data-scope |
| IV-7 | `purchase-orders` GET, `[id]` GET, `receive` | PO reads + receiving | Any member, store-scoped (receiving is a STORE-floor action) | handler + data-scope |
| IV-8 | `purchase-orders` POST, `[id]` PATCH, `submit`, `cancel`, `orders` POST (Smart Cart) | PO create/manage | ADMIN/MANAGER + store scope | handler + data-scope |
| IV-9 | `adjustments` GET, `losses`/`prep`/`transfers` POST, `transfers/destinations` GET | Adjustments record/read | Any member + `canAccessStore` store scope | handler + data-scope |
| IV-10 | `alerts` GET, `alerts/count` GET, `expected` GET, `pars` GET, `order-guide` GET, `reports/*` GET (8 report routes) | Alerts/expected/reports reads | **Any member**, store-scoped (pages are ADMIN/MANAGER — API is broader) | handler + data-scope |
| IV-11 | `pars` PUT | Par levels | ADMIN/MANAGER (`canManage`) + store scope | handler |

### 1f. Forecasting APIs

| ID | Route(s) | What it guards | Roles allowed today | Enforcement type |
|---|---|---|---|---|
| FC-1 | `forecasting/plan` GET, `calendar`, `basis`, `day-report`, `export`, `audit` | Forecast reads | ADMIN + MANAGER (managers all locations, read-only — v1 decision) | handler |
| FC-2 | `forecasting/plan` POST, `day`, `month`, `backfill`, `import` | Goal writes | ADMIN only (`{write:true}`) | handler |

### 1g. Labor APIs (all behind both Labor gates → 404)

| ID | Route(s) | What it guards | Roles allowed today | Enforcement type |
|---|---|---|---|---|
| LB-1 | `labor/budget`, `coverage`, `weekly-plan`, `day-adjustment` GET, `day-split` GET, `daypart` GET | Labor reads (dashboard cards + weekly plan) | Any member (`requireLaborView`); store-scoped for non-admin; `canManage` flag = ADMIN/MANAGER | handler + data-scope |
| LB-2 | `labor/settings`, `positions`, `forecast` GET | Labor config reads | ADMIN/MANAGER (`requireLaborContext`) | handler |
| LB-3 | `labor/day-adjustment` POST/DELETE, `day-hours`, `day-split` writes, `daypart` writes, `positions` writes, `settings` writes, `forecast` writes | Labor config/mutations | ADMIN/MANAGER (write==read, v1 decision) + store scope | handler + data-scope |
| LB-4 | `labor/toggle` POST | Per-org Labor toggle | ADMIN (+ availability gate) | handler |

### 1h. HR APIs (all behind HR gates: availability → `activeModules("hr")`)

| ID | Route(s) | What it guards | Roles allowed today | Enforcement type |
|---|---|---|---|---|
| HR-1 | `hr/documents` GET, `[id]/download` GET | Document library reads (reference library) | Any member | handler |
| HR-2 | `hr/documents` POST, `[id]` PATCH, `versions`, `upload-url`, `checkpoints` writes, `anchors` GET/POST, `anchors/rescan` | Document config/manage | ADMIN (`{admin:true}`) | handler |
| HR-3 | `hr/documents/[id]/acknowledgments` GET | Signing status | Self; for another staff member: ADMIN/MANAGER (manager in-scope) | handler + data-scope |
| HR-4 | `hr/documents/[id]/acknowledgments` POST | The signing act | Self-sign: linked ACTIVE staff; attested: ADMIN/MANAGER, manager in-scope (terminated staff allowed for attested backfill) | handler + data-scope |
| HR-5 | `hr/documents/[id]/signed-record` GET/POST | Signed-record generate/lookup | Self, or ADMIN/MANAGER in-scope | handler + data-scope |
| HR-6 | `hr/signed-records/[id]/download` | Executed signed-PDF download | ADMIN, or MANAGER with staff in scope (`canReadHrSignedRecord`; HR-7 rule 5 — staff never download) | handler + data-scope |
| HR-7 | `hr/forms` GET/POST, `[id]` GET/PATCH, `[id]/link` | Form builder | ADMIN | handler |
| HR-8 | `hr/forms/[id]/submissions` GET/POST, `submissions/[id]/countersign`, `signed-pdf` | Form execution/countersign | ADMIN/MANAGER (in-scope via `loadSubmissionForManage`) | handler + data-scope |
| HR-9 | `hr/forms/submissions/[id]/download` | Executed form PDF | Same tier as HR-6 | handler + data-scope |
| HR-10 | `hr/training` GET/POST/PUT, `[id]` all, `export`, `import`, `upload-url`, `lessons/[id]/resources`, `resources/[id]` DELETE | Training builder | ADMIN | handler |
| HR-11 | `hr/training/assignments` POST, `[id]` PATCH/DELETE, `lessons/[lessonId]`, `quiz-result`, `certify`, `certificate`, `attempts/[id]/review` | Training assignment/execution manage | ADMIN/MANAGER, manager limited to staff in own stores; trainer must be an ADMIN/MANAGER user | handler + data-scope |
| HR-12 | `hr/training/resources/[id]/download` | Training resource file | Manage tier; OR staff-self with an assignment containing the resource | handler + data-scope |
| HR-13 | `hr/toggle` POST | Per-org HR toggle | ADMIN (+ availability gate) | handler |

### 1i. Staff portal APIs (`/api/my/*`)

| ID | Route(s) | What it guards | Roles allowed today | Enforcement type |
|---|---|---|---|---|
| MY-1 | `my/signed-records/[recordId]` GET | Own signed-record bytes (view-only proxy) | Linked ACTIVE staff, own records only | handler + data-scope (self) |
| MY-2 | `my/training/[assignmentId]/lessons/[lessonId]`, `quiz` | Own training progress writes | Linked ACTIVE staff, own assignment only | handler + data-scope (self) |

### 1j. Integrations

| ID | Route(s) | What it guards | Roles allowed today | Enforcement type |
|---|---|---|---|---|
| SQ-1 | `square/auth` GET | Start Square OAuth connect | ADMIN *(SEC-1; was any member)* | handler |
| SQ-2 | `square/callback` GET | Square token exchange + store | Session org is the write target; single-use nonce cookie validated *(SEC-1; state was trusted as the org)* | handler |
| SQ-3 | `square/disconnect` POST | Clear Square tokens | ADMIN *(SEC-1; was any member)* | handler |
| SQ-4 | `square/status` GET | Connection status | Any member | handler |
| SQ-5 | `square/locations`, `square/team-members` GET | Square location/team data reads | **Any member** | handler (auth only) |
| SQ-6 | `square/catalog/sync`, `square/sales-items/sync` POST | Catalog syncs | ADMIN + inventory module | handler |
| SQ-7 | `square/catalog/status` GET | Catalog sync status | Any member + module | handler |
| SQ-8 | `square/sales/sync` POST | Sales sync trigger | Any member + module + store scope | handler + data-scope |
| IG-1 | `instagram/auth` GET, `disconnect`, `toggle` | Instagram connect/manage | ADMIN | handler |
| IG-2 | `instagram/callback` GET | Instagram token exchange | Session + **`state` must equal session org** | handler |
| IG-3 | `instagram/status`, `feed` GET | Status/feed reads | Any member | handler |

### 1k. Client-side conditional renders (UI affordances only — every one backed, or *not* backed, by the API rows above)

| File(s) | Conditional |
|---|---|
| `dashboard/dashboard-client.tsx` | `canManageGoal` (ADMIN/MANAGER) goal edit affordance |
| `dashboard/labor-*.tsx`, `labor/weekly-plan-client.tsx` | `canManage` (server-computed flag) manual budget / rebalance affordances |
| `forecasting/forecasting-client.tsx` | `isAdmin` edit vs read-only |
| `inventory/*-client.tsx` (ingredients, counts, storage-areas, vendors, po-detail, sales-items, adjustments) | `canManage` / `isAdmin` props gate add/edit/delete/sync/import buttons |
| `messages/messages-client.tsx` | `isManager` status/ack controls; `isAdmin` corporate-update compose/delete |
| `hr/documents/documents-client.tsx` | `isAdmin` add/edit/archive/generate |
| `staff/page.tsx`, `staff-buttons.tsx`, `staff/[id]/*` | `isAdmin` add/import/edit; `canSeeNotes`; note delete author-or-ADMIN; legal-name controls |
| `users/user-actions.tsx` | Role options; STAFF only in Edit dialog (UM-1 f) |
| `hr/page.tsx` | Cards conditional per role |
| `settings/*-actions.tsx` | Admin-only settings cards (page itself ADMIN) |
| `sidebar.tsx` | The whole §1b table |

---

## 2. Security-gap list — reachable with no (or insufficient) server-side enforcement

Ordered worst-first. **None fixed in PERM-1** (recorded for a follow-up phase).

**A. Write APIs with no role floor:**
1. **`POST /api/staff` (PL-16) — any org member, including STAFF and STORE, can create staff members.** No role check whatsoever; the /staff UI is ADMIN/MANAGER but the API is open.
2. ~~**`GET /api/square/auth` + `POST /api/square/disconnect` (SQ-1/SQ-3) — any org member can initiate the Square OAuth connect or wipe the org's Square tokens.** Instagram's identical surface is ADMIN-only.~~ **RESOLVED — SEC-1 (2026-07-25):** both routes now `requireAdmin`, matching Instagram.
3. ~~**`GET /api/square/callback` (SQ-2) — `state` is trusted as the target org and never compared to the caller's session org.** Any signed-in user (of any org) completing an OAuth dance could attach a Square token to an arbitrary org. Instagram's callback does this check; Square's doesn't.~~ **RESOLVED — SEC-1 (2026-07-25):** callback writes tokens to the *session's* org (state is never a write address) and `state` is a crypto-random single-use nonce validated against a double-submit httpOnly cookie.
4. **`POST /api/checklists` (PL-2) — any member can create a checklist for any store in the org**, ignoring store assignment (GET is scoped; POST isn't).
5. **`POST /api/upload/task-attachment` + `DELETE .../[taskId]` (PL-23) — any member can attach/delete files on template tasks**, though every other template mutation is ADMIN.

**B. Read APIs broader than their pages (information exposure to STORE/STAFF):**
6. `GET /api/staff` (PL-15) — staff directory (names, emails, assignments) readable by any member (store-scoped for non-admins).
7. `GET /api/square/locations`, `/api/square/team-members` (SQ-5) — raw Square location and team-member data readable by any member.
8. Inventory reads (IV-1, IV-10): recipes, vendors, vendor prices/adjustments, alerts, expected stock, pars, order guide, and all 8 `reports/*` analytics routes are open to any member with the module active, while the corresponding pages redirect non-ADMIN/MANAGER.
9. `POST /api/square/sales/sync` (SQ-8) — any member can trigger a Square sales sync for an assigned store.

**C. Pages whose role restriction is nav-only (URL-reachable):**
10. `/store-view` and `/store-view/checklist/[id]` (PG-13/14) — STAFF excluded only by nav.
11. `/labor` Weekly Plan (PG-17) — nav is ADMIN/MANAGER; the page (and LB-1 API) serves any member. Partially deliberate ("read-only for viewers"), but the nav and the guard disagree.
12. `/inventory/recipes`, `/inventory/storage-areas`, `/inventory/vendors` (PG-21) — nav is ADMIN/MANAGER; pages render for any member with the module.
13. `/templates/[id]`, `/templates/[id]/edit`, `/templates/new` (PG-6) — reachable by MANAGER via the layout tier even though nav, list page, and all template APIs are ADMIN-only (mutations will 403; the edit UI still renders).
14. `/items` (PG-19) — in no nav at all; reachable by any member.
15. Print pages (PG-34) — any member can print any template/checklist in the org.

**D. Known-by-design (documented, listed for completeness):**
16. STAFF `/my` confinement is a UI lock only (SH-2 comment; HR-9 "EMPLOYEE role split" is the planned fix) — a linked STAFF login retains the full STAFF-tier API surface above.

**E. Logged as follow-up phases:**
17. **SEC-2 (logged 2026-07-25):** Instagram OAuth has the same missing-nonce shape SEC-1 fixed for Square — its callback's org-equality check blocks cross-org token planting, but `state` is still the predictable orgId with no CSRF nonce. Deliberately untouched in SEC-1 (Instagram was the reference implementation); with Square hardened, Instagram is now the weaker flow. See ROADMAP `SEC-2`.

---

## 3. Contradiction list — enforcement points that disagree

1. **Square vs Instagram integration management:** Instagram connect/disconnect/toggle = ADMIN (IG-1); Square connect/disconnect = any member (SQ-1/3); Square callback skips the state-vs-session check Instagram performs (SQ-2 vs IG-2). *(Resolved on the Square side by SEC-1, 2026-07-25 — Square now ADMIN + session-org-bound + nonce, making Instagram the weaker flow; that residue is SEC-2 / §2 item 17.)*
2. **Templates three-way disagreement:** nav ADMIN-only (NV-4) · layout allows MANAGER (PG-4) · list page + every API ADMIN-only (PG-5, PL-10). MANAGER can open detail/edit/new pages whose actions all 403.
3. **Staff surface:** pages ADMIN/MANAGER (PG-9) vs `GET /api/staff` any member (PL-15) vs `POST /api/staff` unguarded (PL-16) vs per-record routes correctly tiered (PL-17).
4. **Checklists:** GET store-scoped (PL-1) vs POST org-wide for any member (PL-2).
5. **Inventory pages vs APIs:** PG-22 pages redirect non-managers while their data APIs (IV-10) serve any member; PG-21 pages don't even redirect.
6. **Goal writes:** dashboard manual monthly goal PUT = ADMIN/MANAGER (PL-9), but every Forecasting goal write = ADMIN-only (FC-2). A manager can set the dashboard goal yet not the plan it overrides.
7. **Labor vs Forecasting write tiers:** Labor writes ADMIN+MANAGER, Forecasting writes ADMIN-only — *deliberate* per the decision log (labor-access.ts comment), listed so the registry doesn't "harmonize" it by accident.
8. **Weekly Plan nav vs guard:** NV-13 (ADMIN/MANAGER) vs PG-17/LB-1 (any member, read-only) — the "read-only for viewers" design never got a viewer entry point.
9. **Training certificates naming:** `ensureTrainingCertPdf` still uses `fullName ?? displayName` while signature surfaces are Full-Name-only — documented scope boundary (DECISIONS "Staff Display Name vs Full Name" f), listed as an intentional inconsistency.

---

## 4. Clerk webhook finding (`/api/webhooks/clerk`)

Verified against the PERM-1 "Also check" item:

- **`role` is written only in the `organizationMembership.created` upsert's CREATE branch** (PendingInvite role → Clerk role map → STAFF default). The UPDATE branch writes `{ email }` only.
- `user.updated` writes `{ email }` only. `organization.created` upserts Organization name + slug; `organization.updated` writes **name only** (see caveats below). `organizationMembership.deleted` unlinks `StaffMember.userId` and deletes the user's `StoreUserAssignment` rows — it does not touch `User` columns.
- **Conclusion: a future permission-assignment column on `User` would NOT be clobbered** by any current webhook path while the row exists.
- **Caveat (same one UM-1 recorded for `role`):** if a `User` row is deleted and re-created through the webhook (member removed + re-added), the CREATE branch rebuilds the row from PendingInvite/role-map defaults — any future permission column would come back at its default. Permission assignment should live where this churn can't reach it (or the create path must be taught about it) — a phase-3 design input, no action now.
- The `roleMap` still contains the dead `"org:manager"` entry (no such Clerk role exists — UM-1 a). Harmless; left untouched.

**Org-rename caveats (found 2026-07-25, nothing fixed — logged as HR-14 scope):**

- **`organization.updated` does not propagate `slug`.** The handler destructures `slug` out of the payload and then writes `{ name: org.name }` only. A renamed Clerk org keeps its original Froot `slug` permanently — only `organization.created` ever sets one (`org.slug ?? slugify(org.name)`). Renaming *does* propagate the name, so the row ends up internally inconsistent rather than stale-everywhere.
- **`organization.updated` uses `update`, not `upsert`, with no `try`/`catch`.** It is the only org path in the file without that protection: `organization.created` upserts, and `organizationMembership.created` upserts with an explicit comment that Clerk does not guarantee webhook delivery order. The route's only two `try`/`catch` blocks wrap signature verification and email resolution. If no `Organization` row matches `clerkOrgId` — a Clerk org predating the DB row, or a rename arriving before `organization.created` — Prisma throws P2025, the route 500s, and the rename is lost unless Clerk's retries succeed. Not theoretical: the DB is known to carry fossil org rows while Clerk-side is the source of truth.

---

## 5. Capability registry (Deliverable 2)

Derived strictly from what the code enforces today (§1). Where today's gate is
a whole page by role, the capability stays page-level (no pre-decomposition).
Where enforcement points contradict each other, the capability records the
tier of the **primary server-side enforcement point** (API for actions, page
guard for surfaces), and the contradiction stays in §3 — the shim reproduces
today's per-call-site answers either way.

Convention: `domain.resource.action`. The shim exposes:

```ts
can(user, capability): boolean       // boolean gate
scope(user, capability): unknown     // valued gate — unrestricted for every
                                     // capability in this phase
```

Deny-by-default: unknown capability → `false`.

| Capability | Granted today to | Derived from |
|---|---|---|
| `dashboard.view` | all roles | NV-1, PG-1, PL-8 |
| `dashboard.goal.edit` | ADMIN, MANAGER | PL-9, dashboard-client |
| `checklists.view` | all roles (scoped; STAFF nav needs store-proxy) | NV-2, PG-2, PL-1, SH-3 |
| `checklists.execute` | all roles (scoped) | PL-3, PG-14 |
| `checklists.create` | all roles (today unscoped — gap #4) | PL-2 |
| `messages.use` | all roles (scoped) | NV-3, PG-3, PL-6 |
| `messages.moderate` | ADMIN, MANAGER (delete also author) | PL-7 |
| `corporate.updates.manage` | ADMIN | PL-5 |
| `templates.manage` | ADMIN | NV-4, PG-5, PL-10 |
| `stores.view` | ADMIN, MANAGER (page tier; list API all roles scoped) | NV-5, PG-7, PL-11 |
| `stores.manage` | ADMIN | PL-12 |
| `users.manage` | ADMIN | NV-6, PG-8, PL-14 |
| `staff.view` | ADMIN, MANAGER (page tier; scoped) | NV-7, PG-9/10, PL-15* |
| `staff.manage` | ADMIN, MANAGER (in-scope; create today unguarded — gap #1) | PL-16*, PL-17 |
| `staff.sync.square` | ADMIN | PL-18 |
| `staff.documents.manage` | ADMIN, MANAGER (in-scope) | PL-19, PL-20 |
| `staff.notes.use` | ADMIN, MANAGER (in-scope; delete author-or-ADMIN) | PL-21 |
| `reports.view` | ADMIN, MANAGER | NV-8, PG-11 |
| `forecasting.view` | ADMIN, MANAGER | NV-9, PG-12, FC-1 |
| `forecasting.edit` | ADMIN | FC-2 |
| `storeview.access` | ADMIN, MANAGER, STORE (nav tier; page allows all — gap #10) | NV-10, PG-13 |
| `instagram.view` | all roles (when enabled) | NV-11, PG-18, IG-3 |
| `instagram.manage` | ADMIN | IG-1 |
| `square.manage` | today: any member (gap #2; catalog syncs ADMIN) | SQ-1/3/6 |
| `settings.access` | ADMIN | NV-16, PG-15 |
| `inventory.assets.view` | ADMIN, MANAGER, STORE (nav tier; APIs all-member — gap #8) | NV-15, PG-20/21, IV-1 |
| `inventory.assets.manage` | ADMIN, MANAGER | IV-2 |
| `inventory.import` | ADMIN | IV-3 |
| `inventory.storage.manage` | ADMIN, MANAGER (scoped; copy ADMIN via `inventory.import`) | IV-4 |
| `inventory.counts.execute` | ADMIN, MANAGER, STORE (scoped) | NV-15, IV-5 |
| `inventory.counts.finalize` | ADMIN, MANAGER | IV-6 |
| `inventory.po.view` | ADMIN, MANAGER, STORE (scoped; incl. receiving) | NV-15, IV-7 |
| `inventory.po.manage` | ADMIN, MANAGER (scoped) | IV-8, IV-11, PL-24 |
| `inventory.adjustments.record` | ADMIN, MANAGER, STORE (scoped) | NV-15, IV-9 |
| `inventory.analytics.view` | ADMIN, MANAGER (page tier; APIs all-member — gap #8) | NV-15/17, PG-22, IV-10 |
| `labor.view` | ADMIN, MANAGER (nav tier; API any member — gap #11) | NV-13, PG-17, LB-1 |
| `labor.manage` | ADMIN, MANAGER (scoped) | NV-14, PG-16, LB-2/3 |
| `labor.toggle` | ADMIN | LB-4 |
| `hr.access` | all roles (HR gates on) | NV-12, PG-23 |
| `hr.documents.view` | all roles | PG-24, HR-1 |
| `hr.documents.manage` | ADMIN | PG-25, HR-2 |
| `hr.sign.self` | linked ACTIVE staff (any role) | PG-32, HR-4 |
| `hr.sign.attest` | ADMIN, MANAGER (in-scope) | PG-32, HR-3/4/5 |
| `hr.records.view` | ADMIN (list page); MANAGER in-scope (per-record) | PG-30, HR-5 |
| `hr.records.download` | ADMIN; MANAGER in-scope | HR-6, HR-9 |
| `hr.forms.manage` | ADMIN | PG-26, HR-7 |
| `hr.forms.execute` | ADMIN, MANAGER (in-scope) | PG-27, HR-8 |
| `hr.training.author` | ADMIN | PG-28, HR-10 |
| `hr.training.manage` | ADMIN, MANAGER (in-scope; preview per HR-17) | PG-29, HR-11, HR-12 |
| `hr.compliance.view` | ADMIN, MANAGER (scoped) | PG-31 |
| `hr.toggle` | ADMIN | HR-13 |
| `my.access` | linked ACTIVE staff | PG-33, MY-1/2, `getActiveStaffSelf` |

`*` = the derived tier is what the *page/UI and sibling routes* enforce; the
starred API rows currently under-enforce (see §2). The shim must reproduce
today's behavior at each call site, so migrating a starred call site later is
where the gap gets closed — deliberately not in PERM-1.

**Not in the registry** (enforcement exists but isn't role-based): module
gates (`requireModule`, availability gates), org scoping, webhook/cron secrets,
self-scope resolution (`getActiveStaffSelf`). These remain their own layers;
`can()` sits beside them, not above them.

**`scope()` capabilities in this phase:** every capability returns its
unrestricted value. The first real valued capabilities are expected to be
store scope (today: `getUserStoreScope` — ADMIN=all, else assignment list) and
the manager training-module scope (HR-17) — both listed so phase 3 designs
`scope()` against real shapes.

---

## 6. Out-of-scope findings (text only — nothing fixed)

1. Everything in §2 (the security-gap list) — most urgently PL-16
   (`POST /api/staff`), SQ-1/2/3 (Square connect/disconnect/callback), PL-2
   (checklists POST scope), PL-23 (task attachments).
2. `requireLaborView`'s catch block masks DB errors as 401s (noted in-code as
   a BUG-1 concern; console.error added, but the status is still wrong).
3. Sidebar `role` prop defaults to `"STAFF"` when `dbUser` is null
   (`(app)/layout.tsx` → `Sidebar role={dbUser?.role ?? "STAFF"}`) — a
   session with no `User` row browses with STAFF nav but no API access;
   harmless today, worth an explicit denied state eventually.
4. `hr/acknowledge` attested capture allows attesting for terminated staff by
   design (exit-paperwork backfill) — confirm this survives any future
   `staff.manage` tightening.
5. The dead `"org:manager"` entry in the Clerk webhook role map (UM-1 a).
6. `/items` page is orphaned from nav (PG-19) — decide whether it's a surface
   or a leftover.
7. `dashboard/goal` PUT (PL-9) writing a manual goal a MANAGER can set while
   Forecasting is ADMIN-only (§3 #6) — pick a tier when capabilities go live.
