NEW SESSION — DOCS-2: production promotion bookkeeping.
Docs-only. No code, no schema, no database, no env changes.

Save this prompt to docs/prompts/DOCS-2_promotion_bookkeeping.md
before starting any work. If a file already exists at that path, do
NOT overwrite it — read it, report what it contains, and ask me
where this goes.

Read before doing anything: docs/DEPLOY_LOG.md IN FULL (note its
ordering before writing to it — see the standing rule below);
docs/ROADMAP.yaml's meta block and every row currently at
status: staging; docs/MIGRATIONS.md's promotion-history section;
CLAUDE.md; docs/WORKFLOW.md § Session completion rules.

WHY THIS SESSION EXISTS: DEBT-23 was withdrawn because a claimed
missing DEPLOY_LOG entry turned out to be a misread grep — but its
surviving instruction stands: "Writing this row down is not the
same as closing it." Three production promotions have happened
since meta.note was last updated and this session is the one that
records them. Do not let filing become the omission.

STANDING RULES
- Treat every SHA, date and claim in this prompt as UNVERIFIED.
  Establish each from git and the files themselves; report drift.
- DEPLOY_LOG.md is REVERSE-CHRONOLOGICAL — newest at the top.
  Confirm that with `grep -n "^## " docs/DEPLOY_LOG.md` BEFORE
  writing anything, and say what you found. This is the exact
  mistake DEBT-23 was built on.
- Audit first, plan, wait for my approval, then edit. Commit only
  when I say so. Never push.
- Gate: docs-only, so eslint skipped. Bare npm run build, chained,
  NO PIPES — per CLAUDE.md § Commit Gates.
- meta.updated is gone (DEBT-24, final). Do not re-add it.

────────────────────────────────────────────────────────────────
TASK 1 — establish what actually reached production, from git
────────────────────────────────────────────────────────────────
There are THREE unrecorded promotions, not one. Establish each
independently — merge SHA, date, and the phases/rows it carried:

(a) 2026-07-29 — the BUILD-2 promotion. DEBT-23's withdrawal says
    its DEPLOY_LOG entry was written at that time; VERIFY that,
    and verify meta.note does NOT list it.
(b) 2026-08-01 morning — 21 commits: DEBT-1a/1b, DEBT-2a/2b,
    DEBT-3, DEBT-5, DEBT-7, DEBT-25. Production verified by me:
    the Mid-Shift form shows "During the Day".
(c) 2026-08-01 evening — 6 commits: the DEBT-SWEEP (9508d4c,
    6f33427, 89c70f7, cf0b044, cde5022) plus commit 6 (97ed309).

Report which of the three already have a DEPLOY_LOG entry and
which do not. Do not assume it is all three.

MIGRATIONS: check whether ANY of the three carried a migration
file. My understanding is none did — DEBT-1b's backfill was
one-off approved SQL in the Neon console, deliberately not a
committed migration, and the sweep touched no schema. Verify from
prisma/migrations/ and the merge diffs rather than accepting that.
If the answer is genuinely none for all three, MIGRATIONS.md's
history section should say so explicitly for (b) — a reader
reconstructing "which migrations rode which promotion" needs
"none, and here is why" rather than silence.

────────────────────────────────────────────────────────────────
TASK 2 — DEPLOY_LOG entries
────────────────────────────────────────────────────────────────
Write an entry for each promotion in Task 1 that lacks one, in the
file's existing heading format and in the correct position for a
reverse-chronological file. (b) and (c) are the same date but
SEPARATE merges — two entries, not one combined, since the point
of the log is the order and content of promotions.

Each entry names: merge SHA, date, what it carried, any migrations
(or explicitly none), and what was verified in production. For (c)
name the six verifications I ran on staging and re-ran on prod.

────────────────────────────────────────────────────────────────
TASK 3 — meta.note's promotion list
────────────────────────────────────────────────────────────────
It currently reads "Six prod promotions to date", ending at
06b1561 (2026-07-27). Bring it current with the three above.
Also check whether its "Staging and main are LEVEL as of
2026-07-27 at 06b1561" line is still accurate wording now that
they are level at a different SHA. Keep the SQ-2 double-SHA
divergence note and the HR launch date — both still true.

────────────────────────────────────────────────────────────────
TASK 4 — status flips
────────────────────────────────────────────────────────────────
Every row at status: staging whose code is now on main needs a
flip. Establish the list from the file, not from me. I expect it
to include DEBT-1, 2, 3, 5, 7, 8, 17, 21, 22, 24, 25 plus the
sweep's DEBT-4, 6, 11, 15, 20, 26, 31.

THE DISTINCTION MATTERS — WORKFLOW.md's vocabulary:
  shipped  — merged to main, live in prod
  verified — shipped AND smoke-tested against real store data
Flip to `verified` ONLY what I actually exercised in production,
and add a `shipped:` date to each. Everything else goes to
`shipped`. Report which rows you put in which bucket and on what
evidence — if a row's evidence is unclear, put it in `shipped` and
say so rather than promoting it on assumption.

DEBT-1's row carries an explicit instruction — "WHY status:staging
AND NOT verified — READ THIS BEFORE PROMOTING… Flip it after the
promotion, not before." That condition is now met. Quote the
instruction in your report and confirm it is satisfied.

DO NOT TOUCH: DEBT-18 and DEBT-23 (withdrawn — not a promotion
state); DEBT-33 (stays open, partial); DEBT-9, 12, 13, 16, 19,
27-30, 32, 34-37 (open, untouched by any promotion).

────────────────────────────────────────────────────────────────
AUDIT AND PLAN — before any edit
1. DEPLOY_LOG's ordering, established by command, quoted.
2. The three promotions: SHA, date, contents, entry present or
   absent. Plus the migration answer per promotion.
3. The full status-flip list with shipped/verified per row and the
   evidence for each.
4. Anything contradicting this prompt — say so rather than
   reconciling silently.
5. Commit plan. I expect two: DEPLOY_LOG + MIGRATIONS.md, then
   ROADMAP.yaml (meta.note + the flips).

DONE CRITERION
Every production promotion on record has a DEPLOY_LOG entry.
meta.note lists all of them. No row carries status: staging while
its code is on main. Confirm at the end that meta.updated was not
re-added and that the do-not-touch list above is untouched.

REPORT BACK
1. The four audit items, then what was actually committed.
2. Every claim of mine that turned out wrong.
3. Bare build green, chained, no pipes, per commit.
4. The explicit unpushed-commits line — I run all pushes.
