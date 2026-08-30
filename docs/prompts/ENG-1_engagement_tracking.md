# ENG-1 — Engagement tracking: staff, managers, and store accounts — TIER 3

TIER 3: structural. One additive migration (new table + two columns), one new
capability, one new API route, one new page, one client beacon component, one
cron addition. Plan-first with a hard STOP after Phase A. One phase, no riders.

Rulings for this phase were made by Gary in chat on 2026-08-30 and are embedded
in § Rulings below for recording in DECISIONS.md — confirm the wording at
commit; do not invent or extend them.

---

## Repo gate (run first, paste results, one command at a time — no `&&` chains)

```
pwd
```
Must end in `Froot/froot` (lowercase froot — the capital-F parent is a trap).

```
git remote -v
```
Must show `indianathomas-afk/froot`.

```
git status
```
Tree must be clean and on `staging`. If anything is off, STOP and report.

---

## What this phase builds (plain statement)

An admin-only view of who is actually using Froot: when each login was last
active, what pages they use, and (coarsely) where from. Three layers:

1. **Last activity** — `User.lastSeenAt` + `User.lastSeenLocation`, stamped by
   the capture path, throttled. Not "last Clerk sign-in" — last activity, which
   is the number Gary actually wants.
2. **Page usage** — a `UsageDaily` rollup: one row per user × path × day with a
   count. Never a raw event log. A user who opens the dashboard 40 times on
   Tuesday is one row with `count: 40`. Bounded by users × pages × days;
   pruned at 180 days.
3. **Location** — city/region from Vercel's geo headers on the beacon request.
   **The raw IP is never stored, anywhere, in any column or log line this
   phase adds.** This is a ruling, not a preference.

Surfaced at `/staff/engagement` (ADMIN only) and, per store, via a log icon
link on `/stores`. STORE-role shared accounts (the store iPads) appear as
first-class rows — their usage IS the store's engagement (ruling 5).

Nothing in this phase touches Square.

---

## Phase A — audit (report, then STOP for Gary's approval)

Read-only. Report findings as numbered sections with file:line citations.

1. **Capture path.** Locate where an authenticated request resolves the user —
   `getCurrentUser()` / `actorFor()` in `src/lib/auth.ts` and the `(app)`
   layout. Identify the cleanest server-side seam for the beacon route to
   reuse (auth + org resolution) without duplicating logic.
2. **The beacon's client seam.** Confirm the `(app)` layout's server/client
   split and where a small client component can observe route changes
   (`usePathname`). Confirm nothing in NAV-1's restructure conflicts.
3. **Geo headers.** Confirm which Vercel geo headers are available in a route
   handler in this deployment (`x-vercel-ip-city`, `x-vercel-ip-country-region`,
   `x-vercel-ip-country`) and how they behave on localhost/preview (expect:
   absent — the code must treat them as optional).
4. **`writeAuditLog` pattern.** Read it. The beacon write adopts the same
   philosophy: a failed write is swallowed and never blocks or slows the
   user-facing request. Confirm the pattern to copy, but do NOT write
   engagement data into `AuditLog` — it gets its own table (different shape,
   different retention, different query pattern).
5. **Cron.** Read `vercel.json` and the existing `api/cron/sales-reconcile`
   route. Confirm the pattern for adding a daily prune job and how cron routes
   authenticate themselves.
6. **Capability registry.** Read `src/lib/permissions.ts` — the registry, tier
   constants, `ENFORCED_CAPABILITIES`, and `GRANTABLE_CAPABILITIES`. Confirm
   how `engagement.view` (ADMIN_ONLY) is added such that it is REAL: enforced
   at the page and at every API route the page reads. The `labor.view` lesson
   (COMP-1 audit F3) applies — a capability whose only consumer is a link is
   the defect, not the feature. `engagement.view` does NOT go on
   `GRANTABLE_CAPABILITIES`. Appending there is a security change with the
   weight of a baseline change and is out of scope.
7. **Link placements.** Read `/staff` and `/stores` page components. Propose
   where the Engagement link lives on `/staff` (header area) and where the
   per-store log icon lives on `/stores` (upper-right icon cluster per row,
   per Gary's description). Propose whether the store view is
   `/staff/engagement?store=<id>` (one page, filtered — the lean) or a
   separate route, and say why.
8. **Schema check.** Confirm `User` has no existing lastSeen/lastActive
   column, and that no existing table already serves the rollup shape.
9. **Path cardinality.** List the app's page route patterns and propose the
   path normalization rule (e.g. `/staff/123` → `/staff/[id]`) so the rollup
   stays bounded. Un-normalized dynamic paths would make rows per-entity
   instead of per-page — that is the unbounded-growth failure this design
   exists to avoid.

**STOP. Present the plan — schema, routes, seams, normalization rule, link
placements — and wait for Gary's approval before Phase B.**

---

## Phase B — build (after approval only)

### B1 — schema (additive only)

- `UsageDaily`: `id`, `organizationId`, `userId`, `storeId` (nullable — the
  user's home store at write time; STORE accounts carry their own store),
  `date` (date, org-local day), `path` (normalized), `count`, `lastAt`.
  Unique on `(userId, path, date)`. Index to serve the page's queries
  (per-org recency, per-store filter).
- `User.lastSeenAt` (nullable DateTime), `User.lastSeenLocation` (nullable
  string, "City, Region" — never an IP).
- Hand-authored migration per CLAUDE.md § Database and MIGRATIONS.md:
  `migrate diff` → read the SQL → `db execute` → `migrate resolve --applied`
  → `generate`. `applied_steps_count: 0` is expected and correct; the schema
  probe is the evidence. Name the `ep-` host in the output of every DB check.
  No column drops, no rewrites.

### B2 — the beacon route

- `POST /api/usage` — authenticated (existing auth seam from A1). Body:
  `{ path }`. Steps: normalize path (A9 rule); upsert-increment the
  `UsageDaily` row for (user, path, org-local today); stamp
  `User.lastSeenAt`/`lastSeenLocation` only if `lastSeenAt` is stale by
  more than 15 minutes; read city/region from geo headers if present.
- Failure handling: catch everything, return 204 regardless. A broken
  engagement tracker must never break a working store.
- Unauthenticated: 401, write nothing.
- Rate sanity: the throttle is the lastSeen stamp only; the rollup upsert is
  cheap and unthrottled. If the audit finds a reason this needs more (e.g.
  connection pressure), STOP and say so rather than inventing a queue.

### B3 — the client beacon

- Small client component mounted once in the `(app)` layout. On pathname
  change: fire-and-forget `navigator.sendBeacon` (fallback: `fetch` with
  `keepalive`) to `/api/usage`. No await, no error UI, no retries.
- Fires for every authenticated user of every role — the data is everyone;
  the *view* is admin-only.

### B4 — the page

- `/staff/engagement`, gated by `engagement.view` at the page AND at any API
  route it reads (route-level `can()`, 403 on refusal — the acceptance
  standard is the route refusing, not a hidden button).
- Per-login rows (all roles, STORE accounts included and labeled as such):
  last seen, last location, top pages (30 days), total activity count
  (30 days). Sortable by last seen so dormant logins surface.
- Store filter per A7's decision. The store view leads with pages and
  recency — location is omitted or de-emphasized for STORE rows since the
  iPad never leaves the store.
- Links: Engagement link on `/staff` and per-store log icon on `/stores`,
  both rendered under the same `can()` check. Hidden, not locked, per the
  NAV-1 ruling's reasoning — and the server gate is the actual gate.

### B5 — retention

- Daily cron (pattern from A5): delete `UsageDaily` rows older than 180
  days. Log the deleted count via the swallowed-failure pattern.

### B6 — fixture

- `scripts/verify-eng1-engagement.ts` in the house style: `engagement.view`
  is ADMIN-baseline and answers false for MANAGER/STORE/STAFF; it is not
  grantable (`isGrantable` false for every role); path normalization
  collapses dynamic segments; the upsert increments rather than duplicates.

---

## Rulings (record in docs/DECISIONS.md — Gary confirms wording at commit)

> ENG-1 (2026-08-30): Froot tracks engagement — last activity, page usage as
> daily rollups, and coarse location — for every login, viewable by ADMIN
> only via the engagement.view capability, which is not grantable. (1)
> Location is city/region from edge geo headers only; the raw IP address is
> never stored. (2) UsageDaily rollups are retained 180 days and pruned by
> cron; there is no raw per-event log. (3) The feature is named Engagement,
> not Compliance — it is an operational usage view, not an HR/legal record.
> (4) A store's engagement IS its shared STORE account's usage: each store
> runs Froot on shared iPads under the store login, and that account's
> activity is tracked as the store's, without attribution to the individual
> holding the device. (5) Handbook disclosure of usage tracking is Gary's
> item, outside the repo.

---

## Evidence (done criterion — route-level, branch-identified)

1. **Gate:** `/api/staff/engagement`-serving route(s) and the page refuse
   MANAGER, STORE, and STAFF (403 / refusal at the route, tested by request,
   not by button absence). ADMIN sees data. Test principals: Karson (ADMIN),
   Tommy Thomas (MANAGER — deliberately MANAGER since PERM-8, do not "fix"),
   the STORE test login, a STAFF login.
2. **Beacon:** unauthenticated POST `/api/usage` → 401, zero rows written.
   Authenticated: two beacons, same path, same day → ONE row, `count: 2`,
   shown in a DB query whose output carries the `ep-` host in the same
   output (staging = `br-square-feather`).
3. **Normalization:** beacons to two different dynamic IDs under the same
   route pattern land on the same normalized `path`.
4. **lastSeen throttle:** two beacons 1 minute apart update `lastSeenAt`
   once.
5. **No IP:** grep the diff — no column, variable, or log statement this
   phase adds stores or prints a raw IP.
6. **Prune:** run the cron route against staging with a seeded >180-day row;
   show it deleted, with branch identity in the output.
7. **Fixture:** `npx tsx scripts/verify-eng1-engagement.ts` output pasted.

Staging browser evidence comes AFTER Gary pushes, in chat, per the standing
browser-evidence standard (org ID + Clerk instance named). This session never
claims deployed verification.

---

## Ceremony

- `npm run build` gates every commit. Lint does not (DEBT-33).
- Two-commit pattern: work commit, then docs commit citing the work SHA —
  ROADMAP.yaml row ENG-1 (short SHAs quoted, preserve-and-mark, no
  meta.updated), DECISIONS.md entry per § Rulings with Gary's confirmed
  wording, this prompt committed under docs/prompts/.
- DEPLOY_LOG entry drafted as a pasteable heredoc sized to blast radius —
  this is a contained feature, not a 243-line entry.
- Commit only. Gary runs all pushes. When done-and-committed, the next step
  is the PRE-PUSH-CHECK session (docs/prompts/PRE-PUSH-CHECK.md) for ENG-1.
- Out-of-scope findings: FIX NOW / RULING NOW / COMMENT / ROW triage before
  the report. ROW is the last resort.

## Explicitly NOT in scope

- Session duration, time-on-page, per-click event streams, or any raw event
  log.
- Inactivity alerts or notifications.
- Making `engagement.view` grantable.
- Any Square surface. Any change to AuditLog.
- Per-individual attribution on shared STORE devices.
