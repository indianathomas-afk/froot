# Session: Roadmap reconcile — bring ROADMAP.yaml current with git

**Save to:** `docs/prompts/ROADMAP_RECONCILE_SESSION.md`
**Run:** any time the /internal/roadmap page looks behind reality — typically at
the end of a heavy build day, or when several sessions ran without updating the
roadmap.
**Size:** S–M (docs only: `docs/ROADMAP.yaml`, `docs/DEPLOY_LOG.md`,
`docs/DECISIONS.md` — no code, no schema, no deps)
**Done criterion:** every commit since ROADMAP.yaml last changed is reflected in
a phase's status/commits/blockers, **Pass 2 below is complete**, `meta.updated`
is bumped, and `next build` passes.

---

## Why this exists

Work has landed in git that isn't reflected in docs/ROADMAP.yaml, so the live
dashboard shows stale state. This session reconciles the roadmap to what actually
happened in the repo. It does not judge the code — it just makes the log match
reality.

**There are TWO passes.** Pass 1 maps new commits onto rows. Pass 2 re-verifies
what existing rows already claim. Pass 1 alone has repeatedly left the roadmap
*complete but wrong* — every commit accounted for, while rows carried stale text,
blockers nobody had checked in weeks, and findings recorded as milder than they
were. **Pass 2 is not optional.**

---

## Pass 1 — map new commits onto rows (audit first, edit nothing yet)

1. Find when the roadmap last changed:
   `git log -1 --format=%cI -- docs/ROADMAP.yaml`
2. List every commit since then:
   `git log --oneline --since="<that date>"` (also check both `main` and
   `staging` if they've diverged — note which branch each commit is on).
3. Read the current docs/ROADMAP.yaml.
4. For each commit since the last roadmap change, map it to the roadmap:
   - existing phase → what changes (status planned→staging→shipped, new commit
     SHA, a blocker discovered or cleared, scope deferred)?
   - no matching phase → a NEW phase/bug that needs an entry (propose an id
     following the existing scheme).
5. Note any commit you can't confidently map, and any roadmap phase whose status
   looks wrong given the commits.

Present a reconciliation table — `id | change | evidence (commit)` — covering
every commit. **Wait for approval before editing.**

---

## Pass 2 — re-verify what the rows already claim

Every item below is a mistake this repo has actually made, not a hypothetical.
Work through all six. Report each as `verified` / `corrected` / `still open`.

### 2a. Every open blocker — is it still true?

Open the `blockers:` on every row and ask: *when was this last checked?* Blockers
here have sat unverified for weeks while the thing they described silently
changed.

- **F-1** carried "CRON_SECRET not confirmed set" for **18 days**. It had been
  set on the ship date all along; nobody looked.
- **F-4** carried an unverified webhook-key blocker for **17 days** while live
  intraday pacing was silently degraded to a nightly backfill.

For each blocker: verify it, then **close it, sharpen it, or record the date you
confirmed it still stands.** A blocker with no verification date is a blocker
nobody owns. When closing one, **move the text into `notes:` rather than deleting
it** — the history is the point.

### 2b. Every "proof required" — has the proof been captured?

Some rows demand evidence before closing. Find them and check whether the
evidence was ever recorded.

**BUG-3** required a build log showing the datasource host without `-pooler`, and
explicitly warned that *a green deploy is not proof*. The code shipped to prod on
both branches and sat at `in_progress` for two days because nobody pasted the log
line. **Quote the evidence into the row** — a claim that proof exists somewhere
is not proof.

Watch for **negative evidence** specifically: BUG-3's real proof was the
*absence* of a fallback warning, which no green build could ever demonstrate.

### 2c. Is any row's text now stale?

A fix lands and the row still describes the old world — and the stale sentence
usually got copied into two or three neighbours.

BUILD-1 said `DATABASE_URL_UNPOOLED` was "ABSENT from local .env entirely" long
after it was present, and the same premise sat in DEBT-4 and BUILD-2's blocker.
**When you correct a stale claim, grep for it** — it is rarely in one place.

### 2d. Does any row UNDERSTATE its finding?

Re-read the sharpest claims against the code. Two live examples:

- **PERM-2**'s deferred note said a MANAGER could assign staff to stores they do
  not manage. The code showed **no org check at all** — cross-*tenant*, not
  cross-*store*.
- **DEBT-5** was filed "harmless today." It was actively hiding a store's login
  from the `/users` table.

A row that undersells a bug is worse than a missing row, because it reads as
triaged.

### 2e. Is `docs/DEPLOY_LOG.md` current?

Compare its newest entry against `git log --merges` on `main`. It has silently
fallen **two promotions** behind before. Every prod merge needs an entry with the
merge SHA, the rollback command, migrations (or explicitly none), and any
verification still outstanding.

### 2f. Do the rulings in `docs/DECISIONS.md` still match the code?

Spot-check the most recent entries. A ruling the code contradicts is worse than
no ruling — and the contradiction is often in **live data** rather than in code
(the STORE-is-a-device ruling was contradicted by an existing account named after
a person on a corporate email).

Also: if this session **changes a design's shape**, record why the old shape was
wrong, not just what replaced it. BUILD-2's `isPrimary` design was impossible —
admins have no assignment rows to flag — and without that written down the next
session would have re-specced it identically.

---

## Task — update docs/ROADMAP.yaml

After approval, apply only what the table shows:
- Move statuses to match reality (respect the vocabulary: planned / in_progress /
  staging / shipped / verified — remember `staging` = merged to staging, NOT in
  prod; `shipped` = on main).
- Add commit SHAs to the phases they belong to.
- Add newly discovered blockers; clear resolved ones.
- Add new phases/bugs with real titles from the commit work — don't invent scope
  beyond what the commits show.
- **Bump `meta.updated` to today.**

## Constraints

- Docs only: `docs/ROADMAP.yaml`, `docs/DEPLOY_LOG.md`, `docs/DECISIONS.md`. No
  code, no Prisma, no dependencies.
- Don't fabricate: if a commit's purpose isn't clear, list it as unmapped and ask
  rather than guessing a phase.
- Where a status is ambiguous (did it reach prod, or just staging?), **don't
  infer it from `git branch --contains`** — that only proves the commit is on
  main, not *which* promotion carried it. Use
  `git log --ancestry-path <sha>..origin/main` and
  `git merge-base --is-ancestor <sha> <merge>`. A prompt once asserted a
  promotion date that git disproved.
- **Treat this prompt's own claims as unverified.** Session prompts have carried
  premises the repo contradicted — rows said to be missing that already existed,
  dates that were wrong. Check before acting, and report the contradiction rather
  than silently reconciling it.
- Work on **one branch only** — normally `staging`. Editing the same rows on both
  branches guarantees a conflict on every touched row at the next merge. If main
  is ahead on a row, copy main's text verbatim to pre-resolve it.
- Don't touch ../froot_docs/.

## Report back

1. The Pass 1 reconciliation table (every commit accounted for).
2. **Pass 2 results — all six checks, each `verified` / `corrected` /
   `still open`.**
3. Anything left unmapped.
4. Anything in this prompt that contradicted the repo.
5. The new `meta.updated` value and `next build` result.
6. The explicit unpushed-commits line (CLAUDE.md Git Rules).

---

## After this session

Commit on the branch you want the roadmap to reflect, then **push to staging** so
Vercel rebuilds and /internal/roadmap regenerates. The page updates only on
deploy — pushing the reconciled ROADMAP.yaml is what makes it current. (Gary runs
the push.)
