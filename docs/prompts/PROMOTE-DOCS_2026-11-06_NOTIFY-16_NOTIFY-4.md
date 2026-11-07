# PROMOTE-DOCS — 2026-11-06 — NOTIFY-16 + NOTIFY-4 — TIER 1

TIER 1: docs only. One docs commit on STAGING. No code, no schema, no prisma
commands. Never push — Gary pushes and re-promotes.

## Repo gate (one command at a time, paste each result)

pwd                      → must end in Froot/froot
git status               → on staging, tree clean (this prompt file may be untracked)
git log --oneline -1     → must be 0ee6965 Merge branch 'staging'

## Facts to record (from Gary's chat, 2026-11-06)

- Production merge: 0ee6965 ("Merge branch 'staging'"), --no-ff, first parent
  49249fb. Carries 11 commits: d5d3202, 17af011, 1b36e73 (NOTIFY-16);
  652ea75, 547425a, 12c5474, 2e85c90, 5c24e02 (NOTIFY-4); f042fd4, 1809c73,
  b469663 (NOTIFY-4 polish). Take the promotion timestamp from
  `git show -s --format=%ci 0ee6965` — do not invent one.
- Migration 20261106230000_notify_taskcomm_kind_settings: applied on staging
  (br-square-feather, ep-odd-rain-a6gr4xmm) in the 5c24e02 staging build log,
  "2 migrations found … successfully applied". On production it applies via
  vercel-build; Gary reports the production build Ready and the new card
  loading on production /settings/notifications. The production build-log
  migration lines were NOT pasted to chat — record exactly that, and say the
  card loading is the evidence (the page reads NotificationKindSettings).
- Gary's production verdict, verbatim: "I did all tests and this is working
  amazing." Browser identity was not captured with that statement; record it
  as Gary's report, not as browser evidence.
- The Tasks and Communication email arrives OFF for every production org
  (NotificationKindSettings has no row = off). Gary flips it himself.
- Rollback: `git revert -m 1 0ee6965`. The table stays (additive-only rule).
- Staging was fast-forwarded to 0ee6965 and pushed; all four tips level.

## Edits (preserve-and-mark: prepend dated lines, delete nothing)

1. docs/DEPLOY_LOG.md — the three UNPROMOTED entries for NOTIFY-16, NOTIFY-4
   and the NOTIFY-4 polish: stamp each with the merge SHA 0ee6965 and the
   promotion timestamp, the way earlier promotions were stamped. Heading count
   must not change. Add one short umbrella line only if earlier two-phase
   promotions have one; match precedent, keep it small.
2. docs/ROADMAP.yaml — NOTIFY-16 and NOTIFY-4: status staging → shipped, with
   the promotion date and "0ee6965" (quoted short SHA) in a prepended dated
   note carrying the facts above. No meta.updated key. NOTIFY-17, CHK-17,
   DEBT-128, DEBT-129 stay planned, untouched.
3. docs/MIGRATIONS.md — only if it keeps a per-migration applied-to log: add
   production for 20261106230000_notify_taskcomm_kind_settings, citing the
   evidence as stated above. If it keeps no such log, leave it alone.

Use __SHORTSHA__-style tokens for anything not yet known while drafting, then
`grep -c '__' <file>` must equal its pre-edit count before committing.

## Commit

npm run build → must pass (ROADMAP is typechecked at prebuild).
git add only the files edited above, plus this prompt at
docs/prompts/PROMOTE-DOCS_2026-11-06_NOTIFY-16_NOTIFY-4.md.
One commit: docs(PROMOTE): NOTIFY-16 + NOTIFY-4 shipped in merge 0ee6965

## Report and STOP

The commit SHA, the files touched, heading counts before/after, and the two
row statuses as they now read. Do not push.
