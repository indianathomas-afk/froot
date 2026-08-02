# DEBT-TRIAGE — records vs tasks

NEW SESSION — DEBT-TRIAGE: separate the debt list's TASKS from its
RECORDS, and relocate the records to where a reader will hit them.
AUDIT AND RECOMMEND ONLY in part one. No edits until I rule row by
row. ROADMAP.yaml and docs only when part two comes. NO DATABASE
ACCESS.

Save this prompt to docs/prompts/DEBT-TRIAGE_records_vs_tasks.md
before starting any work. If a file already exists at that path, do
NOT overwrite it — read it, report what it contains, and ask me
where this goes.

Read before doing anything: every OPEN debt row in docs/ROADMAP.yaml
IN FULL — I expect DEBT-9, 12, 13, 16, 19, 27, 28, 29, 30, 32, 33,
34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, but establish the real
list rather than trusting mine; CLAUDE.md in full; docs/MIGRATIONS.md;
docs/WORKFLOW.md; docs/DECISIONS.md; docs/PERMISSIONS_INVENTORY.md.

THE PROBLEM, stated as mine rather than as a defect in the rows.
The standing rule "anything found and not fixed gets a row" is
correct and has earned its place — it is why a two-writer race and a
never-rendering CSS class got caught rather than lost. But it has no
second tier, so a FINDING and a TASK land in the same list under one
heading, and the list reads as a backlog it is not. The count grows
faster than work completes, which reads as being blocked when mostly
it is being well-documented. I want the list to mean something again.

THE DISTINCTION I want you to apply, and argue with if it is wrong:
- A TASK is a row where someone will one day change code, data or
  configuration, and the row is the instruction. It belongs in the
  debt list.
- A RECORD is a row whose value is entirely that a future reader
  KNOWS something — a hazard, a convention, a measured fact, a
  constraint. Nothing will be "done". It belongs wherever the
  person who needs it will actually be standing: CLAUDE.md,
  MIGRATIONS.md, DECISIONS.md, PERMISSIONS_INVENTORY.md, or a
  code comment. Relocating it CLOSES the row honestly — the
  knowledge is not lost, it is filed where it fires.
- Some rows are BOTH. Say so, and say what splits off.

TASK — for EVERY open row, one entry, in this shape:
1. TASK / RECORD / BOTH / LEAVE.
2. If RECORD or BOTH: exactly WHERE it should live, and WHY that
   is the place a reader hits it at the moment it matters. Be
   concrete — the file and the section, not "the docs".
3. If TASK: is it standalone, or does it belong folded into another
   row? Several rows already say this about themselves (DEBT-28
   says fold into DEBT-27; DEBT-30 and DEBT-32 are both gated on
   DEBT-1 being verified). Honour what the rows say rather than
   re-deciding it.
4. If LEAVE: why it is neither — a product decision awaiting my
   ruling, or work deliberately deferred.
5. One line on the COST OF DOING NOTHING. This is the field I most
   want and the one the rows are worst at: what actually happens,
   to whom, if this is never touched. "Nothing observable" is a
   legitimate and useful answer — say it where it is true.

MY OWN PRIOR, offered so you can disagree with evidence rather than
guess at what I want:
- DEBT-19's naming convention reads to me like CLAUDE.md, with the
  dead staging orgs as a separate small cleanup task.
- DEBT-35 reads like a precondition on MIGRATIONS.md §2, where the
  baseline squash is described — that is the only operation it
  bites, and §2 is where someone stands before doing it.
- DEBT-34's guard is either a real pre-commit check (task) or a
  line in CLAUDE.md § Environment Variables (record). Not both.
- DEBT-13 is the only row I can see with a live user cost today.
  Tell me if I am wrong about that — it is the most important thing
  in this audit and I would rather be corrected than agreed with.
- DEBT-29 and DEBT-36 are product decisions waiting on me, not
  debt. LEAVE, and say so plainly so they stop reading as backlog.

ALSO ESTABLISH, since it bears on whether this is worth doing:
- The real open count at HEAD, and how many of them were filed in
  the last 48 hours. If the growth rate is what I think it is, say
  so with numbers.
- Whether any open row is ALREADY SATISFIED and nobody closed it.
  DEBT-34's file is deleted; check for others. A row describing
  work already done is the worst kind of noise.
- Any row whose evidence has gone stale — a file:line that has
  drifted far enough that the row would mislead.

DO NOT PROPOSE, and report if you find yourself wanting to:
- Deleting any row. Relocation closes; deletion loses.
- A new status value, a severity field, or any schema change to
  DebtItem. DEBT-41 already tracks the missing-vocabulary problem
  and P-4 just did the last type change; I am not doing another
  tonight.
- Fixing anything. This session decides what things ARE.

STANDING RULES
- Treat every claim in this prompt as UNVERIFIED at HEAD.
- Audit first, report, WAIT. I will rule row by row before any
  edit.
- Never push. No commits until I say so.
- Gate when part two comes: docs-only, eslint skipped, bare
  npm run build, chained, redirect not pipe.
- meta.updated is gone (DEBT-24, final).

REPORT BACK, part one
1. The real open list, the count, and the last-48-hours number.
2. The per-row table: verdict, destination, fold-target, cost of
   doing nothing.
3. Already-satisfied rows and stale-evidence rows, called out
   separately — these are the cheapest wins and I want them
   visible, not buried in the table.
4. Where you disagree with my five priors, with evidence.
5. Your recommended ORDER for part two, and how many sessions it
   should take.
