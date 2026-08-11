# HR-22 follow-up — `skipDuplicates` verification + branch confirmation

**Type:** cleanup / verification. Small. One phase.
**Preconditions:** HR-22 work commit `bd63da7` and docs commit `0273c98` exist and are UNPUSHED.

---

## Why this session exists

HR-22 shipped `skipDuplicates: true` on the single-assign path. `TrainingAssignment`
carries only `@@index([staffMemberId])` and `@@index([trainingModuleId])` — there is no
`@@unique([trainingModuleId, staffMemberId])`, by ruling (HR-20: no DB-level duplicate
constraint). Prisma's `skipDuplicates` works by skipping rows that would violate a unique
constraint. With no such constraint, the flag has nothing to act on.

The concern is not broken behaviour — behaviour is unchanged. The concern is that the line
**reads as duplicate protection while providing none**, and a future session will trust it.
The real mechanism is the read-then-classify pass that produces `alreadyAssigned`, which is
racy by design and is exactly why the invariant's third check (assigned vs. what the database
reports inserted) exists.

---

## Phase 1 — AUDIT ONLY. Report and STOP.

Do not edit, create, or delete any file in this phase. No commits.
Run commands one at a time. No `&&` chains.

Report each of the following verbatim:

1. **Branch and commit state**
   - `git branch --show-current`
   - `git log --oneline -4`
   - `git status`
   - State plainly whether `bd63da7` and `0273c98` sit on `staging` or somewhere else.

2. **The `skipDuplicates` call site**
   - Locate every occurrence in the repo.
   - For each: file path, line number, and the surrounding 15 lines.
   - State explicitly whether it is passed to `create` or `createMany`. If `create`, say so —
     it is not a valid argument there.

3. **Constraint confirmation**
   - Grep `prisma/schema.prisma` and `prisma/migrations/` for any unique constraint on
     `TrainingAssignment` covering `(trainingModuleId, staffMemberId)` in either order.
   - Report the result as a plain yes/no with the evidence lines.

4. **The real dedupe path**
   - Show the code that produces the `alreadyAssigned` bucket in the bulk route.
   - One or two sentences: how does a duplicate actually get prevented today, if at all?

5. **HR-23 row** — read the row from `docs/ROADMAP.yaml` verbatim, including findings #2, #3
   and #4 as recorded and the reason they were filed together.

6. **DEPLOY_LOG** — read back the entry written during the HR-22 session, plus the standing
   note that governs whether a second unpushed work commit requires its own entry or an
   amendment to the existing one. Quote the convention; do not infer it.

**STOP HERE.** Present findings and a proposed plan. Wait for explicit approval before Phase 2.

---

## Phase 2 — only after approval

Expected change, subject to what the audit finds:

- Remove the inert `skipDuplicates` argument.
- Replace it with a short comment naming the actual mechanism and the ruling behind it —
  something to the effect of: no unique constraint exists by HR-20 ruling; duplicates are
  classified, not prevented; the invariant's insert cross-check is what catches the race.
- Behaviour must be identical before and after. If removing the argument changes any
  observable behaviour, STOP and report instead — that means the audit was wrong.

Gate before committing:
- scoped eslint on touched files (0 errors; the pre-existing HR-21 warning at
  `training-client.tsx:242` is expected and is not a blocker)
- `npm run build` green
- `npm run lint` is NOT a commit gate (DEBT-33)

Commits:
- One work commit.
- One docs commit maximum, only if the DEPLOY_LOG convention read in Phase 1 requires it.
  The docs commit cites the work SHA.

---

## DON'Ts

- **Do not add a unique constraint, write a migration, or touch the schema.** The HR-20 ruling
  stands. If you believe a constraint is warranted, say so in the report as a candidate row —
  do not implement it.
- **Do not amend `bd63da7` or `0273c98`.** `0273c98` cites `bd63da7` by SHA; amending breaks
  the citation. New commits only.
- **Do not push.** Commit only. Gary pushes.
- **Do not change** the race handling, the invariant, the response shape, the bucket
  semantics, the disclosure line, or the recipients endpoint.
- **Do not open HR-23.** It is filed and planned; leave it filed.
- **Do not edit ROADMAP.yaml rows.** Rulings are transcribed by Gary only.
- No database queries are needed this session. Do not run any.
- No `&&` chains. One command at a time, read the result before the next.

---

## Definition of done

- Branch confirmed and stated in plain language.
- `skipDuplicates` resolved: removed with a comment naming the real mechanism, or the audit
  showed it is load-bearing and nothing changed.
- HR-23 row and DEPLOY_LOG convention reported verbatim.
- Gate green. Working tree clean. Commits listed as unpushed.
- Scope triage on any new findings: FIX NOW / RULING NOW / COMMENT NOT A ROW / ROW.
  A new row is the last resort.
