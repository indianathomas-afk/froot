NEW SESSION — DEBT-7 ONLY. Do not carry assumptions from any prior
session. DEBT-3 and DEBT-5 are related rows but are NOT this session —
do not touch them, and do not contradict what their rows say.

Save this prompt to docs/prompts/DEBT-7_staging_setup_danger_header.md
before starting any work. If a file already exists at that path, do NOT
overwrite it — read it, report what it contains, and ask me where this
goes.

Read before doing anything: docs/ROADMAP.yaml row DEBT-7 (and BUILD-1
and SEC-4, which it cross-references); CLAUDE.md; docs/STAGING_SETUP.md
in full; docs/WORKFLOW.md § Session completion rules. This message is
the task order.

STANDING RULES
- Treat this prompt's claims AND the ROADMAP row's claims as
  UNVERIFIED. Re-verify every file:line against the current checkout.
  If a reference has drifted, report the real location rather than
  following it silently.
- This is a DOCS-ONLY session. No database access of any kind — no
  Neon, no `vercel env`, no `.env` reads beyond what CLAUDE.md
  requires. There is nothing in this task that needs a database. If
  you find yourself wanting one, stop and report why.
- The ONLY files you may modify: docs/STAGING_SETUP.md,
  docs/ROADMAP.yaml, and the prompt file save above. No src/, no
  prisma/, no vercel.json, no env changes. Anything else you think
  needs fixing goes in the report as text.
- Audit first, plan, wait for my approval, then edit. Commit only
  when I say so. Never push.
- Chain build and commit as ONE command — `npm run build && git
  commit ...` — never two lines. A reported build is not a gate.

────────────────────────────────────────────────────────────────
THE TASK — neutralise docs/STAGING_SETUP.md's dangerous advice
────────────────────────────────────────────────────────────────
Context, to be re-verified: docs/STAGING_SETUP.md describes a staging
environment that was never built, and one of its instructions is now
actively dangerous. Per the DEBT-7 row:

  (1) §2 claims the Neon-Vercel integration auto-creates a database
      branch per Preview deployment. It does not and never did here;
      staging is one long-lived hand-wired branch (ep-odd-rain).
  (2) §2 step 4 (around :26) instructs the reader to "remove any
      manually-set DATABASE_URL under Preview scope", and §5's table
      (around :56) lists Preview DATABASE_URL as "auto-injected by
      Neon integration". THIS IS THE DANGEROUS PAIR. Following either
      today would delete the branch-scoped staging override — the row
      that makes staging deploys reach ep-odd-rain instead of failing
      — and contradicts BUILD-1's deferred step 2, which says to ADD
      Preview-scoped vars.
  (3) §4 and §5 say staging uses Square SANDBOX. Staging actually
      uses a separate "Froot Staging" PRODUCTION app against the real
      Square account. The file's promise that "no real charges can
      happen from staging even by accident" is not something this
      environment guarantees.
  (4) §8's verification checklist therefore cannot pass as written.

DECIDED, DO NOT RE-LITIGATE — the fix shape is:
  (a) A prominent header at the top of the file marking it
      ASPIRATIONAL / HISTORICAL — the plan as drafted, not the system
      as built. The header must: say the file must not be followed as
      instructions; name the four falsehoods above in one line each;
      and point the reader to ROADMAP.yaml row DEBT-7 and BUILD-1 for
      the real state.
  (b) An inline warning immediately at the §2 step 4 instruction and
      at the §5 table's DATABASE_URL row, each stating plainly: do
      not do this — deleting the Preview-scoped DATABASE_URL breaks
      staging deploys; see BUILD-1.

Do NOT rewrite the file to describe the environment that actually
exists. That is a bigger job, it is not this session, and partial
rewriting is worse than none — a half-corrected file reads as
authoritative. Header + two inline warnings, nothing more.

Your judgement is wanted on ONE thing: whether §4's "no real charges
can happen from staging even by accident" line ALSO needs its own
inline warning, since it is a false safety guarantee a reader might
rely on, or whether the header covers it because §4 is not an
imperative instruction the way :26 is. Recommend, don't just ask.

────────────────────────────────────────────────────────────────
AUDIT AND PLAN — what I want back before any edit
1. The real current line numbers of: §2 step 4's remove-DATABASE_URL
   instruction, §5's DATABASE_URL table row, and §4's no-real-charges
   line. Call out any drift from :26 / :56.
2. The full proposed header text, quoted.
3. The full proposed inline warning text for both sites, quoted.
4. Your recommendation on the §4 judgement item.
5. Anything in this prompt that contradicts the repo or the ROADMAP
   row — say so rather than reconciling it silently.
6. Commit plan. I expect two commits: the STAGING_SETUP.md edit, then
   the follow-up ROADMAP.yaml commit recording its SHA.

DONE CRITERION
Row DEBT-7 leaves the open list on /internal/roadmap. `isResolvedDebt`
counts staging | shipped | verified. A row cannot record the SHA of
the commit that contains it — use the repo's follow-up-commit
convention (precedents: 6f0821c, 116d77e, b407de1). Short SHAs must be
QUOTED in ROADMAP.yaml — `commits: ["84437e5"]` — because YAML reads
bare 84437e5 as scientific notation. The generator coerces this
(DEBT-21), but quote anyway. Bump `meta.updated`. Confirm at the end
that the row does not have a landed status without a commits field.

REPORT BACK
1. The six audit items above, then what was actually committed.
2. Every file:line that had drifted, with the real location.
3. `next build` green, chained with each commit as one command.
4. The explicit unpushed-commits line — I run all pushes.
