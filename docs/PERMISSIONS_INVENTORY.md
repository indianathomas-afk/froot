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

## Audit method — GET routes are a write path in this codebase

**A write-path audit that greps only for non-GET handlers has a blind spot
here.** Square sales sync fires from **13 GET handlers**, each of which triggers
outbound Square API calls and `SalesPeriodCache` writes on an ordinary member's
*read*. This is method guidance, not a gap: the routes are gated and the cache is
org-scoped. Verified at HEAD 2026-08-01.

Grep for the helpers **by name — and note that one grep is not enough**:

1. `syncSalesForStore` / `ensureSalesCached` (`src/lib/sales-sync.ts`) — finds
   **8** GET handlers: `dashboard/{sales,summary,rollup}`,
   `inventory/reports/{variance,item-sales,profitability,cogs}`,
   `cron/sales-reconcile`.
2. `computeExpectedInventory` / `computeWeeklyUsage` / `computeLowStockAlerts`
   (`src/lib/expected-inventory.ts`, which calls `ensureSalesCached` internally;
   `computeLowStockAlerts` reaches it via `computeExpectedInventory`) — finds
   **5 more**: `inventory/{order-guide,expected,alerts,alerts/count,pars}`.

**The method failure is the durable part.** Step 1 alone — which is the whole of
the remedy as originally recorded — finds 8 of the 13. The other five never
mention a sync helper; they call the inventory-computation layer, which syncs on
their behalf. Any indirection like this defeats a by-name grep, so the second
step is not optional and the same question should be asked of any new
computation helper.

Three further call sites are non-GET and are not the concern here:
`square/sales/sync` (POST), `forecasting/backfill` (POST), `webhooks/square`
(POST).

Recorded from DEBT-6, which is closed in favour of this note.

---

## 0. Enforcement primitives (where the logic lives)

| Helper | File | What it enforces |
|---|---|---|
| `clerkMiddleware` + `isPublicRoute` | `src/proxy.ts` | Session required everywhere except `/`, sign-in/up, `/accept-invite`, `/api/webhooks/*`, `/api/cron/*`, `/menu/*` (N-3, 2026-11-02: tightened from `/menu(.*)`, which also matched `/menus` etc.; the public nutrition menu, PG-41) |
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
| `requireForecastContext` / `requireForecastStore` | `src/lib/forecasting-access.ts` | View = `can(forecasting.view)`; `{write:true}` = `can(forecasting.edit)` (ADMIN); store scoped to `StoreUserAssignment` for non-admins (PERM-3). Also exposes `viewScope` + `forecastWindowForStore` / `forecastWindowForCaller` |
| `forecastWindowFrom` / `isDateInWindow` / `isMonthInWindow` / `windowYears` | `src/lib/forecast-window.ts` | Pure month math for the MANAGER forecast window (current + next month). No DB — shared by the API guards and the client year selector so they cannot drift |
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

**`/robots.txt` — corrected 2026-07-26 (PERM-2).** Production returns **404**,
not a 307 to sign-in as previously recorded; verified by request on 2026-07-26
(`404`, empty redirect target). The reason is that `src/app/robots.ts` is
staging-only — it arrived with P-3 (`3902d5c`), which has not been promoted.
**Forward risk, from reading the code rather than testing:** the proxy matcher
excludes files by extension but `.txt` is not in that list, and `/robots.txt`
is not in `isPublicRoute`. So once P-3 promotes, an unauthenticated crawler
should start getting a redirect to sign-in instead of the file. Adding
`/robots.txt` to `isPublicRoute` at promotion time is the fix. Not verified
against a live deployment — both staging aliases in `docs/STAGING_SETUP.md`
and `docs/TEMPLATES_IMPORT_EXPORT.md` also return 404, so the staging behavior
was not observable from here.

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
| SH-5 | `next.config.ts` `headers()` (N-3, 2026-11-02, R-1(b)) | Framing. Every path except `/menu/<…>` sends `X-Frame-Options: DENY` + `Content-Security-Policy: frame-ancestors 'none'`; `/menu/<…>` sends `frame-ancestors *` only (the embed, N3-F5). Before N-3 NO route sent either header (production, 2026-11-02, `docs/prompts/N-3_AUDIT.md` § B) | — (header, not a role) | response header |

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
| NV-18 | Nutrition section: Menu Nutrition (/nutrition/menu) · Import Nutrition (/nutrition/import) (N-1, 2026-11-01) · Label Inbox (/nutrition/labels) (N-1e, 2026-11-02) · Serving Settings (/nutrition/settings) (N-2, 2026-11-02) · Public Menu (/nutrition/publish) (N-3, 2026-11-02) | Menu Nutrition: ADMIN, MANAGER, STORE (`nutrition.view`) · Import, Label Inbox, Serving Settings and Public Menu: ADMIN (`nutrition.manage`) | `activeModules` includes inventory AND nutrition (R-4) |

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
| PG-12 | `(app)/forecasting/page.tsx` | Forecasting | `can(forecasting.view)` (redirect); edit UI = `can(forecasting.edit)`; store list scoped to assignments for non-admins (PERM-3) | route-guard + client-render |
| PG-13 | `(app)/store-view/page.tsx` | Store View | **Any member** (incl. STAFF), scoped | data-scope (role restriction is nav-only) |
| PG-14 | `(app)/store-view/checklist/[id]/page.tsx` | Checklist execution | Any member, store-scoped (404 outside) | data-scope |
| PG-15 | `(app)/settings/page.tsx` | Settings hub | ADMIN (redirect) | route-guard |
| PG-16 | `(app)/settings/labor/page.tsx` | Labor config | Labor gates + ADMIN/MANAGER (redirect); stores scoped | route-guard + data-scope |
| PG-17 | `(app)/labor/page.tsx` | Weekly Plan page | Labor gates; **any member** (role restriction is nav-only); stores scoped | route-guard (gates) + data-scope |
| PG-18 | `(app)/instagram/page.tsx` | Instagram feed page | Any member when connected+enabled | route-guard (feature gate only) |
| PG-19 | `(app)/items/page.tsx` | Menu Items (Square catalog metadata) | Any member (page not in nav at all); sync button ADMIN | client-render only |
| PG-20 | `(app)/inventory/ingredients`, `sales-items`, `counts`, `counts/[id]`, `adjustments`, `purchase-orders`, `purchase-orders/[id]` pages | Inventory operational surfaces | Any member (module-gated), scoped; manage affordances via `canManage`/`isAdmin` props | data-scope + client-render |
| PG-21 | `(app)/inventory/recipes`, `recipes/[id]`, `storage-areas`, `vendors` pages | Inventory asset surfaces | **Any member** (nav says ADMIN/MANAGER; no server role check); manage UI `canManage`. N-5 (2026-11-03): `/inventory/recipes` gains a **Modifiers** tab and `recipes/new?modifierId=` builds a modifier recipe — same gates, nothing new | data-scope + client-render (role restriction nav-only) |
| PG-21b | `(app)/inventory/recipes/import/bevspot` page (BEV-1, 2026-11-01) | BevSpot recipe import | ADMIN only: the page redirects anyone else via `getCurrentUser()`; its APIs re-check (IV-3). Entry button on `/inventory/recipes` shown to ADMIN only | handler (page) + client-render |
| PG-22 | `(app)/inventory/expected`, `alerts`, `reports`, `orders/new`, `purchase-orders/new`, `ingredients/deleted`, `ingredients/duplicates` pages | Inventory manager surfaces | ADMIN+MANAGER (redirect) | route-guard |
| PG-23 | `(app)/hr/page.tsx` | HR hub | HR gates; any member; cards conditional (compliance ADMIN/MANAGER; documents/forms/training links ADMIN) | route-guard (gates) + client-render |
| PG-24 | `(app)/hr/documents/page.tsx` | Document library | HR gates; audience-scoped per DOC-1 (ADMIN unnarrowed); **archived rows listed for ADMIN only** (DOC-1 B); manage buttons ADMIN | route-guard + data-scope + client-render |
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
| PG-36 | `(app)/nutrition/menu/page.tsx` (+ `nutrition/page.tsx` → redirect) | Menu Nutrition (N-1) | `nutrition.view`: ADMIN, MANAGER, STORE; upgrade card when inventory or nutrition is off. N-5 (2026-11-03): a **Modifiers** section (signed nutrition per add-on) under the same gate; its **Cost** column renders only for `inventory.costs.view` (ADMIN/MANAGER) — STORE sees nutrition, never cost | route-guard + render (cost column) |
| PG-37 | `(app)/nutrition/import/page.tsx` | Nutrition CSV import (N-1) | `nutrition.manage`: ADMIN; others redirect to /nutrition/menu | route-guard |
| PG-38 | `(app)/nutrition/menu/[salesItemId]/label/page.tsx` (N-2, 2026-11-02) | One item's Nutrition Facts label preview: the serving-size picker (previews only, saves nothing), Print, and — ADMIN only — the item's serving override form (writes via NU-10). Sales item resolved inside the caller's org; unknown, cross-org or no recipe → 404 | `nutrition.view`: ADMIN, MANAGER, STORE; upgrade card when inventory or nutrition is off | route-guard + data-scope (org) |
| PG-39 | `src/app/print/nutrition-label/[salesItemId]` (N-2) | Print view of one item's label (`?serving=` carries the picker's preview size, never saved). Outside the app shell, so it repeats the gate: both modules + `nutrition.view`; anything refused is a 404 | ADMIN, MANAGER, STORE (`nutrition.view`); org-scoped | route-guard + data-scope (org) |
| PG-40 | `(app)/nutrition/settings/page.tsx` (N-2) | Serving Settings: the org's drink serving size and the size table (writes via NU-9) | `nutrition.manage`: ADMIN; other viewers redirect to /nutrition/menu | route-guard |
| PG-41 | `src/app/menu/[slug]/page.tsx` (N-3, 2026-11-02) | **PUBLIC — no session, by design.** The org's nutrition menu, read-only, embeddable (`?embed=1`). Renders ONLY the payload built by `buildPublicMenu` (`src/lib/public-menu.ts`): item and size names, menu group names, rounded label values for fully Verified sizes, allergen labels, disclaimer and cross-contact texts, the org's display name, a last-updated date — never prices, costs, ingredients, recipes, documents, links, user names or ids (pinned by `scripts/verify-n3-public.ts`). Unknown slug, menu off, or inventory/nutrition module off → the same plain 404 | Anyone (public) | public by design — data-scope (slug → one org) + serializer |
| PG-42 | `(app)/nutrition/publish/page.tsx` (N-3) | Public Menu settings: on/off, web address, included menu groups, hidden items, disclaimer and cross-contact texts, live counts, link and embed code (writes via NU-11) | `nutrition.manage`: ADMIN; other viewers redirect to /nutrition/menu; upgrade card when inventory or nutrition is off | route-guard |
| PG-43 | `(app)/nutrition/labels/page.tsx` (N-1e, 2026-11-02) | Label Inbox: drop many label files or add from a link, confirm each file's ingredient (suggested, never assigned), Read all / Read selected with progress and a clean stop at the read limit, the one-card-at-a-time review queue (Apply & mark verified / Apply only / Skip / Discard), and leftovers 7+ days old with "Discard all older than 7 days" (via NU-13 … NU-16, NU-2, NU-7) | `nutrition.manage`: ADMIN; other viewers redirect to /nutrition/menu; upgrade card when inventory or nutrition is off | route-guard |

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
| PL-17 | `staff/[id]` GET/PATCH; `terminate`; `reactivate`; `resync-square`; ~~`square-writeback`~~ (REMOVED — see note below); `invite` | Staff record lifecycle | ADMIN org-wide; MANAGER in-scope | handler + data-scope |
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

**PL-17 — `staff/[id]/square-writeback` is REMOVED, 2026-08-18 (SQ-WB-1, work
commit `0fd414a`).** The row above is preserved as surveyed and the route name
struck rather than deleted, because the row records what was enforced on
2026-07-25 and that reading stays true for that date. The rest of PL-17 —
`GET`/`PATCH`, `terminate`, `reactivate`, `resync-square`, `invite` — is
unchanged, and the gate this row records (`staff.manage`, ADMIN org-wide /
MANAGER in-scope) was correct for the write-back while it existed.

The route was deleted for a reason no permission row could have caught, which is
worth recording HERE rather than only in the decision log: **its gate was sound
and its authorization was not.** `POST /api/staff/[id]/square-writeback` checked
`staff.manage` correctly, then called `PUT /v2/team-members/{id}` against Square
using a credential the merchant never granted — the OAuth scope set requests
`EMPLOYEES_READ` and not `EMPLOYEES_WRITE`, so the write could only ever land via
the `SQUARE_ACCESS_TOKEN` personal-token fallback. A caller who passed every
check in this document still caused a write outside the consent grant. **This
inventory audits Froot's gates on Froot's callers; it says nothing about what
credential a route presents to a third party downstream.** That is a distinct
question and this document has never asked it.

Ruled by Gary 2026-08-18 (`docs/DECISIONS.md`, "Froot is read-only toward Square;
the name write-back dies"): Froot reads Square and never writes it, OAuth
connect/disconnect plumbing excepted, and no write permission will ever be
requested from a merchant. Found by LABOR-0B (`dd7b860`,
`docs/prompts/LABOR-0B_RESULTS.md` findings 1 and 2).

### 1e. Inventory APIs (all behind `requireModule("inventory")`)

| ID | Route(s) | What it guards | Roles allowed today | Enforcement type |
|---|---|---|---|---|
| IV-1 | `ingredients` GET, `[id]` GET, `vendor-prices` GET, `duplicates` GET, `ingredient-categories` GET, `loss-reasons` GET, `recipes` GET, `recipes/[id]` GET, `vendors` GET, `vendors/[id]` GET + `[id]/adjustments` GET, `sales-items` (via pages), `[id]/weights` | Inventory reads (asset data) | Any member (org-scoped; not store-scoped — assets are org-level) | handler (module) |
| IV-2 | `ingredients` POST/PATCH/DELETE, `restore`, `bulk`, `merge`, `duplicates/dismiss`, `ingredient-categories` writes, `loss-reasons` POST, `sales-items/[id]` + `bulk`, `modifiers/bulk` PATCH (N-5, 2026-11-03), `recipes` writes + `duplicate`, `vendors` writes + `adjustments` POST, `variance-adjustments` POST, `items/[id]/metadata` | Inventory asset writes | ADMIN/MANAGER | handler |
| IV-3 | `ingredients/import` (CSV), `storage-areas/copy`, `import/bevspot/preview` + `import/bevspot/apply` (BEV-1, 2026-11-01) | Bulk import / cross-store copy | ADMIN | handler |
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
| FC-1 | `forecasting/plan` GET, `basis`, `day-report` | Forecast reads with no per-day goal payload — annual plan aggregates, last-year basis totals, live actuals | ADMIN + MANAGER (`forecasting.view`), each scoped to assigned stores | handler + data-scope |
| FC-1w | `forecasting/calendar`, `export` | Per-day goal reads | ADMIN + MANAGER; MANAGER's `goal` (and `export`'s derived `variance`) is **nulled outside the current+next-month window** — `basis` and `actual` are not, so full sales history stays readable (PERM-3) | handler + field-mask |
| FC-1a | `forecasting/audit` | Goal-edit history | ADMIN + MANAGER; MANAGER limited to assigned stores **and** to window months (the `before`/`after` metadata is otherwise a back-door read of masked goals) | handler + data-scope |
| FC-2 | `forecasting/plan` PUT, `day`, `month`, `backfill`, `import` | Goal writes | ADMIN only (`{write:true}` → `forecasting.edit`) | handler |

PERM-3 notes: the window is computed **per request** from `Store.timezone`, never
cached across a month boundary, and is inclusive from the 1st of the current
month through the last day of the next (December → next January, crossing the
year). Out-of-window requests are **masked, never rejected** — a 4xx would both
withhold the historical actuals managers are entitled to and reintroduce the §2
"page renders while its API 403s" class. The window is a DISPLAY restriction,
not a confidentiality boundary; see DECISIONS.md "Forecast read window is a
display restriction, not a confidentiality one".

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
| HR-2 | `hr/documents` POST, `[id]` PATCH, `[id]/audience` GET/PUT, `versions`, `upload-url`, `checkpoints` writes, `anchors` GET/POST, `anchors/rescan` | Document config/manage | ADMIN (`{admin:true}`) | handler |
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
| SQ-5a | `square/locations` GET | Square location list for the store import dialog and the Edit Store location picker | ADMIN (`stores.manage`) *(PERM-6 Task 4; was **any member** with the entire Square object spread to the client — now an explicit field allow-list)* | handler |
| SQ-5b | `square/team-members` GET | Square team-member reads for the staff import dialog | ADMIN (`staff.import.square` since PERM-8, 2026-08-29 — same tier, and **grantable to a specific MANAGER**; was `staff.sync.square`, which now covers the bulk re-sync only) *(DEBT-10, 2026-07-28; was **any member** with the entire Square team-member object spread to the client — now an explicit field allow-list. `email_address` is retained because the import dialog writes it to `StaffMember.email`; `phone_number` and every untyped remainder are dropped. First call site of `staff.sync.square`)* | handler |
| SQ-5c | `stores/[id]/resync-square` POST | Re-pull ONE store's Square location record onto its mirrored fields (name, address, phone, timezone, contactEmail) | ADMIN (`stores.manage`) | handler |
| SQ-6 | `square/catalog/sync`, `square/sales-items/sync` POST | Catalog syncs (`sales-items/sync` also reads Square modifier lists since N-5, 2026-11-03 — still `ITEMS_READ`, still read-only) | ADMIN + inventory module | handler |
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
| `forecasting/forecasting-client.tsx` | `isAdmin` edit vs read-only; `windowed` bounds the year selector's forward edge and labels the blanked months |
| `dashboard/dashboard-client.tsx` (Monthly Goal card) | `canViewForecasting` gates the `Forecasting →` link — was ungated for every role (PERM-3) |
| `dashboard/rollup-view.tsx` (Store Ranking header) | `canViewForecasting` gates the `Forecasting →` link — was ungated for every role (PERM-3) |
| `inventory/*-client.tsx` (ingredients, counts, storage-areas, vendors, po-detail, sales-items, adjustments) | `canManage` / `isAdmin` props gate add/edit/delete/sync/import buttons |
| `messages/messages-client.tsx` | `isManager` status/ack controls; `isAdmin` corporate-update compose/delete |
| `hr/documents/documents-client.tsx` | `isAdmin` add/edit/archive/restore/generate, audience chip and Assign action, archived disclosure |
| `staff/page.tsx`, `staff-buttons.tsx`, `staff/[id]/*` | `isAdmin` add/import/edit; `canSeeNotes`; note delete author-or-ADMIN; legal-name controls |
| `users/user-actions.tsx` | Role options; STAFF only in Edit dialog (UM-1 f) |
| `hr/page.tsx` | Cards conditional per role |
| `settings/*-actions.tsx` | Admin-only settings cards (page itself ADMIN) |
| `sidebar.tsx` | The whole §1b table |

### 1l. Nutrition APIs (N-1, 2026-11-01 — all behind `requireNutrition()`: inventory AND nutrition modules → 403 `MODULE_NOT_ACTIVE`, then the capability → 403)

`src/lib/nutrition-access.ts`. Rulings: `docs/DECISIONS.md` 2026-11-01 N-1
(F3 who edits, R-4 both modules). Neither capability is in
`ENFORCED_CAPABILITIES` or `GRANTABLE_CAPABILITIES`, so the role grant is the
whole answer today.

| ID | Route(s) | What it guards | Roles allowed today | Enforcement type |
|---|---|---|---|---|
| NU-1 | `nutrition/ingredients/[id]` GET, `nutrition/recipes/[id]` GET | One ingredient's nutrition/allergens/flag; one recipe's computed breakdown | ADMIN, MANAGER, STORE (`nutrition.view`); org-scoped | handler + data-scope (org) |
| NU-2 | `nutrition/ingredients/[id]` PUT, `nutrition/ingredients/bulk-exempt` POST | Edit nutrition, allergens and the not-food flag | ADMIN (`nutrition.manage`); org-scoped (other orgs' ids never match) | handler + data-scope (org) |
| NU-3 | `nutrition/import/preview` + `nutrition/import/apply` POST | Nutrition CSV import (never creates ingredients; apply re-plans server-side and writes an `AuditLog` row in its transaction) | ADMIN (`nutrition.manage`) | handler |
| NU-4 | `nutrition/template` GET (N-1a, 2026-11-01) | Download the org's ingredients as a pre-filled import file (reads only; an unedited file imports as zero changes) | ADMIN (`nutrition.manage` — the same gate as NU-3); org-scoped | handler + data-scope (org) |
| NU-5 | `nutrition/ingredients/[id]/label` GET (N-1b, 2026-11-01) | View an ingredient's label document: resolves the record inside the caller's org, then 307 to a 5-minute signed URL on the PRIVATE `froot-nutrition` store. Unknown, cross-org and "no document" all 404 | ADMIN, MANAGER, STORE (`nutrition.view`); org-scoped | handler + data-scope (org) + private store (bare blob URL not fetchable) |
| NU-6 | `nutrition/ingredients/[id]/label/upload-url` POST, `nutrition/ingredients/[id]/label` POST + DELETE (N-1b) | Upload / replace / remove the label document. upload-url presigns a PUT with the type allow-list and 10 MB cap in the signature, under `nutrition/{org}/ingredients/{id}/`; register pins that folder, re-reads the stored bytes (type, size, sha256, first-bytes check) and writes an `AuditLog` row. Refused only on a PREPARED or not-food ingredient — no saved numbers needed: registering on an ingredient with no record creates a proof-only record (N1D-F1, which superseded N-1b F6; corrected 2026-11-02 by N-1e). Removing the document always resets a VERIFIED record, never asked (N1D-F2). N-1e: the register write is `attachLabelDocument`, shared with NU-12 and NU-16; this button never asks "Replace current label?" (R4) | ADMIN (`nutrition.manage`); org-scoped | handler + data-scope (org) + namespace pin |
| NU-7 | `nutrition/ingredients/[id]/verify` POST (N-1b) | Mark VERIFIED (requires saved numbers AND an uploaded label document — the source link is reference only and never enough, N1D-F2; a proof-only record cannot be verified, N1D-F1; corrected 2026-11-02 by N-1e) or back to ESTIMATED; the only writer of VERIFIED. `AuditLog` row in the transaction | ADMIN (`nutrition.manage`); org-scoped | handler + data-scope (org) |
| NU-8 | `nutrition/ingredients/[id]/label/read` POST (N-1c, 2026-11-02) | "Read label": sends the ingredient's stored label document to the Anthropic API (base64 from the PRIVATE store, never a URL) and returns the transcribed panel for the dialog's review. Writes NO nutrition. Refused on a PREPARED or not-food ingredient, with no document, or on a HEIC file (415) — no saved numbers needed (N1D-F1 superseded N-1c F6; corrected 2026-11-02 by N-1e). 503 when `ANTHROPIC_API_KEY` is unset. Per-org limit 30/hour and 300/day counted from `AuditLog` (429) — since N-1e the count includes label-inbox reads (NU-14), one pool, in `src/lib/label-read-run.ts`; a successful read of the same file hash within 24 h is reused, not re-sent (`{ fresh: true }` forces a new call). One `AuditLog` row per outcome (`nutrition.label.read` / `.read.failed` / `.read.reused`) — file name, hash, model, success/failure, and the transcribed values on success; never the file | ADMIN (`nutrition.manage`); org-scoped | handler + data-scope (org) + rate limit |
| NU-9 | `nutrition/settings` PUT (N-2, 2026-11-02) | The org's Nutrition Facts serving settings: drink serving size (null = the 12 fl oz default) and size-table rows keyed on the exact Square variation name (a null volume removes the row). Values 0 < fl oz ≤ 200. One `AuditLog` row (`nutrition.serving.settings`, from → to) in the transaction | ADMIN (`nutrition.manage`); org-scoped | handler + data-scope (org) |
| NU-10 | `nutrition/items/[salesItemId]/serving` PUT + DELETE (N-2) | One sales item's serving override: "per item", or its own volume and/or serving size; DELETE returns it to the table/defaults. Sales item resolved inside the caller's org (404 otherwise). One `AuditLog` row (`nutrition.serving.item`, from → to) per change | ADMIN (`nutrition.manage`); org-scoped | handler + data-scope (org) |
| NU-11 | `nutrition/publish` PUT (N-3, 2026-11-02) | The org's public menu settings (creates the `PublicMenu` row on first save; no row = off). Included groups must be this org's `SquareCategory` rows and hidden items this org's Square item ids, else 400; a slug taken by another org → 409. One `AuditLog` row (`nutrition.publish.settings`, from → to) in the transaction; expires the cached public payload at once | ADMIN (`nutrition.manage`); org-scoped | handler + data-scope (org) |
| NU-12 | `nutrition/ingredients/[id]/label/from-link` POST (N-1e, 2026-11-02) | "Add from link" in the dialog's Proof box: the SERVER fetches a pasted URL through `src/lib/safe-fetch.ts` — **the first server fetch of a user-supplied URL in Froot** (N1E-F4): https only, port 443, no user:pass@, every address checked at CONNECT time via a custom `lookup` (private, loopback, link-local, metadata, CGNAT, unique-local, IPv4-mapped — refused if ANY resolved address is non-public, so DNS rebinding can't reach one), re-checked on every redirect (max 3), 15 s timeout, 10 MB cap while streaming, PDF/PNG/JPEG/WEBP by Content-Type AND first bytes, HTML refused ("Open the page, save the label image, and upload it."), no cookies or credentials sent. The file is put in this ingredient's folder and attached through the NU-6 write; `sourceUrl` set to the link. Asks "Replace current label?" (`CONFIRM_REPLACE`) and "Still verified?" BEFORE fetching. Failed fetches write `nutrition.inbox.fetch.failed` with the host only | ADMIN (`nutrition.manage`); org-scoped | handler + data-scope (org) + URL guard |
| NU-13 | `nutrition/labels` GET + POST, `nutrition/labels/upload-url` POST (N-1e) | The label inbox. GET: the org's open inbox items (uploaded / read / failed, with age), the ingredients a label can be for, the read-limit state — never a blob URL, pathname or hash. upload-url + POST: the N-1b two-leg upload into `nutrition/{org}/inbox/`; register pins that folder, runs the same stored-bytes checks as NU-6, refuses HEIC (415, the N-1c note), creates a `NutritionLabelInboxItem` with a filename SUGGESTION only, `AuditLog` `nutrition.inbox.uploaded` | ADMIN (`nutrition.manage`); org-scoped | handler + data-scope (org) + namespace pin |
| NU-14 | `nutrition/labels/[id]/read` POST (N-1e) | Read one inbox file; "Read all" calls it one at a time (N1E-F3). Reuses the item's own read for its life in the inbox (R1), then any read of the same file hash in the org within 24 h; otherwise the shared NU-8 read — same model, same 30/hour · 300/day pool, 429 `RATE_LIMITED` with `retryAt` that stops the batch with the row unchanged. A failure marks only this row FAILED. After a read, the label's product name may replace the SUGGESTION — never a confirmed ingredient | ADMIN (`nutrition.manage`); org-scoped | handler + data-scope (org) + rate limit |
| NU-15 | `nutrition/labels/[id]` PATCH + DELETE, `nutrition/labels/discard-old` POST (N-1e) | PATCH `{ ingredientId }`: the ADMIN's confirm — **the only writer of `ingredientId`** (N1E-F2, "suggest, never assign"; pinned by `scripts/verify-n1e.ts`); the ingredient must be this org's, food, not prepared. DELETE: discard — row DISCARDED, file deleted from storage. discard-old: every open item 7+ whole UTC days old, same as DELETE each. One `AuditLog` row per assign / discard (`nutrition.inbox.assigned` / `.discarded`) | ADMIN (`nutrition.manage`); org-scoped | handler + data-scope (org) |
| NU-16 | `nutrition/labels/[id]/attach` POST (N-1e) | Step 1 of the review queue's Apply: refused until the item is read AND an ADMIN confirmed its ingredient. Asks "Replace current label?" then "Still verified?" before copying. Copies the file inside the private store into the ingredient's folder (R2 — the NU-6 namespace pin stays true), checks the hash, attaches it through the NU-6 write, records the inbox read on the ingredient as `.read.reused` (no model call) and returns its `readId`. Steps 2–3 are the UNCHANGED NU-2 PUT (`appliedFromRead`) and NU-7 verify — no second write path. The inbox copy is deleted, the item APPLIED | ADMIN (`nutrition.manage`); org-scoped | handler + data-scope (org) + namespace pin |

N-1c also widened NU-2's PUT: an optional `appliedFromRead` (the read's audit
id, apply intent, edited fields) must name a read of the same ingredient in the
same org, and writes a `nutrition.label.applied` row in the save's transaction.
Apply is that PUT — there is no second write path — and "Apply & mark
verified" is that PUT followed by NU-7.

N-1b also widened NU-2's PUT (source link; 409 `CONFIRM_STILL_VERIFIED` /
`CONFIRM_CLEAR_PROOF` answered by the dialog) and NU-3's apply (writes
`source_url`, resets VERIFIED → ESTIMATED, never sets VERIFIED). Neither
changes who may call them.

The ingredient dialog's nutrition section (`inventory/ingredients/nutrition-section.tsx`)
is editable only when the page passes `canManageNutrition` (ADMIN + both
modules) and read-only otherwise; that is a UI affordance — NU-2 is the
enforcement. The inventory ingredient PATCH and `bulk` (IV-2, ADMIN/MANAGER)
do NOT write nutrition fields.

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
7. ~~`GET /api/square/locations`, `/api/square/team-members` (SQ-5) — raw Square location and team-member data readable by any member.~~ **RESOLVED in two parts:** `square/locations` by **PERM-6 Task 4 (2026-07-27)** — ADMIN via `stores.manage` + field allow-list (SQ-5a); `square/team-members` by **DEBT-10 (2026-07-28)** — ADMIN via `staff.sync.square` + field allow-list (SQ-5b). Both gaps were API-surface only: neither route is public in `proxy.ts`, and both callers already rendered under `isAdmin`, so no non-admin *UI* path ever existed — but a signed-in STORE or STAFF account could reach either by hand. The team-member payload was the PII one (every employee's email, and whatever else Square returns on a person).
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

**B (cont.) — found and fixed by PERM-3:**
18. ~~**Every `/api/forecasting/*` read was org-scoped but not assignment-scoped** — `requireForecastStore` checked `organizationId` only, so a MANAGER assigned to one location could read any sibling store's forecast, sales history, live Square balancing report and CSV export by passing its `storeId`. `/audit` was the only route that filtered by assignment.~~ **RESOLVED — PERM-3 (2026-07-26):** `requireForecastStore` now mirrors `requireLaborStore` (403 for non-admins outside `StoreUserAssignment`), and `(app)/forecasting/page.tsx` scopes its store list the same way.

**E. Logged as follow-up phases:**
17. **SEC-2 (logged 2026-07-25):** Instagram OAuth has the same missing-nonce shape SEC-1 fixed for Square — its callback's org-equality check blocks cross-org token planting, but `state` is still the predictable orgId with no CSRF nonce. Deliberately untouched in SEC-1 (Instagram was the reference implementation); with Square hardened, Instagram is now the weaker flow. See ROADMAP `SEC-2`.
19. **SEC-3 (logged 2026-07-26, found by PERM-3):** `POST /api/forecasting/import` writes the uploaded budget file to Vercel Blob with `access: "public"` at `forecasting/${orgId}/${storeId}/${year}-${Date.now()}.${ext}`, persists that URL on the plan and in the audit log, and `plan` GET hands it to any MANAGER. **A tenant's budget file is retrievable by URL with no authentication at all** — the only protection is the timestamp's guessability. Not a permissions tier, so deliberately NOT fixed in PERM-3; it needs a Blob access-model change (private store + signed reads, as HR documents already do via `HR_BLOB_READ_WRITE_TOKEN`). See ROADMAP `SEC-3`.

---

## 3. Contradiction list — enforcement points that disagree

1. **Square vs Instagram integration management:** Instagram connect/disconnect/toggle = ADMIN (IG-1); Square connect/disconnect = any member (SQ-1/3); Square callback skips the state-vs-session check Instagram performs (SQ-2 vs IG-2). *(Resolved on the Square side by SEC-1, 2026-07-25 — Square now ADMIN + session-org-bound + nonce, making Instagram the weaker flow; that residue is SEC-2 / §2 item 17.)*
2. **Templates three-way disagreement:** nav ADMIN-only (NV-4) · layout allows MANAGER (PG-4) · list page + every API ADMIN-only (PG-5, PL-10). MANAGER can open detail/edit/new pages whose actions all 403. *(**RESOLVED** by PERM-2, 2026-07-26 — ADMIN only; the layout now asks `templates.manage`.)*
3. **Staff surface:** pages ADMIN/MANAGER (PG-9) vs `GET /api/staff` any member (PL-15) vs `POST /api/staff` unguarded (PL-16) vs per-record routes correctly tiered (PL-17). *(**RESOLVED** by PERM-2, 2026-07-26 — both now ADMIN/MANAGER via `staff.view` / `staff.manage`; the unguarded POST was a security fix. Per-record routes left alone. Residue: POST still accepts a `storeIds` array it never scope-checks — logged as PERM-2 `deferred`.)*
4. **Checklists:** GET store-scoped (PL-1) vs POST org-wide for any member (PL-2). *(**RESOLVED** by PERM-2, 2026-07-26 — the Task 1 audit established POST INSTANTIATES a store's daily checklist rather than creating a definition, and is the only path by which an instance ever exists. Single instantiation is ADMIN/MANAGER/STORE scoped to `StoreUserAssignment`; the org-wide bulk fan-out is ADMIN-only via `checklists.create.bulk`. A cross-tenant `templateId` hole found in the same function was fixed under a logged scope exception — see DECISIONS.md.)*
5. **Inventory pages vs APIs:** PG-22 pages redirect non-managers while their data APIs (IV-10) serve any member; PG-21 pages don't even redirect. *(**RESOLVED** by PERM-2, 2026-07-26 — inventory split by data sensitivity, not by page. Operational routes (counts, adjustments, pars, storage areas, item/category reads) are granted to every role; commercial ones (all 8 reports, expected, alerts, count summary → `inventory.analytics.view`; vendor prices, vendor adjustments, recipe costs, order guide → the new `inventory.costs.view`) are ADMIN/MANAGER. Pages now ask the same capability their data APIs enforce. Nav visibility deliberately kept on the separate `inventory.nav.view` so STAFF-1's sidebar exclusion survives the operational grants going to ALL. Field-level cost redaction inside operational payloads is explicitly NOT part of this — see ROADMAP `PERM-4`.)*
6. **Goal writes:** dashboard manual monthly goal PUT = ADMIN/MANAGER (PL-9), but every Forecasting goal write = ADMIN-only (FC-2). A manager can set the dashboard goal yet not the plan it overrides. *(**RESOLVED** by PERM-2, 2026-07-26 — dashboard goal PUT is ADMIN only; `canManageGoal` on the summary route asks the same capability so the edit affordance disappears rather than 403ing. Forecasting untouched.)*
7. **Labor vs Forecasting write tiers:** Labor writes ADMIN+MANAGER, Forecasting writes ADMIN-only — *deliberate* per the decision log (labor-access.ts comment), listed so the registry doesn't "harmonize" it by accident.
8. **Weekly Plan nav vs guard:** NV-13 (ADMIN/MANAGER) vs PG-17/LB-1 (any member, read-only) — the "read-only for viewers" design never got a viewer entry point. *(**RESOLVED** by PERM-2, 2026-07-26 — `labor.view` is now ALL and the nav entry renders for every role. The guard stays read-only for non-managers; `labor.manage` and item 7 above are untouched.)*
9. **Training certificates naming:** `ensureTrainingCertPdf` still uses `fullName ?? displayName` while signature surfaces are Full-Name-only — documented scope boundary (DECISIONS "Staff Display Name vs Full Name" f), listed as an intentional inconsistency.
10. **"Admins have no `StoreUserAssignment` rows" is a UI convention, not an invariant.** The claim underpins every `...(isAdmin ? {} : { id: { in: storeIds } })` scope and BUILD-2's design, but nothing enforces it. `PATCH /api/users/[id]` writes `storeAssignments: { deleteMany: {}, create: storeIds.map(...) }` **unconditionally** (`users/[id]/route.ts:164-167`), and `EditUserButton` sends `storeIds: Array.from(selectedStores)` unconditionally (`users/user-actions.tsx:189`). The store picker is hidden for ADMIN (`:214`, and `:104` in the invite form) but `selectedStores` state persists — so promoting a MANAGER with two stores to ADMIN and saving writes two assignment rows for an ADMIN. Found by BUILD-2, 2026-07-29; filed, not fixed (changing it alters behaviour, and it is PERM territory). Harmless today because every consumer treats `isAdmin` as unscoped and ignores the rows — but it means the sentence above should be read as "admins are not *shown* a store picker", and any future code that infers "no rows ⇒ admin", or "has rows ⇒ scoped", is unsound. *Disconfirming evidence: a guard clearing `storeIds` when role is ADMIN, in either the client or the route. Neither has one.*

---

## 4. Clerk webhook finding (`/api/webhooks/clerk`)

Verified against the PERM-1 "Also check" item:

- **`role` is written only in the `organizationMembership.created` upsert's CREATE branch** (PendingInvite role → Clerk role map → STAFF default). The UPDATE branch writes `{ email }` only.
- `user.updated` writes `{ email }` only. `organization.created` upserts Organization name + slug; `organization.updated` writes **name only** (see caveats below). `organizationMembership.deleted` unlinks `StaffMember.userId` and deletes the user's `StoreUserAssignment` rows — it does not touch `User` columns.
- ~~**Conclusion: a future permission-assignment column on `User` would NOT be clobbered** by any current webhook path while the row exists.~~ **AMENDED 2026-07-29 by BUILD-2 — no longer true as stated.** The bullet above it is still exact: `role` is written only in the CREATE branch, and the UPDATE branch writes `{ email }` only. But the handler now contains a **third** `User` write: `prisma.user.update({ data: { defaultStoreId } })` inside the `if (pending)` block (`webhooks/clerk/route.ts`), which runs **after** the upsert regardless of which branch it took. So a `User` column *can* now be written by the webhook while the row already exists. Read the original conclusion as scoped to the upsert, not to the handler. Note this is the **deliberate second option** offered by DECISIONS.md 2026-07-25 ("PERM-3 design constraint"): a column on `User` must either live where membership churn can't reach it, **or the webhook's create path must be explicitly taught to restore it.** BUILD-2 takes the second — `defaultStoreId` is re-derived from `PendingInvite.storeIds` on re-add, so the churn caveat below does **not** apply to it. It is one of the few `User` columns that survives a remove-and-re-add correctly, by construction rather than by luck.
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
scope(user, capability): CapabilityScope
  // { access: "none" } | { access: "unrestricted" }
  // | { access: "window"; monthsAhead: number }
  //
  // Unrestricted for every capability EXCEPT forecasting.view for MANAGER,
  // which PERM-3 narrowed to a current+next-month window. Narrowing lives in
  // the SCOPE_OVERRIDES table in src/lib/permissions.ts — gated behind can(),
  // so an override can restrict below a role's ceiling but never elevate above
  // it. That table is where PERM-5's per-user overrides hook in.
```

Deny-by-default: unknown capability → `false`.


**Updated 2026-07-26 by PERM-2.** Rows below now reflect the rulings in §3 (items 2, 3, 4, 5, 6, 8), not the pre-PERM-2 enforcement. `inventory.nav.view`, `inventory.costs.view` and `checklists.create.bulk` are new. Where a capability's grant and its nav entry differ, that is deliberate — see the comment in `src/lib/permissions.ts`.

| Capability | Granted today to | Derived from |
|---|---|---|
| `dashboard.view` | all roles | NV-1, PG-1, PL-8 |
| `dashboard.goal.edit` | ADMIN | PL-9, dashboard-client |
| `checklists.view` | all roles (scoped; STAFF nav needs store-proxy) | NV-2, PG-2, PL-1, SH-3 |
| `checklists.execute` | all roles (scoped) | PL-3, PG-14 |
| `checklists.create` | ADMIN, MANAGER, STORE (store-scoped — instantiate today's checklist) | PL-2 |
| `checklists.create.bulk` | ADMIN (org-wide fan-out; cannot be store-scoped) | PL-2 |
| `messages.use` | all roles (scoped) | NV-3, PG-3, PL-6 |
| `messages.moderate` | ADMIN, MANAGER (delete also author) | PL-7 |
| `corporate.updates.manage` | ADMIN | PL-5 |
| `templates.manage` | ADMIN | NV-4, PG-5, PL-10 |
| `stores.view` | ADMIN, MANAGER (page tier; list API all roles scoped) | NV-5, PG-7, PL-11 |
| `stores.manage` | ADMIN | PL-12, SQ-5a, SQ-5c |
| `users.manage` | ADMIN | NV-6, PG-8, PL-14 |
| `staff.view` | ADMIN, MANAGER (scoped) | NV-7, PG-9/10, PL-15 |
| `staff.manage` | ADMIN, MANAGER (in-scope) | PL-16, PL-17 |
| `staff.sync.square` | ADMIN. Bulk re-sync only since PERM-8 (2026-08-29) split the import read out. **Not grantable** — it terminates staff and overwrites assignments org-wide | PL-18 |
| `staff.import.square` | ADMIN baseline, and **the first per-user GRANTABLE capability in the product** — an admin may grant it to a specific MANAGER via Edit User (`GRANTABLE_CAPABILITIES`, MANAGER only; PERM-8, 2026-08-29). Split out of `staff.sync.square` | SQ-5b |
| `staff.documents.manage` | ADMIN, MANAGER (in-scope) | PL-19, PL-20 |
| `staff.notes.use` | ADMIN, MANAGER (in-scope; delete author-or-ADMIN) | PL-21 |
| `reports.view` | ADMIN, MANAGER | NV-8, PG-11 |
| `forecasting.view` | ADMIN; MANAGER **scoped** — `scope()` returns `{access:"window", monthsAhead:1}`, limiting per-day forecast goals to the current and next month. Historical actuals are NOT limited. Assigned stores only for non-admins | NV-9, PG-12, FC-1, FC-1w, FC-1a |
| `forecasting.edit` | ADMIN | FC-2 |
| `forecasting.scope.all` | ADMIN | FC-1, FC-1a, PG-12 — **added by PERM-6 Task 5.** "Exempt from `StoreUserAssignment` scoping on forecasting reads", split out of `forecasting.edit`, which was doing this job *and* "may write goals" under one context flag named `isAdmin`. Both are ADMIN today, so behaviour is unchanged; the point is that PERM-5 can grant one without the other. Consumed by `requireForecastStore`, `forecasting/audit`'s store filter, and the `/forecasting` store picker — the three sites that read the fused flag |
| `storeview.access` | ADMIN, MANAGER, STORE (nav tier; page allows all — gap #10) | NV-10, PG-13 |
| `instagram.view` | all roles (when enabled) | NV-11, PG-18, IG-3 |
| `instagram.manage` | ADMIN | IG-1 |
| `square.manage` | today: any member (gap #2; catalog syncs ADMIN) | SQ-1/3/6 |
| `settings.access` | ADMIN | NV-16, PG-15 |
| `inventory.nav.view` | ADMIN, MANAGER, STORE (**nav visibility only** — deliberately separate from API access; STAFF-1) | NV-15, PG-20/21 |
| `inventory.assets.view` | all roles (operational item/category/area/par reads) | IV-1, IV-4 reads, IV-10 pars |
| `inventory.assets.manage` | ADMIN, MANAGER | IV-2 |
| `inventory.import` | ADMIN | IV-3 |
| `inventory.storage.manage` | ADMIN, MANAGER (scoped; copy ADMIN via `inventory.import`) | IV-4 |
| `inventory.counts.execute` | all roles (scoped) | IV-5 |
| `inventory.counts.finalize` | ADMIN, MANAGER | IV-6 |
| `inventory.po.view` | ADMIN, MANAGER, STORE (scoped; incl. receiving) | NV-15, IV-7 |
| `inventory.po.manage` | ADMIN, MANAGER (scoped) | IV-8, IV-11, PL-24 |
| `inventory.adjustments.record` | all roles (scoped) | IV-9 |
| `inventory.analytics.view` | ADMIN, MANAGER (reports, expected, alerts, finalized-count summary) | NV-15/17, PG-22, IV-10, IV-5 summary |
| `inventory.costs.view` | ADMIN, MANAGER (vendor prices + adjustments, recipe costs, order guide) | IV-1 pricing rows, IV-10 order-guide |
| `nutrition.view` | ADMIN, MANAGER, STORE (N-1 F3; STAFF excluded) | NV-18, PG-36, PG-38, PG-39, NU-1 |
| `nutrition.manage` | ADMIN (N-1 F3: edits nutrition, allergens, the not-food flag; runs the import; N-2: serving settings and item overrides) | NV-18, PG-37, PG-40, NU-2, NU-3, NU-4, NU-6, NU-7, NU-8, NU-9, NU-10 |
| `labor.view` | all roles (read-only viewer; nav now matches the guard) | NV-13, PG-17, LB-1 |
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
| `notify.pace.receive` | ADMIN, MANAGER (assigned stores only — the assignment half is the recipient query's, not this entry's). **Deniable, never grantable.** Added by NOTIFY-2c, 2026-09-20 | `src/lib/pace-alerts.ts` recipient query; grid row "Email notifications" |
| `notify.milestone.receive` | ADMIN, MANAGER (the employee's stores only; corporate staff → ADMINs only — the recipient query's, not this entry's). **Deniable, never grantable.** Added by MS-4b, 2026-10-19 | `src/lib/notifications/kinds/milestone.ts` recipient query; grid row "Milestone reached" under "Email notifications" |
| `notify.docdue.receive` | ADMIN, MANAGER (what each sees — whole org for ADMINs, assigned stores for MANAGERs — is the producer's scope map, not this entry's). **Deniable, never grantable.** Added by NOTIFY-14, 2026-10-27 | `src/lib/doc-digest-alerts.ts` scope map and `src/lib/notifications/kinds/doc-digest.ts` recipient query; grid row "Overdue & due-soon document digest" under "Email notifications" |

### Notification capabilities are DENIABLE-ONLY (NOTIFY-2c, Gary, 2026-09-20)

`notify.*` is a namespace for **who receives a Froot email**, one entry per
user-addressed email (`notify.pace.receive` was the first; `notify.milestone.receive`, MS-4b,
2026-10-19, is the second; `notify.docdue.receive`, NOTIFY-14, 2026-10-27, is the third). Three rules hold for every entry in it, and they are rules rather than
this one entry's accidents:

1. **Deniable — a row in `ENFORCED_CAPABILITIES`, so an ADMIN unticks it on the
   person's row in Edit User on `/users`.** That is the only control, and it is
   **admin-set, never self-service**: there is no user-facing opt-out and no
   unsubscribe anywhere in the product.
2. **Never in `GRANTABLE_CAPABILITIES`.** An email goes to a person because
   their role puts them on the list, and the per-user control only takes them
   off it. STORE and STAFF therefore cannot be added to a mailing list one
   account at a time — `PATCH /api/users/[id]` 400s on the grant (it filters on
   `isGrantable`) and `can()` refuses a smuggled one at read time.
3. **The org-level switch outranks it.** `/settings/notifications` decides
   whether the email exists for the org at all; these capabilities only narrow
   the recipient list below it. Org off → nobody, whatever any user's row says.

**What makes these rows unlike every other row in the grid:** they take away no
access. Denying one removes a message from someone's inbox and leaves every
page, route and permission they hold exactly as it was. The `removes` copy on
each row has to say so in the admin's words, because an unticked box in a
capability grid otherwise reads as a loss of power.

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

**Found by PERM-3 (2026-07-26), recorded only — none fixed:**

8. `GET /api/forecasting/day-report` runs an **uncached, paginated live Square
   `SearchOrders` loop** (`limit: 500`, follows `cursor` to exhaustion) for any
   date, with no rate limiting and no result caching. Cheapest endpoint to abuse
   in the app; every other sales read goes through `SalesPeriodCache`.
9. `POST /api/forecasting/import` validates `year` with `Number.isInteger` only,
   while its sibling writes `/backfill` and `/plan` PUT both clamp
   `2020..2100`. An admin can materialize a full `yearDates(year)` set of
   `DailyGoal` rows for year `1` or `9999`.
10. `/calendar` and `/export` interpolate an unvalidated `year` straight into a
    date string (`dbDate(\`${year}-01-01\`)`), so a non-4-digit or fractional
    year yields `Invalid Date` and a Prisma-layer error instead of a clean 400.
11. §1f previously listed the plan write as `forecasting/plan` **POST**; the
    route exports **GET** and **PUT** (there is no POST). Corrected in this
    revision — noted because the same error may exist in other docs.
12. Several Labor surfaces tell users to "set up sales goals in Forecasting"
    (`labor-budget-card.tsx`, `labor-coverage-card.tsx`,
    `labor/weekly-plan-client.tsx`). These are **text, not links**, so PERM-3's
    affordance rule does not strictly apply — but `/labor` is `labor.view` =
    ALL, so STAFF and STORE read a pointer to a surface they cannot open.
13. `(app)/dashboard/page.tsx` still computes `canSeeCounts` with an inline
    `role === "ADMIN" || role === "MANAGER"` for the inventory count-recency
    block. Untouched by PERM-3 (it is an inventory gate, not a forecasting one);
    it should become `can(inventory.analytics.view)` or similar when that
    surface is migrated.
