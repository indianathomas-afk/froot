Read and execute /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/QREV-1.md

# QREV-1 — Review a quiz attempt's answers (what they got wrong)

**TIER 2.** Contained UI + page-query change. No schema, no migration, no new capability, no new API route. Brief audit, then build. Commit only — never push.

## Why

On `/staff/[id]` → Training, a failed attempt shows only "Failed · 38%". A manager sitting down with the team member has no way to see which questions they missed or what they answered. The data already exists: every `TrainingQuizAttempt` stores `questionsSnapshot` (the quiz exactly as graded, frozen at submit) and `answers` (`{ [questionId]: string | string[] }`). Today the page only unpacks written answers for `PendingReview` attempts. This phase makes every attempt reviewable.

## Repo gate (stop if any fails)

1. Run `git branch --show-current` → must be `staging`.
2. Run `git status --short` → must be empty.
3. Run `git log --oneline -1` and put the SHA in your report.

## Audit (read, report briefly, then build — no stop unless noted)

Read at HEAD, don't assume:

- `/Users/garythomas/Claude_Projects/Froot/froot/src/app/(app)/staff/[id]/page.tsx` — the `attempts:` mapping.
- The Training tab client component that renders the attempt lines ("Sep 27, 2026 1:05 PM — Failed · 38%").
- The function that grades a submitted attempt (find it — likely under `/Users/garythomas/Claude_Projects/Froot/froot/src/lib/` near `training.ts`). Record: the question JSON shape (types, option ids/labels, where the correct answer lives), how multi-select is scored, how written questions affect `scorePct`, and whether per-question written grades are stored anywhere or only the final score.
- The "Record quiz result" (ManagerAttested) path — does it store per-question `answers`, or only a score? 
- `/Users/garythomas/Claude_Projects/Froot/froot/docs/ROADMAP.yaml` — confirm `QREV-1` is unused. If taken, STOP and report.

**Stop only if:** the grader cannot be called on a snapshot + answers without side effects (it writes, or reads the live quiz instead of the snapshot). Report and wait.

## Build

**1. Server: one shared breakdown function.** Add a pure function (e.g. `attemptBreakdown(questionsSnapshot, answers)`) next to the existing grader, that returns per question: `prompt`, `type`, the staff answer rendered as option labels (not ids), the correct answer as labels, and `result: "correct" | "incorrect" | "written" | "unanswered"`. It must reuse the grader's own per-question logic — do not write a second grading rule. If the grader has no per-question seam, extract one so both paths call it; the grader's output must not change.

**2. Snapshot, not live quiz.** Correct answers come only from `questionsSnapshot`. A quiz edited after the attempt must not change what the review shows.

**3. The stored score is the record.** If the breakdown's recomputed score disagrees with the attempt's stored `scorePct`, show the stored score and a single muted line "Question-level detail may not match this attempt's recorded score." Never overwrite or "correct" the stored score. Attempts are append-only — this phase writes nothing.

**4. Page payload.** In the `attempts:` map, add `breakdown` for every attempt that has answers (not just `PendingReview`). Keep `writtenItems` exactly as is — the trainer review dialog still depends on it. Ship labels only, not the raw snapshot JSON.

**5. UI.** On each attempt line, add a small **Review answers** link. It opens a dialog (use the existing dialog pattern on this tab):
- Header: `Attempt N · Failed · 38% (pass: 80%)` and `3 of 8 correct`.
- Questions in quiz order. Missed questions tinted red with ✗, correct with ✓.
- Each question: prompt, "Their answer: …", and on a miss, "Correct answer: …". Multi-select shows all selected labels.
- Written: show their answer, labelled "Written — graded by trainer" (no ✓/✗ unless per-question grades are actually stored).
- Unanswered: "No answer".
- One toggle: **Missed only** (default off).
- ManagerAttested attempts with no stored answers: no link; the line reads "Score recorded by manager — no answers captured".

**6. Scope guard.** No change to `/my/training` or anything a STAFF login can load. Correct answers must never reach the staff portal — they retake the quiz. Only the existing ADMIN/MANAGER tier that already sees the Training tab gets the breakdown.

## Evidence

- Fixture `scripts/verify-quiz-review.ts`, pure (no DB): single-choice right/wrong, multi-select exact/partial/extra, written, unanswered, answer id not in snapshot, and a snapshot whose live quiz was since edited. Assert the breakdown's recomputed score equals the grader's score for every case.
- Read-only query on dev (`br-broad-wave`, print the branch literal in the output): for every `TrainingQuizAttempt` with a non-null `scorePct`, run the breakdown and count matches vs mismatches against stored `scorePct`. Report the counts. Mismatches are a finding, not a fix.
- `npm run build` green.

## Out of scope — file as findings, don't build

- Staff seeing their own missed questions in `/my/training` (answer-key leak before a retake — needs a ruling).
- Module-level "most-missed questions" across all staff (useful for spotting badly worded questions).
- Printing/exporting a review.

## Commits

Stage only the files this session touched (no `git add -A`). One work commit, one docs commit (ROADMAP row `QREV-1` at `in_progress` with the work SHA; DECISIONS.md draft entry for rules 2 and 3 above, marked unratified). Do not push.

## Report

Repo gate SHA · audit findings (question shape, grader seam, written grading, ManagerAttested answers) · files changed · fixture result · dev match/mismatch counts with branch literal · build result · commit SHAs · findings classified FIX NOW / RULING NOW / COMMENT / ROW.
