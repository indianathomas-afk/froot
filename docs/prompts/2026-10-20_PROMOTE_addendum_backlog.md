# ADDENDUM to 2026-10-19_PROMOTE_milestones_notify.md — backlog cleanup + stash fold (Gary, 2026-10-20)

Measurement is DONE in chat; re-verify, don't re-plan. Facts established:
- Payload origin/main..staging: 14 code commits (MS-1, BUG-15, MS-2, MS-3a, MS-3b, MS-3c, CHK-15,
  MS-4a, NOTIFY-5, NOTIFY-6, NOTIFY-11, MS-4b, MS-5, MS-5b). 9a70f52 is in range.
- 8 migrations, all additive, all new flags default false. Production baseline (br-sparkling-block):
  newest applied = 20260928222624_doc6_key_return_register, none of the 8 present, no failed rows.
- vercel.json adds labor-scheduled-shifts (45 11 * * *) and notify-dispatch (15 * * * *).
- stash@{0} "main docs WIP" is mostly superseded by 32ec889; its leftovers are folded in below
  (fixes 6, 7, 10) and the stash is DROPPED at the end, never popped.

RULES: Claude never pushes. Mark in place, never delete (house convention: "⚠ SUPERSEDED" /
"Correction" notes, prepended notes, "NOTHING BELOW IS EDITED"). Anchor every edit by TEXT, not
line number — line numbers below are from staging at a4450d7 and will shift. Re-prove each SHA
with git before writing it.

## STEP A — Backlog commit on staging: docs(DOCS-CLOSEOUT-2): backlog stamps, stash fold

DEPLOY_LOG.md
1. ~L1043, DOC-6 entry (heading e4be68a): rollback `<merge SHA>` → `e4be68a`
2. ~L1210, SIGNED-1 entry (heading 5c3c6c6): → `5c3c6c6`
3. ~L1302, DOC-5 entry (heading 92df26b): → `92df26b`
4. ~L1371, QREV-1 entry (heading d929d1d): → `d929d1d`
5. ~L1437, NAV-2 entry (heading 3c0ffc9): → `3c0ffc9`
   Evidence for 1–5: each entry's stamped heading; each SHA is in
   `git log --merges --first-parent origin/main`.
6. ~L993, DOC-6: insert above "**Unpromoted — staging only.**" the stash's note:
   "> **Correction 2026-09-29: promoted in `e4be68a`.** The paragraph below is the
   PRE-PUSH-CHECK's own. It is kept as written and is now spent." (source: `git stash show -p stash@{0}`)
7. ~L912, DOC-11 (heading 0d51496): insert above "**Status: staging only, not on `main`.**" a
   "⚠ SUPERSEDED AT PROMOTION 2026-09-29" mark, adapted from the stash's version, naming 5bc3008
   as the check commit the payload table could not name.
8. ~L2504, Calendar entry (53cb9ce): add a Correction note under "Carries CAL-1b (`9936610`) —
   STILL UNPROMOTED": promoted later in `d2b8d79`. Evidence: `git merge-base --is-ancestor
   9936610 d2b8d79` succeeds; same check against `d2b8d79^1` fails.
11–13. Retroactive entries in date position, in the existing SHA-heading format, marked
   "RETROACTIVE ENTRY, written 2026-10-20 by DOCS-CLOSEOUT-2", sourced from the ROADMAP rows:
   - `10c9cf5` 2026-09-13 CHK-8 template task sort order. Parents 53b5a7c, 509fe62. 1 commit
     (509fe62). No prisma diff. Rollback: `git revert -m 1 10c9cf5`, no database step.
     Goes between the 53cb9ce /users entry and 53b5a7c Take Photo. ROADMAP ~L3095.
   - `e6149f8` 2026-08-30 09:21 NAV-1 grouped sidebar + Daily Tasks. Parents 849e410, 16f6f6b.
     4 commits: a005cba, 16f6f6b, plus closeout docs 10439b3 (PERM-8), e4c8c69 (COMP-1).
     No prisma diff. Rollback `git revert -m 1 e6149f8`. ROADMAP ~L16942.
   - `8c25084` 2026-08-30 15:32 ENG-1 engagement tracking. Parents 66ea10e, 835b213. 4 commits:
     f1e9833, e2ed2d0, 5421762, 835b213. Migration 20260830120000_eng1_engagement_tracking
     (applied on production per _prisma_migrations). Rollback is code-only and leaves the
     additive tables unread. ROADMAP ~L17185. FIRST PARENT IS 66ea10e, NOT e6149f8: run
     `git log --oneline e6149f8..66ea10e` and name what was committed directly to main.
   The NAV-1 entry goes above PERM-8 (849e410). ENG-1 goes above NAV-1.

ROADMAP.yaml
9.  DOC-6 row (~L6855): add `- "73c1a59"` after `- "a2c7153"` in commits:. Evidence: the row's
    own notes (~L6876): e4be68a^1..e4be68a^2 is exactly 65ca616, a2c7153, 73c1a59.
10. DOC-11 row (~L7066): apply the stash's ROADMAP hunk: status: staging → shipped, shipped:
    2026-09-29, add "5bc3008" to commits:, add the two open: items (rotate/refit, phone signing
    as Tommy), prepend the SHIPPED note. Keep the old comment, marked spent.

STOP. Show me `git diff --stat` and the full diff of 11–13.

## STEP B — Promotion docs commit on staging (from the main prompt)
- MS-4b: the "none was pushed" line is stale; mark it superseded. Add 9a70f52 to the MS-4b payload.
- MS-3a: correct the "not pushed" line.
- CHK-15: record that the CHK-15 Test staff member is left terminated on purpose.
STOP. Print the push command for staging. I push and wait for Preview green.

## STEP C — Merge (print commands, I type them)
1. `npx prisma migrate status` against production must show exactly the 8 pending.
2. Follow CLAUDE.md for whether `migrate deploy` is my manual step or runs in the Vercel build.
   Because all 8 are additive, applying before the main push is safe.
3. `git checkout main && git pull --ff-only && git merge --no-ff staging`, then I push main.

## STEP D — Post-merge stamps on main
- Stamp the 14 UNPROMOTED DEPLOY_LOG headings with the merge SHA. Mark each "Status: staging only"
  line superseded in place. Fill each rollback line with the real SHA (no `<merge SHA>` left).
- Move the 14 ROADMAP rows (CHK-15, MS-1, MS-2, MS-3, MS-3b, MS-3c, MS-4a, MS-4b, MS-5, MS-5b,
  NOTIFY-5, NOTIFY-6, NOTIFY-11, BUG-15) to shipped with today's date and the merge SHA.
- Final check: `git grep -n "<merge SHA>\|^## UNPROMOTED" -- docs/DEPLOY_LOG.md` returns nothing.
  `git grep -n "^    status: staging$" -- docs/ROADMAP.yaml` returns nothing.
- Print: push main, then `git checkout staging && git merge --ff-only main && git push`, so
  staging carries the stamps and the drift that caused this cleanup can't recur.
- Confirm fixes 6, 7 and 10 cover the stash, then print `git stash drop stash@{0}`.

## STEP E — Production smoke (record in DEPLOY_LOG, read-only)
Both new crons are listed in Vercel. notify-dispatch rows are dry-run. Milestones, milestone
emails and checklist milestones are OFF for every org. The open items list is unchanged:
Handbook "not available yet", RESEND_API_KEY "Needs Attention", NOTIFY-10 resolved-flag warning,
DEBT-116/117/118, NOTIFY-10 email go-live.

---

# RULINGS ON STEP A (Gary, 2026-10-20, in chat after the Step A stop) — verbatim

Rulings:
1. Keep "RESTORED ENTRY" and NAV-1's original heading format. Both are more accurate.
2. Restore HELP-1b from bc13251 the same way, in this commit. Add a one-line note on the DEBT-90 row that the entry was restored by DOCS-CLOSEOUT-2.
3. The main prompt was never saved. The addendum is the whole spec, with one addition to Step B: write the PRODUCTION PROMOTION umbrella entry at the head of DEPLOY_LOG, in the 076ccf8 format. It covers the 14-item payload table, the 8 migrations, the 2 crons, the env facts (NOTIFY_EMAIL_PROVIDER unset, so all email dry-runs; NOTIFY_SANDBOX_ALLOWLIST Preview-only; milestones, milestone emails and checklist milestones default OFF), "UNPROMOTED" until the post-merge stamp, the rollback recipe, and the Step E open items. Also note that MS-5's 8 unobserved staging checks ship unverified, contained by milestones defaulting OFF. Save the addendum as docs/prompts/2026-10-20_PROMOTE_addendum_backlog.md in the same commit, so the spec exists in the repo.
4. Before committing Step A: for every merge in `git log --merges --first-parent origin/main` back to 2026-08-17, list any `## ` heading in docs/DEPLOY_LOG.md present in <merge>^1 and absent from <merge>. Report the results. Restore anything dropped the same way, or report "none."

This is my go for Step A, then Step B. Stop after Step B with the staging push command as planned.
