# Store hours validation — block the impossible, flag the improbable

TIER 2 — contained. One new pure module, two call sites, one fixture,
one read-only sweep. No schema, no migration.
Branch: staging. Commit only. NEVER push — Gary pushes.

PRECONDITION: R7-D is promoted and pushed, and staging is level with
main. If it is not, STOP and say so — this session's commits must not
ride the R7-D promotion, whose DEPLOY_LOG entry does not describe them.

## WHY THIS EXISTS — it caught two real errors this morning

Nothing in Froot populated StoreHours until 2026-08-23. Every open
window in the labor model was inferred from trailing sales
(inferOpenWindowsByWeekday, flagged since L-3). Gary began entering
real hours and the editor accepted two impossible sets without comment:

  1. Mon–Fri entered as 08:00 AM to 08:00 AM — a zero-length day, or a
     24-hour one, depending on how the engine reads it.
  2. Sunday entered as 01:00 AM open. An AM/PM slip on a campus store.

Both saved silently. The second one is not cosmetic: the GM on-floor
band's real default is `open.startHour -> 14:00` (DEBT-83, a hardcoded
literal at labor-plan.ts:284). A 01:00 open turns Kristie's Sunday band
into thirteen hours at a store she is 50% allocated to. A wrong open
time propagates straight into the labor forecast.

THE EDITOR IS NOW THE ONLY DEFENCE, because these are Froot's own rows
and a Square resync never overwrites them.

## THE RULE SET — and why the obvious check is WRONG

`close < open` is LEGAL and MUST NOT BLOCK. The dialog's own helper text
promises it: "A store that closes after midnight is fine — enter the
real closing time (say 02:00) rather than 24:00." Blocking it would
break the promise the UI makes. Overnight windows are real.

BLOCK ON SAVE — unambiguous, no legitimate case:
  B1. open == close on a day not marked Closed. Zero-length or 24-hour;
      neither is a store. THIS IS ERROR 1 ABOVE.
  B2. one time filled and the other blank, day not marked Closed.
      Blank means "not yet decided" — the dialog says so — and a
      half-filled day is neither decided nor blank.

WARN AND ALLOW — improbable, but real stores are strange:
  W1. duration > 16h.
  W2. duration < 4h.
  W3. open time before 05:00. THIS IS ERROR 2 ABOVE — the AM/PM slip.
  W4. a day whose open OR close differs by more than 3 hours from the
      MEDIAN of that store's other filled, non-closed days. Six days at
      08:00 and one at 01:00 is the strongest available signal and it
      is nearly free. Needs at least 3 other filled days to fire;
      below that there is no shape to compare against.

WARN, NEVER BLOCK, on W1–W4 BY RULING PRECEDENT. Rohan's Restaurant,
Cafe De Keva Cart and Keva Kiosk are seasonal and legitimately odd. The
shape is R7-C's: ASSERT, RAISE A VISIBLE FLAG, NEVER NORMALISE. Do not
auto-correct a time, do not swap AM/PM, do not infer intent. Inventing
a value nobody typed is the failure mode this house has ruled against
twice (LaborDaySplit's read-normalisation is the anti-pattern).

## SHAPE — the module, not the form

A PURE module: src/lib/store-hours-validate.ts. Follow
src/lib/labor-roster-hours.ts — client-bundle-safe, no prisma import,
no server-only import, so the dialog and the fixture import the SAME
code the API route calls.

Export something in the shape of:
  validateStoreHours(days) -> { blocking: Issue[], warnings: Issue[] }
with each Issue naming the day and a plain-English reason. Exact
signature is yours; the constraint is that ONE function produces both
lists and both call sites use it.

TWO CALL SITES, and the second is the point:
  1. The dialog — disable Save while blocking is non-empty, show the
     reason next to the offending day, render warnings inline without
     blocking.
  2. THE API ROUTE that persists StoreHours — reject on blocking.
     Find it; do not assume its path. A form-only check is not a check:
     BUG-11/BUG-12 are the precedent for the editor and the write path
     disagreeing.

Warnings are NOT persisted. No column, no flag, no schema. They are
computed at render and at write, and a warned save succeeds.

## THE SWEEP — read-only, same session

Run the validator over EVERY existing StoreHours row and report a
table: store, day, open, close, and any blocking or warning issue.

Gary entered hours by hand this morning, so this is the check on the
data as much as on the code. Name the branch in the same output as the
result. If a deployed branch is needed, the credential rule stands —
hand Gary the SQL for the Neon console, do not reach for a deployed
credential.

REPORT WHAT YOU FIND. Do not fix data in this session. A wrong row is
Gary's to correct in the UI, which is also the first live test of the
editor's new behaviour.

## FIXTURE FIRST

scripts/verify-store-hours.ts, in the verify-labor-*.ts style — pure,
no DB, runnable with npx tsx. Cases, at minimum:

  - 08:00–08:00 not closed -> BLOCKS (error 1, by name)
  - open filled, close blank, not closed -> BLOCKS
  - both blank, not closed -> clean (undecided is legal)
  - day marked Closed with times present -> clean, no issue of any kind
  - 22:00–02:00 overnight -> CLEAN, NOT a warning. The promise the
    helper text makes. Assert this explicitly.
  - 01:00–16:00 with six sibling days at 08:00 -> W3 and W4 both fire,
    and the save still SUCCEEDS
  - 10:00–16:00 with six siblings at 08:00–20:00 -> W4 fires on close,
    not on open
  - fewer than 3 sibling days -> W4 does NOT fire
  - a legitimately short seasonal day, 11:00–14:00 -> W2 only, allowed

Show the fixture failing before the module exists or is wired.

## OUT OF SCOPE — do not get pulled in
DEBT-83 and the GM on-floor window default. The :98/:102 whole-crew
ruling. Entering or correcting hours data. Timezone handling. Anything
that reads or writes the labor forecast. If a labor engine file needs
editing, STOP and report — that means the scope was wrong.

## HOUSE RULES
Additive only. No schema, no migration, no drops. Preserve-and-mark.
Two-commit pattern: work commit, then the docs/roadmap recorder with
the SHA. Gate per commit: scoped npx eslint on touched files, then bare
npm run build. No bare npm run lint (DEBT-33). No && chains in anything
handed to Gary; fixed sequences go in ONE parenthesised subshell with
|| echo "*** NO MATCH ***" guards. Row ids come from ROADMAP.yaml's
next free — S5-D numbers are DEVIATIONS, not row ids.

Triage everything found and not fixed: FIX NOW / RULING NOW / COMMENT /
ROW. Default to the first three. Report the count in each bucket.
