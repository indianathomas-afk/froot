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
git merge staging --no-ff --no-edit   # --no-ff = always make a merge commit; --no-edit = no editor popup

# ── write the docs/DEPLOY_LOG.md entry NOW, and commit it, BEFORE the push ──
# (open the file, add the entry for this promotion, citing the merge SHA above)
git add docs/DEPLOY_LOG.md
git commit -m "DEPLOY_LOG: <date> production promotion (<what it carried>)"

git push origin main          # → Vercel auto-deploys www.usefroot.com
git checkout staging          # go back to staging for your next work
```

**The `git add` + `git commit` lines are IN the block deliberately.** They used
to live only in the prose below it, and the block read checkout / pull / merge /
push / checkout — so anyone copying the block literally pushed without ever
committing the entry, which is the exact DEBT-38 failure the entry exists to
prevent. A step that only appears in prose beside a copyable command block is a
step that does not happen. (Found 2026-08-07, on the first promotion run under
this section.)

**Write the `docs/DEPLOY_LOG.md` entry between the merge and the push — it is a
step of the promotion, not a thing remembered afterwards.** The merge commit
from the line above is what you cite in it: date, merge SHA, what the promotion
carried, and the rollback line. Committing that entry on `main` before pushing
means the log and the code reach production together; an entry deferred until
after the push is an entry nobody is holding a reason to write.

**Why `--no-ff`.** Without it a promotion where `main` has not moved
independently fast-forwards and creates no merge commit at all — so there is no
artifact prompting anyone to write the log entry, `git log --merges` returns
none of those promotions when you are reconstructing history after the fact, and
rollback becomes a hand-assembled reverse-order revert range instead of the
short recipe below. That is exactly what you do not want to be assembling under
pressure. (DEBT-38: five of seven pushes to main went unlogged this way, one of
them for three days.)

### Rolling a promotion back

```bash
git checkout main
git revert -m 1 --no-commit <merge-sha>
git checkout HEAD -- docs/DEPLOY_LOG.md   # keep the log — see below
git commit -m "Revert the <date> promotion"
git push origin main
```

`-m 1` keeps parent 1 — production as it stood before the merge — and reverts
everything that came in from `staging`.

**`git revert -m 1 <merge-sha>` on its own CONFLICTS, every time.** Measured on
merge `fad9207`, 2026-08-07: 37 of 38 files reverted cleanly and
`docs/DEPLOY_LOG.md` was the single conflicted path. The cause is structural, not
particular to that promotion — this section has you commit the log entry on
`main` *after* the merge, while the promotion set itself also contains commits
that touched `DEPLOY_LOG.md` (the previous promotion's own entry, among others).
So the revert always tries to undo edits to a file the post-merge commit has
since rewritten. The evidence is in the `fad9207` entry in `docs/DEPLOY_LOG.md`;
it is not re-derived here.

**Keep the log. That is the correct resolution, not a workaround.** A deploy log
is the record that the deploy happened — reverting it would erase the entry
describing the very thing being rolled back, at the moment that entry is most
needed.

Faster posture if the site is actively broken: Vercel → Deployments → promote
the previous production deployment back to current, then do the revert at
leisure. **An additive migration stays either way** — reverting the code leaves
unread columns, which is harmless; dropping them is a destructive migration
against production for no benefit.

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
4. **A row whose code was pushed to `staging` during this session has its
   status set to `staging` IN THE SAME SESSION, before the session ends.** A
   row left at `planned` or `in_progress` after its code is on staging is a
   defect, not a pending decision. Rule 2 already says `status` reflects
   reality; this says WHEN — the session that moved the code is the only
   session that has a reason to look, so a row not updated then is a row
   nobody updates until someone is misled by it.

   **A debt row being shipped gains `status: staging` EXPLICITLY.** A missing
   status on a debt row means OPEN by design — `DebtItem` in
   `src/lib/roadmap.ts:135` makes the field optional, and `isResolvedDebt` in
   `roadmap-client.tsx:71` is the single definition that reads it — and 27 of
   the 75 debt rows still rely on that convention (28 before DEBT-72a's own
   backfill flipped DEBT-28 today; see below). It is DEBT-14's *"a missing
   status means OPEN"*, recorded in `docs/ROADMAP.yaml`'s own header. So a debt
   row that is shipping must DECLARE itself. Omission is not neutral on a debt row: it
   already says the opposite of what a shipping row needs to say.

   **Why this rule exists.** Nothing in the promotion procedure reads
   `docs/ROADMAP.yaml` — that is DEBT-72, and the gate that would fix it is
   DEBT-72b and is not built. But the gate was never the whole problem.
   DEBT-72's audit (`docs/prompts/DEBT-72_AUDIT.md`, `b809e03`) measured the
   half a gate cannot catch: **the board goes stale after work lands, and then
   a decision gets made from it.** Twice in four days — a session that opened
   on "BUG-7 needs promoting" when BUG-7 had been in production since
   2026-08-14, and a session prompt whose own §1 quoted a `WORKFLOW.md` §2 line
   that had read differently since 2026-08-07. Neither is a promotion failure;
   both are a row not updated by the session that moved its code. DEBT-72a
   (2026-08-17) is the backfill that proved the scale: **eleven rows read
   `in_progress` while their code was live in production**, eight of them for
   five to six days. Evidence:
   `docs/prompts/DEBT-72a_BACKFILL.md`.
