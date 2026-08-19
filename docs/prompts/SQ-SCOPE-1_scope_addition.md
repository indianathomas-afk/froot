# TIER 2 — SQ-SCOPE-1: Add the two labor read scopes to the OAuth request

**Session type: CONTAINED, TWO-STRING CODE CHANGE.** This session edits one
line of one file, plus docs. It does NOT bump `SQUARE_VERSION`, does NOT touch
the webhook subscription, and does NOT build any labor feature. The L-2 build
gates remain in force except the one this session clears.

---

## Context (self-contained — do not rely on chat history)

Repo: `~/Claude_Projects/Froot/froot` (lowercase `froot` is the git root; the
capital-F parent is a known trap — verify with `git rev-parse --show-toplevel`).

Gary's rulings of 2026-08-18 (recorded in `docs/DECISIONS.md`, top entries —
read them):
- Froot is read-only toward Square; the name write-back dies.
- The L-2 consent batch is frozen at exactly two scope strings, pinned at
  source by the LABOR-0B survey (`docs/prompts/LABOR-0B_RESULTS.md`):
  `TIMECARDS_READ` and `TIMECARDS_SETTINGS_READ`. Scheduled-shift reads ride
  on `TIMECARDS_READ`; wage reads are already covered by the held
  `EMPLOYEES_READ`. `REPORTING_READ` is PARKED (Square's docs contradiction)
  and must NOT be added.
- Consent economics: adding scopes now, while exactly one merchant (Gary) is
  connected, freezes the re-consent batch at one person forever. New merchants
  consent to the full list on first connect.

The write-back removal (SQ-WB-1, work commit `0fd414a`) must already be on
`origin/staging` — the consent screen must tell the truth (read-only) on the
day it is shown.

## Gate — three checks before touching code

1. `docs/DECISIONS.md` top entries contain the 2026-08-18 read-only ruling.
   Quote the heading line.
2. Commit `0fd414a` is an ancestor of `origin/staging` (run
   `git fetch origin` then `git merge-base --is-ancestor 0fd414a origin/staging`
   and report the exit code). If not: STOP — the removal has not been pushed.
3. `docs/prompts/LABOR-0B_RESULTS.md` Task 3 table pins the two scope strings
   exactly as `TIMECARDS_READ` and `TIMECARDS_SETTINGS_READ`. Quote the table
   rows. If the strings differ, STOP and report — the ruling froze the batch
   against that survey, and a mismatch means one of them is wrong.

## Hard rules

1. The ONLY source-file edit this session makes is the scope string in
   `src/app/api/square/auth/route.ts` (the line currently reading
   `MERCHANT_PROFILE_READ ITEMS_READ ORDERS_READ EMPLOYEES_READ` — verify it
   is line 9 by reading it; quote it verbatim before and after).
2. Do NOT touch `SQUARE_VERSION` or the two hardcoded `"2024-01-17"` literals
   (`callback/route.ts:43`, `locations/route.ts:44`). Version bump is a later
   session.
3. Do NOT add `REPORTING_READ` or any other string. Two additions, zero
   removals, zero reordering of the existing four.
4. Do NOT add any `_WRITE` scope under any circumstances — this would violate
   the 2026-08-18 ruling and the consent story.
5. No `&&` command chains. One command per paste.
6. `npm run build` green before each commit. No push — Gary pushes.

## Task 1 — The edit

Append ` TIMECARDS_READ TIMECARDS_SETTINGS_READ` to the existing
space-separated scope string in `src/app/api/square/auth/route.ts`. Preserve
the existing four strings and their order exactly. Quote the full line
before and after in the session output.

Confirm by reading the file that nothing else in the route changed.

## Task 2 — What this does and does not change (record in output)

Record explicitly, for the session report:
- This changes the AUTHORIZE URL only. The existing connected token keeps its
  current four read permissions and every current sync keeps working
  unchanged. Nothing about live behavior moves until Gary re-consents.
- After re-consent, the token carries six read permissions. No code reads the
  two new ones yet — they are deliberately dormant until the version bump and
  the L-2 build. Dormancy is by design, per the consent-economics ruling.
- Post-consent verification is LIMITED: the Timecard endpoints the new scopes
  unlock require `Square-Version` ≥ 2025-05-21, and the pin is still
  2024-01-17. So this session's success criteria are (a) the authorize URL
  carries six scopes and (b) existing reads still work after re-consent. The
  first successful labor read happens after the version-bump session, and
  THAT is when the grant is fully proven.

## Task 3 — Docs (recorder commit)

Preserve-and-mark throughout:
a. `docs/ROADMAP.yaml` L-2 blockers — prepend: scope addition shipped to
   staging (cite work commit SHA via `git rev-parse HEAD`); gate status now:
   LABOR-0 complete, scopes added pending Gary's re-consent, version bump
   still owed.
b. `docs/ROADMAP.yaml` — file ONE new row, authorized by Gary 2026-08-18 as a
   rider to this recorder commit: id `SQ-ACK-1`, track `staff`, size S,
   status `planned`, title "Acknowledgeable name divergence — let an admin
   mark a Froot/Square name difference as intentional, quieting the banner
   to a note". Notes: surfaced by SQ-WB-1's removal of the write-back; the
   divergence banner is currently a permanent nag when the difference is
   deliberate; Gary ruled to file, not rush.
c. `CLAUDE.md` § Square Integration — update the scope list it quotes (if it
   quotes one) to the six strings, citing this session.

## Output and commits

Two-commit pattern:
1. Work commit: the one-line scope change. E.g.
   `feat(square): add TIMECARDS_READ + TIMECARDS_SETTINGS_READ to OAuth request`
2. Recorder commit: Task 3, citing the work SHA (measured, not assumed).

Session output: the before/after line quotes, gate evidence, and the standard
FIX NOW / RULING NOW / COMMENT / ROW triage.

## After this session (Gary's steps — record verbatim in the output)

1. Push.
2. Wait for the staging deploy to go green in Vercel.
3. On STAGING (Clerk instance `verified-snapper-7`): open /settings, and IF
   staging has a Square connection, click Connect/Reconnect and approve the
   consent screen. Confirm the screen lists timecard read permissions. If
   staging has no Square connection, note that and skip to production at the
   next promotion.
4. On PRODUCTION (after the next promotion carries this commit): /settings →
   Square card → reconnect → approve. One click. The batch is frozen at one
   merchant forever.
5. Confirm existing behavior: dashboard sales numbers still populate (the
   order sync still works on the old scopes' reads).

## Decisions that are NOT this session's to make

- Version bump (its own TIER 3 session, next on the track).
- Anything reading the new scopes.
- Webhook subscription changes.
- `SQUARE_ACCESS_TOKEN` cleanup (SQ-1/SQ-3 territory).
