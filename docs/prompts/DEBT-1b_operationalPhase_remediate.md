NEW SESSION — DEBT-1b: REMEDIATE operationalPhase, gated on the
DEBT-1a audit. DEBT-2 is NOT this session.

HARD PRECONDITION — check before anything else: docs/DEBT-1_AUDIT.md
must exist, be committed, and contain a writer verdict and per-branch
data tables with no PENDING cells for staging or production. If it is
missing, uncommitted, or has PENDING cells, STOP and report — this
session cannot run ahead of its evidence. Do not substitute your own
audit for the file.

Save this prompt to
docs/prompts/DEBT-1b_operationalPhase_remediate.md before starting
any work. If a file already exists at that path, do NOT overwrite it
— read it, report what it contains, and ask me where this goes.

Read before doing anything: docs/DEBT-1_AUDIT.md in full — it is the
evidence base and its recommendation block is the draft plan;
docs/ROADMAP.yaml row DEBT-1; CLAUDE.md (§ Database Evidence);
docs/MIGRATIONS.md. This message is the task order; where it and the
audit file disagree, stop and report rather than picking one.

STANDING RULES
- Every database result you cite must name its Neon branch on the
  same line.
- You may touch the DEV branch directly (local .env). You have NO
  staging or production connection string and must not obtain one —
  no `vercel env pull`. All staging/production SQL is written by
  you, labeled per branch, approved by me, executed by ME in the
  Neon SQL editor, results pasted back.
- NO MUTATION RUNS ANYWHERE — including dev — before its exact SQL
  has been shown to me and approved. Approval is per-statement,
  per-branch. An approval for dev is not an approval for staging.
- NO SCHEMA CHANGES. This is a DATA fix (UPDATEs) plus, if the audit
  found open writers, a CODE fix. If you find yourself editing
  prisma/schema.prisma or writing DDL, stop and report.
- Files you may modify: the src/ files the audit's writer verdict
  names (and ONLY those), docs/MIGRATIONS.md or docs/DEPLOY_LOG.md
  per the mechanism ruling below, docs/DEBT-1_AUDIT.md (appending a
  remediation record), docs/ROADMAP.yaml, and the prompt file save.
- Audit first, plan, wait for approval, then edit. Commit only when
  I say so. Never push.
- Chain build and commit as ONE command.
- `meta.updated` is gone (DEBT-24, final). Do not re-add.

────────────────────────────────────────────────────────────────
ORDER OF OPERATIONS — fixed, do not reorder
────────────────────────────────────────────────────────────────
STEP 1 — PLUG THE WRITERS (skip only if the audit's verdict is "tap
closed", with its evidence re-verified against the current checkout).
If any code path can still write "During Hours" (or any non-canonical
variant), fix those sites first, as their own commit, before any
data changes. The fix writes the canonical "During the Day" — it
does not add new variants and does not touch the I-14b alias.

STEP 2 — BACKFILL, dev → staging → production, in that order, each
branch its own approval:
  For each dirty location the audit found:
    a. Show me the UPDATE, the branch, and the expected row count
       (from the audit's table — if the audit's count is stale,
       re-run the SELECT first and say so).
    b. On approval: dev you run; staging/production I run.
    c. Immediately verify: re-run the DISTINCT/count SELECT on that
       branch and show zero non-canonical rows remain. Before/after
       counts recorded, branch named.
  If the audit found a third variant, it is remediated the same way
  ONLY if its canonical mapping is obvious; if the mapping requires
  judgment (what did the writer mean?), stop and bring it to me with
  the affected rows.

STEP 3 — RECORD. Append a dated remediation record to
docs/DEBT-1_AUDIT.md: what ran where, before/after counts per
branch, SHAs.

EXPLICITLY OUT OF SCOPE: retiring the I-14b alias. Even with data
clean and writers plugged, the alias stays as a belt-and-suspenders
until the fix has soaked in production. Log its retirement as a new
debt row (next free DEBT-N) with a note that it is unblocked once
DEBT-1 is verified — that keeps it tracked without rushing it.

MECHANISM RULING NEEDED — bring me a recommendation, not a question:
one-off approved SQL per branch (Neon console, recorded in
DEBT-1_AUDIT.md and DEPLOY_LOG.md) vs. a committed data-migration
file that travels through `migrate deploy`. Weigh: the house policy
is Neon-as-source-of-truth with approved SQL; but a migration file
self-documents in the ledger and re-applies to any future branch,
while a console one-off does not. State your pick and why before
Step 2 begins. Whichever wins, the record in Step 3 still happens.

────────────────────────────────────────────────────────────────
AUDIT AND PLAN — what I want back before any edit
1. Precondition check result: the audit file's verdict and tables,
   summarized, with anything that has drifted since it was written.
2. Step 1 scope: the exact writer sites (or the verified "tap
   closed" evidence).
3. The full SQL set for Step 2, per location per branch, with
   expected counts.
4. The mechanism recommendation.
5. Anything contradicting the audit file, the row, or this prompt —
   say so rather than reconciling silently.
6. Commit plan. I expect: writer fix (if any) as its own commit;
   docs/records commit; ROADMAP follow-up commit with quoted SHAs.

DONE CRITERION
DEBT-1 gets status per convention ONLY when every branch shows zero
non-canonical rows, verified with branch-named before/after counts,
AND the writer verdict is "closed". `isResolvedDebt` counts
staging | shipped | verified — but if production's backfill has run
and verified, this row has genuinely landed everywhere, so say which
status you're setting and why. CLOSED preamble above original text,
original preserved below the house marker, commits quoted. The new
alias-retirement row exists. Confirm no row touched this session has
a landed status without a commits field, and that DEBT-2 is
untouched.

REPORT BACK
1. The six audit items, then what was actually committed and what
   SQL ran where — every line branch-named.
2. Before/after counts per location per branch.
3. Explicit confirmation: no mutation ran anywhere without its
   per-branch approval, and the session possessed no staging or
   production connection string at any point.
4. `next build` green, chained with each commit as one command.
5. The explicit unpushed-commits line — I run all pushes.
6. What I should verify on staging and production after pushing,
   and what "correct" looks like in the UI for a formerly-dirty row.
