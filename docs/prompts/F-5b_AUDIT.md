# F-5b — Phase 1 audit (2026-09-20)

TIER 3. Read-only. No file in `src/` or `prisma/` was touched by this phase.
One prisma command was run; it is recorded verbatim at the foot of this
document and it wrote nothing.

---

## Finding 1 — Where an `Organization` boolean is toggled today

**The surface the new toggle should join: `/settings` → Integrations tab, its
own `Card`, after the Calendar card at `src/app/(app)/settings/page.tsx:312-352`.**

Three `Organization` scalar switches already render on that tab, and they split
into two shapes:

| Column | Card | Client island | Route | Availability gate |
|---|---|---|---|---|
| `activeModules` +`"hr"` | HR, Training & Compliance (`page.tsx:217-260`) | `HrModuleToggle` (`hr-actions.tsx:12-36`) | `POST /api/hr/toggle` | `hrModuleAvailable()` → 404 |
| `activeModules` +`"labor"` | Weekly Labor Model (`page.tsx:264-305`) | `LaborModuleToggle` | `POST /api/labor/toggle` | `laborModuleAvailable()` → 404 |
| `calendarEnabled` | Calendar (`page.tsx:312-353`) | `CalendarModuleToggle` (`calendar-actions.tsx:14-37`) | `POST /api/calendar/toggle` | **none — the column is the only gate** |

**`calendarEnabled` is the precedent, not HR.** It is the one dedicated
`Boolean` column with no env availability gate in front of it, and its route
(`src/app/api/calendar/toggle/route.ts:25-51`) is the exact shape
`paceAlertsEnabled` needs: `auth()` → `requireAdmin()` → Zod
`{ enabled: boolean }` → org lookup by `clerkOrgId` → `update`. Its own comment
at `:22-24` records why there is no 404 gate: R2 made the calendar "a plain
per-org column rather than a staged rollout, so the column IS the only gate."
Pace alerts are in the same position — F-5 shipped 2026-07-10 and has no
availability env var.

**Role gate: ADMIN, and it is enforced twice by design.** The page is gated by
`can(actor, "settings.access")` (`page.tsx:50`), which is `ADMIN_ONLY` and held
out of the override grid (`page.tsx:24-49` records why). The route re-checks with
its own inline `requireAdmin()`, per the standing rule quoted in
`calendar/toggle/route.ts:11-15` — **module governance owns these routes, not the
page that renders them** (PERM-2: a gate on a page is not a gate on an endpoint).
This is the same gate HR-16's field uses (`api/hr/settings/route.ts:64-68`), as
the prompt requires.

**A second placement was considered and rejected.** `PUT /api/hr/settings` is
the closest *sibling* (org-level email routing, ADMIN, written 2026-09-20) but it
sits behind `hrModuleAvailable()` and a `PUT` that owns one HR field. A pace-alert
switch does not belong behind the HR availability gate — an org with HR
unavailable still gets pace alerts. A dedicated `POST /api/pace-alerts/toggle`
on the calendar pattern is the correct shape.

---

## Finding 2 — Offboarding: what survives a Clerk removal

**`organizationMembership.deleted` IS handled** —
`src/app/api/webhooks/clerk/route.ts:287-302`. **`user.deleted` is NOT handled**;
the file handles exactly five events: `organization.created` (`:43`),
`organization.updated` (`:64`), `organizationMembership.created` (`:72`),
`user.updated` (`:267`), `organizationMembership.deleted` (`:287`). The
DECISIONS.md note that `user.deleted` may not exist is correct — it does not.

What the handler does on removal (`:298-301`), for a user whose
`organizationId` matches the org:

1. `staffMember.updateMany({ where: { userId }, data: { userId: null } })` — unlinks the staff profile.
2. `storeUserAssignment.deleteMany({ where: { userId } })` — **drops every store assignment.**

What it does **not** do, and this is the finding:

- The `User` row is **not deleted**.
- `User.role` is **not changed**. A departed ADMIN stays `role: "ADMIN"`.
- `User.organizationId` is **not cleared**.
- Nothing is stamped to mark the departure.

### `User` has no active / deleted / status field

`prisma/schema.prisma`, `model User` — the full scalar list is `id`,
`clerkUserId`, `organizationId`, `email`, `name`, `role`, `defaultStoreId`,
`deniedCapabilities`, `grantedCapabilities`, `lastSeenAt`, `lastSeenLocation`,
`createdAt`. **There is no `isActive`, no `deletedAt`, no `status`.** The nearest
thing is `lastSeenAt` (ENG-1, 2026-08-30), which is *last activity* stamped by
the `/api/usage` beacon — it answers "is this login being used", not "does this
person still belong to the org", and it is `null` for anyone who has not browsed
since ENG-1 shipped.

### Can a departed manager still match `pace-alerts.ts:91-98`?

**A departed MANAGER: no. A departed ADMIN: yes — and they keep receiving alerts forever.**

The recipient query has two arms:

```
OR: [{ role: "ADMIN" },
     { role: "MANAGER", storeAssignments: { some: { storeId: store.id } } }]
```

- The **MANAGER arm requires a `StoreUserAssignment` row**, and the webhook
  deletes exactly those rows on membership deletion. So the manager arm already
  has a de-facto membership test and is clean. A departed manager drops out on
  the next run.
- The **ADMIN arm has no assignment requirement at all** — only
  `organizationId` + `role: "ADMIN"`. And it cannot have one: ADMINs
  deliberately hold **no** `StoreUserAssignment` rows whatsoever. That is
  recorded on the schema itself (`User.defaultStoreId` comment, `schema.prisma`:
  "ADMINs have NO assignment rows at all"). So the one signal that retires a
  departed manager does not exist for an admin.

**The departed admin is invisible in the product, which is what makes this
quiet.** `/users` renders from the **Clerk** membership list —
`src/app/(app)/users/page.tsx` fetches `getOrganizationMembershipList` and the
final render is `memberList.map(...)`, using DB rows only as a lookup map. A
`User` row with no Clerk membership therefore appears on no screen in Froot,
while still matching this query. Nothing in the app would show an operator that
a former admin is on the recipient list.

**What the data does and does not support for F2 — see the fork below.**

---

## Finding 3 — Store dashboard URL

**There is none. `/dashboard` takes no store parameter of any kind.**

- `src/app/(app)/dashboard/page.tsx:103` — `export default async function DashboardPage()`. **No `searchParams` argument.** A `?store=` on that URL is read by nothing.
- There is no `/dashboard/[storeId]`. The only dynamic segments under `(app)/` are `help/[slug]`, `hr/acknowledge/[documentId]`, `hr/documents/[id]`, `hr/forms/[id]`, `hr/training/[id]`, `inventory/counts/[id]`, `inventory/purchase-orders/[id]`, `inventory/recipes/[id]`, `staff/[id]`, `store-view/checklist/[id]`, `templates/[id]` — none of them a dashboard.
- Store selection is **`localStorage` only**: key `"froot.dashboard.store"`, read through `useSyncExternalStore` (`dashboard-client.tsx:131`, `:157-167`). It is per-browser state with no URL representation, and `/messages` reads the same key (`messages-client.tsx:137`).

**A `?store=` convention does exist elsewhere and is the near miss worth naming:**
`/checklists?store=<id>` is real (`checklists/page.tsx:110-115`,
`searchParams: Promise<{ store?: string }>`), and it validates the id against
the caller's own scope before trusting it. So the *pattern* exists in the
codebase — it is simply not wired to `/dashboard`.

**Consequence for F4:** linking a manager to their store's numbers is not a
one-line change. It is either (a) leave `/dashboard` and let localStorage decide
which store loads — which for a multi-store manager may be the wrong one — or
(b) build `?store=` on the dashboard, which is a new page parameter with its own
scope validation. **(b) is out of scope for F-5b as written.**

---

## Finding 4 — DEBT-105 at source: confirmed, three parts

**(a) The send is after the create.**
- `PaceAlertLog` create: `src/lib/pace-alerts.ts:107-116`, inside the `try` at `:106`, `catch` at `:117-122` translating P2002 to "already alerted this month".
- The send: **`src/lib/pace-alerts.ts:135`** — `await opts.sender.send({`.
- 19 lines of pure formatting sit between them (`:124-133`); nothing else writes.

**(b) The create is NOT in a transaction with the send.** `grep` for `$transaction` across `src/lib/pace-alerts.ts` and `src/app/api/cron/pace-alerts/route.ts` returns nothing. It is a bare `prisma.paceAlertLog.create`. So the row is committed the moment that await resolves, long before the send is attempted.

**(c) The per-store catch is the only thing between a send throw and the next store.**
`src/app/api/cron/pace-alerts/route.ts:36-44` — the `for (const store of stores)` loop, `try` at `:37`, `catch` at `:39-43` which pushes `reason: "error: …"`, `console.error`s and falls through to the next iteration. No rethrow, no abort, and the run still returns `ok: true` at `:48`. **There is no cleanup path of any kind.** The committed lock survives the throw, and the next day's run reads it and returns the reassuring "already alerted this month" (`:87`, `:119`).

**The blast radius is live on staging today, not hypothetical.** `docs/DEPLOY_LOG.md:45` records that staging already runs `NOTIFY_EMAIL_PROVIDER=resend`; the cron is registered at `vercel.json` for `0 15 * * *`. The DEBT-105 row's closing line — "unset today in every environment, so the flaw is latent" — was true when filed on 2026-09-19 and **is now stale for staging.**

---

## Finding 5 — Migration state, and one hazard the prompt did not anticipate

**Newest folder: `prisma/migrations/20260920120000_hr16_ack_recipients`** — as
the prompt expected. Its entire content is one line:

```sql
-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "hrAckRecipients" TEXT[] DEFAULT ARRAY[]::TEXT[];
```

**Ledger entry format** (`docs/MIGRATIONS.md:828-884`): an `## YYYY-MM-DD —
`<folder>` (PHASE)` heading; an applied-where paragraph; a `| Statement | Kind |`
table; a paragraph on what every existing row lands on; the verbatim
`migrate diff` command in a fenced block; a note on whether the diff came back
clean; an `ON DELETE` note; a protected-index note.

### HAZARD — the F-5b diff will NOT come back clean, and left alone it breaks the staging deploy

`docs/MIGRATIONS.md:830` states HR-16's migration is **"APPLIED NOWHERE. Not to
dev, not to staging, not to production."** That is still true, and this audit
measured it rather than assuming it. The read-only diff run below returns HR-16's
column as still outstanding against the live dev database:

```
-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "hrAckRecipients" TEXT[] DEFAULT ARRAY[]::TEXT[];
```

**So a Phase-2 `migrate diff --from-config-datasource` would emit TWO
statements** — HR-16's column and F-5b's — into the F-5b migration file.
Committing that verbatim means `prisma migrate deploy` on the staging build runs
`20260920120000_hr16_ack_recipients` first (adding the column), then the F-5b
folder, which tries to `ADD COLUMN "hrAckRecipients"` a second time →
**Postgres 42701, column already exists → the staging deploy fails**, and by
`migrate deploy`'s semantics the failed migration blocks every later one until
it is resolved by hand.

This is worth stating plainly because the F-5b migration would *look* correct in
review: both statements are additive, neither drops anything, and the file would
pass every rule in § Database. The defect is not in the SQL, it is in the SQL
being generated against a database that is one migration behind the repo.

**Two ways out; this is a decision, so it is presented in the forks below as
F5.** Neither is taken by this audit.

---

## Line-number corrections to the prompt

Small, and stated so Phase 2 edits land in the right place:

- The prompt's `:150` for the dashboard link is **`src/lib/pace-alerts.ts:147`** (`` `Dashboard: ${appUrl}/dashboard`, ``). `:150` is `.filter((l) => l !== null)`.
- The prompt's `:103-122` for the create is precise if it means the comment block plus the whole `try`/`catch`; the `create` call itself is `:107-116`.
- The prompt's `:39-43` for the per-store catch is the `catch` block; the `try` opens at `:37`.
- The prompt's `:137-150` for subject and body is right (`subject` `:137`, body array `:138-150`).
- The prompt's `:91-98` for the recipient query is exact.
- The prompt's `:31-33` for the store filter is exact.

---

## Prisma commands run in Phase 1 — verbatim, complete

One command. It has no `-o`, so it wrote no file; it printed to stdout.

```bash
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
```

Full output:

```
Loaded Prisma config from prisma.config.ts.

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "hrAckRecipients" TEXT[] DEFAULT ARRAY[]::TEXT[];
```

**Nothing was applied to any database.** DEBT-103 holds: `migrate diff` is the
only prisma command this session has run or will run, and step 3 of § Database
remains Gary's — now owed for HR-16 *and*, after Phase 2, for F-5b.
