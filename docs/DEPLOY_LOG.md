> Renamed from STAGING_DEPLOY_LOG.md 2026-07-22 — logs both staging and prod deploys.

Deploy verification: 2026-07-02T22:00:05Z

---

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
