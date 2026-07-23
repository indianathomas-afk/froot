# L-3 Production Promotion — Session Prompt (audit-first)

You are working in a fresh Claude Code session on **UseFroot (Froot)**, a store-operations
SaaS for Square merchants (juice/smoothie shops; reference store = Las Brisas). Stack:
Next.js 16, React 19, TypeScript, Prisma 7 on Neon, Clerk, shadcn/ui, deployed on Vercel.

**App root:** `~/Claude_Projects/Froot/froot` (the lowercase `froot`). Run everything from there.

**Numbering:** the labor roadmap uses the **L-** scheme. Do NOT reintroduce old
LAB-/bare-Phase numbers. Source-of-truth docs live in `docs/`: `ROADMAP.md`,
`LABOR.md`, `DECISIONS.md`, `MIGRATIONS.md`, `DEPLOY_LOG.md` (referenced from here as
`../ROADMAP.md`, `../DEPLOY_LOG.md`, etc.).

## What this session is

We are promoting **L-3 (Weekly Plan report — floor-first daily split, GM 40-hr cap,
cross-day rebalancing)** from `staging` to `main`/production. L-3 is built, verified on
staging, docs updated, and committed to **staging only**. Nothing is on `main` yet.

A product decision is already made and should be logged, not re-litigated: **coverage stays
sales-inferred for v1** (accepted behavior — Square always provides selling hours, so there
is no empty-data failure mode). Populating `StoreHours` for open/close accuracy is a future
additive upgrade, explicitly deferred.

## CRITICAL deploy fact — read before doing anything

Vercel is wired so that **`main` auto-deploys to production**. There is no manual promote
step and no preview gate. The moment `git push origin main` lands, it is LIVE at Las Brisas.
There is no window to catch a problem between push and live.

Therefore:
- **You (Claude Code) do NOT run `git push`.** You audit, you prepare, you present the exact
  commands, and you STOP. The human runs the push themselves after reading your audit.
- Everything before the human's push must be **read-only**. No merges, no writes, no
  migrations, until the audit is presented and explicitly approved.

## Phase 1 — Read-only audit (do this, then STOP and report)

Run these and report findings in plain language. Do not modify anything.

1. **State check.** `git fetch --all`, then confirm current branch and that `staging` and
   `main` are both up to date with origin. Report anything dirty/uncommitted.

2. **What's actually being promoted.**
   - `git log main..staging --oneline`
   - `git diff main..staging --stat`
   Summarize in plain English what changes go live.

3. **MIGRATION CHECK (the one that matters).**
   - `git diff main..staging --stat -- prisma/migrations`
   - List any migration directories that exist on `staging` but not on `main`.
   - Open `package.json` and report the exact **`build`** script. Specifically: does it run
     `prisma migrate deploy` (or equivalent) at build time? If yes, then a push to main WILL
     run any new migration against **production Neon** automatically on deploy.
   - Verdict: does promoting L-3 run ANY schema change against prod Neon? Expected answer is
     NO (L-3 is report/compute logic that reads existing models), but confirm it against the
     diff — do not assume.

4. **Env var check.** Grep the diff for new `process.env.*` references
   (`git diff main..staging | grep process.env`). For any new required env var, flag that it
   must already be set in the Vercel **Production** environment or the deploy will break.

5. **Build-time surprises.** Note anything else in the diff that runs at build or first
   request (new server-only deps, changed `next.config`, new required config).

**Then STOP.** Present a plain-language verdict: **SAFE TO PROMOTE** or **NOT SAFE — here's
why**, with the migration and env findings called out explicitly. Wait for the human's
explicit approval before Phase 2.

## Phase 2 — Prepare the promotion (only after approval; human runs the push)

If approved, present (do not execute) the exact command sequence for the human to run:

```
cd ~/Claude_Projects/Froot/froot
git checkout main && git pull origin main && git merge staging --no-edit && git push origin main && git checkout staging
```

Remind the human: `git push origin main` is the point of no return — it deploys to prod
immediately. Confirm the merge is a clean fast-forward / no conflicts before they push; if
there are conflicts, stop and surface them.

## Phase 3 — Post-deploy smoke test (human verifies before trusting)

After the human pushes and Vercel finishes deploying, walk this checklist:

- [ ] Vercel production deployment shows **Ready** (no build failure).
- [ ] The **Weekly Plan report** loads in production for Las Brisas.
- [ ] Numbers look sane: floor-first daily split present, GM capped at 40 hrs, cross-day
      rebalancing behaving as it did on staging.
- [ ] No server errors in Vercel runtime logs; no client console errors on the report page.
- [ ] Spot-check one week against what staging produced — they should match.

## Rollback (know this before pushing)

If prod looks wrong: revert the merge commit on `main` and push — Vercel auto-redeploys the
previous production state.
```
git checkout main && git pull origin main
git revert -m 1 <merge_commit_sha> --no-edit
git push origin main
git checkout staging
```
Since there is no migration in this promotion (per Phase 1), a code revert fully restores the
prior state — nothing to un-migrate. (If Phase 1 unexpectedly found a migration, STOP and do
not proceed without a separate migration-rollback plan.)

## Docs to update (only after a clean smoke test)

- `../DEPLOY_LOG.md` → add a prod-promotion entry (date, commit SHA, what shipped).
- `../ROADMAP.md` → mark L-3 **promoted to production**.
- `../DECISIONS.md` → log: (a) coverage stays sales-inferred for v1, `StoreHours` deferred;
  (b) L-3 promoted to prod on this date.
- `../MIGRATIONS.md` → note "no migration in L-3 promotion" (or the finding, if different).

Keep this scoped to the L-3 promotion only. Any unrelated issues you notice: write them down
as text, do not fix them in this session.
