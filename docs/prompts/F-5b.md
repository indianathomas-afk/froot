Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/F-5b.md and execute it.

# F-5b — Pace alerts: org toggle, burned-lock fix (DEBT-105), recipient hygiene

**TIER 3 — schema change.** One additive column on `Organization`, one
migration file, one settings toggle, two small changes in
`src/lib/pace-alerts.ts`. Audit, STOP, build on Gary's go.

**Save to:** `/Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/F-5b.md`
**Branch:** `staging`. Commit only — never push.
**Today:** 2026-09-20.

Read `/Users/garythomas/Claude_Projects/Froot/froot/CLAUDE.md` first. One
command at a time, no `&&`, never `git add -A`, `npm run build` gates every
commit. Report every `prisma` command verbatim. `npx prisma migrate diff` is
the only prisma command permitted; nothing is applied by this session
(DEBT-103). The migration applies to staging via vercel-build on push.

---

## Why this session exists

F-5's behind-pace alert is the only email Froot sends to managers, and the
2026-09-20 read-only pass found the email text is fine and the plumbing
around it has four gaps. Production is about to switch
`NOTIFY_EMAIL_PROVIDER` to `resend` so HR-16 can deliver; the moment that
happens, the 15:00 UTC pace-alert cron starts emailing real Keva admins and
managers too, because both features share the sender. F-5b puts a switch
between them and fixes what the pass found. Email wording is NOT changed.

Rulings already made:
- Email subject and body stay as they are (`pace-alerts.ts:137-150`).
- Recipients remain ADMIN + assigned MANAGER. No STAFF.
- Lock-before-send ordering stays (crash cannot double-alert).
- Per-org threshold and an admin daily digest are DEFERRED — record on the
  row, do not build.

## Phase 1 — Audit. Report, then STOP.

1. **Org settings.** Where `Organization` booleans are toggled today
   (HR-16 just added `hrAckRecipients` via `/settings` + `PUT
   /api/hr/settings`; the HR module toggle is `POST /api/hr/toggle`). Report
   the page section and route the new toggle should join, and its role gate.
2. **Offboarding.** What happens to a `User` row and its
   `StoreUserAssignment` rows when a member is removed from the org in Clerk?
   Read the Clerk webhook handlers (`organizationMembership.deleted`,
   `user.deleted` if they exist — the DECISIONS.md webhook notes say they may
   not). Report whether a departed manager can still match the recipient
   query at `pace-alerts.ts:91-98`. If `User` has an active/deleted/status
   field, name it. If it has none, say so — that decides F2 below.
3. **Store dashboard URL.** Does a per-store dashboard route exist (a
   `?store=` param, a `/dashboard/[storeId]`, or the store selector's URL
   form)? Report the exact shape or that there is none.
4. **DEBT-105 at source.** Confirm the send at `pace-alerts.ts:135` is after
   the `PaceAlertLog` create at `:103-122`, that the create is not inside a
   transaction with the send, and that the per-store catch at
   `route.ts:39-43` is the only thing between a send throw and the next
   store. Report file:line.
5. **Migration state.** Newest folder in `prisma/migrations` (expect
   `20260920120000_hr16_ack_recipients`); `docs/MIGRATIONS.md` entry format.

**Forks for Gary — do not resolve:**

- **F1 — Toggle default for existing orgs.** `false` (my lean: nothing
  sends until someone turns it on, including Keva) vs `true` (current
  behaviour preserved; production flip sends immediately).
- **F2 — Recipient hygiene.** Depends on finding 2: filter by an existing
  active/status field; or, if none exists, treat "has a live Clerk org
  membership" as the test if the data supports it; or leave as-is and file
  a row. Present what the data allows.
- **F3 — Failed send.** Compensating delete of the `PaceAlertLog` row on
  send throw (my lean; tomorrow retries, double-alert still impossible)
  vs adding a `deliveredAt`/status column (bigger, defer).
- **F4 — Dashboard link.** Per-store URL from finding 3 if one exists;
  otherwise leave `/dashboard`.

Then STOP.

## Phase 2 — Build (after go)

**Schema.** `Organization.paceAlertsEnabled Boolean @default(<F1>)`.
Additive. `prisma migrate diff` → `prisma/migrations/<ts>_f5b_pace_alerts_toggle/migration.sql`
+ `docs/MIGRATIONS.md` entry. Not applied.

**Cron gate.** In `route.ts`, the store filter at `:31-33` additionally
requires `organization.paceAlertsEnabled: true`. A disabled org's stores are
never evaluated and never get a `PaceAlertLog` row. Log one line per run
with counts: orgs enabled / stores evaluated / alerted / skipped.

**Settings.** On the surface from finding 1, a toggle "Behind-pace alert
emails" with one line of help text: "Emails admins and the store's assigned
managers once per store per month when month-to-date sales fall below the
alert threshold." ADMIN only, same gate as HR-16's field.

**DEBT-105 (per F3).** In `processPaceAlertForStore`, wrap the send: on
throw, delete the `PaceAlertLog` row just created (by id, not by unique
key, so a concurrent winner's row is never deleted), then rethrow so the
per-store catch still records `error:` and the run continues. Comment the
ordering: lock → send → on failure release. Mark DEBT-105 resolved in the
docs commit, citing the work SHA.

**Recipients (per F2).** Apply the filter Gary chose at `:91-98`. Nothing
else in the query changes.

**Link (per F4).** `:150` only.

**Fixture.** `scripts/verify-f5-polish.ts` gains three checks: disabled org
→ store skipped with reason; send throw → no `PaceAlertLog` row remains
and the second run alerts; recipient filter excludes whatever F2 excludes.
Run it and report the count.

## Phase 3 — Commit (two-commit pattern)

Commit 1: schema, migration, cron gate, settings toggle, lib changes,
fixture.
`feat(F-5b): pace-alerts org toggle; release lock on failed send (DEBT-105); recipient filter`

Commit 2 (cites commit 1):
- `docs/ROADMAP.yaml`: new row `F-5b` (track forecasting, size S,
  `in_progress`, commits) with F1–F4 rulings in notes and two `deferred:`
  entries: per-org threshold; admin daily digest. DEBT-105 → resolved with
  rider. F-5 notes prepended: "F-5b (SHA) added the org toggle; production
  sends nothing until an org enables it."
- `docs/DECISIONS.md`: F-5b heading, F1–F4.
- `docs/FORECASTING.md`: pace-alerts section gains the toggle and the
  release-on-failure ordering.
- `docs/MIGRATIONS.md`, `docs/prompts/F-5b.md`.
`docs(F-5b): row, rulings, DEBT-105 resolved, FORECASTING + MIGRATIONS (work <SHA>)`

## Staging verification (Gary)

Staging runs `resend`, and pace alerts would go to real staging
admin/manager addresses. So:
1. Push; migration applies. Every org on staging now has the toggle at the
   F1 default.
2. `/settings`: confirm the toggle renders and saves (flip it, reload, flip
   back). Leave every org DISABLED.
3. Do NOT run the pace-alerts cron on staging. The fixture is the proof of
   the lock-release and the gate; the cron gate is proven on production the
   day after the flip, by the run-count log line.

## Report format

1. Findings 1–5 with file:line.
2. F1–F4 as presented and as ruled.
3. Both SHAs, migration folder, fixture check count.
4. `npm run build` result.
5. Prisma commands run, verbatim.

## Out of scope

- Email wording. Per-org threshold. Digest. HTML.
- Anything in HR-16 or notify.ts.
- Running the cron anywhere.
