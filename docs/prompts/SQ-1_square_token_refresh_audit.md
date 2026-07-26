# SQ-1 — Square OAuth token refresh audit (READ ONLY)

**Track:** SQ (Square integration)
**Branch:** staging
**Type:** Audit only — no implementation
**Created:** 2026-07-26

---

## Why this session exists

Production `/api/square/status` returns:

```json
{"connected":true,"expiresAt":"2026-08-06T02:48:55.000Z"}
```

Square access tokens expire 30 days after issue. If nothing refreshes the token
before **2026-08-06**, Keva Juice's Square integration stops working — sales
sync, catalog sync, inventory counts, staff sync — and recovery requires a full
OAuth reconnect through the authorize flow.

This session determines whether refresh exists, whether it runs, and what breaks
when the token expires. It does **not** fix anything.

---

## Constraints

- **READ ONLY** on application code. No edits, no commits, no pushes, no migrations.
- **No database writes.** SELECT statements only. Present each query for approval
  before running it, and echo the database host first.
- **Do not call any Square API endpoint.** This is a code and config audit. Calling
  Square risks consuming or invalidating the live token.
- Out-of-scope findings: write them down as text. Do not fix them.
- The **only** permitted write is the `docs/ROADMAP.yaml` entry described in
  "Roadmap update" at the end of this file.

---

## Tasks

### 1. Does refresh code exist?

Search the repo for any call to Square's `ObtainToken` endpoint using the
`refresh_token` grant type.

Start with `src/lib/square.ts`, then grep the whole repo for:
`refresh_token`, `grant_type`, `oauth2/token`, `squareRefreshToken`,
`squareTokenExpiresAt`.

**Report:** does a refresh function exist? File and line. If not, say so plainly.

### 2. If it exists, what invokes it?

Determine every caller. Check specifically for:

- a scheduled job — compare against the crons registered in `vercel.json`
- lazy refresh — a wrapper that checks `squareTokenExpiresAt` before each Square
  API call and refreshes when near expiry
- a manual or admin-triggered route

**Report:** the invocation path, or that the function exists but is never called.

### 3. Where are the token fields written?

List every code path that writes `squareAccessToken`, `squareRefreshToken`, or
`squareTokenExpiresAt` on `Organization`.

Expected: the OAuth callback. **Report anything else** that writes them.

### 4. What happens on expiry?

Trace what a Square API call does when the access token is expired. Does it
surface a clear error, fail silently, or retry?

Check the shared Square fetch helper in `src/lib/square.ts` and two
representative callers: `/api/square/catalog/sync` and
`/api/cron/sales-reconcile`.

**Report:** the user-visible and log-visible symptom of expiry.

### 5. Cron inventory and plan limits

List every cron in `vercel.json` with its schedule.

Note: the Vercel account is on the **Hobby** plan, not Pro. The Pro assumption in
project docs was inferred from `maxDuration = 300` in code, which is a request,
not a grant.

**Report:**
- whether any registered cron's schedule exceeds Hobby limits
- whether `maxDuration = 300` exceeds the Hobby function timeout cap
- the implication for F-1 (`CRON_SECRET`), which has been investigated as a
  secrets problem and may be partly or wholly a plan-tier problem

### 6. Database read (present query first, then run)

Against the **production** Neon branch, read-only. Echo the database host before
running. Do not print token values — booleans only.

```sql
SELECT "name",
       "squareTokenExpiresAt",
       ("squareAccessToken"  IS NOT NULL) AS has_access,
       ("squareRefreshToken" IS NOT NULL) AS has_refresh
FROM "Organization";
```

**Report:**
- is a refresh token stored at all?
- does `squareTokenExpiresAt` suggest the token has ever been renewed, or does it
  look like a single issuance dating from the original connect?

### 7. Identify which Neon branch is `ep-green-smoke-a6xthq4r`

Open audit item. Determine whether this host is the production or staging Neon
branch. Report the branch name only — never the connection string.

Context: `npm run build` runs `prisma migrate deploy`, so a local build executes
migrations against whatever `DATABASE_URL` resolves to. If `ep-green-smoke` is
production, a local build can write schema changes to production outside any
promotion. This is a finding to record, not to fix in this session.

---

## Report back

- **Refresh code:** exists / does not exist (file + line if it exists)
- **Invocation:** scheduled / lazy / manual / never called
- **Expiry symptom:** what actually breaks, and how it surfaces in UI and logs
- **Refresh token stored:** yes / no
- **Cron inventory** + Hobby-plan concerns + F-1 implication
- **Neon branch identity** for `ep-green-smoke-a6xthq4r`
- **Days remaining** until 2026-08-06
- **Recommended remediation shape for SQ-2** — as a proposal only. Do not
  implement it. Include which approach you'd choose (scheduled refresh vs. lazy
  refresh vs. both) and why, given the Hobby cron constraints.

---

## Roadmap update (the one permitted write)

Add to `docs/ROADMAP.yaml`:

- **SQ-1** — status `complete`, with a one-line summary of the finding
- **SQ-2** — status `blocked` or `next` depending on the SQ-1 outcome, with the
  2026-08-06 deadline recorded explicitly in the notes
- Update the **F-1** notes with the Hobby-plan finding from Task 5
- Add an audit item for the Neon branch / local `migrate deploy` finding from
  Task 7

Do not restructure the file. Additive entries only, matching existing formatting.

---

## Done criterion

Report delivered. `docs/ROADMAP.yaml` updated. No other repository or database
state changed. No commit, no push — Gary runs all git commands.
