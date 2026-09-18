# DOCS-CAL — Record the 2026-09-18 promotion and fix two check-process gaps — TIER 1

Docs only. No code, no schema. One or two docs commits. You never push.

## Repo gate
pwd must end in Froot/froot. git status: on staging, clean, up to date
with origin/staging. Confirm `git branch -r --contains 53cb9ce` shows
origin/main. Pick the row id: the next free DOCS-n in ROADMAP.yaml
(verify; do not assume).

## What happened (from Gary, in chat, 2026-09-18 — cite this)
- 09:04 — Gary ran the promotion template end to end. `53cb9ce`
  "promote: UM-3, CAL-1, CAL-1a" merged staging → main and pushed.
  Production deployed it. This ran BEFORE the CAL-1 staging protocol
  and before the docs said staging — a template mishap, not a decision.
- Production evidence, br-sparkling-block-a620qvg4: calendar_tables 4,
  orgs_enabled 0. Keva sees nothing; the toggle is off for every org.
- Staging evidence so far: rendered /calendar; CAL-1a centred dialog
  (first-row click); CAL-1b Edit dialog (after its push); Weekly
  projection correct (Mondays 14/21/28 Sep, 5 Oct). Cron, grant test,
  STORE completion and overdue banner: NOT yet observed.
- CAL-1b (9936610, 00db87e, dfbfe6e) is on origin/staging only. Not
  promoted.

## Task 1 — ROADMAP.yaml (preserve-and-mark, prepend only)
- UM-3: status shipped, shipped 2026-09-18 in "53cb9ce".
- CAL-1: status shipped, same. Rider stating plainly that promotion
  preceded staging verification, listing what IS observed and what is
  NOT (above), and that the module is off for every org in production.
  Keep every existing blocker; mark the ones the evidence resolves.
- CAL-1a: status shipped, same promotion.
- CAL-1b: status staging (it is on origin/staging now).
- No meta.updated key. Nothing deleted.

## Task 2 — DEPLOY_LOG.md
Flip the UM-3 and CAL-1 (incl. the CAL-1a and CAL-1b carry lines)
UNPROMOTED entries to promoted: merge SHA 53cb9ce, 2026-09-18, and the
sentence that the promotion preceded the staging pass. CAL-1b's carry
line stays marked unpromoted inside the CAL-1 entry. Chunked writes,
wc -l after each, grep -c "^## " before and after — nothing clobbered.

## Task 3 — docs/prompts/PRE-PUSH-CHECK.md (two edits, both ratified
by Gary in chat 2026-09-18 — quote this)
(a) Step 2, docs SHA: the two-commit pattern cannot record the docs
    SHA inside the docs commit. The check ADDS the docs SHA and its own
    SHA to the row as a normal step, in its own docs commit. This is
    by design, not DRIFT. Reword the ROADMAP bullet accordingly.
(b) Step 2, DEPLOY_LOG: the entry is written INTO the file at check
    time, marked unpromoted, in chunked verified writes (the UM-3 /
    CAL-1 shape) — not handed to Gary as a heredoc. Reword the bullet.
Then add ONE sentence to WORKFLOW.md's promotion section: run
`git log --oneline main..staging` and paste it to chat BEFORE typing
merge; the log is the read-only step, everything after it is the
promotion.

## Task 4 — CLAUDE.md
Only if a house rule changed. (a) and (b) are check-procedure edits,
not house rules; confirm untouched unless you find a rule that now
contradicts them.

## Gates and report
npm run build exit 0, no pipe. Report the SHA(s) and the before/after
heading counts for DEPLOY_LOG. Stop. Do not suggest further work.
