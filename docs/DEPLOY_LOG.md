> Renamed from STAGING_DEPLOY_LOG.md 2026-07-22 — logs both staging and prod deploys.

Deploy verification: 2026-07-02T22:00:05Z

---

## 2026-07-21 — PRODUCTION promotion (L-3 + HR/Labor backlog)

- **Event:** first `staging → main` promotion in a while; `main` had drifted **53 commits behind** staging, so this promotion carried the **entire backlog**, not just L-3.
- **Merge commit / rollback SHA:** `9743899` — full: `974389946392dbacfca08f8add66264f8219e26b`
  (rollback: `git revert -m 1 974389946392dbacfca08f8add66264f8219e26b` → push main).
- **What shipped:** L-3 Weekly Plan (floor-first daily split, GM 40-hr cap, cross-day rebalancing) **plus the full HR module** (HR-0…HR-7.6) **and the Labor foundation** (pre-reset L-0…L-3).
- **Migrations:** 11 additive migrations applied to production Neon via `prisma migrate deploy` in the Vercel build — **succeeded** (a first redeploy hit the transient Prisma P1002 Neon-pooler timeout; a retry went green). No destructive ops, no data rewrites. See `MIGRATIONS.md`.
- **Post-promote:** enabled Labor in prod (`LABOR_MODULE_AVAILABLE=true` added to the **Production** env scope + org `activeModules` "labor" toggle); HR left dark. Prod forecast plan was regenerated (see `DECISIONS.md` — it was stale per-environment data, unrelated to this promotion).

> **Renamed 2026-07-22:** was `STAGING_DEPLOY_LOG.md`; renamed to `DEPLOY_LOG.md` (DOCS-1 consolidation) since it records both staging and production events. Splitting into separate staging/prod logs remains a future option if the mixed log gets noisy.
