Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/PROMOTE-DOCS_2026-11-11_PWA-1.md and run it.

# PROMOTE-DOCS — 2026-11-11 — PWA-1

**TIER 1** — docs only. No code, no schema, no prisma commands beyond the `prisma generate` that `npm run build` runs. Declare the tier before writing anything. Work on `staging` (docs commits go on staging first, never main). Commit only; never push.

## Facts to record (do not re-derive; verify each against git)

- PWA-1 promoted to production in merge **`2a1f757`** ("Merge branch 'staging'"), first parent **`90a98b5`**. Pushed `90a98b5..2a1f757` to main on 2026-11-11.
- The merge carried four commits: `630e88b` (work), `870d3d4` (docs), `045db56` (PRE-PUSH-CHECK), and `d99df06` (TAB-14 promote-docs, already recorded — do not re-stamp it).
- Staging was fast-forwarded to `2a1f757` and pushed; main, staging and both origins sit at `2a1f757` before this commit.
- No migrations, no env vars.
- Rollback: `git revert -m 1 2a1f757`.
- Staging evidence (Gary, iPad, 2026-11-11, staging build `045db56`): all five PWA-1 tests passed — icon is the orange slice on a cream tile named "Froot"; launch from the icon shows no address bar or tabs; sign-in inside the app lands in Tablet mode; a Desktop choice survives a full close and relaunch; plain Safari still defaults to Desktop. Gary: "Everything checks out and is working."

## Verify first

1. Repo gate: in `/Users/garythomas/Claude_Projects/Froot/froot`, on `staging`, tree clean.
2. `git rev-parse HEAD` and `git rev-parse origin/main` both equal `2a1f757…`. If not, STOP and report.
3. `git log --oneline 90a98b5..2a1f757` lists exactly the four commits above plus the merge.

## Edits

**`docs/DEPLOY_LOG.md`** — find the `## UNPROMOTED — 2026-11-11 — PWA-1 …` entry written by `045db56`. Restamp its heading as promoted, following the shape of the TAB-14 entry's promotion stamp (`d99df06` is the precedent). Add: merge `2a1f757`, first parent `90a98b5`, the four carried commits, rollback line, the staging evidence above. Heading count must be the same before and after (a restamp, not a new heading); report both counts and the line delta.

**`docs/ROADMAP.yaml`** — PWA-1 row: status `staging` → `shipped`, `shipped: 2026-11-11`, add the merge SHA to the row's commits/promotion field per existing shipped rows. Move "iPad staging test" out of `open:` into the row as done with the evidence above. Add to `open:`: "Production check on a store iPad: Add to Home Screen from usefroot.com, launch from the icon → no Safari bar, Tablet mode, cream icon." and "Remove stale 'DRAFT ruling R1' comment in `src/components/layout/standalone-tablet-default.tsx` (next code phase)." Keep `deferred:` as is. Preserve-and-mark: delete nothing.

Touch nothing else. No DECISIONS.md change (R1 was ratified in `045db56`).

## Commit gate

- `grep -c '__'` on any token you templated must be 0.
- `npm run build` green.
- Stage the two files explicitly (no `git add -A`), plus this prompt file at `docs/prompts/PROMOTE-DOCS_2026-11-11_PWA-1.md` if it is untracked.
- One commit: `docs(PROMOTE): PWA-1 shipped in merge 2a1f757; staging evidence`.

## Report

Tier, commit SHA, DEPLOY_LOG heading counts before/after and line delta, the ROADMAP row diff, prisma commands run. End with: "Committed, NOT pushed."
