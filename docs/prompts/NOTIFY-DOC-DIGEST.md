Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/NOTIFY-DOC-DIGEST.md and follow it.

# NOTIFY-n — Overdue & due-soon document digest (manager-facing)

**TIER 3** — new email type, settings, possibly schema. Full ceremony: audit → **STOP for Gary's ratification** → build → **STOP after any migration is generated** → Gary applies it to dev → fixture → commit. Declare the tier before writing anything.

## Repo gate

1. Confirm you are in `/Users/garythomas/Claude_Projects/Froot/froot` (lowercase), on `staging`, and that `staging`, `main`, `origin/staging` and `origin/main` all point at `6cefd63`. Tree clean. If not, STOP and report.
2. Read `/Users/garythomas/Claude_Projects/Froot/froot/CLAUDE.md` and `/Users/garythomas/Claude_Projects/Froot/froot/docs/ROADMAP.yaml`. **The existing `NOTIFY-3` row is employee-facing emails (deferred by Gary 2026-09-20) — this phase is NOT that row; do not change its scope or status.** Pick the next free `NOTIFY-n` id by reading the file (never assume), and use it as this phase's id everywhere below in place of `NOTIFY-n`. Add a one-line cross-ref to NOTIFY-3's notes saying the manager-facing digest shipped as NOTIFY-n (prepended, dated). Also read the DOC-8, NOTIFY-12, NOTIFY-13, NOTIFY-2c and F-5b rows.

## What Gary wants

DOC-8 gave documents due dates, but nobody sees one unless they open Froot. This phase is a scheduled email to admins and managers listing who is overdue or due soon on documents. Employee-facing emails stay deferred (Gary, 2026-09-20) — this phase emails nobody about their own documents.

## Draft rulings (Gary's leans from chat — NOT ratified; he ratifies in his own words at the audit STOP)

1. **Recipients.** Every ADMIN gets the whole org. Each MANAGER gets only the stores they're assigned to. NOTIFY-12 "Also send to" contacts get the org-wide version. A new deniable-not-grantable `notify.*` capability (NOTIFY-2c pattern) lets an admin untick a person in Edit User; it can never add anyone.
2. **Content.** Only documents with a due date (DOC-8 `signWithinDays` set): overdue, plus due within the next 3 days. Unsigned documents without N are excluded.
3. **Layout.** Grouped by store, then person; each line = document + "Was due {Mon D}" or "Due in d days / tomorrow / today" using DOC-8's wording helpers (`src/lib/hr-due-wording.ts`), overdue lines first. Branded template (NOTIFY-2b). Button → `/hr/compliance`. A plain-text version alongside, as every other consumer has.
4. **Empty digest.** Nothing to report for a recipient → no email to that recipient, with a named skip log line.
5. **Schedule.** Uses NOTIFY-13's schedule controls on `/settings/notifications`. Default weekly, Monday 8:00 AM Pacific. Org toggle defaults OFF (F-5b pattern) — nothing sends until Gary flips it.
6. **Repeats.** Each digest is a fresh snapshot; a person reappears every run until they sign. No "already reminded" tracking.
7. **Exclusions.** Terminated staff; DOC-8's `recordMissing` case (never overdue, admin's gap).
8. **Training.** Out of scope. File a row for a training section in the same digest later.
9. **Records.** One AuditLog Notification row per send attempt (existing `email.sent` / `email.failed` pattern, provider recorded), so it appears on the hub's "Recent emails" card.

## Phase 1 — Audit (read-only). Write `/Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/NOTIFY-DOC-DIGEST_AUDIT.md`

Answer with file paths and line references:

- **Due-state source:** DOC-8's `documentDueState()` and the compliance items it feeds. Confirm the digest can be built entirely from that, so the email can never disagree with `/hr/compliance`.
- **Scheduler:** how NOTIFY-13 stores schedules per email type, how its cron decides what fires when, store-local vs org time, and whether adding a new email type needs schema or is just a new key. State the TIER consequence.
- **Toggle:** where the existing per-type on/off lives (pace alerts `paceAlertsEnabled`, others), and whether the digest's toggle is a column or a setting row.
- **Recipients:** the pace-alert recipient query (ADMINs + store MANAGERs), the NOTIFY-2c `can()` post-filter, NOTIFY-12 contacts. Note DEBT-106 (departed admin still matches) — it affects this digest the same way; say so, don't fix it here.
- **Sample send:** does NOTIFY-13 (or the hub) have a "send a sample to me" path? If yes, plan to wire the digest into it so Gary can see it on staging without a cron curl. If no, propose the smallest equivalent (admin-only, emails the caller only, like `POST /api/notify/test`).
- **Hub UI:** where the new card goes on `/settings/notifications` and what it shows (toggle, schedule, recipients line, sample button).
- **Timezones:** DB is UTC, Gary is Pacific; how "due within 3 days" is counted against DOC-8's member-local midnight rule.

End with: (a) forks needing a ruling, each with a lean; (b) build plan — schema (if any), files, fixture checks; (c) anything contradicting a draft ruling.

**STOP after writing the audit.** Report a short summary and the forks. Do not commit. Wait for Gary.

Ratification rule: record only Gary's own words. A reply that is button text you drafted, or text he pasted from elsewhere, is not a ruling — ask him to say it himself, or offer to ask the forks one at a time.

## Phase 2 — Build (only after Gary ratifies)

1. Record his ratification in `/Users/garythomas/Claude_Projects/Froot/froot/docs/DECISIONS.md`, his exact words, newest-first.
2. If schema is needed: additive only, generated with `prisma migrate diff` (the only DB-touching command you may run). Name it `<timestamp>_notify3_doc_digest`. **STOP after generating it.** Report the SQL; Gary applies it to dev himself. Before continuing, verify the columns exist on dev with a read-only check that prints the branch id — don't take a typed "applied" as proof.
3. Build the digest builder, cron wiring, hub card, capability, and sample send.
4. Fixture: empty digest skips; ADMIN sees all stores, MANAGER only theirs; denied user excluded; terminated and `recordMissing` excluded; no-N documents excluded; due-in-3 boundary; overdue sorted first; wording matches DOC-8 helpers; one audit row per send attempt; toggle off → nothing sends.
5. `npm run build` green; scoped eslint on changed files (bare `npm run lint` fails, DEBT-33).

## Commits (commit only, never push)

Stage only files you touched — no `git add -A`.

1. Work commit: `NOTIFY-n: overdue & due-soon document digest for admins and managers`
2. Docs commit: NOTIFY-n row (new, `in_progress`) with commits; the audit; DECISIONS entry; MIGRATIONS.md line if a migration exists; the training-section row.

## Report

Tier, audit summary, ratified forks, migration (name + SQL, or "none"), files changed, both SHAs, fixture count, build result, prisma commands run (verbatim), out-of-scope findings classified FIX NOW / RULING NOW / COMMENT / ROW, and a staging test plan for Gary (staging sends real email — keep the toggle OFF and use the sample send to his own address): sample shows Test - Handbook Regression for Tommy with correct wording; a manager-scoped sample shows only that manager's stores; untick a person in Edit User and they drop out; a "Recent emails" row appears on the hub.
