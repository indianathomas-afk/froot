Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/DOCS-CLEANUP-NOTIFY12_2026-10-24.md and execute it.

# DOCS-CLEANUP-NOTIFY12 — stamp the NOTIFY-12 promotion, MS-6 heading, workflow rules (2026-10-24)

**TIER 1 — docs only. Runs on `staging`.** No code, no schema, no prisma commands beyond the `prisma generate` inside `npm run build` (report it; it is not a breach). Commit only. Never push.

## Repo gate (report each, stop on any surprise)
1. `git rev-parse --abbrev-ref HEAD` → `staging`
2. `git status --short` → clean (this prompt file may be the only untracked file)
3. `git log --oneline -1` → expect `9542b14`
4. `git log --oneline main..staging` and `git log --oneline staging..main` → both empty
5. `git log -1 --format='%H %P %s' 9542b14` → report; confirm it is a merge whose second parent is `8fba214`
6. `git stash list` → report only

## What happened (facts to record)
- **NOTIFY-12 promoted 2026-10-24** in merge `9542b14` (staging → main, first parent `cd62c36`, carries `146e94f`, `8648a2a`, `8fba214`; 32 files). Rollback: `git revert -m 1 9542b14` — note the migration is additive and stays applied; reverting code alone would leave signed-ack emails reading no picks, so a rollback must be planned, not run blind.
- **Migration `20261023200000_notify12_recipients` applied:** dev 2026-10-23 22:35:10Z by Gary (`npx prisma migrate deploy` from `froot/`); staging and production by their Vercel builds on 2026-10-24. Parity query (the one recorded in MIGRATIONS.md) returned **0 rows on dev, staging and production**.
- **Staging evidence 2026-10-24 (build `8648a2a`, Gary as indianathomas):** (1) parity 0 rows; (2) Contacts card replaced the old text box, `gary@kevajuice.com` backfilled and checked under signed-ack, card reads On, milestone card refuses extras; (3) contact added, named, picked under pace alerts, held across reload; (4) store-login warning shown for `corporate@keva.com` with Tommy set to STORE; a store's own contact email (`kevajuice14@icloud.com`, a Store record field, not a login) correctly shows no warning; archive/restore kept picks; (5) "Send a test to me" and the milestone sample both arrived; (6) Tommy signed a test document and Recent emails showed one signed-ack row per picked contact.
- **Production evidence 2026-10-24:** parity 0 rows on production; `/settings/notifications` shows the four backfilled HR addresses as contacts, all checked under signed-ack.
- **Process notes:** `8fba214` (the PRE-PUSH-CHECK commit) was not pushed before the promotion — Gary pushed after `8648a2a` only; it reached production inside the merge and staging on the merge-back. No harm (docs only). The 2026-10-23 dev apply was Gary's own (not a session breach).

## Edits (read each file first; preserve-and-mark — add dated riders, never delete text)
1. **`docs/DEPLOY_LOG.md`**
   - The NOTIFY-12 entry written by the PRE-PUSH-CHECK (marked UNPROMOTED / staging only): stamp it promoted 2026-10-24 in `9542b14` with the rollback note, and add the staging and production evidence above. Do not add a second entry.
   - The MS-6 entry still headed "UNPROMOTED": confirm with `git branch --contains` / `git log` which merge carried MS-6 to main (expected `2231bc0`), then stamp it. If the evidence disagrees, STOP and report.
   - Heading count must stay the same. Report before/after.
2. **`docs/ROADMAP.yaml`**
   - NOTIFY-12 → `shipped: 2026-10-24`, promotion merge `9542b14`, evidence summary, blockers discharged. Keep the staging test list; mark each item passed.
   - MS-6 row: if still `staging`, flip to shipped with its merge (same evidence rule as above).
   - NOTIFY-10: add `resolved: true` to the blocker whose text already says "RESOLVED 2026-10-18" (the build warns about it). **Leave NOTIFY-10 itself `planned`** — its step 14 (a real signed-ack send on production) is still owed.
3. **`docs/MIGRATIONS.md`** — on the NOTIFY-12 entry: applied-to-dev (date, time, who), applied-to-staging and applied-to-production (2026-10-24, via vercel-build), parity 0 rows on all three.
4. **`CLAUDE.md` and `docs/WORKFLOW.md` — four rules Gary set 2026-10-23/24.** Add them; where existing text says the opposite (e.g. promotion docs passes run on main), add a dated superseding rider instead of deleting it:
   - **R1 — every commit goes on `staging`, docs passes included. Never commit on `main`.** A promotion's docs stamp is a normal staging commit that rides the next promotion. After every promotion, main is merged back into staging (fast-forward) and pushed. Cite `cd62c36` (2026-10-23) as the last docs commit made on main.
   - **R2 — migration apply instructions come only from Gary's planning chat.** A session that generates a migration STOPS (existing rule) and does not print apply commands for Gary.
   - **R3 — every apply instruction to Gary begins with `cd /Users/garythomas/Claude_Projects/Froot/froot` and `pwd`,** never the `froot` alias alone (the capital-F `Froot` parent folder fetched Prisma 8 on 2026-10-23).
   - **R4 — SQL handed to Gary never carries a hand-typed branch label.** Branch identity comes from the Neon console's branch dropdown / Computes page, or a value the server reports (`neon.branch_id`), never a literal in the SELECT.
   - Also confirm WORKFLOW.md says **push only after PRE-PUSH-CHECK reports ready** (it happened again with `8fba214`); add the line if missing.

No other files. No DECISIONS.md entry, no new ROADMAP rows.

## Gates before commit
- `grep -c '__' <each edited file>` before and after — no new placeholders.
- `npm run build` — must pass.

## Commit
- `git add` the edited files and this prompt file by path only (never `-A`).
- One commit: `docs(DOCS-CLEANUP-NOTIFY12): stamp NOTIFY-12 promotion 9542b14, MS-6 heading, NOTIFY-10 blocker flag, workflow rules R1-R4`
- Do not push.

## Report
Repo gate results, the MS-6 merge you found and how, heading counts, every row touched (id + one line), CLAUDE.md/WORKFLOW.md lines added or ridered, `__` counts, build result, commit SHA, prisma commands run. Then stop.
