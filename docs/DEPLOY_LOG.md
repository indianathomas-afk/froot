> Renamed from STAGING_DEPLOY_LOG.md 2026-07-22 — logs both staging and prod deploys.

Deploy verification: 2026-07-02T22:00:05Z

---

## 2026-07-29 — PRODUCTION promotion (BUILD-2 default store + one-primary-store index)

- **Promotion SHA:** `493175e` — full: `493175ee337dd628d56c77a4a84e9b2600ae0759`.
- **FAST-FORWARD, not a merge — the rollback differs from every entry below.**
  `origin/main` HEAD has a **single parent** (`f480568`), so there is no merge
  commit and **`git revert -m 1` does not apply**. Rollback is reverting the four
  commits in reverse order (`493175e`, `f480568`, `944dfa3`, `118a02d`) → push main.
- **⚠️ Reverting the code does NOT undo the schema.** `118a02d` carries two
  migrations that `prisma migrate deploy` has already applied to the production
  database. Reverting it removes the migration *files* but leaves
  `User.defaultStoreId` and `StoreStaffAssignment_one_primary_key` in place, and
  leaves both rows in `_prisma_migrations`. Removing either would need a NEW
  forward migration — never by hand, and never by deleting ledger rows. This is
  the first entry in this log where code rollback and schema rollback come apart.
- **What shipped:** BUILD-2 — `User.defaultStoreId` (nullable FK, `onDelete: SetNull`),
  a partial unique index enforcing one primary store per staff member, the Default
  Location select in the Edit User modal, PATCH write-time validation
  (`src/lib/default-store.ts`), the device-account provisioning default in the Clerk
  webhook, and Task 8's `primaryStoreName()` internal tie-break.
- **Migrations: two**, both applied via `prisma migrate deploy` in the Vercel build:
  - `20260729124105_build2_user_default_store` — additive. `ALTER TABLE "User" ADD
    COLUMN "defaultStoreId" TEXT` plus an FK `ON DELETE SET NULL`. No table rewrite,
    no backfill.
  - `20260729145504_build2_staff_one_primary_store` — `CREATE UNIQUE INDEX
    "StoreStaffAssignment_one_primary_key" ON "StoreStaffAssignment"("staffMemberId")
    WHERE "isPrimary"`. **Hand-authored** — not expressible in `schema.prisma`
    (no `WHERE` on `@@unique`); see MIGRATIONS.md § Protected indexes. Fail-closed:
    aborts rather than corrupting if a duplicate primary exists.
- **Pre-checks:** Query A (duplicate primaries) returned **zero rows on branch
  `production`** (2026-07-27, re-run 2026-07-29/30) and **zero rows on branch
  `preview/staging`** (2026-07-29).
- **Post-promotion verification is INCOMPLETE.** The column and index were confirmed
  present on branch **`preview/staging`** only — *not* on branch `production` — and
  none of BUILD-2's five UI checks have been run. The phase is `shipped`, not
  `verified`, for exactly that reason.
- **Note:** consumption belongs to UX-2. Until it lands, setting a default store has
  no visible effect beyond the Edit User modal — expected, not a defect.

## 2026-07-27 — PRODUCTION promotion (PERM-2 + PERM-3 + BUILD-1 + SQ-1 docs + roadmap dashboard)

- **Merge commit / rollback SHA:** `06b1561` — full: `06b156108688061a8a4bfdb56af1d945a8a56676`
  (rollback: `git revert -m 1 06b156108688061a8a4bfdb56af1d945a8a56676` → push main;
  pre-merge tag `pre-staging-merge-20260727-1427` also on origin). Parents `0363b2f`
  (main) and `5e8effc` (staging). **74 files changed, +4002 / −179.**
- **What shipped:** PERM-2 permission-contradiction resolution (`979da0b` — §3 #2/#3/#4/#5/#6/#8
  via the capability layer, incl. the security fix for a completely unguarded
  `POST /api/staff`), PERM-3 MANAGER forecast read window + forecasting store scoping
  + affordance gating (`b8f32bb`), BUILD-1 vercel-build split (`6a77e68`), the SQ-1
  token-refresh audit write-up (`f93b906`/`9bd61c7`/`056943f`), the P-3 live
  `/internal/roadmap` dashboard (`3902d5c`), and the DOCS-2 roadmap reconcile
  (`5e8effc`).
- **Migrations:** **none.** `git diff --stat pre-staging-merge-20260727-1427..HEAD -- prisma/`
  returned empty. Production build log confirms: `31 migrations found; No pending
  migrations to apply.`
- **Merge conflict:** one, `docs/ROADMAP.yaml` — expected, since main carried the SQ-2
  cherry-pick (`9dc6dc0`) while staging carried its own SQ-2 row plus the whole DOCS-2
  reconcile. Resolved by taking **staging's superset**, which had already been written
  to match main's SQ-2 note verbatim for exactly this reason. No content lost from
  either side.
- **Verification results (5):**
  - **BUILD-1 — verified in production.** Log shows `Running "npm run vercel-build"` →
    `prisma migrate deploy && npm run build`, then `31 migrations found`. Proves both
    that `vercel-build` is picked up by @vercel/next AND that migrate deploy actually
    runs. This satisfies BUILD-1's own verification step 3, in prod rather than the
    staging log it asked for. Status flipped `in_progress` → `shipped`.
  - **BUG-3 — proof finally recorded; closed.** Datasource resolved to the DIRECT
    endpoint in both logs, neither host ending `-pooler`: staging (13:14)
    `ep-odd-rain-a6gr4xmm`, production (14:49)
    `ep-green-smoke-a6xthq4r.us-west-2.aws.neon.tech`. Decisively, **neither log
    contains the `[prisma.config] DATABASE_URL_UNPOOLED is not set` fallback
    warning** — the negative evidence a green deploy alone could never provide,
    since the fix is a `??` fallback that would have deployed green either way.
  - **F-1 — cron execution confirmed.** Vercel → Observability → Cron Jobs, Production,
    last 12h: `/api/cron/sales-reconcile` (0 11 * * *) 1 invocation P75 **14s**;
    `/api/cron/pace-alerts` (0 15 * * *) 1 invocation P75 **30s**. Durations in the tens
    of seconds prove completion, not a millisecond 401 rejection.
  - **SQ-2 — token refresh confirmed in production; the 08-06 expiry risk is CLOSED.**
    Production logs 2026-07-26 21:39:15, on both `/api/dashboard/summary` and
    `/api/dashboard/sales`: `[square] token refresh success org=cf888f2d-…`
    `expiresAt=2026-08-06T02:48:55.000Z -> 2026-08-26T04:39:18.000Z`. Fired on the first
    Square-touching request after promotion, exactly as the 23-day window predicted.
  - **SEC-1 — PARTIAL.** As ADMIN in prod, `fetch('/api/square/auth',{redirect:'manual'})`
    returned `0 opaqueredirect`, so the legitimate connect path still works and the
    deny-by-default change caused no regression. The **403-for-non-ADMIN half remains
    untested and is currently untestable** — no non-ADMIN account exists in the
    production Clerk instance. Logged as a new open item (create a production test
    account); every role verification to date has run through staging's Clerk DEV
    instance.
- **Also verified:** the P-3 roadmap dashboard renders at `/internal/roadmap` with
  "Jul 27, 2026 · from the git commit date of docs/ROADMAP.yaml" — the shallow-clone
  `unknown` fallback did **not** fire.
- **Post-promotion env change:** Gary scoped the Jun 26 `DATABASE_URL` row from
  *Production and Preview* to **Production only**; production redeployed successfully
  afterward (Datasource still `ep-green-smoke`), proving the value survived the edit.
  This closes the fail-open half of BUILD-1's blocker. The remaining half — no
  generic Preview-scoped `DATABASE_URL`/`DATABASE_URL_UNPOOLED`, so non-staging
  preview builds now fail at build time — is **deliberately deferred**; it costs
  nothing while only `staging` and `main` are pushed, and blocks only the deferred
  second-developer plan.

## 2026-07-26 — PRODUCTION promotion (PERM-1 + SEC-1 + BUG-3 fix)

- **Merge commit / rollback SHA:** `c463af3` — full: `c463af3482b1be4955c9e35b221e01db26f90eba`
  (rollback: `git revert -m 1 c463af3482b1be4955c9e35b221e01db26f90eba` → push main).
  Parents: `1ba059c` (previous main) and `95df9aa`.
- **What shipped:** PERM-1 permission capability shim (`6f70465`: enforcement
  inventory, capability registry, `can()`/`scope()`, sidebar nav pilot,
  zero behavior change), SEC-1 Square OAuth hardening (`ecee728`: session-org
  binding, 32-byte state nonce via double-submit httpOnly cookie, ADMIN gate on
  `/api/square/auth` and `/api/square/disconnect`), and the BUG-3 fix (`f6818f1`:
  `prisma.config.ts` routes Prisma CLI through Neon's direct endpoint).
- **Migrations:** none. SEC-1 Part B was chosen specifically to avoid a schema
  change, and BUG-3 is connection routing only.
- **Open prod-verification items:** SEC-1's ADMIN gate was never smoke-tested in
  production — verify a non-ADMIN gets 403 on `/api/square/auth`. **Do not test via
  Disconnect**, which revokes Keva Juice's live Square token. BUG-3's required proof
  (a build log showing the `Datasource "db"` host WITHOUT `-pooler`) is still
  unrecorded, which is why BUG-3 remains `in_progress` despite being in prod on both
  branches.
- *Recorded retroactively 2026-07-27 during the DOCS-2 reconcile — this entry was
  missing when the promotion happened.*

## 2026-07-25 — PRODUCTION promotion (HR-17 training preview)

- **Merge commit / rollback SHA:** `1ba059c` — full: `1ba059c03a9a2603eb1d1da3976e1e8d8ee6db1e`
  (rollback: `git revert -m 1 1ba059c03a9a2603eb1d1da3976e1e8d8ee6db1e` → push main).
  Parents: `59a6cdc` (previous main) and `da413bd`.
- **What shipped:** HR-17 only (`438a9ef`, built 7-24) — training builder "Save &
  Preview" opens the trainee renderer read-only, through the same extracted
  `TrainingModuleView` the `/my` execution page uses. Read-only by construction:
  preview carries no `assignmentId`, so neither write endpoint is reachable. Gated
  ADMIN/MANAGER, manager limited to modules applying to their stores; the resource
  download route's admin tier widened to the manage tier for the same scope.
- **Migrations:** none — HR-17 has no schema changes.
- **Attribution note (verified 2026-07-27):** this promotion carried HR-17 **only**.
  PERM-1 (`6f70465`) and SEC-1 (`ecee728`) are **not** ancestors of `1ba059c` —
  confirmed with `git merge-base --is-ancestor` (false for both) and
  `git log --ancestry-path 6f70465..origin/main`, whose first merge is `c463af3`.
  They shipped 07-26 in the entry above, not here.
- *Recorded retroactively 2026-07-27 during the DOCS-2 reconcile — this entry was
  missing when the promotion happened.*

## 2026-07-24 — PRODUCTION promotion (HR-11b + HR-11c) + HR LAUNCH

- **Merge commit / rollback SHA:** `59a6cdc` — full: `59a6cdcc4a989baf32951cc0f5d3db7863b378cc`
  (rollback: `git revert -m 1 59a6cdcc4a989baf32951cc0f5d3db7863b378cc` → push main;
  pre-merge tag `pre-staging-merge-20260724-2107` also on origin).
- **What shipped:** HR-11b field anchoring & inline stamping (DocumentAnchor model,
  server-side detection via new dep `unpdf`, admin confirm/rescan UI, per-signature
  checkpoints + timestamps), HR-11c ceremony fixes (anchor dedup, affordance-at-line,
  identity chips, legal Full Name capture + Square writeback), DECISIONS.md.
- **Migrations:** 2 additive (`20260723220118_hr11b_document_anchors`,
  `20260724153903_staff_legal_name_lock`) applied via `prisma migrate deploy` in the
  Vercel build. Pre-merge audit: no conflicts, no destructive SQL, no new env vars,
  local `next build` green before and after the merge.
- **HR LAUNCH:** `HR_MODULE_AVAILABLE=true` added to the Vercel **Production** scope
  post-push + redeploy (aliased to www.usefroot.com). Per-org `activeModules` "hr"
  toggle still flips in Settings per org.
- **Open prod-verification items (carried from HR-11c blockers, not re-tested
  pre-promotion):** certificate org-name ("Microsoft") re-test in prod; mobile
  visual QA of lift offsets on /my signing.

## 2026-07-23 — PRODUCTION promotion (HR-8 → STAFF-1 batch)

- **Merge commit / rollback SHA:** `942bc59` — full: `942bc591309a7f6fafee9089a9606db103a6ff6c`
  (rollback: `git revert -m 1 942bc591309a7f6fafee9089a9606db103a6ff6c` → push main).
- **What shipped:** HR-8 compliance rollup, BUG-1 steps 1–3 + BUG-2 fixes, UM-1
  user-management fixes, HR-15/HR-15b rehire + signing cycles, STAFF-1 (staff
  `/my` experience, nav matrix, HR-11 inline signing ceremony, BUG-1 step 4),
  DOCS-1 docs consolidation.
- **Migrations:** 1 additive (`20260723180000_hr15b_signing_cycles`) applied via
  `prisma migrate deploy` in the Vercel build.
- **Note:** HR stays dark in prod (`HR_MODULE_AVAILABLE` unset in Production).
- *Recorded retroactively 2026-07-24 during the Roadmap Tier-0 session — this
  entry was missing when the promotion happened.*

## 2026-07-21 — PRODUCTION promotion (L-3 + HR/Labor backlog)

- **Event:** first `staging → main` promotion in a while; `main` had drifted **53 commits behind** staging, so this promotion carried the **entire backlog**, not just L-3.
- **Merge commit / rollback SHA:** `9743899` — full: `974389946392dbacfca08f8add66264f8219e26b`
  (rollback: `git revert -m 1 974389946392dbacfca08f8add66264f8219e26b` → push main).
- **What shipped:** L-3 Weekly Plan (floor-first daily split, GM 40-hr cap, cross-day rebalancing) **plus the full HR module** (HR-0…HR-7.6) **and the Labor foundation** (pre-reset L-0…L-3).
- **Migrations:** 11 additive migrations applied to production Neon via `prisma migrate deploy` in the Vercel build — **succeeded** (a first redeploy hit the transient Prisma P1002 Neon-pooler timeout; a retry went green). No destructive ops, no data rewrites. See `MIGRATIONS.md`.
- **Post-promote:** enabled Labor in prod (`LABOR_MODULE_AVAILABLE=true` added to the **Production** env scope + org `activeModules` "labor" toggle); HR left dark. Prod forecast plan was regenerated (see `DECISIONS.md` — it was stale per-environment data, unrelated to this promotion).

> **Renamed 2026-07-22:** was `STAGING_DEPLOY_LOG.md`; renamed to `DEPLOY_LOG.md` (DOCS-1 consolidation) since it records both staging and production events. Splitting into separate staging/prod logs remains a future option if the mixed log gets noisy.
