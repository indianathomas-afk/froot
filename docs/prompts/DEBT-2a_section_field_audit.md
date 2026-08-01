NEW SESSION — DEBT-2a: AUDIT ONLY. sectionName vs section field
ambiguity. This session LOOKS and REPORTS. It mutates nothing — no
UPDATE, no INSERT, no DELETE, no DDL, no schema edits, anywhere, on
any branch, period. Remediation is DEBT-2b, a separate session whose
prompt will be written AFTER this audit reports, because unlike
DEBT-1 the shape of the fix is not yet known. DEBT-1 is closed at
status: staging (c17ccc1, c01a2b1, bb1f578) — do not re-open it, and
do not contradict its rows or DEBT-30/32/33.

Save this prompt to docs/prompts/DEBT-2a_section_field_audit.md
before starting any work. If a file already exists at that path, do
NOT overwrite it — read it, report what it contains, and ask me
where this goes.

Read before doing anything: docs/ROADMAP.yaml row DEBT-2 (its notes
are one line — the row itself doesn't yet know what the ambiguity
is, which is part of why this audit exists); docs/DEBT-1_AUDIT.md in
full — it is the template this audit follows and its method-and-
limits section is binding here too; CLAUDE.md (§ Database Evidence);
docs/MIGRATIONS.md ("Which branch am I actually reading?").

STANDING RULES — the DEBT-1 set, plus what it taught us
- Treat this prompt's claims AND the row's claims as UNVERIFIED.
- DATABASE PROTOCOL:
  * Every result names its Neon branch on the same line.
  * DEV branch only, directly (local .env, ep-late-water-a6k53nv2),
    SELECT only.
  * NO staging or production connection string — not obtained, not
    requested, not on disk. Staging/production SQL is written by
    you, labeled per branch, run by me in the Neon console.
  * Every branch's query block begins with the Q0 identity query
    (current_database + neon.endpoint_id + neon.branch_id) and its
    expected endpoint. Results that arrive without identity output
    do not count.
  * dev is a snapshot from production at BUILD-1 time — but note
    DEBT-31: MIGRATIONS.md's "separately seeded" claim about staging
    is disproven for Template. Assume nothing about per-table
    lineage; measure per branch.
  * Expensive schema-wide sweeps (the query_to_xml pattern): staging
    only, never production, per the DEBT-1 precedent.
- Before writing down any causal explanation, state what evidence
  would disconfirm it.
- Unmeasured is not zero: any cell I haven't run yet says PENDING;
  a query returning nothing is recorded as "0 rows". Expected
  values are never written as measured values.
- Files you may modify: docs/DEBT-2_AUDIT.md (new, the deliverable),
  docs/ROADMAP.yaml (one note on the DEBT-2 row), and the prompt
  save above. No src/, no prisma/. Other findings go in the report
  as text.
- Audit, plan, my approval before the deliverable is written.
  Commit only when I say so. Never push.
- Build gate: bare `npm run build` chained with the commit as ONE
  command, NO PIPES anywhere in the chain. `npm run lint` is red at
  baseline (DEBT-33) — do not put bare lint in any gate; scoped
  eslint over touched files only, if code were in scope (it isn't
  this session).
- `meta.updated` is gone (DEBT-24, final).

────────────────────────────────────────────────────────────────
QUESTION 0 — WHAT IS THE AMBIGUITY, PRECISELY?
────────────────────────────────────────────────────────────────
DEBT-1 started with a known bad string. DEBT-2 starts with a one-
line row, so the first job is characterization, not counting.
Establish from schema + code, with file:line evidence:

  (a) Where does each identifier exist? `section`, `sectionName`,
      and any siblings (`task_section` appears in the CSV import
      column list — trace it). Which Prisma models carry which
      field, and what does each actually hold?
  (b) Are these two names for ONE piece of data (a rename that
      never finished, a denormalized copy, an API field mapped to a
      different DB column), or two genuinely different things that
      are confusingly named? The remediation for those two cases is
      completely different, so this distinction is the audit's
      center of gravity.
  (c) Is there a join/lookup relationship (e.g. a Section entity
      with names, referenced by id, PLUS a free-text field) — and
      if so, can the two disagree for the same row?

────────────────────────────────────────────────────────────────
QUESTION 1 — CODE: who reads/writes which, and where can they skew?
────────────────────────────────────────────────────────────────
Enumerate every site in src/, scripts/, prisma/ that reads, writes,
compares, groups, sorts, displays, imports, or exports either
field. Classify each:
  (a) touches one field only, coherently
  (b) maps or copies between the two — these are the skew factories
      if the mapping is conditional, lossy, or absent on some path
  (c) WRITES either field — the tap question again: enumerate every
      write path and whether each can produce a value inconsistent
      with the other field / the canonical source. The CSV import
      and export, Duplicate, and the seed script were DEBT-1's six;
      check the same doors here plus any section-specific ones.

────────────────────────────────────────────────────────────────
QUESTION 2 — DATA: does the ambiguity exist in live rows?
────────────────────────────────────────────────────────────────
Shaped by Question 0's answer, but at minimum, for every carrier
table/column found, on every branch (dev direct; staging and
production via me):
  - distinct values with counts (bracketed, length included, NULLs
    shown — the DEBT-1 query shape, so whitespace/casing drift
    surfaces)
  - if Q0 found a pair that can disagree: a query that counts rows
    where they DO disagree, with a sample of disagreeing rows
  - near-duplicate section names that differ only by case or
    whitespace (the classic free-text drift), per branch
If Question 0 concludes the fields cannot disagree by construction,
say so with the evidence and mark the disagreement queries N/A
rather than running theater.

────────────────────────────────────────────────────────────────
DELIVERABLE — docs/DEBT-2_AUDIT.md
────────────────────────────────────────────────────────────────
Same skeleton as DEBT-1's, which worked:
  1. The characterization verdict first and plainly: what the
     ambiguity actually is, in one paragraph a reader can act on.
  2. Blast radius: what a skewed/drifted row causes in user-visible
     terms — and if the answer is "nothing, the field is inert",
     say that plainly (DEBT-1's §0 precedent).
  3. The code-site table, classified, file:line.
  4. The data tables, per branch, branch-named, PENDING/0-rows
     discipline throughout.
  5. The writer verdict for every write path.
  6. Recommendation block for DEBT-2b: the fix shape, order of
     operations, whether data remediation is needed at all — and if
     the honest answer is "this is a rename/refactor, not a data
     cleanup" or "no action worth taking, close with a note", say
     so. Recommend, don't just ask. Name what a durable fix needs
     (constraint? consolidation?) and what's out of 2b's likely
     scope, per the DEBT-30 precedent.

────────────────────────────────────────────────────────────────
AUDIT AND PLAN — before the deliverable is written
1. The Question 0 characterization, with evidence.
2. The code-site enumeration in full.
3. Carrier tables/columns, with evidence.
4. Dev-branch results, branch-named, identity first.
5. The exact SQL for staging and production, labeled per branch,
   SELECT-only, Q0 first in each block, expected endpoints stated.
6. Anything contradicting the repo or the rows — say so.
7. Commit plan: deliverable commit, then ROADMAP note commit.

DONE CRITERION
DEBT-2 stays OPEN — audits don't close rows. The row gains a note
above its original text (house marker style) pointing at
docs/DEBT-2_AUDIT.md with the audit commit's SHA quoted. New
findings that deserve tracking become rows (next free is DEBT-34;
BUG numbers continue from BUG-5) — logged as text, never fixed
inline. Confirm DEBT-2 is still open, DEBT-1 untouched, and no row
touched this session has a landed status without commits.

REPORT BACK
1. The seven audit items, then what was actually committed.
2. Every claim that had drifted, with the real fact.
3. Explicit confirmation: ZERO mutations on any branch; no staging
   or production connection string possessed at any point.
4. Build green, chained bare, no pipes.
5. The explicit unpushed-commits line — I run all pushes.
