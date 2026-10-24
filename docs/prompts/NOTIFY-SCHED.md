Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/NOTIFY-SCHED.md and execute it.

# NOTIFY-SCHED — per-email-type schedules (time of day, days of week, frequency)

**TIER 3** (schema + cron engine). This session runs **Phase 1 (audit) only**, writes the audit file, and **STOPS**. Nothing is built until Gary rules on the forks and says go.

Standing rules apply, including CLAUDE.md R1–R4 (2026-10-24): commits on `staging` only; if a migration is generated, STOP and do **not** print apply commands for Gary — his planning chat gives them.

## Why
Gary wants each org's ADMIN to choose, on `/settings/notifications`, **when** Froot's scheduled emails go out: time of day, which days (Mon–Sun checkboxes), and how often (daily, weekly, monthly). Today send times are fixed in code and `vercel.json`. Must work for 100+ orgs in different time zones with no per-org setup outside the app.

## Target model (draft — the audit tests it against the code)
- **Two kinds of email** in the NOTIFY-6 registry: *event* emails send when the event happens (signed acknowledgments — unchanged in this phase); *scheduled* emails (pace alerts, milestone emails, and any future report) carry a schedule.
- **Per org, per scheduled kind:** local send hour, allowed days of week, frequency (daily / weekly / monthly). No row = today's behaviour, exactly.
- **One hourly cron** evaluates every org × scheduled kind: "is it the chosen local hour, on an allowed day, and has this kind not yet been sent for this period?" Local time comes from each store's own time zone (stores already carry one — e.g. "Los Angeles (PT)"), handled with IANA zones so DST is correct.
- **Period lock** per (org, kind, store or org, period) so a run that repeats or overlaps never double-sends. For pace alerts this generalises today's once-per-store-per-month `PaceAlertLog`.
- UI: a **Schedule** section on each scheduled kind's card on the hub, next to the NOTIFY-12 Recipients section. ADMIN only.

## Phase 1 — audit (read-only)

### Repo gate (report each, stop on surprise)
1. `git rev-parse --abbrev-ref HEAD` → `staging`
2. `git status --short` → clean (this prompt may be the only untracked file)
3. `git log --oneline -1` → expect `797f100`; `git log --oneline staging..main` → empty (staging is ahead of main by docs commits only — report `main..staging`)

### Read and report
1. **Every cron.** `vercel.json` schedules and each cron route: what it sends, when (UTC), auth (`CRON_SECRET`), and how it decides what to send. Include pace alerts, milestones, and anything else (calendar, checklists) that shares the cron list — scheduling must not disturb non-email crons.
2. **Pace alerts today:** threshold evaluation, `PaceAlertLog` lock (key, period, the F-5b compensating delete on send failure, DEBT-105), and what "once per store per month" means in code.
3. **Milestone emails today:** the "at most one a day" rule, the 7-day lookback, how sends are grouped (per store's managers vs org-wide admins), and its lock if any.
4. **Time zones:** where a store's time zone lives (field, values, nullability), whether `Organization` has one, and every existing helper that converts to store-local time (CAL-2a fixed a UTC "today" bug — reuse what it built). How should an org-wide email (admins across stores in different zones) pick its local hour?
5. **Registry fit:** how NOTIFY-6's `define.ts` / kinds would mark a kind scheduled vs event, and where the hourly evaluator would call the dispatcher.
6. **Hub UI:** where a Schedule section sits on each card; the existing ADMIN gate.
7. **Vercel limits:** confirm the plan's cron frequency allowance (Pro) and the function time limit; estimate run time for one hourly pass at 100 orgs × N stores.
8. **Staging testability:** Vercel crons fire on production only. Propose how Gary tests on staging (precedent: CAL manual `curl` with the Preview `CRON_SECRET`) and how the fixture injects a fake clock.
9. **Schema landing spot:** proposed table/columns, the period-key format, and how the generalised lock coexists with `PaceAlertLog` (migrate, wrap, or replace — preserve-and-mark, no drops).
10. **ROADMAP:** next free NOTIFY and DEBT ids (read the file; never assume) and overlapping rows (NOTIFY-3 reminders, ops-report email, DEBT-120).
11. **Dev migration level:** `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` → report whether empty, and the datasource host (expect `ep-late-water-a6k53nv2`). If not empty, STOP. Never run `migrate dev`, `deploy`, `reset` or `execute`.

### Forks for Gary (state each with the lean; add any the code raises)
- **F1 — which kinds get schedules now.** Lean: pace alerts and milestone emails. Signed acknowledgments stay immediate.
- **F2 — daily/weekly digest for event emails** (batch signed-acks). Lean: defer to a later phase; file a row.
- **F3 — time zone for an org-wide email.** Lean: store-scoped sends use each store's zone; org-wide sends use one org zone. The audit proposes where that comes from (existing field, or the most common store zone, or a new org setting).
- **F4 — pace-alert frequency meaning.** Lean: frequency sets the lock period — a store that is behind gets at most one alert per day / week / month, sent at the chosen hour on an allowed day. Monthly with no schedule row = today exactly.
- **F5 — monthly timing.** Lean: day of month 1–28 (avoids short-month gaps), at the chosen hour, ignoring the weekday boxes.
- **F6 — defaults.** Lean: no schedule row reproduces today's send times and frequency byte-for-byte; the fixture proves it.
- **F7 — cron shape.** Lean: one hourly dispatcher for scheduled email kinds, replacing their fixed daily entries in `vercel.json`; non-email crons untouched.
- **F8 — missed hour** (cron outage or deploy at the send hour). Lean: the next hourly run on the same local day sends it; no catch-up the next day.
- **F9 — who edits.** Lean: ADMIN only.

### Out of scope (file as ROW only if the audit proves it's needed)
Event-email digests (F2), the ops-report email, employee-facing emails, raising the 10-extras cap, DEBT-120.

### Output
Write `/Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/NOTIFY-SCHED_AUDIT.md` with findings, proposed schema, the forks with leans, and the build plan below adjusted to what you found. Commit nothing. Report a short summary and **STOP**.

## Build plan (after Gary rules — do not start)
1. Schema + migration via `prisma migrate diff` only. **STOP** — no apply commands; Gary applies to dev from his planning chat and says go.
2. Registry marks + hourly evaluator + generalised lock; existing kinds behave identically with no schedule rows.
3. Hub UI: Schedule section per scheduled card.
4. Fixture with an injected clock: defaults unchanged; chosen hour in store-local time across a DST boundary; disallowed day skipped; one send per period under repeated runs; missed hour caught on the same day only; monthly day 1–28; org isolation. Negative controls must fail where they should.
5. Commits: work, then docs (ROADMAP row, DECISIONS draft, MIGRATIONS entry). The docs commit also: (a) fixes `docs/prompts/PRE-PUSH-CHECK.md` wherever it says to stamp or commit "on main" (superseded by R1 — dated rider, don't delete); (b) records on the MS-6 MIGRATIONS entry that it was applied on staging (`br-square-feather`) at 2026-10-22 04:58:40Z, production not separately confirmed. Scoped `git add`. Never push. PRE-PUSH-CHECK is a separate session.
