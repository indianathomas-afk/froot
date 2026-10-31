TIER 3 session (investigation only — no code, no schema, no migration). Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/TIMECARD-HEAL-0_open_card_investigation.md and execute it. Repo gate first, one command at a time. Stop where it says stop.

# TIMECARD-HEAL-0 — Why open timecards never close — TIER 3

## What Gary saw (plain English)

On staging, the Day Inspector (`/labor/inspector`, Las Brisas, 2026-10-29)
showed almost every employee with a red **"Open, stale"** tag, often with
**"Double"** too. Their bars spanned the full day, and paid hours ran into the
thousands (Alyssa 7,787h, Maya 9,846h). The open cards started in Aug–Oct.

Production on the same store-day (`usefroot.com`, 2026-10-29) was clean:
normal clock-in/clock-out bars inside their scheduled shifts, real paid hours
(4–9h), and one legitimate No-show.

**Working theory (unproven):** these people did clock out in Square. Froot
stored the card while it was still open, and the sync only looks a few days
back, so a card that falls outside that window before a sync sees its
clock-out is never re-fetched and stays open in Froot forever. Staging syncs
only on dashboard loads (L-4d Phase A: production-only cron), so gaps there are
long. Production syncs nightly, so it has been fine. The gap is still real: a
few missed nights in production would produce the same rot.

This session proves or disproves that with code and dev data. It fixes
nothing.

## Repo gate (one command at a time, paste results)

```
pwd
```
→ must end in `Froot/froot`. If it ends in capital-F `Froot`, run
`cd /Users/garythomas/Claude_Projects/Froot/froot` and run `pwd` again.

```
git status
```
→ on `staging`, tree clean except this prompt file.

```
git log --oneline -1
```
→ expect `dbf0121`.

## Phase A — read (read-only, report with file:line)

The file wins over this prompt. No production or staging database reads from
this session: CLAUDE.md allows deployed-environment reads only in the Neon
console, and Gary runs those. Dev reads must carry the branch column.

A1. **The timecard sync.**
    - The `/api/cron/labor-timecards` route and whatever it calls.
    - The dashboard-triggered sync path (labor-dashboard.ts:302-319 per L-4d).
    - The model (`SquareTimecard` or equivalent) and the sync state
      (`SquareLaborSyncState`).
    Report:
    - the exact Square query, including which filter decides what is fetched:
      start time, updated time, or a cursor;
    - the window size;
    - how a card already in Froot gets updated (upsert key, which fields
      change).
A2. **Does anything ever re-fetch an open card outside the window?** Answer
    yes or no, with the cite. This is the theory's key claim.
A3. **The Square side.** From the installed SDK types (`node_modules`, not
    memory): can Labor search filter by `updated_at`, by card status
    (OPEN/CLOSED), or fetch cards by id? Which of those would let Froot heal an
    old open card with the read scopes it already has? No new scope.
A4. **The display side.** In `labor-inspector.ts` and the Day Inspector page:
    how "Open, stale" and "Double" are decided, and how an open card's end time
    is drawn (to "now"?) and paid hours computed. Also: does any **number**
    outside the Inspector read open cards? Check labor-actuals and "Scheduled
    vs actual". If yes, those numbers are wrong on staging today. Say where,
    and whether production could get the same.
A5. **Dev data.** On dev `br-broad-wave`, count timecards that are open with a
    start older than 24h. Report the count only, no names, with the branch in
    the same output. Dev may hold none; say so.
A6. **For Gary to run in the Neon console** (read-only SQL, branch literal in
    the output). Write one query that counts open-and-older-than-24h timecards
    per store. Gary will run it on staging, which should be high, and on
    production, which should be near zero. Write the SQL only; don't run it.

## Phase B — findings and plan (then HARD STOP)

B1. **Verdict.** Is the theory right, partly right, or wrong? Plain English
    first, then the cites.
B2. **Fix options**, with your lean. Expect at least these:
    - a heal pass: each sync also re-fetches every card Froot holds as open
      and older than N hours, by id or by an `updated_at` filter;
    - a wider window (cheaper, but it only delays the failure);
    - a display guard: open cards older than N hours are drawn and counted as
      "unknown," not as paid hours.
    Say which combination, and why.
B3. **Tier and size** of the fix phase, whether a migration is needed (my
    expectation: no), and the fixture shape.
B4. **RULING NOW items**, one sentence each, with your lean and a draft wording
    (e.g. the value of N; whether display guards are in scope).
B5. Classify every out-of-scope finding FIX NOW / RULING NOW / COMMENT / ROW.
    FIX NOW is not allowed here (no code).

### ═══ HARD STOP ═══
Print B1–B5 plus the A6 SQL. Ask Gary: "Ratify as written, or give me your
wording." Write nothing until he replies.

## Phase C — record (only after Gary's go)

C1. File one ROADMAP row for the fix phase, at the next free ID read from the
    file, status `planned`. Its notes carry B1–B3 with cites.
C2. Add the ratified rulings, in Gary's words verbatim, to `docs/DECISIONS.md`
    as one dated entry at the top.
C3. Placeholder count before and after. It must not rise.
C4. Run `npm run build`. Stage only the files you touched plus this prompt.
    One docs commit:
    `docs(TIMECARD-HEAL-0): open-card investigation, fix row filed, rulings`
C5. `git status` shows a clean tree.

## Report and stop

Report the SHA, the verdict in one line, and the new row's ID. Do NOT push.
Next is Gary's PRE-PUSH-CHECK.
