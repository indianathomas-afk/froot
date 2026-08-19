# TIER 2 — SQ-WB-1: Remove the Square team-member write-back

**Session type: CONTAINED REMOVAL.** One dead feature comes out; nothing new
goes in. This session deletes the only code path that writes business data to
Square, bringing the codebase into compliance with Gary's 2026-08-18 read-only
ruling BEFORE the upcoming consent event promises merchants a read-only
integration.

---

## Context (self-contained — do not rely on chat history)

Repo: `~/Claude_Projects/Froot/froot` (lowercase `froot` is the git root; the
capital-F parent is a known trap — verify with `git rev-parse --show-toplevel`).

The LABOR-0B survey (`docs/prompts/LABOR-0B_RESULTS.md`, commit `dd7b860`)
found that `updateSquareTeamMemberName` (`src/lib/square.ts:227`) issues
`PUT /v2/team-members/{id}` against Square, live via
`src/app/api/square/square-writeback/route.ts:46`. Two defects stack:

1. It violates the read-only ruling: Froot never writes to Square (app-wide,
   OAuth machinery excepted).
2. The write can only succeed via the `SQUARE_ACCESS_TOKEN` personal-token
   fallback (`src/lib/square.ts:236`) — the OAuth grant holds no
   `EMPLOYEES_WRITE`, so this write executes OUTSIDE the merchant's consent.
   It works today only because the sole merchant is Gary.

Gary's ruling (2026-08-18): **kill it, no carve-out.** Names sync
Square→Froot only. If Froot's display name differs from Square's, that is a
Froot-side preference stored in Froot, never a push.

## Gate — verify the ruling exists before touching code

Open `docs/DECISIONS.md` and confirm a 2026-08-18 (or later) entry in Gary's
words covering (a) the app-wide read-only ruling and (b) the write-back kill.
Quote the entry's heading line in your session output. **If no such entry
exists, STOP the entire session** — a ruling in chat is not a ruling, and this
session deletes code on the strength of it. Report the stop; do not proceed
"provisionally."

## Hard rules

1. Do NOT touch `src/app/api/square/auth/route.ts` — no scope changes.
2. Do NOT touch `SQUARE_VERSION` anywhere (including the two hardcoded
   `"2024-01-17"` literals LABOR-0B found in `callback/route.ts` and
   `locations/route.ts` — they belong to the version-bump session).
3. Do NOT delete or modify any Vercel environment variable. `SQUARE_ACCESS_TOKEN`
   findings are SURVEY OUTPUT ONLY this session.
4. No `&&` command chains. One command per paste, read results, proceed.
5. Additive-only elsewhere: this session's only deletions are the write-back
   route, the helper, and their direct call sites. Anything else that looks
   deletable gets FIX NOW / RULING NOW / COMMENT / ROW triage in the output,
   not a deletion.
6. `npm run build` must pass before each commit.
7. Do NOT push. Gary runs all pushes.

## Task 1 — Survey before surgery (read-only)

Map the full blast radius BEFORE editing anything. Record all of it with
file:line references in the session output:

a. Every caller of `updateSquareTeamMemberName` (expect `square-writeback/
   route.ts:46`; confirm it is the only one).
b. Every client-side caller of `/api/square/square-writeback` — grep `src/`
   for the route path. Identify which UI flow triggers it (expected: the
   staff name-edit flow on `/staff/[id]`), what it does with the response,
   and what the user-visible behavior is when the call no longer happens.
c. Every remaining reader of `SQUARE_ACCESS_TOKEN` once the fallback at
   `square.ts:236` is gone. This is the answer to SQ-1's open question
   ("does anything still read it?"). If the answer becomes ZERO, record that
   the env var is a candidate for deletion in a future session — flag only.
d. Check `docs/PERMISSIONS_INVENTORY.md` for the route's row (search
   "writeback") so Task 3 updates the right line.

**STOP CONDITION:** if (a) or (b) surfaces more than three call sites total,
or any caller outside the staff-edit flow, stop and report before deleting —
the blast radius assumption was wrong and Gary decides.

## Task 2 — The removal

a. Delete `src/app/api/square/square-writeback/route.ts` (the whole route).
b. Delete `updateSquareTeamMemberName` from `src/lib/square.ts`, including
   its personal-token fallback block at `:236`. Do not refactor neighboring
   code while there; touch only what the deletion requires.
c. Update the client caller(s) found in Task 1b: remove the write-back call
   and any UI copy that promises a Square-side update (button text, toast,
   helper text). The Froot-side name edit itself keeps working — only the
   push disappears. If the UI currently implies "this will update Square,"
   the copy must stop saying so.
d. `npm run build` — must be green.

## Task 3 — Docs sweep (same ruling, same session)

Preserve-and-mark everywhere — prepend, never delete:

a. `docs/PERMISSIONS_INVENTORY.md` — mark the write-back route's row removed,
   citing the ruling date and this session's work commit SHA.
b. `CLAUDE.md` § Square Integration "Phase 2 Square routes to add" — mark
   `square/inventory/submit` and `square/inventory/adjust` DEAD, citing the
   2026-08-18 read-only ruling. They were never built; they are now never to
   be built.
c. `docs/ROADMAP.yaml` — prepend to the relevant rows: SQ-1 (the
   `SQUARE_ACCESS_TOKEN` reader count from Task 1c), and L-2 (write-back
   removed; codebase now read-only toward Square, matching the consent story
   the scope-addition session will present).

## Output and commits

Two-commit pattern:
1. Work commit: the code removal (Task 2) only. Conventional Commits subject,
   e.g. `refactor(square): remove team-member write-back per 2026-08-18
   read-only ruling`.
2. Recorder commit: the Task 3 docs sweep, citing the work commit SHA measured
   with `git rev-parse HEAD` — not assumed.

Session output (in-session summary, not a new prompt file): Task 1 survey
results in full, including the SQ-1 answer, plus the standard triage list.

## Decisions that are NOT this session's to make

- Deleting the `SQUARE_ACCESS_TOKEN` env var (flag only, even if reader
  count is zero).
- Anything touching scopes, versions, or the consent event.
- Any behavior change to the staff-edit flow beyond removing the push.

If a finding demands more than this scope, it is a RULING NOW entry and the
session completes its stated work around it.
