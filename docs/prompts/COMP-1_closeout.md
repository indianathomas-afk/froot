TIER 2

# COMP-1 closeout — roadmap, deploy log, and reference docs

You are working in the Froot repo. Run `froot` to navigate to the git root
(`~/Claude_Projects/Froot/froot`). REPO GATE before anything else: run `pwd`
and `git remote -v`; you must be in the Froot repo with remote
`indianathomas-afk/froot`. If not, stop and say so. (Two prior COMP-1 sessions
were launched into a Bloomnet worktree by mistake.)

This session is documentation-only. **If completing any item below turns out
to require editing anything under `src/`, `prisma/`, or any file that decides
behavior, STOP and say so — that escalates the tier and is not this session's
work.** You never push — Gary runs every push. No `&&` chains — one command at
a time, results read before the next. Work happens on `staging`; Gary merges
`--no-ff` to main afterward.

## Context

COMP-1 (compensation confidentiality + `labor.access` capability) is built,
staging-tested (all eight acceptance steps passed), promoted to production,
and spot-checked on production against real data. Read
`docs/prompts/COMP-1_comp_confidentiality.md` and `docs/prompts/COMP-1_AUDIT.md`
for the full history. This session closes out the paperwork.

## Phase 1 — audit what already exists (read-only, then report before editing)

The Phase B session intended a work commit + recorder commit; the promotion
happened afterward. Establish what actually landed before writing anything:

1. `git log --oneline -8` on staging and on main — identify the COMP-1 work
   commit, whether a recorder commit exists, and the promotion merge.
2. Check `docs/ROADMAP.yaml` — does a COMP-1 row exist? Does an F1 row exist?
3. Check `docs/DEPLOY_LOG.md` — does the staging-push entry exist? Does a
   production-promotion entry exist?
4. Check `docs/DECISIONS.md` — is the ratified COMP-1 entry present?
5. Check `docs/prompts/` — both COMP-1 files should be committed by now; if
   either is still untracked, note it.

Report the gap list in one short message, then proceed to fill ONLY the gaps —
TIER 2 does not wait for approval unless something surprising turns up. If any
of the above is in a state that contradicts this prompt's assumptions (e.g. no
work commit on main), STOP and describe what you found.

## Phase 2 — fill the gaps

Apply the house conventions on every file: preserve-and-mark (nothing deleted;
corrections prepend with dates), deviation numbers read from the highest
recorded entry in ROADMAP.yaml (last known: S5-D68 — re-verify, never assume),
and `docs/prompts/` files are never edited — addenda only.

**1. ROADMAP.yaml — COMP-1 row** (write or complete it):
- Status: done, shipped to production. Record the work-commit SHA, the
  promotion merge SHA, and today's date.
- Summary of what shipped: `compConfidential` flag on `SquareTeamMemberWage`
  (Froot-owned column, sync's DO UPDATE never touches it); server-side
  redaction via `comp-confidential.ts` across four surfaces plus `/staff`;
  `estateWeekly` moved server-side; edit/delete refused for non-admins on
  confidential people; `labor.access` capability at MANAGE enforced in
  `requireLaborContext()` and the page guard.
- Record the three leaks found and fixed mid-build (RSC flight payload on
  /settings/labor; PUT echo of stored weeklyCost; blank-editable masked cost
  box), and the fixture `scripts/verify-comp-confidential.ts` including the
  restored-defect proof for the fail-closed case.
- Cross-reference: this work closes the PERM-5C deferral recorded at
  settings/labor/page.tsx:44 — say so in the row, and prepend a dated
  correction on the PERM-5C/PERM-5 entry (wherever the deferral is recorded)
  pointing at COMP-1. Preserve-and-mark; do not rewrite the old text.
- Accepted limitation on record: single-confidential-person subtraction
  inference (also in DECISIONS.md).

**2. ROADMAP.yaml — new F1 row** (its own row, out-of-scope finding from
COMP-1 triage):
- `GET /api/labor/positions` returns `defaultHourlyRate` to any ADMIN/MANAGER
  with no `canSeeWages` gate, unlike the roster and salaried routes. Ruled
  OUT of COMP-1 (archetype rates, not person comp — the rate legend is
  manager-visible by design and structurally cannot consult a per-person
  flag). The row exists so the inconsistency is a known, not a surprise.
  Status: open, low priority. Name the file and route. Give it the next free
  row ID in whatever namespace fits house style (check for collisions first).

**3. DEPLOY_LOG.md — production promotion entry** (skip if Phase 1 found it
already written): a short dated entry — promotion-sized, not full-ceremony —
recording COMP-1 merged `--no-ff` to main, the merge SHA, that `migrate
deploy` applied the migration to production (`br-sparkling-block`) and the
backfill seeded real rows there, and that staging's eight acceptance steps
plus a production spot check (mask + Network-tab search against real figures)
passed. Compose it via the required flow: heredoc chunks, `wc -l` after each,
splice with head/tail, then `grep -c "^## " docs/DEPLOY_LOG.md` to prove no
prior entry was clobbered — a count of 1 means restore with
`git checkout docs/DEPLOY_LOG.md`. Never open an editor on this file.

**4. DECISIONS.md** — verify the ratified COMP-1 entry is present and intact.
If it is missing, STOP and tell Gary — do not compose one; the ratified text
lives in the Phase B session and the chat, and only Gary supplies it.

**5. Reference docs sweep** — check whether these mention pay visibility or
labor permissions in a way COMP-1 made stale, and prepend dated corrections
where they do (do not rewrite): `docs/LABOR.md`, any permissions inventory
doc referenced by ROADMAP (e.g. PERMISSIONS_INVENTORY), and `CLAUDE.md` ONLY
if it states something now false — CLAUDE.md gets the lightest possible
touch, and if a change there feels larger than a sentence, write it down as a
finding instead of editing.

**6. Prompt-file addendum** — append (never edit above the existing content)
a short dated addendum block at the END of
`docs/prompts/COMP-1_comp_confidentiality.md` noting: executed across three
sessions (two scrapped for wrong-repo worktree), Phase A audit at
`COMP-1_AUDIT.md`, built and promoted, and the flag landed on
`SquareTeamMemberWage` rather than the prompt's default lean — superseded by
audit finding 1. One paragraph, not a retelling.

## Commit and close

One commit on `staging` is fine for docs-only work — message in house style
naming COMP-1 closeout. Build gate still applies (`next build`) even for docs,
to prove nothing behavioral was touched. Do not push.

End with: (a) the gap list from Phase 1 and what was filled, (b) `git log
--oneline -3`, (c) the `grep -c "^## "` count from the DEPLOY_LOG splice, and
(d) a one-line note of anything found that belongs in a future row — triaged
FIX NOW / RULING NOW / COMMENT / ROW, with ROW as last resort. Remind Gary the
commit rides to main on his next `--no-ff` merge and push.

## Out of scope

The §7.1 staging query (Gary runs it in the Neon console when convenient —
non-blocking curiosity). Any code change of any kind. F1's actual fix. DOC-4.
Anything else found along the way gets written down, not done.
