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

```bash
# after editing prisma/schema.prisma:
npx prisma migrate dev --name describe_the_change
git add -A && git commit -m "Add <thing> to schema"
git push origin staging
# the Vercel build runs `prisma migrate deploy` automatically —
# staging DB updates on the staging deploy, prod DB updates when you merge to main
```

Never run `db push` or `migrate dev` against staging or prod databases.

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
