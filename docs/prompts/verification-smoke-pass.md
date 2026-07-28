# Verification session — smoke pass (PERM-2 + PERM-3) + SQ-2 promotion

Do these in order. This session is verification, not building. If a check fails,
stop and note which phase and which step — don't push forward.

---

## 0 · Safety first — repoint local off production (~5 min, no Claude Code)

Right now local points at the customer's PRODUCTION database (`ep-green-smoke`).
Fix before anything else.

- [ ] Neon console → Branches → create a `dev` branch from production.
- [ ] Copy into local `.env`:
      - [ ] `DATABASE_URL` (pooled)
      - [ ] `DATABASE_URL_UNPOOLED` (same host, strip `-pooler`) ← missing today
- [ ] Sanity: run any Prisma command and confirm it echoes the **dev** host,
      NOT `ep-green-smoke`. If it still says green-smoke, stop — don't run anything.

---

## Test methodology (read once before you start)

- [ ] Open **DevTools → Network** (filter: Fetch/XHR) **and Console**, both visible
      the whole time. The failure mode is a silent 403 behind a spinner — you'll
      only see it as a red 403/500 in Network, not always as a visible error.
- [ ] Change Tommy's role in **Clerk** (the source of truth), not just the DB — a
      DB-only change gets reverted by the next webhook and you'd be testing the
      wrong permissions.
- [ ] **Sign out and back in** between the STORE and MANAGER passes so the session
      actually carries the new role.
- [ ] Have a **second store's `storeId`** on hand for the isolation checks.

---

## 1 · STORE pass — Tommy as STORE

Must WORK (positive):
- [ ] `/store-view` → tap **"Start checklist"** — this is the highest-risk path.
      It must open, not 403 or spin.
- [ ] `/inventory/counts` → start a count, add lines — works.
- [ ] Open a **finalized** count → shows "ask a manager for the summary," not a
      spinner or a raw error.

Must be BLOCKED (negative):
- [ ] No **Forecasting** entry in the nav.
- [ ] No `Forecasting →` link on the Monthly Goal dashboard card.
- [ ] Visiting `/forecasting` directly → redirects (doesn't render).
- [ ] Request another store's `storeId` (via URL/param) → **403**, and that store
      is **absent** from any store picker.

---

## 2 · MANAGER pass — Tommy as MANAGER (sign out/in first)

Must WORK:
- [ ] Forecasting shows **July–August** goals.
- [ ] Months beyond August are **blank**, with the subheading explaining why.
- [ ] Last **July's actuals** are still present.

Must be BLOCKED:
- [ ] Request another store's `storeId` → **403**, and that store absent from the
      picker.

---

## 3 · ADMIN regression — don't skip this

Permission refactors often over-restrict or accidentally change the role that was
already fine. Quick pass as ADMIN:
- [ ] ADMIN still sees Forecasting, Inventory, all stores in the picker.
- [ ] Click through the main nav as ADMIN — no *new* unexpected 403s on paths that
      worked yesterday.

---

## 4 · Promote SQ-2 to production — by July 30

Hard deadline: July 30 is when prod's Square token-refresh window opens. If the
refresh code isn't in prod by then, the live Square integration can fail on expiry.

- [ ] **Cherry-pick / cut at the SQ-2 commit** onto main. Do NOT merge staging
      wholesale — that would drag PERM-2, PERM-3, BUILD-1, and the roadmap
      dashboard into production unverified (the 53-commit-drift trap).
- [ ] After promotion, confirm token refresh works in production.
- [ ] Update SQ-2 → `shipped` in `ROADMAP.yaml`; push so the dashboard reflects it.

---

## Holds until after this session

PERM-4, PERM-5, UM-2, SEC-3, BUG-4, and the Vercel Preview `DATABASE_URL` fix all
wait. They'll still be there. One promotion, verified, at a time.

---

# RESULTS — pass executed 2026-07-27 (Gary)

Recorded 2026-07-27 during the DOCS-2 reconcile. The checklist above is the plan
as written beforehand and its boxes were never ticked in the file; this section
is the record of what was actually run. Where the two differ, this section wins.

Roles driven: **Tommy Thomas as STORE, then as MANAGER.** Changed in Clerk, with a
sign-out/in between passes, per the methodology above.

## Negative checks — all passed

| # | Check | Role | Result |
|---|---|---|---|
| S1 | `POST /api/staff` | STORE | **403** — was entirely unguarded pre-PERM-2 |
| S2 | `GET /api/staff` | STORE | **403** |
| S3 | Forecasting calendar | STORE | **403** |
| S4 | Cross-store calendar (sibling `storeId`) | MANAGER | **403** |
| S5 | `PATCH /api/forecasting/day` | MANAGER | **403** "Admin access required" |

S1 is the headline: PERMISSIONS_INVENTORY §2's worst-first finding — any org
member, including STORE and STAFF, could create staff records — is now closed by
observation rather than by code reading alone.

S4 confirms the assignment-scoping fix Gary added inside PERM-3: a MANAGER can no
longer read a sibling store's forecast by passing its `storeId`.

## Window masking — confirmed per-field, not range-clamping

The load-bearing result, because the two implementations are indistinguishable
from a passing 403 and only differ in the payload:

- `days: Array(365)` returned — the **full year**, not a truncated range.
- Window computed as **2026-07-01 → 2026-08-31**.
- **June 15: `goal` null, `actual` 2582.93 PRESENT.**

A masked goal sitting beside a live historical actual in the same row is exactly
the Q1 ruling in `DECISIONS.md` — mask the field, never clamp the range, because
clamping would withhold the historical actuals the ruling explicitly grants.

`/api/stores` as MANAGER returned **1 of 12** stores.

## Positive / regression checks — passed

- STORE can **start and complete** a checklist. This is the guard that matters:
  PERM-2's Task 1 found `POST /api/checklists` is the only way a daily instance is
  ever created, so the originally-proposed ADMIN-only lock would have stopped
  stores from opening.
- STORE **sees Weekly Plan in the nav** — the §3 #8 `labor.view` widening working
  as intended. (Note: PERM-4c will narrow labor *cost* data specifically; the nav
  tier itself stays wide. See `DECISIONS.md` 2026-07-27.)

## Partial — role-check ordering unverified

Inventory **pars** and **storage-areas** returned `400 "storeId is required"`
rather than a role denial. Not denied — but not proven either: a 400 raised
*before* the role check looks identical from the client to one raised after.
Re-test with a valid `storeId` to establish ordering on those two routes.

## Not covered — known gap

**The STAFF role was not exercised at all.** Recorded rather than glossed. Pick it
up with **HR-9** (EMPLOYEE role split), which has to re-walk these same routes.

## Section 4 (SQ-2 promotion) — done separately

SQ-2 was cherry-picked to `main` as `9dc6dc0` (staging's copy is `81be8d9`) and is
recorded `shipped: 2026-07-26` in `ROADMAP.yaml`. Still open from that section:
confirm token refresh in the **production** runtime logs. Production's token
(expiry 2026-08-06) was already inside the new 23-day refresh window at
promotion, so the first Square request after deploy should refresh immediately.

## Section 0 (repoint off production) — appears done, unconfirmed

Local `.env` now resolves to `ep-late-water-a6k53nv2` — neither production
(`ep-green-smoke`) nor staging (`ep-odd-rain`) — with `DATABASE_URL_UNPOOLED`
present and `-pooler`-free. Verified by env-var name and host only on 2026-07-27;
the dev branch's contents were not inspected. DEBT-4 stays open pending Gary's
confirmation and BUILD-1 reaching production.

---

# PRODUCTION verification — promotion `06b1561`, 2026-07-27

The staging pass above cleared the way for the promotion; this section records
what was checked **in production afterward**. Recorded during DOCS-3. Full
promotion detail in `docs/DEPLOY_LOG.md`.

Promotion: merge `06b1561`, parents `0363b2f` + `5e8effc`, rollback tag
`pre-staging-merge-20260727-1427`. 74 files, +4002/−179. **No migrations** —
`git diff --stat <tag>..HEAD -- prisma/` was empty. One conflict
(`docs/ROADMAP.yaml`), resolved by taking staging's superset.

## BUILD-1 — vercel-build split VERIFIED in production ✅

Production deployment `EHfDfAKJR`, 14:49:

```
Running "npm run vercel-build"
> prisma migrate deploy && npm run build
Loaded Prisma config from prisma.config.ts
31 migrations found; No pending migrations to apply.
```

Both risks answered: `vercel-build` **was** picked up (invoked by name, so the
@vercel/next script precedence held against a real deploy, not just a source
reading), and migrate deploy **actually ran** (it enumerated the ledger). The
feared failure was migrations silently ceasing to apply while builds stayed
green — this is the opposite. Satisfies BUILD-1's own verification step 3.

## BUG-3 — unpooled datasource PROVEN; bug closed ✅

| Env | Time | Datasource host | `-pooler`? |
|---|---|---|---|
| staging | 13:14 | `ep-odd-rain-a6gr4xmm` | no |
| production | 14:49 | `ep-green-smoke-a6xthq4r.us-west-2.aws.neon.tech` | no |

**The decisive evidence is negative:** neither log contains
`[prisma.config] DATABASE_URL_UNPOOLED is not set`. Because the fix is a `??`
fallback rather than strict, a pooled connection would still have deployed
green — so the *absence of the warning* is the only thing distinguishing "fix
working" from "fix silently degraded." This is exactly why BUG-3's notes
insisted a green deploy was not proof.

## F-1 — crons genuinely execute ✅

Vercel → Observability → Cron Jobs, Production, last 12 hours:

| Route | Schedule | Invocations | P75 |
|---|---|---|---|
| `/api/cron/sales-reconcile` | `0 11 * * *` | 1 | 14s |
| `/api/cron/pace-alerts` | `0 15 * * *` | 1 | 30s |

One invocation each is correct for daily crons under the Hobby cap. The
**durations** are the proof: a cron rejected at the `CRON_SECRET` check returns
a 401 in milliseconds. Tens of seconds is the profile of routes doing real work.

## SQ-2 — token refresh CONFIRMED in production; 08-06 risk CLOSED ✅

Vercel Logs, Production, 2026-07-26 21:39:15 — on both
`/api/dashboard/summary` and `/api/dashboard/sales`:

```
[square] token refresh success org=cf888f2d-f234-48c7-8097-fd5b44b5b3dd
expiresAt=2026-08-06T02:48:55.000Z -> 2026-08-26T04:39:18.000Z
```

Fired on the first Square-touching request after promotion, exactly as the
23-day window predicted. **The 2026-08-06 expiry deadline is gone** — the token
now runs to 08-26.

Note this line *is* the observability SQ-2 added: under the old silent
`if (!res.ok) return org`, success and failure both produced nothing, so a
failure would have been invisible until expiry. The phase verified itself. That
two dashboard GETs triggered it is consistent with DEBT-6.

## SEC-1 — PARTIAL ⚠️

- **Positive half — done.** As ADMIN in production,
  `fetch('/api/square/auth', {redirect:'manual'})` → `0 opaqueredirect`. The
  redirect to Square still fires, so the deny-by-default change did **not**
  break the legitimate connect path.
- **Negative half — untested and currently untestable.** Confirming a non-ADMIN
  gets 403 needs a non-ADMIN production account, and none exists in the
  production Clerk instance.

**Still prohibited:** do not test via Disconnect — it revokes Keva's live Square
token. Now more costly than before, since that token was just refreshed out to
2026-08-26.

## Roadmap dashboard (P-3) — renders in production ✅

`/internal/roadmap` shows "Jul 27, 2026 · from the git commit date of
docs/ROADMAP.yaml" — the first link of the fallback chain resolved, so the
shallow-clone `unknown` fallback did **not** fire.

## Carried forward

- **Create a production test account** (STORE or MANAGER, one store). Blocks the
  SEC-1 403 check, and is the general gap: every role verification to date has
  run through Tommy on staging's Clerk **DEV** instance. Also unblocks the STAFF
  coverage gap and the outstanding prod smoke tests on STAFF-1, HR-8, HR-11b/c,
  HR-15.
- **Inventory pars / storage-areas role-check ordering** — still unverified from
  the staging pass above (400 before any role check). Re-test with a valid
  `storeId`.
- **BUILD-1's remaining half** — non-staging preview builds now have no database
  and fail at build time. Deliberate and fail-closed; fix when collaboration
  work starts.
