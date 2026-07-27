# Session: Roadmap reconcile — bring ROADMAP.yaml current with git

**Save to:** `docs/prompts/ROADMAP_RECONCILE_SESSION.md`
**Run:** any time the /internal/roadmap page looks behind reality — typically at
the end of a heavy build day, or when several sessions ran without updating the
roadmap.
**Size:** S (updates docs/ROADMAP.yaml only — no code, no schema, no deps)
**Done criterion:** every commit since ROADMAP.yaml last changed is reflected in
a phase's status/commits/blockers, `meta.updated` is bumped, and `next build`
passes.

---

## Why this exists

Work has landed in git that isn't reflected in docs/ROADMAP.yaml, so the live
dashboard shows stale state. This session reconciles the roadmap to what actually
happened in the repo. It does not judge the code — it just makes the log match
reality.

---

## Audit first — edit nothing yet

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

- docs/ROADMAP.yaml only (plus meta). No code, no Prisma, no dependencies.
- Don't fabricate: if a commit's purpose isn't clear, list it as unmapped and ask
  rather than guessing a phase.
- Where a status is ambiguous (did it reach prod, or just staging?), check whether
  the commit is on `main` or only `staging` and set status accordingly.
- Don't touch ../froot_docs/.

## Report back

1. The reconciliation table (every commit accounted for).
2. Anything left unmapped.
3. The new `meta.updated` value and `next build` result.

---

## After this session

Commit on the branch you want the roadmap to reflect, then **push to staging** so
Vercel rebuilds and /internal/roadmap regenerates. The page updates only on
deploy — pushing the reconciled ROADMAP.yaml is what makes it current. (Gary runs
the push.)
