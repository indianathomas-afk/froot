TIER 1 session. Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/BUG-17_PROMOTION-STAMP.md and execute it. Repo gate first, one command at a time. Stop where it says stop.

# BUG-17 PROMOTION STAMP — 0ff5628 — TIER 1

TIER 1: docs only. No code, no schema, no Prisma command beyond the
`prisma generate` inside `npm run build`. One docs commit on `staging` (R1:
never commit on `main`). Never pushes.

## What happened (the facts this stamp records)

- **Merge.** On 2026-10-31 Gary promoted `staging` to production with
  `git merge staging --no-ff --no-edit`, creating merge commit `0ff5628`.
  - Parents: `a4a33b9` (prior main) and `b2fd9e3` (staging tip).
  - Payload: 6 commits, `dbf0121` (L-4 stamp), `eeb94ae` and `84e7f6c`
    (TIMECARD-HEAL-0), `52f12a6`, `09961fc` and `b2fd9e3` (BUG-17).
  - Pushed to `main`; `staging` brought level with `main`.
- **No migration** in this promotion.
- **Staging verification (Gary, 2026-10-31):**
  - **Las Brisas dashboard on staging (`b2fd9e3~staging`):** the October
    stuck-card note read 16 at 12:06 and 8 at 12:25, and was gone at 12:48
    (PDT).
  - **Neon, staging `br-square-feather-a63z92vz`:** open-older-than-24h went
    from 155 to 68. Las Brisas 58 → 0 and Carson 29 → 0. The rest are
    unchanged only because their dashboards hadn't synced yet. They were South
    Reno 44, Meadowood Mall 9, UNR 7, Southgate 5, Spanish Springs 2 and
    University Village 1; total 68 confirmed by a one-row count.
- **Production (Gary, Neon, after the merge):** `br-sparkling-block-a620qvg4`
  open-older-than-24h = 0.
- **Production build and live check:** Gary reports both at the STOP below.

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
→ expect `0ff5628`. Then:

```
git log --oneline 0ff5628^1..0ff5628^2
```
→ must list exactly the 6 commits above. Anything else: STOP.

## Step 1 — read the precedent

Read the L-4 promotion stamp (`dbf0121`). Copy its shape exactly: the
per-entry PROMOTED paragraphs, the row flip, and the evidence placement. The
file wins over this prompt; say so where they differ.

## STOP — production evidence

Ask Gary: "Paste the Vercel production build lines for `0ff5628` (the
Datasource line and the migration line), and tell me what usefroot.com/dashboard
→ Las Brisas showed: the footer SHA, and whether any 'open more than 24 hours'
note appeared. Name the org and the Clerk instance."

Record his reply verbatim. STOP and write nothing if any of these hold:
- the Datasource line isn't `ep-green-smoke-a6xthq4r`;
- the build failed;
- the footer isn't `0ff5628`;
- a stuck-card note appears on production.

## Step 2 — write (after Gary's reply)

1. **`docs/DEPLOY_LOG.md`:** every UNPROMOTED entry this promotion carried.
   Expect TIMECARD-HEAL-0 and BUG-17; read the file and list what you find.
   Mark each promoted in place, the precedent's way: merge `0ff5628`,
   2026-10-31.
   - The BUG-17 entry holds the merge details, the staging verification above,
     the production evidence, Gary's reply verbatim, and the rollback:
     `git revert -m 1 0ff5628`. There's no schema to unwind.
   - Use chunked, verified writes. Report heading and line counts before and
     after.
2. **`docs/ROADMAP.yaml`:**
   - BUG-17: status → `shipped`, `shipped: 2026-10-31` if the row type allows
     it, `0ff5628` added to commits, and a prepended dated promotion note with
     the 155 → 68 / 0 evidence.
   - TIMECARD-HEAL-0: follow the file. It may have no row of its own (L-4-0
     precedent); only mark what exists.
   - BUG-18 and DEBT-122 stay `planned`. Don't touch other rows.
3. **`docs/MIGRATIONS.md`:** for L-4a, fill the missing staging applied time:
   2026-10-30 20:23:50 UTC (13:23:50 PDT). Source: the Vercel staging build
   log for `45fcf5f`, line "Applying migration
   `20261030200242_l4a_labor_assignment`" at 13:23:50.546. Replace the
   "finished_at not read" note.
4. Placeholder count before and after (`grep -c '__' docs/ROADMAP.yaml`). It
   must not rise.
5. Run `npm run build`. It must pass with no error lines.
6. Stage only the files you touched plus this prompt. One commit:
   `docs(BUG-17): promotion stamp 0ff5628, row to shipped; L-4a staging time filled`
7. `git status` shows a clean tree.

## Report and stop

Report the SHA, the files changed, and the before/after counts. Do NOT push.
Gary pushes with `git push origin staging`. The stamp rides the next
promotion (R1).
