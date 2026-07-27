# SQ-2 — Square token refresh: observability + threshold

**Track:** SQ (Square integration)
**Branch:** staging only
**Type:** Implementation — small, two changes
**Depends on:** SQ-1 (complete)
**Created:** 2026-07-26
**Soft deadline:** 2026-07-30

---

## Why this session exists

SQ-1 established:

- `refreshTokenIfNeeded()` exists at `src/lib/square.ts:37` and is invoked lazily
  from `getSquareClient()` at `src/lib/square.ts:202`.
- It has **never successfully fired in production.** Not because it is broken —
  because its guard (`src/lib/square.ts:41`) only fires inside 7 days of expiry,
  and that window has not opened yet.
- On failure it returns silently: `if (!res.ok) return org` at
  `src/lib/square.ts:56`. No log, no error, no signal.
- The settings UI reads `!!org?.squareAccessToken` — presence, not validity — so
  an expired token displays as "Connected" indefinitely.
- Dashboard sync failures are caught and cached numbers are served, so stale
  figures render as current with no error state.

Current token state (both single original issuances, never renewed):

| Environment | Expires | Issued (inferred) | 7-day window opens |
|---|---|---|---|
| Production (`www.usefroot.com`) | 2026-08-06 | ~2026-07-07 | 2026-07-30 |
| Staging (`froot-git-staging…vercel.app`) | 2026-08-09 | ~2026-07-10 | 2026-08-02 |

**The problem this creates:** under current code, the first-ever execution of
untested refresh logic happens against Keva Juice's live production token on
07-30 — three days *before* staging gets its turn. The test environment is
scheduled behind the production environment.

This session inverts that, and makes the outcome observable either way.

---

## Scope — exactly two changes

Do not implement anything else from the SQ-1 recommendation list. Items 3, 4 and
5 in that list (cron backstop, routing bypassing helpers through
`getSquareClient`, `oauth.authorization.revoked` handling, settings UI reading
`/api/square/status`) are **SQ-3**. Note them if you touch adjacent code; do not
fix them.

### Change 1 — Log the refresh outcome

Replace the silent failure at `src/lib/square.ts:56` with explicit logging of
all three outcomes:

- **attempt** — organization id/name, current `squareTokenExpiresAt`
- **success** — old expiry → new expiry
- **failure** — HTTP status and Square's error response body

Requirements:

- **Never log token values.** Not access, not refresh, not partial, not
  truncated. Log expiry timestamps and booleans only.
- **Preserve existing return behavior.** The function must still return the
  stale `org` on failure — callers depend on it and changing that is out of
  scope. Add the log; do not change control flow.
- Use whatever logging convention the codebase already uses. Report what that
  is before writing code.

### Change 2 — Move the threshold off "inside 7 days of expiry"

Square's guidance is to refresh every 7 days or less. The current guard does the
opposite: it waits until the token is 23 days old, then compresses every retry
opportunity into the final 7 days before expiry.

Change the guard at `src/lib/square.ts:41` so refresh is attempted when the token
is **older than ~7 days**, rather than when it is close to expiring.

Note: only `squareTokenExpiresAt` is stored — there is no `issuedAt` field.
Derive age from expiry (Square access tokens live 30 days, so a token older than
7 days is one expiring in less than 23 days). **Do not add a schema field for
this** — see the hard constraint on migrations below.

Report the exact expression you intend to use before writing it.

---

## Hard constraints

- **Staging branch only. Do not push.** Gary runs all git commands.
- **NO SCHEMA CHANGES, NO MIGRATIONS, NO `prisma migrate` OF ANY KIND.**
  This is not the usual caution. The local `.env` `DATABASE_URL` resolves to the
  **production** Neon branch (`ep-green-smoke-a6xthq4r`), and `npm run build`
  runs `prisma migrate deploy`. A migration created in this session would apply
  to production from the local machine, outside any promotion. That defect is
  tracked as BUILD-1 and is not yet fixed. Work within the existing schema.
- **Audit first.** Read `src/lib/square.ts` in full, plus `getSquareClient` and
  its callers. Present a plan and wait for explicit approval before editing.
- Out-of-scope findings: write them down as text. Do not fix them.
- `package-lock.json` committed with any dependency change (none expected).

---

## Expected behavior after deploy — read this before testing

With the threshold change, staging's token (issued ~07-10, 16 days old) becomes
immediately eligible. **Refresh should fire on the first Square-touching request
after deploy** — a dashboard load will do it.

That is the point of the sequencing: staging executes the untested path first,
with logging in place, against staging's own Square authorization. If it fails,
the blast radius is staging's Square access — production runs on a separate
Square application (`Froot`, `sq0idp-Udjq…`) with a separate token and is
unaffected.

---

## Verification on staging

1. Deploy to staging. Record `expiresAt` from
   `https://froot-git-staging-indianathomas-2483s-projects.vercel.app/api/square/status`
   **before** loading anything else. Expected: `2026-08-09T02:05:10.000Z`.
2. Load the staging dashboard (triggers `getSquareClient`).
3. Re-check `/api/square/status`. **Expected: `expiresAt` has moved ~30 days
   out, into early September.**
4. Check the Vercel runtime logs for the staging deployment. Confirm the attempt
   and success lines appear, and confirm **no token values are present in the
   log output.**
5. If refresh failed: the logs now say why. Report the status code and error
   body. Do not attempt a fix in this session — report and stop.

---

## Report back

- Logging convention used, and the three log lines added (verbatim)
- The exact threshold expression, before and after
- Confirmation that no token value can reach the logs
- Confirmation that failure still returns the stale `org` (control flow unchanged)
- Staging `expiresAt` before and after the dashboard load
- Whether the refresh succeeded, and the log output proving it
- Any out-of-scope findings, as text only
- Anything encountered that belongs in SQ-3

---

## Roadmap update

`docs/ROADMAP.yaml`:

- SQ-2 → `staging` once verified on staging (not `verified` — that requires
  production)
- Add SQ-3 as `planned`, listing the four deferred items from the SQ-1
  recommendation
- Note the production promotion window: SQ-2 should reach production **before
  2026-07-30**, when production's current 7-day window would otherwise open

Additive only. Match existing formatting and the documented status vocabulary.

---

## Done criterion

`next build` passes. Staging verification steps 1–4 complete with `expiresAt`
confirmed moved. `docs/ROADMAP.yaml` updated. Nothing committed, nothing pushed.
