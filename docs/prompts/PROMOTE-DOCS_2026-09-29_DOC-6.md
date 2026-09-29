Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/PROMOTE-DOCS_2026-09-29_DOC-6.md and follow it exactly.

# PROMOTE-DOCS 2026-09-29 — DOC-6 late promotion stamp

**TIER 1.** Declare the tier before writing anything. Docs only: no code, no schema, no ROADMAP row for this session itself.

## Why

DOC-6 (the key holder register) is on production. Its work commit `73c1a59` is an ancestor of `origin/main`. But its ROADMAP row still says `staging`, and its DEPLOY_LOG entry still says UNPROMOTED. The shipped-flip was skipped again, which is the same gap DEBT-104 describes. This session corrects the records.

This runs **on staging**, not main. The fix ships to main with DOC-11's promotion, which saves a merge-back.

## Repo gate (stop if any fail)

Run each as its own command:

```
git branch --show-current
```
Must be `staging`.

```
git fetch origin
```

```
git status -sb
```

- The branch must be level with `origin/staging` (not ahead or behind).
- The only untracked file allowed is `docs/prompts/PROMOTE-DOCS_2026-09-29_DOC-10.md`, plus this prompt.
- If `5bc3008` isn't on `origin/staging`, STOP. Gary needs to push the DOC-11 check first.

## Find the facts (measure, don't cite)

Record the command output for each:

- **Merge commit:** the merge commit on `origin/main` that first brought DOC-6's commits in. Use `git log --merges --ancestry-path` from `73c1a59` to `origin/main`, and confirm with `git branch -r --contains`.
- **Date:** the merge's committer date, decoded to Pacific time.
- **Carried commits:** which commits that merge carried. List them with `git log --oneline <merge>^1..<merge>^2`.

If this turns up more than one candidate merge, or none, STOP and report. Don't pick one.

## Edits

**1. ROADMAP.yaml** (`/Users/garythomas/Claude_Projects/Froot/froot/docs/ROADMAP.yaml`), DOC-6 row:
- Status goes to `shipped` with the merge date.
- Add the merge SHA.
- Prepend a dated note saying the records were corrected late on 2026-09-29, and that the shipped-flip was skipped at promotion.
- These two production items were owed at promotion and haven't been confirmed. Keep them in `open:`, and don't mark them done:
  - the production read-only query;
  - turning on Tracks return (label "Key") on the production Key Agreement.
- Preserve and mark. Delete nothing.

**2. DEPLOY_LOG.md**, DOC-6 entry:
- Replace the UNPROMOTED marker with the merge SHA and date.
- Add a one-line rollback: `git revert -m 1 <merge>`.
- This is the only change allowed inside that entry.
- Check the heading count before and after; it must be unchanged.

**3. DEBT-104 row:** add a dated rider saying the gap recurred on DOC-6 (2026-09-29), despite the shipped-flip step now sitting in the WORKFLOW.md § 2 promotion block. Don't change its status.

**4. Leftover prompt:** stage `docs/prompts/PROMOTE-DOCS_2026-09-29_DOC-10.md` and this prompt, so neither sits untracked anymore.

## Check and commit

```
npm run build
```

It must exit 0, because the roadmap generator runs in the build.

Make one commit, staging only the four files touched:
- `ROADMAP.yaml`
- `DEPLOY_LOG.md`
- the two prompt files

Commit message:

```
docs(DOC-6 PROMOTE): stamp merge <sha>, row to shipped (late)
```

Never push.

## Report

- The merge SHA and date, with the command output.
- The commits it carried.
- The before/after heading count.
- The build result.
- The commit SHA.
