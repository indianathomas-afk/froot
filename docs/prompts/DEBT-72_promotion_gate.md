# DEBT-72 — Promotion gate (`npm run promote`)

**TIER: 2 — build + docs, no schema, no product code.**
*(Gary: correct this line to match your taxonomy before you run it. I could not read
`docs/prompts/` — it is excluded from the project sync — so this label is my guess at
the shape, not a reading of your convention. Everything below is unaffected by it.)*

**Session date:** 2026-08-17
**Ruled by:** Gary, 2026-08-17, in chat. The ruling is restated verbatim in §2.
**Repo:** `github.com/indianathomas-afk/froot` — local `~/Claude_Projects/Froot/froot`
(the lowercase `froot` is the git root; the capitalized parent is not).

---

## 1. Why this exists — the incident, stated as fact

On 2026-08-14 the fix `00881dc` (BUG-7, the `salesPeriodCache` write race) reached
production while its own row in `docs/ROADMAP.yaml` still read `status: in_progress`
and carried the note "NOT YET VERIFIED ON STAGING". It was not discovered for three
days. The fix turned out to be correct — that is luck, not process.

The mechanism is not an attention lapse. It is that **nothing in the promotion
procedure reads `docs/ROADMAP.yaml`.** `WORKFLOW.md` §2 promotes with
`git merge staging --no-edit`, which consults nothing and, when `main` has not
diverged, produces no merge commit either.

The second half of the same mechanism is already recorded on **DEBT-38**: five of the
seven pushes to `main` since `06b1561` were fast-forwards (`17dc723`, `746c1be`,
`18220bb`, `493175e`, `63407be`, `97ed309`). No merge commit means (a) no artifact to
prompt a `DEPLOY_LOG` entry, and (b) nothing for `git log --merges` to find when
reconstructing history afterwards. DEBT-38's row names two candidate fixes, (a) fold
the log entry into the promotion and (b) `--no-ff`, and says explicitly that the
choice is Gary's and that they are not exclusive.

**This prompt implements both.** When it lands, DEBT-38's open question is answered
and that row closes with it.

---

## 2. The ruling (Gary, 2026-08-17) — do not redesign this

Four decisions, already made. Implement them; do not propose alternatives.

1. **It lives in a script**, `scripts/promote.mjs`, run as `npm run promote`.
   Not a git hook — `.git/hooks` is unversioned, `--no-verify` defeats it silently,
   and a gate that can vanish without a trace is not a gate. Not prose in
   `WORKFLOW.md` — prose is what already failed.
2. **`--no-ff` is enforced by construction.** The script builds the merge itself, so
   a revertable artifact is not something anyone has to remember.
3. **The status check is an allowlist, not a denylist.** A roadmap row passes only if
   its status reads `staging`, `shipped`, or `verified`. Everything else fails:
   `planned`, `in_progress`, `withdrawn`, a missing status, an unrecognized status
   value, or a row ID that does not exist in the file. Rationale: `withdrawn` was
   added by ruling on 2026-08-01 and another status will be added someday; a new
   value must trip the gate and force a decision rather than sail through.
4. **It is a hard block with a recorded override.** `--override "ROW-ID: reason"`
   is the only way past, it requires both the row ID and a reason, and the script
   writes that string verbatim into the `DEPLOY_LOG` entry. An override becomes
   evidence instead of a hole.

---

## 3. Ground truth to verify before building — do not assume any of it

Run these and report the actual output. Do not proceed on memory.

**3a. Does the commit → row mapping exist at all?** This decides whether the gate is
buildable as specified.

```
git log --format=%s 06dc830..7e77ea6 | grep -oE '^[A-Za-z][A-Za-z0-9]*-[0-9]+[a-z]?' | sort | uniq -c | sort -rn
```

```
git log --format=%s 06dc830..7e77ea6 | grep -vE '^[A-Za-z][A-Za-z0-9]*-[0-9]+[a-z]?'
```

The second command lists commits whose subject carries no row ID. Report it in full.
If it is a large fraction of the 48 commits, **stop and report** rather than building
a gate that can only see half the range.

**3b. Confirm the parser dependency exists.** `yaml` is already a dependency (added by
P-3 for `scripts/generate-roadmap.mjs`). Confirm it in `package.json`. **Add no new
dependencies.**

**3c. Read `scripts/generate-roadmap.mjs`** before writing anything. It already parses
`docs/ROADMAP.yaml` into `raw.phases`, `raw.bugs`, `raw.debt`. Reuse its reading
strategy; do not invent a second parser that can drift from it.

**3d. Read `docs/WORKFLOW.md` §2** and quote the current promotion steps in your
report, so the edit in §6 is against verified text rather than assumed text.

---

## 4. Build: `scripts/promote.mjs`

Node ESM, no new dependencies, invoked via `"promote": "node scripts/promote.mjs"` in
`package.json`. Use `execFileSync` with argument arrays — no shell string
interpolation, and no `&&` chains anywhere in this repo's scripts or docs.

### Phase A — preflight (all failures are hard stops)

- Refuse unless cwd is the git root and `git rev-parse --show-toplevel` ends in
  `/froot`.
- `git fetch origin`.
- Refuse if the working tree is dirty.
- Range is `origin/main..origin/staging`. Refuse if it is empty.
- If `origin/staging..origin/main` is non-empty, `main` carries commits staging does
  not. Report the list and stop — that is a divergence a human must look at.

### Phase B — the gate

- Read `docs/ROADMAP.yaml` **from staging's tip**, via
  `git show origin/staging:docs/ROADMAP.yaml`. **Not** from the working tree and
  **not** from `main`. Main's copy is older by definition — that is the whole failure
  mode. Put this reason in a comment in the source.
- Collect row IDs from commit subjects across the range
  (`git log --format=%s origin/main..origin/staging`), matching
  `^([A-Za-z][A-Za-z0-9]*-\d+[a-z]?)`.
- Resolve each ID against `phases`, `bugs`, and `debt`.
- **Pass** = status is exactly `staging`, `shipped`, or `verified`.
  **Fail** = anything else, including absent, unrecognized, or an unresolvable ID.
- `blockers` are **ignored entirely**. A row may be `shipped` and still carry an open
  blocker — that is the schema working as designed (BUILD-1 is the standing example,
  and its blocker is deliberately open indefinitely). Keying on blockers would trip
  every promotion forever. Put this reason in a comment too.
- Commits whose subject carries **no** row ID are collected and **reported**, but do
  not block by default — docs-only and chore commits are legitimate. The count and
  the subjects go into the `DEPLOY_LOG` entry. Add a `--strict-attribution` flag that
  promotes them to blocking, default off. *(Flagged for Gary as a follow-up ruling;
  do not change the default.)*
- On failure: print every failing row as `ID — status — title`, print the override
  syntax, exit non-zero. Nothing has been merged at this point, so a failure costs
  nothing to unwind.
- `--override "ROW-ID: reason"` may be passed more than once. An override clears
  exactly the named row and nothing else. An override naming a row that did not fail
  is itself an error.

### Phase C — the merge

- Tag first: `pre-staging-merge-YYYYMMDD-HHMM` (this matches the existing convention,
  e.g. `pre-staging-merge-20260727-1427`).
- `git checkout main`, then `git merge --no-ff origin/staging` with a generated
  message naming the row IDs carried.
- On conflict: stop, leave the working tree exactly as it is, print which files
  conflicted, exit non-zero. Do not attempt resolution.

### Phase D — the record

- Detect migrations in the range: `git diff --name-only <base>..HEAD -- prisma/`,
  reduced to migration folder names.
- Prepend a new entry to `docs/DEPLOY_LOG.md` matching the format of the existing
  entries (read two of them first). It must carry, computed rather than typed:
  merge SHA short and full, the `git revert -m 1 <full-sha>` rollback line, the
  pre-merge tag, both parents, the commit range and count, the migration folder
  names, every `--override` string verbatim, and the unattributed-commit list.
- Leave `TODO:` markers for the parts only a human can write — "What shipped" in
  prose, and any verification notes.
- **Timestamps in `DEPLOY_LOG` are UTC, and every timestamp is labelled `UTC`.**
  The log is evidence. Record all three of the distinct times where known — commit,
  push, deploy — and never conflate them.
- Then **stop.** Do not commit, do not push, do not print a push command.

### Phase E — `npm run promote -- --finish`

- Refuse if any `TODO:` marker remains in the newest `DEPLOY_LOG` entry. This is the
  DEBT-38 half of the gate and it must mean it.
- Make the recorder commit (two-commit pattern: the merge is the work, this is the
  recorder).
- Print the exact push command for Gary to run, and exit.

**The script never pushes.** Per `CLAUDE.md` Git Rules, Claude never pushes, and this
script inherits that rule. It prints; Gary runs.

---

## 5. Verification — the acceptance criterion is a failure on real history

A gate that has never refused anything has not been tested.

- Add `--dry-run`: runs Phase A and Phase B, prints the verdict, merges nothing.
- Add `--range <base>..<head>` so a historical range can be replayed. When `--range`
  is given, `ROADMAP.yaml` is read from `<head>`, not from `origin/staging`.
- **Replay the real incident.** Find the push that carried `00881dc` to `main`
  (start from `git log --oneline --ancestry-path 00881dc..origin/main`) and replay
  that range. At the time, BUG-7's row read `in_progress`. **The gate must fail on
  BUG-7.** Paste the actual output into your report.
- **Replay `06dc830..7e77ea6`** (the 2026-08-17 promotion) and report the verdict
  either way. Do not predict it — run it.
- Replay one older range where every row had landed, and show it passing. A gate that
  fails everything is as useless as one that passes everything.
- Construct a temporary ROADMAP fixture with a status value the allowlist does not
  know (e.g. `status: abandoned`) and show it failing closed. Delete the fixture.
- `npx tsc --noEmit` and `npm run build` both green before you finish.

---

## 6. Also change

- **`docs/WORKFLOW.md` §2** — replace the manual promotion steps with `npm run promote`
  and `npm run promote -- --finish`. Preserve-and-mark: do not delete the old steps,
  mark them superseded with today's date and leave them readable.
- **`docs/ROADMAP.yaml`** — set DEBT-72's status to `staging` once the work is on
  staging (not `verified`; that is Gary's call after a real promotion runs through it).
  Add to **DEBT-38** that its open question is answered by DEBT-72, choosing both
  candidate (a) and candidate (b), and that it closes with DEBT-72. Do not delete
  DEBT-38's existing text — prepend, dated, per preserve-and-mark.
- **BUILD-1**, one line into the existing blocker, since the reasoning was made today
  and should not have to be rediscovered:
  > Fix when a second developer's first PR is expected. The Preview database must NOT
  > be `preview/staging` — an unreviewed PR migration would apply to the branch used
  > for promotion verification.

---

## 7. Out of scope — report, do not do

- Changing any row's status other than DEBT-72 and the DEBT-38 note.
- Building CI. There is no `.github/` and this prompt does not create one.
- The `needs-current` naming problem, DEBT-73, DEBT-69, DEBT-70's client half.
- Anything touching `prisma/`. This session is additive-only in the trivial sense:
  it has no schema surface at all.
- Editing anything in `docs/prompts/`, including this file. Addenda only.

---

## 8. The bootstrap, which is real and not a joke

The first promotion this gate ever runs against is **its own**. When DEBT-72's commits
are in `origin/main..origin/staging`, the gate will read DEBT-72's row — and if that
row still says `in_progress`, the gate blocks its own promotion.

That is correct behavior and it is the first live proof it works. Set the row to
`staging` as part of this session's roadmap update, and note in your report that the
first real run is the acceptance test.

---

## 9. Report back

- The §3a output, verbatim.
- The §5 replay output, verbatim, including the BUG-7 failure.
- `docs/WORKFLOW.md` §2 as it read before your edit.
- Anything you found that contradicts §1 of this prompt. The board can be stale about
  production; verify against the repo, not the row.
- Do not push. List the commits you made and stop.
