TIER 3 session. Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/2026-10-16_MS-3b_raise_detection.md and execute it. Repo gate first, one command at a time. Stop where it says stop.

# MS-3b — Raise detection, cooldown, wage sync — TIER 3

Written 2026-10-16 by the MS-3a build session, on Gary's split ruling: *"Write
the MS-3b prompt into docs/prompts/ for a later session. Promote together."*

TIER 3: schema + confidential pay data + a cron change. Short audit → plan →
STOP for Gary's approval → build. Commit only. Never push. Never run a
migration.

## What MS-3b delivers (plain English)
Froot notices when someone's Square hourly rate goes up, treats that as a
completed raise, and hides that person's Raise badge for the cooldown an ADMIN
set on /staff/milestones (30 / 60 / 90 / 180 / custom days, already saved by
MS-3a). An ADMIN can enter a "last raise date" by hand to cover raises from
before Froot was watching. Wages sync daily so a raise is seen within a day.
Raise dates and amounts are shown only to people allowed to see that person's
pay.

NOT in MS-3b: notifications and the Copy button (MS-4), the report (MS-5).
Froot stays read-only from Square.

## Read first
- `docs/prompts/2026-10-16_MS-3_AUDIT.md` — A1 (wages), A2 (COMP-1), A10 (the
  split), F5–F8, F10, F15.
- `docs/DECISIONS.md` 2026-10-16 — MS-3 (Gary's rulings, in his words).
- The `MS-3` and `MS-3b` rows in `docs/ROADMAP.yaml`, and `DEBT-115`.
- `src/lib/raise-eligibility.ts` — MS-3a's `getRaiseEligibility`. MS-3b
  EXTENDS it; it does not build a second one.

## Rulings that already govern this phase (Gary, 2026-10-16)
- *"Wage sync in the daily timecard cron: Approved (goes in MS-3b)."*
- *"Testing raise detection: Approved — fixture on dev, cooldown on staging via
  the manual date (MS-3b)."*
- *"Badge vanishing after a raise: Accepted. Amounts and dates stay hidden from
  anyone without pay access."*
- *"Design: Extend my "no design bundle" ruling to MS-3a and MS-3b."*
- F5, F6, F7, F10, F15 *"approved as listed"*:
  - F5: a raise is `hourlyRate` higher than the immediately previous
    `WageSnapshot` for that member, both non-null. A job change at a higher rate
    counts. A decrease resets nothing. The baseline snapshot is never a raise. A
    dip-and-restore (15 → 14 → 15) counts. Salaried (latest `payType ===
    "SALARY"`): detection off, badge shows criteria only.
  - F6: ADMIN-only "last raise date" per member for pre-Froot raises; the
    cooldown counts from the LATER of it and the last detected raise.
  - F7: during cooldown, no badge on /staff. On the tab, pay-visible viewers
    see "Recent raise — eligible again from <date>"; everyone else sees "Recent
    raise — in cooldown", with no date and no amount. No amounts on this surface
    even for an ADMIN.
  - F10: the colour goes to every ADMIN/MANAGER who can see the member. Raise
    dates (detected and manual), the cooldown end date and from/to rates go
    only where `canSeeWages(org, actor) && compVisibleOnRow(actor, wageRow)` —
    failing CLOSED with no wage row (`compVisibleForMember`'s rule). Redacted
    on the server before anything renders or returns; absent keys, not nulls.
  - F15: only an ADMIN (`milestones.manage`) may set or clear the manual date.
- Cooldown boundary: the day BEFORE raise date + cooldown days is still in
  cooldown; that day itself is eligible. Store-local dates.

## Repo gate (one command at a time, paste each result)
pwd                → must end in Froot/froot (one cd allowed if it ends in Froot)
git status         → on staging, tree clean, up to date with origin
git log --oneline -5
If any check fails: STOP and report.

## Phase 1 — SHORT AUDIT (read-only), then PLAN and STOP
B1. Confirm MS-3a is as the MS-3 row says (getRaiseEligibility's signature,
    the `cooldown` key absent from RaiseCriterionKey today).
B2. WageSnapshot today on dev: row count, distinct members, any member with
    more than one row (read-only SELECT on dev, branch named on every line).
B3. `scripts/verify-ms1.ts` C18/C20: confirm the plan — the ONLY new reader is
    `src/lib/raise-history.ts`, added to C18's allow-list deliberately; C20
    (no `src/app` file names the table) stays unchanged.
B4. The labor-timecards cron: where the wage sync slots in, its own try/catch,
    and that `syncTeamMemberWages` needs no new Square scope (EMPLOYEES_READ).
B5. Dev level: `npx prisma migrate diff` (read-only). If not empty: STOP.
Write findings + plan to
docs/prompts/2026-10-16_MS-3b_AUDIT.md (or the session's date), commit that file
only, then STOP for Gary.

## Planned schema (adjust to house style)
- `StaffMember.lastRaiseDate DateTime? @db.Date`, `lastRaiseSetByUserId
  String?`, `lastRaiseSetAt DateTime?`. Additive only.
- No raise table: raises are DERIVED on read from `WageSnapshot` (audit lean,
  approved with the split).

## Phase 2 — BUILD (only after Gary's go)
1. Migration: `npx prisma migrate diff` into a new folder, then STOP. Gary
   applies it to dev (he uses `prisma migrate deploy`) and says go.
2. `src/lib/raise-history.ts`: the only `WageSnapshot` reader. Batched
   `detectRaises(org, members)` → latest raise date per member (store-local)
   plus from/to rates, salaried excluded.
3. Extend `getRaiseEligibility`: a `cooldown` criterion and an `inCooldown`
   result from the later of the detected raise and `lastRaiseDate`; status
   "cooldown" hides the /staff badge (F7).
4. `redactForViewer(result, payVisible)` — pure; deletes `lastRaise` and
   `cooldownUntil` when not pay-visible and words the cooldown without a date.
   Both pages call it per member before rendering.
5. ADMIN control on the Milestones tab: set / clear "Last raise date"
   (`PUT`/`DELETE /api/staff/[id]/last-raise`, `requireMilestones("milestones.manage")`,
   org-scoped by id, 404 when off). The date is pay data: shown only to
   pay-visible viewers.
6. Daily wage sync: at the end of `/api/cron/labor-timecards`, call
   `syncTeamMemberWages(org, "ACTIVE")` per overlay-on org in its own
   try/catch; a failure is logged and never fails the timecard result. No new
   `vercel.json` entry. Production only (Vercel runs crons on production).
7. FIX NOW carried from the MS-3 audit (Gary approved): correct the header of
   `src/app/api/square/labor/roster/sync/route.ts:15-17`, which claims "the
   debounced refresh the Positions card schedules" — no such refresh exists —
   and say the daily cron now refreshes wages.
8. Fixture `scripts/verify-ms3b.ts`: raise detected on increase only; baseline
   never a raise; decrease then increase; job change at a higher rate;
   salaried excluded; cooldown day before / day of; manual date later than and
   earlier than the detected raise; cleared manual date; terminated; the
   redaction — a MANAGER without `labor.costs.view`, a MANAGER viewing a
   `compConfidential` member, and a member with NO wage row (fail closed) each
   get the colour and NO date or rate keys (assert on the raw JSON); an ADMIN
   gets them. STORE/STAFF denied the last-raise route; out-of-scope MANAGER
   denied. Re-run verify-ms1 (with C18 updated), verify-ms2, verify-ms3.
9. `npm run build` passes, no error lines above piped output.

## Commits (scope `git add` to touched files — never `git add -A`)
- Work commit: code + migration + fixture, gated on eslint over touched files,
  the green fixture and the build (no pipes in the gate).
- Docs commit: MS-3b ROADMAP row (in_progress, work SHA), DECISIONS draft of any
  new ruling in Gary's words plus Claude's choices, MIGRATIONS.md entry, this
  prompt's audit file.
No DEPLOY_LOG entry — PRE-PUSH-CHECK writes it. MS-3 and MS-3b promote together.

## Staging checklist for Gary (in the final report)
Raise detection is NOT exercised on staging — staging is connected to the real
Keva Square account and Froot never writes to Square. Instead: set a manual
last-raise date on one member (badge gone from /staff; tab says "Recent raise");
the day-before / day-of boundary by choosing the date; as gary@keva.com
(MANAGER, Carson) confirm the tab shows NO date for a confidential member and
console-fetch the last-raise route (403); as Tommy (STORE) the route 403s and
the tab doesn't exist; phone width. The cron change activates at promotion.

## Final report
Commits, migration name, every prisma command verbatim, fixture counts (MS-1,
MS-2, MS-3, MS-3b), build result, choices for ratification, the checklist
above, and the unpushed-commits line. End with: "Done and committed. Next:
PRE-PUSH-CHECK for MS-3 and MS-3b."
