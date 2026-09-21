Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/NOTIFY-2a.md and execute it.

# NOTIFY-2a — Email settings hub: /settings/notifications

**TIER 3 — schema change.** One additive column on `Organization`, one
migration, one new settings sub-page that gathers what HR-16 and F-5b put
on `/settings`. Audit, STOP, build on Gary's go.

**Save to:** `/Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/NOTIFY-2a.md`
**Branch:** `staging`. Commit only — never push.
**Today:** 2026-09-20.

Read `/Users/garythomas/Claude_Projects/Froot/froot/CLAUDE.md` first. One
command at a time, no `&&`, never `git add -A`, `npm run build` gates every
commit. Report every `prisma` command verbatim. `npx prisma migrate diff` is
the only prisma command permitted; nothing is applied by this session.
Dev has every repo migration applied as of F-5b (Gary ran `migrate deploy`,
59/59); confirm with a read-only diff before generating anything, and if it
is not empty, STOP.

---

## Why this session exists

Gary's ruling, 2026-09-20: every email setting lives on one page. Today the
HR acknowledgment recipients (HR-16) and the behind-pace toggle (F-5b) sit
as separate cards on `/settings`, and the pace threshold is a global env
var. NOTIFY-2a builds `/settings/notifications`, moves both there, and makes
the threshold per-org. Later consumers (operational reports, employee
notifications) get a card each on the same page.

Rulings already made (do not relitigate):
- Pace-alert recipients stay ROLE-BASED: every ADMIN plus the store's
  assigned MANAGERs. No per-user opt-out. The org toggle is the only
  switch. Do not add a recipient list for pace alerts.
- Employee-facing emails (assignment notifications) are deferred.
- Email wording and format are unchanged in this phase; branding is
  NOTIFY-2b.
- ADMIN only, same gate as `/settings` (`settings.access`, ADMIN_ONLY, not
  grantable), re-checked in every route per PERM-2.

## Phase 1 — Audit. Report, then STOP.

1. **The two existing surfaces.** File:line for the HR recipients card and
   the pace-alerts card on `/settings` (page.tsx and their client islands),
   and the routes behind them (`PUT /api/hr/settings`, `POST
   /api/pace-alerts/toggle`). Report what each island imports so moving
   them is a relocation, not a rewrite.
2. **The sub-page precedent.** `/settings/labor` is the existing settings
   sub-page. Report its layout file, how it is linked from `/settings`, and
   its gate. The new page copies that shape.
3. **Threshold today.** `pace-alerts.ts:20-23` reads
   `PACE_ALERT_THRESHOLD_PCT` (finite, in (0,100], else 90). Report every
   place `thresholdPct` is read or passed, including the cron route and the
   fixture.
4. **`hrAckRecipients` route gate.** HR-16 put `PUT /api/hr/settings`
   behind `hrModuleAvailable()`. Report whether the notifications page
   should render the HR card when the HR module is off for the org, or
   hide it (fork F2).
5. **Migration state.** Newest folder (expect
   `20260920190000_f5b_pace_alerts_toggle`); read-only diff result.
6. **The #4 check from chat, read-only.** In `src/lib/hr-ack-notification.ts`,
   does the `email.sent` AuditLog row's metadata record which provider
   sent it (`console` vs `resend`)? Report yes/no with file:line. If no,
   add `provider` to the metadata in Phase 2 — it is one field, and it is
   what stops a console-mode "sent" on production from reading as
   delivery later.

**Forks for Gary — do not resolve:**

- **F1 — Threshold storage.** `Organization.paceAlertThresholdPct Int?`
  (null = fall back to env/90; my lean) vs non-null with default 90 (env
  var retired). Null-fallback keeps production behaviour identical on
  deploy; the non-null version is simpler to reason about later.
- **F2 — HR card when HR module is off.** Hide the card (my lean: the
  field is meaningless without the module) vs show it disabled with a
  note.
- **F3 — What stays on `/settings`.** Remove both cards entirely and
  replace with one "Email notifications →" link card (my lean) vs leave
  the pace toggle on `/settings` as well as on the new page (two places
  to flip one switch is the thing this phase exists to end).

Then STOP.

## Phase 2 — Build (after go)

**Schema.** Per F1. Additive. `prisma migrate diff` →
`prisma/migrations/<ts>_notify2a_pace_threshold/migration.sql` +
`docs/MIGRATIONS.md` entry. Not applied.

**Threshold plumbing.** The cron resolves the threshold PER ORG: org
value if set, else the existing env/90 fallback. `processPaceAlertForStore`
already takes `thresholdPct` in opts, so the change is in the cron's store
loop, not the lib. The run log line and JSON response report the threshold
per org (or "env" when falling back). Fixture gains one check: an org with
its own threshold alerts at that threshold, not the env one.

**Page.** `/settings/notifications`, on the `/settings/labor` pattern.
Sections, in this order, each a card:
1. **Signed-acknowledgment emails** — the HR-16 recipients field, moved
   verbatim, per F2.
2. **Behind-pace alerts** — the F-5b toggle, moved verbatim, plus a
   threshold input (integer, 50–100, help text: "Alert when month-to-date
   sales fall below this percentage of the month-to-date goal. Leave blank
   to use the default (90%)." — adjust wording if F1 retires the env var).
   Recipients line, read-only, stating the rule: "Sent to every admin and
   the store's assigned managers."
3. Nothing else. No placeholder cards for future consumers; they get added
   when they exist.

`/settings` per F3. Route for the threshold: extend `POST
/api/pace-alerts/toggle` into `PUT /api/pace-alerts/settings` taking
`{enabled, thresholdPct}` (Zod; keep the old route working or migrate the
island — say which), or add a second route; pick whichever the F-5b island
makes cleaner and say so.

**Provider in the audit row** per finding 6.

## Phase 3 — Commit (two-commit pattern)

Commit 1: schema, migration, page, islands, routes, cron threshold, lib
metadata, fixture.
`feat(NOTIFY-2a): /settings/notifications hub; per-org pace threshold; provider on ack audit rows`

Commit 2 (cites commit 1):
- `docs/ROADMAP.yaml`: NOTIFY-2 row becomes NOTIFY-2a (this, `in_progress`,
  commits, F1–F3 rulings) and NOTIFY-2b (planned: shared branded HTML
  template for all consumers, send log on this page from AuditLog
  Notification rows, Resend delivery webhooks for delivered/bounced).
  New planned rows: HR employee-facing notifications (assignment + "you
  have something to sign"; deferred by ruling 2026-09-20); operational
  reports email (Gary, later). New DEBT row: deliverability — new sending
  domain lands in Outlook Junk; no code fix; steps: Not-Junk the first
  sends at each new inbox, tighten DMARC to p=quarantine after weeks of
  clean delivery. F-5b row: `deferred` "per-org threshold" → resolved
  here with rider.
- `docs/DECISIONS.md`: NOTIFY-2a heading, F1–F3, and the standing rulings
  restated (role-based pace recipients, no opt-out, employee emails
  deferred).
- `docs/FORECASTING.md`: threshold is per-org.
- `docs/MIGRATIONS.md`, `docs/prompts/NOTIFY-2a.md`.
`docs(NOTIFY-2a): rows for 2a/2b, employee-notify, ops-report, deliverability; rulings (work <SHA>)`

## Staging verification (Gary)

1. Push; migration applies.
2. `/settings` shows the link card (per F3); both old cards gone.
3. `/settings/notifications`: HR recipients field shows the value saved
   earlier today (empty) and saves; pace toggle flips and persists; set
   threshold 75, reload, still 75; clear it, reload, blank.
4. Leave the pace toggle OFF. No cron on staging.

## Report

1. Findings 1–6 with file:line.
2. F1–F3 as presented and ruled.
3. Both SHAs, migration folder, fixture count.
4. `npm run build`. Prisma commands verbatim.

## Out of scope

- HTML/branding (2b). Send log page (2b). Webhooks (2b).
- Any recipient-model change for pace alerts.
- Employee notifications. Ops reports.
- Running the cron.
