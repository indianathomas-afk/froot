TIER 1 session. Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/L-4_PROMOTION-STAMP.md and execute it. Repo gate first, one command at a time. Stop where it says stop.

# L-4 PROMOTION STAMP — a4a33b9 — TIER 1

TIER 1: docs only. No code, no schema, no Prisma command beyond the
`prisma generate` inside `npm run build`. One docs commit on `staging`
(R1: never commit on `main`). Never pushes.

## What happened (the facts this stamp records)

- **Merge.** Gary promoted `staging` to production on 2026-10-30 with
  `git merge staging --no-ff --no-edit`, creating merge commit `a4a33b9`.
  - Parents: `c416ee3` (prior main) and `1f6afc2` (staging tip).
  - Payload: 11 commits, `b4cb5e7` through `1f6afc2`.
  - Pushed to `main`. `staging` was then fast-forwarded to `a4a33b9` and
    pushed.
- **Production build.** Vercel, Branch `main`, Commit `a4a33b9`:
  - `Datasource "db": … at "ep-green-smoke-a6xthq4r…"`;
  - "Applying migration `20261030200242_l4a_labor_assignment`" at
    22:52:37 PDT (2026-10-31 05:52:37 UTC);
  - "All migrations have been successfully applied";
  - "Deployment completed".
- **Endpoint identity (Gary, Neon console → Computes, 2026-10-30 22:57 PDT):**
  - production `br-sparkling-block` = `ep-green-smoke-a6xthq4r`;
  - staging `br-square-feather` = `ep-odd-rain-a6gr4xmm`;
  - dev `br-broad-wave` = `ep-late-water-a6k53nv2`.
- **Live check on `usefroot.com`:** Gary reports the result at the STOP below.
  Do not write it until he does.

## Repo gate (one command at a time, paste results)

```
pwd
```
→ must end in `Froot/froot`. If it ends in capital-F `Froot`, run
`cd /Users/garythomas/Claude_Projects/Froot/froot` and run `pwd` again.

```
git status
```
→ on `staging`, tree clean except this prompt file.

```
git log --oneline -1
```
→ expect `a4a33b9`. Then:

```
git log --oneline a4a33b9^1..a4a33b9^2
```
→ must list exactly the 11 commits `b4cb5e7` … `1f6afc2`. Anything else: STOP.

## Step 1 — read the precedent

Read the most recent promotion stamp (`7172219`, DOC-7, "promotion stamp
849550d, row to shipped, migration applied to production"). Use `git show
7172219 --stat`, then read the parts of the files it touched. Copy its shape
exactly: how it marks the UNPROMOTED entries, how it flips a row, and how it
records a production migration. If the file disagrees with this prompt, the
file wins; say so.

## STOP — live check

Ask Gary: "What did usefroot.com/labor → Las Brisas, week of Nov 2 show on
Mon 11-02 and Sat 11-07? Name the org and the Clerk instance you were signed
in under." Record his reply verbatim. If he reports the band wrong on either
day: STOP. Write nothing.

## Step 2 — write (after Gary's reply)

1. **`docs/DEPLOY_LOG.md`:** the four UNPROMOTED entries this promotion
   carried (L-4-0, L-4a, L-4-1, L-4d). Mark each promoted in place, the
   precedent's way: merge `a4a33b9`, 2026-10-30. Nothing is deleted.
   - Add whatever promotion entry the precedent writes. Size it to the blast
     radius: one additive migration plus one display change.
   - Rollback: `git revert -m 1 a4a33b9` and keep the log, per WORKFLOW.md §2.
     Say plainly that the L-4a table stays in production after a revert, since
     it's additive and empty, and that dropping it would need its own migration.
   - Production evidence: the build lines above, the endpoint identity, and
     Gary's live-check reply verbatim.
   - Use chunked, verified writes. Report heading and line counts before and
     after; insertions only.
2. **`docs/ROADMAP.yaml`, L-4 row:**
   - status `staging` → `shipped`, plus the shipped date if the row type
     allows it (check the precedent and the schema notes; DEBT-7's `shipped:`
     trap);
   - prepend a dated promotion block: `a4a33b9`, and the guard "NOT SHIPPED
     UNTIL L-4d SHIPS", now satisfied;
   - L-4b stays paused, L-4c stays as the file has it, and L-5 stays
     `planned`. Put remaining work wherever the row's convention puts it.
     Don't touch other rows.
3. **`docs/MIGRATIONS.md`:** for L-4a, production applied
   2026-10-31 05:52:37 UTC (22:52:37 PDT) by the Vercel build of `a4a33b9` on
   `br-sparkling-block` (`ep-green-smoke-a6xthq4r`). All three branches are now
   applied.
4. Placeholder count before and after (`grep -c '__' docs/ROADMAP.yaml`). It
   must not rise.
5. Run `npm run build`. It must pass with no error lines.
6. Stage only the files you touched plus this prompt. One commit:
   `docs(L-4): promotion stamp a4a33b9, row to shipped, migration applied to production`
7. `git status` shows a clean tree.

## Report and stop

Report the SHA, the files changed, and the before/after counts. Do NOT push.
Gary pushes with `git push origin staging`. The stamp rides the next
promotion (R1).
