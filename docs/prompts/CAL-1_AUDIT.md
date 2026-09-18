# CAL-1 — Phase A audit

**HEAD at audit:** `34fad03` ("DEPLOY_LOG: UM-3 entry, unpromoted"), branch `staging`, clean.
**Prompt:** `docs/prompts/CAL-1_calendar_reminders.md`
**Written:** 2026-09-17. Read-only pass. No edits, no commits.

## Repo gate

| Check | Result |
|---|---|
| `pwd` | `/Users/garythomas/Claude_Projects/Froot/froot` — lowercase, correct |
| `git remote -v` | origin `https://github.com/indianathomas-afk/froot.git` |
| `git status` | on `staging`, up to date with origin, clean except the untracked CAL-1 prompt |
| `CAL-1` free? | **Yes** — zero occurrences in `docs/` outside the prompt file itself |
| Highest deviation | **S5-D76** (`docs/ROADMAP.yaml:10881`, `:13698`). CAL-1 deviations start at S5-D77. Note the convention is not uniform: recent rows also use per-session numbering (`R7-D/1`, `D1..D7`). |

---

## A1 — Permissions

**Registry shape** (`src/lib/permissions.ts`)

- `Capability` is a string-literal union, 60+ entries, `:81-145`. A typo is a build error.
- `GRANTS: Record<Capability, readonly PermissionRole[]>` `:155` — the role baseline per capability. Tiers: `ALL` / `MANAGE` (ADMIN+MANAGER) / `OPERATIONAL` (ADMIN+MANAGER+STORE) / `ADMIN_ONLY`, `:146-149`.
- `isCapability()` `:443` guards both loaders.

**`ENFORCED_CAPABILITIES`** `:658` — the /users override grid. Entry shape `EnforcedCapability` `:649`:
```ts
{ capability: Capability; area: string; label: string; removes: string }
```
`removes` is admin-facing prose rendered under the toggle. `PATCH /api/users/[id]` enforces this list as the DENIABLE set — a capability absent from it cannot be denied even by a hand-rolled request (400). Four capabilities are deliberately held out (`settings.access`, `dashboard.view`, `labor.manage`, and one more), each with the reason written above it `:640-648`.

**`GRANTABLE_CAPABILITIES`** `:509` — PERM-8's above-baseline list. **One entry long today**:
```ts
{ "staff.import.square": ["MANAGER"] }
```
`isGrantable(capability, role)` `:517` is exported precisely because three call sites need the same answer: `can()`, `PATCH /api/users/[id]`, and the Edit User modal. The file states in two places that **an append here is a security change with the same weight as a baseline change** (`:33-40`, `:487-495`), and that "all roles" has no spelling on purpose.

**`can()` precedence** `:558` — confirmed, and it is structural rather than conventional:
1. **Denial first and absolute** — returns `false` before baseline or grant is consulted; a failed override load (`{loaded:false}`) also returns `false` (fail closed).
2. **Role baseline** — `baseline.includes(user.role)`.
3. **Elevation branch (last)** — `isGrantable(capability, user.role) && (user.grants?.has(capability) ?? false)`.

So: **denied wins, else baseline OR grant** — exactly as the prompt states. `scope()` `:889` calls `can()` first, so the scoped path inherits all of it.

### The capability gating `POST /api/checklists/[id]/task-log` — **THERE ISN'T ONE**

This is the audit's most consequential finding and it contradicts the premise of the prompt's B4.

`src/app/api/checklists/[id]/task-log/route.ts` calls **no `can()` at all**. It does not import `permissions.ts`. Its gate chain, in order:

| Step | Line | Refusal |
|---|---|---|
| `auth()` → `orgId` | `:7-8` | 401 |
| org lookup by `clerkOrgId` | `:11-12` | 404 |
| checklist scoped `{ id, organizationId: org.id }` | `:14-19` | 404 |
| **`getUserStoreScope()` → `isAdmin \|\| storeIds.includes(checklist.storeId)`** | `:23-26` | 403 |
| CHK-3 closed-day guard | `:29-37` | 409 |
| task-ownership (`taskId` belongs to this template) | `:50-52` | 400 |

`checklists.execute` **exists in the registry** (`permissions.ts:86`, baseline `ALL` at `:178`) and is listed in `docs/PERMISSIONS_INVENTORY.md:445` — but a repo-wide grep finds **zero enforcement call sites**. It is a registered capability nothing asks.

**Consequence for CAL-1 (RULING NOW, item R1 below).** "The A1 capability" is not a single answer:
- Read literally as *what the route enforces*: **store-scope membership, no capability**.
- Read as *what the registry intends*: `checklists.execute`, baseline ALL, never enforced.

Making the CAL-1 complete route ask `can(actor, "checklists.execute")` would be the **first call site in the codebase for that capability**. Behaviourally it is a no-op today (baseline ALL, and it is absent from `ENFORCED_CAPABILITIES` so it cannot be denied) — but it is a new enforcement point on a capability nobody has ruled on, and it is exactly the PERM-1 header's "migrating a contradicted call site changes which of today's disagreeing answers it gives".

---

## A2 — Module toggles

**There are TWO patterns in this repo and the schema comment says which is which.**

**Pattern 1 — `activeModules String[]`** (`prisma/schema.prisma:19`, `@default([])`). Used by `inventory`, `nutrition`, `hr`, `labor`.
- Enforcement helper: `requireModule(module: "inventory" | "nutrition" | "hr" | "labor")` — `src/lib/auth.ts:21`, throws `MODULE_NOT_ACTIVE:<module>`. **The union type is closed; "calendar" must be added to it.**
- Second gate for in-development modules: `hrModuleAvailable()` `auth.ts:35` / `laborModuleAvailable()` `:53` — env `<X>_MODULE_AVAILABLE=true`, plus `<X>_INTERNAL_ORG_IDS` for per-org dogfooding in production. Server-side only, never `NEXT_PUBLIC_`.
- Toggle route: `src/app/api/labor/toggle/route.ts` — the canonical shape. `auth()` → **availability gate 404 (before anything else)** → `requireAdmin()` 403 → Zod `{enabled: boolean}` 400 → org lookup → set-union / filter on `activeModules` → `prisma.organization.update` → seed defaults on first enable → returns `{ enabled }`.
- Sidebar read: `activeModules` is passed as a prop from `(app)/layout.tsx:163`; `sidebar.tsx:272-273` computes `hrEnabled = hrAvailable && activeModules.includes("hr")`.
- Page guard: `/settings` renders the card only when `laborAvailable`; `settings/page.tsx:60-61`.
- Settings UI: a `Card` + a client island (`settings/labor-actions.tsx`) holding a shadcn `Switch`, optimistic with revert on failure, then `router.refresh()`.
- `/settings` itself is gated on `can(actor, "settings.access")` → `redirect("/dashboard")` (`settings/page.tsx:49`). The toggle APIs deliberately keep their own inline checks — **"MODULE GOVERNANCE OWNS THEM, not this page"** (`:34`).

**Pattern 2 — a dedicated boolean column.** `instagramEnabled` (`schema.prisma:28`), `squareLaborEnabled` (`:44`). The comment at `:30-37` states the rule explicitly: `activeModules` is **"the BILLABLE ADD-ON list driving the module cards on /settings"**; a dedicated column is for something that is *not a separate purchase*. CLAUDE.md says the same of Instagram: "Free org-level integration (Square pattern, **not** `activeModules`)".

**Consequence for CAL-1 (RULING NOW, item R2).** B1 proposes `Organization.calendarEnabled Boolean @default(false)` while B1's own escape clause says "or whatever shape A2 says the existing toggles use; match it". The two patterns give opposite answers and the discriminator is **billable or not**, which is a product decision, not a code one:
- `activeModules` + `"calendar"` → the calendar becomes a paid add-on card in the Billing tab. **No migration needed for the toggle at all** (the column already exists); `requireModule`'s union gains `"calendar"`.
- `calendarEnabled Boolean` → free feature, its own switch, matching Instagram. **Adds one column** to the migration.

Ruling 9 ("The calendar is a module: an admin toggle on /settings") is satisfiable by both and does not settle it.

---

## A3 — Nav

`src/components/layout/sidebar.tsx`.

- `NavGroup` `:63-73`: `{ key, label, icon, storageKey, requiresModule?, items }`. **A group header is a BUTTON, never a link** `:59`; the first child repeats the group label. `storageKey` holds the per-group open/closed preference in localStorage — renaming one silently resets every user's preference.
- The Checklists group `:139-153`:
```
key "checklists", storageKey "froot-nav-checklists-open"
  /checklists   "Checklists"            checklists.view
  /store-view   "Start Daily Checklist" storeview.access
  /templates    "Templates"             templates.manage
```
- **Permission filtering is per ITEM, never per group** `:122-125`. A group renders when ≥1 child survives and hides when none do — no empty accordions.
- `isVisible()` `:281-291` is the single filter: `can(actor, item.capability)` AND each `requires*` flag AND the STAFF checklists store-proxy. `actor` is rebuilt client-side from the `deniedCapabilities` prop via `overridesFrom()` `:278`, "so the sidebar and the pages it links to cannot disagree".
- **`requiresModule` is a NavGroup field only.** `NavItem` `:38-57` carries three bespoke booleans instead — `requiresInstagram`, `requiresHr`, `requiresLabor`. A calendar item under an existing group therefore needs a **fourth bespoke boolean** (`requiresCalendar`), not `requiresModule`.
- Nav is UX, not the gate — stated at `:91-93` and in `permissions.ts`. Every route must enforce independently (PERM-2).

### `scripts/verify-nav1-url-sets.ts` — adding `/calendar` turns this fixture RED

The NAV-1 done criterion is that **the set of destination URLs each role can reach is byte-identical** to the pinned pre-NAV-1 baseline (`BASELINE_REV = 10439b3`). `compare()` `:160` flags any `gained` URL as a failure.

The single escape is `SANCTIONED_ADDITIONS` `:156`, currently one line (`/help` → HELP-1a). The file states: **"Adding an entry here is a RULING, not a fix: it asserts that a human decided this destination should appear for these roles."** It also warns twice not to move `BASELINE_REV` to make a red run green.

Two further mechanics matter:
- The parser is a **line-oriented regex** `:46` over `sidebar.tsx` as TEXT. A nav item literal must stay on **one line** or the fixture stops seeing it — silently, with a green run (the `before.length < 20 || after.length < 20` guard at `:110` is the only protection).
- `Item` `:40-45` and `visible()` `:83` know only the three existing `requires*` flags. A new `requiresCalendar` would be invisible to the fixture, so `/calendar` would evaluate as visible whenever the capability passes. Suppressed by the sanctioned entry for *gains*, but the fixture would be asserting something untrue unless the flag is added to it.
- The fixture is **not** run by `npm run build`; it is a manual `npx tsx` run.

---

## A4 — SELF-1 banner

`src/app/(app)/dashboard/compliance-banner.tsx`, mounted at `dashboard/page.tsx:114`. `"use client"`.

- **How it gets its list:** it does not receive it. `useEffect` on mount → `fetchCard<Response>("my compliance", "/api/dashboard/my-compliance")` → `{ owed: OwedSummary | null, reason }`. `fetchCard` (`dashboard/card-fetch.ts:16`) is the shared dashboard fetch: 12s `AbortSignal.timeout`, `console.error` breadcrumb on every failure path, returns `null` rather than throwing. A `live` flag guards the unmount race.
- **Earliest due date:** `owed.nearestDueDate`, rendered through `formatInstant(owed.nearestDueDate, owed.timeZone, "monthDay")` — **in the person's own zone, not the server's** (DEBT-70b), and the clause is **absent entirely** when there is no date rather than filled with a dash.
- `if (!owed) return null` — one early return covers every refusal shape.
- **The "single pulse on mount" rule — read this carefully.** The component's header `:26-30` says: *"NO ANIMATION AT ALL. The ruling allows 'at most a single pulse on load'; zero is inside that … If a pulse is ever wanted it belongs in globals.css as a one-shot keyframe, not as a looping utility class trimmed to one run."* So the **rule** permits one pulse; the **SELF-1 implementation uses none**, and there is **no pulse keyframe in `globals.css`** today (only `accordion-down` / `accordion-up`, `:89-93`). CAL-1's B7 pulse must add a one-shot keyframe — it cannot copy one.
- **Surface colours:** overdue → `bg-[var(--color-destructive)] text-[var(--color-destructive-foreground)] border-transparent`; otherwise the warning trio `--color-warning-bg/-text/-border`. The success trio exists and is unused by this banner: `--color-success-bg` / `-border` / `-text` (`globals.css:36-38`).
- **No dismiss control, deliberately.** It clears on completion and on nothing else.
- **No reserved slot** `:37-43`: it mounts a beat after paint and pushes the page down once. Reserving was considered and rejected because most people owe nothing. Named so it is not later filed as a layout bug — B7's "First load with nothing due renders nothing" matches this exactly.
- **No role test anywhere** in the component or the route (R1, Gary 2026-09-07). The route gates on `getActiveStaffSelf()` — HR module + ACTIVE + exactly-one-match — and is self-scoped by construction (the staff id comes from the session, never the client).

The calendar banner reuses the **shell** (`Link`-wrapped bar, icon, semibold line, `text-xs opacity-90` subline, `mb-6 flex items-center gap-3 rounded-lg border px-5 py-4`) and **not** the data path: `getActiveStaffSelf` is an HR gate and resolves a *staff member*, whereas a calendar occurrence is scoped to a *store*.

---

## A5 — Store day boundary — **the helper exists; do not fork it**

`src/lib/checklist-lifecycle.ts`.

```ts
dayCloseInstant(hoursRow: HoursRow | null, dateStr: string, timeZone: string): DayClose   // :245
```
returns `{ at: Date, source: DayCloseSource, isFallback: boolean }`.

- **`Store` carries a timezone.** `Store.timezone String @default("America/Los_Angeles")` (`schema.prisma`, Store model line 12). Non-nullable with a default, so every store answers.
- **Stores with no `StoreHours` rows are already handled and the fallback is named.** `DayCloseSource` `:102` has four values: `"hours"` (a usable closing time drove it) and three fallbacks — `"closed-day"`, `"no-hours"`, `"no-close-time"` — all of which resolve to **store-local midnight (00:00 on D+1) + `DAY_CLOSE_GRACE_HOURS`**. The three are kept distinct on purpose: "the operator marked Sunday closed" and "nobody ever set this store's hours" are different facts and a report that merges them tells an operator to fix something they already did.
- Overnight closes are handled by string comparison on `"HH:MM"`, never date arithmetic `:264-268`.
- Zoned construction is hand-rolled on `Intl` (`zonedInstant` `:183`) because **there is no `date-fns-tz` in this repo** `:113-120`, and `checklist-lifecycle.ts` must stay importable from a client component (it cannot import `src/lib/reports.ts`, which pulls in the Prisma runtime).
- Four call sites already share it: `(app)/stores/page.tsx:53`, `(app)/reports/operations/page.tsx:106`, `api/cron/checklist-day-close/route.ts:210`, and the module itself.

**The mismatch with ruling 8 (RULING NOW, item R3).** `DAY_CLOSE_GRACE_HOURS = 3` (`:38`) is added to **every** return, fallback and non-fallback alike. Ruling 8 says overdue begins *"at store close on the due date … with no store hours, end of the store's local day"* — i.e. **close + 0h**, and **midnight, not 03:00**. So `dueAtFor()` cannot simply call `dayCloseInstant()` and use `.at`. Three ways out, all in B2's gift:
1. Subtract `DAY_CLOSE_GRACE_HOURS` at the calendar call site — arithmetic on another module's constant, brittle.
2. Add an optional `graceHours` parameter defaulting to `DAY_CLOSE_GRACE_HOURS` — **additive, keeps one expression of the rule, does not move any existing caller.** Recommended.
3. Fork the logic in `calendar.ts` — what the prompt's A5 explicitly forbids.

The constant's own comment `:24-37` already anticipates pressure on it and rules that a *per-org* grace would be a row (a column plus a Settings control, shipped together). A per-caller parameter is a different thing and is not covered by that ruling.

---

## A6 — Attachments — **the prompt conflates two different stores**

`TaskAttachment` (`schema.prisma`): `{ id, taskId @unique, label, url, contentType, sizeBytes, createdAt }`, `task ... onDelete: Cascade`. One per task, enforced by `@unique` on the FK.

**Write path** — `src/app/api/upload/task-attachment/route.ts`:
- `ALLOWED_TYPES = ["application/pdf", "image/jpeg", "image/png"]`, `MAX_BYTES = 10 MB` (413 over).
- Gates: `auth()` 401 → org lookup 404 → task scoped via `template: { organizationId: org.id }` 404. **No capability check, no store scope.**
- Replace-in-place: `del(old.url)` then delete the row, then `put()`.
- Blob key: `task-attachments/${org.id}/${taskId}/${Date.now()}.${ext}`.
- **`put(..., { access: "public" })` on the DEFAULT public store** (`BLOB_READ_WRITE_TOKEN`, implicit). The URL is a public CDN link. There is **no authenticated serving** — the row stores the blob URL and the browser fetches it directly.

**HELP-1b is a different mechanism.** `src/lib/guide-files.ts`: a **private** store (`froot-guide`) with its own token resolved in one place (`guideBlobToken()` `:55`, `GUIDE_READ_WRITE_TOKEN` with a `GUIDE_BLOB_READ_WRITE_TOKEN` fallback), `access: "private"`, short-TTL signed URLs (`getGuideImageUrl` `:107`) and a same-origin streaming route (`streamGuideImage` `:129`). The file's own comment: *"Pattern shared, blast radius not."* CLAUDE.md records the same for HR (`HR_BLOB_READ_WRITE_TOKEN`) and warns that the env var name follows the **store prefix chosen at connection time**, not a convention.

**Consequence (RULING NOW, item R4).** The prompt's A6 asks for "the `TaskAttachment` write path … authenticated serving (HELP-1b pattern)" and says event attachments "reuse it" — but `TaskAttachment` has no authenticated serving, and HELP-1b's private store is **not** the TaskAttachment path. Picking the private pattern makes CAL-1 depend on **provisioning a new Vercel Blob store and a new env var in three environments before an attachment can be uploaded anywhere** — a deploy-blocking dependency, and per CLAUDE.md § Provisioning a secret, a deployment carries the env values that existed when it was BUILT. The public pattern ships with no new variable.

Recommendation: **public store, `TaskAttachment` pattern.** A calendar event attachment is a reference document an admin attaches for the crew to look at — the same artefact class as a task attachment, not an HR record.

Separately, for B6's completion photo there is already a closer precedent: `api/upload/checklist-photo/route.ts` (CHK-7). It stores the blob and **writes nothing to the database** — the record is written by the completion route that already owns the refusals, because "duplicating that write here would give the same fact two authors". It re-applies every gate the write route applies (`:60-90`) on the stated principle that **"an upload route cannot lean on the write that follows it — by then the blob is already stored"**, and caps at **4 MB**, deliberately under Vercel's ~4.5 MB request cap so *our* error message is the one the user reads. `ALLOWED_TYPES` there includes `image/heic`/`heif` as a last-resort passthrough.

---

## A7 — Cron

`src/app/api/cron/checklist-day-close/route.ts`.

- **`CRON_SECRET` check** `:139-145`, and it is the first thing in the handler:
```ts
const secret = process.env.CRON_SECRET
if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 })
if (req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
```
Two hardening items are recorded **as comments at the site, not implemented** `:111-137`: a `.trim()` on both sides (a pasted secret can carry a trailing newline, which fails `!==` and reads exactly like a wrong value — the failure that cost an afternoon, `docs/prompts/CRON-DIAG_findings.md`) and a constant-time comparison. **A new cron copying this verbatim inherits the un-trimmed comparison.**
- `export const maxDuration = 300` `:49`.
- **`vercel.json`** currently registers five crons; `checklist-day-close` is `"0 * * * *"`. A sixth entry is needed for `calendar-materialize`. Note `api/cron/labor-scheduled-shifts/route.ts` exists but is **not** registered in `vercel.json` — a route file alone schedules nothing.
- **Response-body reporting shape** (tail of the file): the body is explicitly *"A PROOF SURFACE … It never contains the secret."* Top-level: `{ ok, now, graceHours, lookbackDays, strandedProbeDays, stores, daysClosed, <each counter>, errors, results }`, where `results` is per-store/per-day detail. Every per-day counter is summed into the top-level totals **and** into a single `console.log` line — a fix made because *"a counter that only exists inside `results[].days[]` is a counter nobody reads"*, and because a sweep that wrote nothing and a sweep that excluded everything previously read identically in the Runtime Logs.
- Idempotence is **by construction, not by a marker table**: every write is an `updateMany` filtered on `closedAt: null`, every materialisation is read-then-create guarded by a unique index, and `isUniqueViolation(e)` `:54` catches `P2002` for the race. A second run in the same hour changes nothing and reports zeros.
- **No org scope, deliberately** `:39-43` — a system job with no session; inventing an org filter "would just be a way to miss a tenant". Every write is still keyed to the store's own `organizationId`. **This conflicts with B3's "for each org with `calendarEnabled`"** — though CAL-1's case differs materially, because a per-org module toggle is a real predicate rather than a scoping habit. Flagged as COMMENT C1, not a ruling.
- Hourly rather than daily, so each store closes on its own clock and a skipped run is self-healing `:24-27`.

---

## A8 — Daily Tasks page

The NAV-1 "Daily Tasks" button targets **`/checklists`** (`dashboard/dashboard-client.tsx:321`), gated by `canViewChecklists` computed in `dashboard/page.tsx:89-95`: `can(actor, "checklists.view")` **plus** STAFF-1's store-proxy (a STAFF login also needs ≥1 Pending/In Progress checklist at their stores). The rule is stated as *"if a role cannot see the sidebar link, it does not see the button"*, and the count query is duplicated from `(app)/layout.tsx` rather than shared because the two run in different render trees — with an explicit note to lift it into `src/lib` **if a third caller appears**.

`src/app/(app)/checklists/` is `page.tsx` + `store-filter.tsx` — a server component with one client island. The banner mounts here and on `/dashboard`.

**Note for B7:** the calendar banner would be that third caller of nothing (it does not need the checklist count), but it *is* the second mount of a banner, and `ComplianceBanner` currently lives under `(app)/dashboard/`. A banner rendered on two pages should not be imported across route folders from a sibling page directory — that is the exact shape of the HR-11j finding CLAUDE.md § "Verifying a guard covers every path" records (a shared client imported across a route-group boundary, with the guard built on the page that owns it). Put the calendar banner in `src/components/`.

---

## A9 — Roadmap

- **`CAL-1` is free.** No occurrence in `docs/ROADMAP.yaml` or anywhere in `docs/` outside the prompt.
- **Highest deviation: S5-D76.**
- **DEBT-61, read in full** (`ROADMAP.yaml:24422-24500`). Summary of what CAL-1 must not disturb:
  - The defect: `Template.frequency` is `String @default("Daily")`; every reference is collection or display. **Neither creation path in `api/checklists/route.ts` reads it** — the single create at `:130` and the bulk loop at `:155-170` filter on `isActive` and `appliesTo` only.
  - **The exclusion now holds at three gates**: materialisation (CHK-3, `d089a7c`), closing (`1c907d2`), and the operations report, all asking `dayCloseAppliesTo(template.frequency)` (`checklist-lifecycle.ts:539`) — *"none of them re-derives it"*.
  - **Two things remain, and neither is a filter**: (1) generation-time frequency awareness — bulk generate still creates a Weekly template's checklist every day, so *"what was noise is now litter"*; (2) honest weekly lifecycle semantics — a non-Daily checklist somebody genuinely started is **never closed**, keeping `closedAt: null` and reading `overdue` forever (counted as `frequencyLeftOpen`). *"That is the right trade today and it is not a resting place."*
  - **Fix shape, unchanged across three riders**: a schema addition **plus a form control plus the generation filter** — a Weekly template needs a day-of-week, a Monthly one a day-of-month, *neither collected today*. That is precisely what `projectDueDates` collects, which is why CAL-2 closes this row.
  - The row's disconfirmation clause has now fired three times without the row closing. **The containment is thorough enough to be mistaken for the fix** — worth stating because CAL-1 adds a fourth thing that looks like it.

---

## Scope triage

### FIX NOW
**None.** Nothing found is broken at HEAD in a way CAL-1 must repair before it can proceed.

### RULING NOW — four, all blocking Phase B

**R1 — What gates completing an occurrence?** `POST /api/checklists/[id]/task-log` enforces **store-scope only, no capability** (A1). `checklists.execute` is registered, baseline ALL, and has **zero call sites**. Options: (a) mirror the route exactly — store scope only, no `can()`; (b) `can(actor, "checklists.execute")` AND store scope, becoming that capability's first enforcement point. (b) is behaviourally identical today but is a new enforcement point on an unruled capability. The prompt's B4 assumes a capability exists; it does not.

**R2 — `activeModules` or a dedicated column?** (A2). The schema comment's discriminator is **billable add-on vs free feature**, which is a product decision. `activeModules` = a Billing-tab add-on card, **no new column**, `requireModule`'s union gains `"calendar"`. `calendarEnabled Boolean` = free, Instagram-shaped, **one new column**. B1 proposes the column; B1's own escape clause defers to this audit.

**R3 — Does the 3-hour day-close grace apply to a reminder's `dueAt`?** (A5). `dayCloseInstant()` adds `DAY_CLOSE_GRACE_HOURS = 3` to every return; ruling 8 says close, and midnight for a store with no hours. Recommended: add an optional `graceHours` param to `dayCloseInstant()` defaulting to the existing constant, so the rule stays in one module and no existing caller moves. Needs approval because it edits a shared engine four call sites depend on.

**R4 — Public or private blob store for event attachments?** (A6). The prompt names two incompatible patterns. Public (`TaskAttachment`) ships with no new env var. Private (HELP-1b) requires a new Blob store and a new variable provisioned in **local, Preview and Production** before an upload works anywhere, and is a build-time dependency on every deployment that must carry it. Recommended: public.

**R5 — `SANCTIONED_ADDITIONS` for `/calendar`.** (A3). `scripts/verify-nav1-url-sets.ts` goes red on any gained URL. The file states an entry there **is a ruling, not a fix**. CAL-1 cannot add a nav entry without one.

### COMMENT — recorded at the site, no action
- **C1 — cron org scope.** The day-close cron takes none, on the stated principle that an org filter is "a way to miss a tenant". B3 iterates orgs by toggle. Different case (a real module predicate, not a scoping habit) — worth a comment in the new cron naming the divergence so the next reader does not read it as a copy error.
- **C2 — the un-trimmed `CRON_SECRET` comparison** is carried as a comment at the day-close site and would be copied verbatim into the new cron. Note it there rather than diverging silently.
- **C3 — no `date-fns-tz`.** `calendar.ts` must extend the `zonedInstant` idiom; B6's "no new dependencies" and A5's constraint agree.
- **C4 — one-line nav literals.** The NAV-1 fixture parses `sidebar.tsx` with a line-oriented regex; a multi-line item literal breaks it silently with a green run.

### ROW — deferred, filed not fixed
- **DEBT (new) — `checklists.execute` is a registered capability with zero call sites.** Not CAL-1's to fix; surfaced by R1 and worth a row whichever way R1 goes, because the next person to ask "what gates checklist execution" will hit the same gap.
- **DEBT (new) — `api/cron/labor-scheduled-shifts` is not registered in `vercel.json`.** Found incidentally in A7. Either it is invoked another way or it never runs; either way the next person adding a cron will read the file as the register and be wrong.

Both are noted here rather than filed, per the prompt's "no riders" — they are offered to Gary, not written.
