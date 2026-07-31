NEW SESSION — DEBT-1a: AUDIT ONLY. operationalPhase string
inconsistency ("During the Day" vs "During Hours"). This session
LOOKS and REPORTS. It mutates nothing — no UPDATE, no INSERT, no
DELETE, no DDL, no schema edits, anywhere, on any branch, period.
Remediation is DEBT-1b, a separate session gated on this one's
findings. DEBT-2 (sectionName vs section) is NOT this session — do
not audit it, do not contradict its row.

Save this prompt to docs/prompts/DEBT-1a_operationalPhase_audit.md
before starting any work. If a file already exists at that path, do
NOT overwrite it — read it, report what it contains, and ask me
where this goes.

Read before doing anything: docs/ROADMAP.yaml rows DEBT-1 and DEBT-2;
CLAUDE.md (especially § Database Evidence); docs/MIGRATIONS.md
(especially "Which branch am I actually reading?"). This message is
the task order.

STANDING RULES
- Treat this prompt's claims AND the row's claims as UNVERIFIED.
  The row says I-14b made "During the Day" canonical with a legacy
  alias, and that at least one live row still carries "During
  Hours". Verify both against the current checkout and live data —
  do not inherit them.
- DATABASE PROTOCOL for this session:
  * Every database result you cite must name its Neon branch on the
    same line. A result without a named branch does not count.
  * You may query the DEV branch directly (local .env,
    ep-late-water-a6k53nv2) — SELECT only.
  * You have NO connection string for staging or production and must
    not obtain one — no `vercel env pull`, no asking me to paste
    URLs. For those branches, WRITE the exact SQL, hand it to me,
    and I will run it in the Neon SQL editor per branch and paste
    results back. Label each query with its target branch.
  * dev is a SNAPSHOT branched from production at BUILD-1 time, not
    a mirror. A clean dev result is NOT evidence about production
    today. Production's answer comes only from production.
- Before writing down any causal explanation, state what evidence
  would disconfirm it.
- The ONLY files you may modify: docs/DEBT-1_AUDIT.md (the
  deliverable, new file), docs/ROADMAP.yaml (one note on the DEBT-1
  row — see done criterion), and the prompt file save above. No
  src/, no prisma/, nothing else. Findings about other problems go
  in the report as text.
- Audit, plan, wait for my approval before writing the deliverable.
  Commit only when I say so. Never push.
- Chain build and commit as ONE command — `npm run build && git
  commit ...`.
- `meta.updated` no longer exists (DEBT-24, final). Do not re-add.

────────────────────────────────────────────────────────────────
QUESTION 1 — CODE: who touches operationalPhase, and how?
────────────────────────────────────────────────────────────────
Enumerate EVERY site in src/ (and prisma/schema.prisma, seeds,
scripts/ if any) that reads, writes, compares, sorts, filters, or
displays operationalPhase. For each site, classify:

  (a) Goes through the I-14b canonical/alias path — safe.
  (b) Compares, sorts, groups, or filters on the RAW string without
      the alias — these are the live bug surfaces. For each, say
      what a "During Hours" row does wrong there in user-visible
      terms (wrong sort bucket, missing from a filter, etc.).
  (c) WRITES the field. This is the question the whole session
      exists to answer: CAN ANYTHING STILL WRITE "During Hours"
      TODAY — a form default, a template, a seed, an import path, an
      API route, a hardcoded string? If yes, the tap is still
      running and DEBT-1b must plug it before any backfill. If no,
      say what closed it and when (commit), so the claim is checkable.

Also locate the I-14b alias itself — file:line, exact mapping, and
whether anything else depends on it.

────────────────────────────────────────────────────────────────
QUESTION 2 — DATA: how dirty is it, exactly, per branch?
────────────────────────────────────────────────────────────────
First, from the schema and code: which tables/columns actually carry
operationalPhase values (the column itself, plus any JSON blobs,
template definitions, or denormalized copies — do not assume it
lives in exactly one place; verify).

Then, for EVERY such location, on EVERY branch (dev directly;
staging and production via me):

  SELECT <column>, COUNT(*) ... GROUP BY <column> — every distinct
  value with its count, including NULLs. We are looking for "During
  Hours" counts AND any third variant nobody knows about
  (whitespace, casing, typos included — make the query surface
  those, not mask them).

For every dirty row population found: which table, which branch, how
many, and — if cheaply visible — roughly when created (createdAt
range), because that bears on whether the writer is plugged.

────────────────────────────────────────────────────────────────
DELIVERABLE — docs/DEBT-1_AUDIT.md
────────────────────────────────────────────────────────────────
A committed file, not just a chat report, because DEBT-1b will be a
fresh session that reads it cold. It must contain:
  1. The writer verdict (Question 1c) stated first and plainly:
     "the tap is running" or "the tap is closed since <commit>",
     with evidence either way and what would disconfirm it.
  2. The code-site table: every site, classification a/b/c,
     file:line.
  3. The data table: every location × branch × distinct value ×
     count, each row naming its branch. Unknowns marked as unknowns
     — if I haven't run a query yet, the cell says PENDING, not a
     guess.
  4. Any third variant found, called out loudly.
  5. A recommendation block for DEBT-1b: what to plug, what to
     backfill, in what order, and whether the I-14b alias can ever
     be retired. Recommend, don't just ask.

────────────────────────────────────────────────────────────────
AUDIT AND PLAN — what I want back before the deliverable is written
1. The code-site enumeration (Question 1) in full.
2. The list of tables/columns holding phase values, with evidence.
3. The dev-branch query results, branch named.
4. The exact SQL for me to run on staging and production, labeled
   per branch, SELECT-only, ready to paste.
5. Anything in this prompt or the row that contradicts the repo —
   say so rather than reconciling it silently.
6. Commit plan for the deliverable + the ROADMAP note.

DONE CRITERION
DEBT-1 stays OPEN — an audit does not close it. The row gains a note
(above its original text, house marker style) that the audit landed,
pointing at docs/DEBT-1_AUDIT.md, with the audit commit's SHA quoted
per convention. No status change to a landed value. Confirm at the
end that DEBT-1 is still on the open list and that DEBT-2 is
untouched.

REPORT BACK
1. The six audit items, then what was actually committed.
2. Every file:line or row claim that had drifted, with the real
   location or fact.
3. Explicit confirmation: ZERO mutations were executed on any
   branch, and the session possessed no staging or production
   connection string at any point.
4. `next build` green, chained with each commit as one command.
5. The explicit unpushed-commits line — I run all pushes.
