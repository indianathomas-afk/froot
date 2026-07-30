# Froot — everyday git workflow

`main` = production (www.usefroot.com). `staging` = testing (the vercel.app URL).
Work always flows one direction: staging → test → main. Never commit to main directly.

## 0. One-time setup (do these once, today)

```bash
git config --global core.editor nano   # friendlier editor than vi if git ever asks
git config --global pull.rebase false  # plain merges on pull, no surprises
```

## 1. Everyday cycle — ship a change to staging

```bash
cd ~/Claude_Projects/Froot/froot
git checkout staging          # make sure you're on staging
git status                    # see what's changed
git add -A                    # stage everything changed
git commit -m "Describe what you changed"
git push origin staging       # → Vercel auto-deploys the staging URL
```

Test it at froot-git-staging-….vercel.app.

## 2. Promote to production (staging → main)

```bash
git checkout main
git pull origin main          # make sure local main is current
git merge staging --no-edit   # --no-edit = no editor popup, uses default message
git push origin main          # → Vercel auto-deploys www.usefroot.com
git checkout staging          # go back to staging for your next work
```

That's the whole release. Watch the deploy at vercel.com → Deployments →
wait for "Ready" on the Production row.

## 3. Schema changes (see MIGRATIONS.md for full detail)

`npx prisma migrate dev` is BROKEN here — the baseline squash was never done, so
shadow-DB replay fails with P3018. Schema changes are hand-authored migrations.
The shape:

1. edit `prisma/schema.prisma`
2. `prisma migrate diff` → writes the SQL to `prisma/migrations/<timestamp>_<name>/`
3. **read the generated SQL** before it touches anything
4. `prisma db execute` applies it to the dev DB, `prisma migrate resolve --applied`
   records it in the ledger
5. `prisma generate`
6. commit the migration folder **with** the code that uses it

Copy the exact commands for 2–5 from **MIGRATIONS.md §3** rather than retyping
them — they connect the way BUG-3 requires. Worked example: the two migrations
hand-authored this way on 2026-07-29,
`20260729124105_build2_user_default_store` and
`20260729145504_build2_staff_one_primary_store`.

Then ship it like any other change:

```bash
git add -A && git commit -m "Add <thing> to schema"
git push origin staging
# the Vercel build runs `prisma migrate deploy` automatically —
# staging DB updates on the staging deploy, prod DB updates when you merge to main
```

Never run `db push` or `migrate dev` against staging or prod databases — and
`migrate dev` is not available locally either, see above.

Once the baseline squash lands and `SHADOW_DATABASE_URL` is set, steps 2–5
collapse back to `npx prisma migrate dev --name <name>` (MIGRATIONS.md §3) — not
today.

## 4. When something looks stuck

**Trapped in vi (screen full of ~ symbols):**
press `Esc`, type `:q!`, press Enter. Then redo the command with `--no-edit`.

**Merge went sideways, want to start over (before pushing):**
```bash
git merge --abort
```

**"command not found: prisma" (or any tool):**
prefix it with npx → `npx prisma …`. Project tools aren't global commands.

**Not sure what state you're in:**
```bash
git status                    # tells you branch + what's pending, always safe
git log --oneline -5          # last 5 commits on this branch
```

**See what staging has that main doesn't:**
```bash
git log --oneline main..staging
```

## Session completion rules

A session is not done until all are true:

1. `next build` passes.
2. This phase's entry in `docs/ROADMAP.yaml` is updated:
   - `status` reflects reality (e.g. in_progress → staging → shipped)
   - `commits` lists this session's SHAs
   - `shipped` dated if it reached prod
   - `blockers` lists anything left broken/unset/unverified in prod, including
     required env vars not yet set and prod-promotion gates
   - `deferred` lists scope explicitly cut
   - do NOT add or bump `meta.updated` — the field was deleted 2026-07-30
     (DEBT-24). The `/internal/roadmap` page dates itself from this file's git
     commit date, falling back to "unknown" by design.
3. Bugs noticed but not fixed go in the `debt:` (or `bugs:`) block in
   ROADMAP.yaml as text — not fixed inline.
