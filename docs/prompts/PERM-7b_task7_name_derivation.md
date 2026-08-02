# PERM-7b — close Task 7's name-derivation blocker

NEW SESSION — PERM-7b: close Task 7's name-derivation blocker.
AUDIT AND QUERY ONLY in part one. No code, no schema, no
migrations, no env changes. NO DATABASE ACCESS of any kind — you
WRITE the query, I RUN it in the Neon console, per CLAUDE.md
§ Database Evidence.

Save this prompt to docs/prompts/PERM-7b_task7_name_derivation.md
before starting any work. If a file already exists at that path, do
NOT overwrite it — read it, report what it contains, and ask me
where this goes.

Read before doing anything: docs/ROADMAP.yaml row PERM-7 IN FULL,
especially Task 7 and its blocker, plus everything DOCS-2 and
DOCS-3 added today; row PERM-6 (single promotion unit); DEBT-19
(nine staging orgs, five named "Microsoft"); DEBT-17; CLAUDE.md
§ Database Evidence; docs/WORKFLOW.md § Session completion rules.

WHY THIS SESSION EXISTS. PERM-7 is `shipped` and running in
production since 746c1be (2026-07-29). Its Task 7 blocker is the
LAST open item across the PERM-6/PERM-7 pair — DOCS-3 cleared the
invite gate on 2026-08-01 with a MANAGER invite, but that run could
not exercise Task 7 because the role was MANAGER, not STORE. This
session closes the pair.

THE THING BEING TESTED, in one line: when a STORE-role invitee
signs up, User.name must be DERIVED FROM THE STORE and must
OVERRIDE any name the person typed at sign-up.

────────────────────────────────────────────────────────────────
PART ONE — audit and write the query. Report back and STOP.
────────────────────────────────────────────────────────────────
1. Quote Task 7's blocker verbatim as it stands at HEAD, and the
   pass/fail criteria the row itself specifies. Where this prompt
   and the row disagree, the ROW WINS and you report it.

2. Re-verify the derivation code at HEAD — the exact file:line
   that writes User.name on the STORE path, and the precedence
   between the derived name and a typed first/last name. Report
   drift from whatever the row cites. State plainly whether the
   code as written overrides or merely fills a blank; that is the
   whole question, and reading it now sets the expectation the
   query then confirms or refutes.

3. THE VERIFICATION TRAP, already established — carry it forward
   rather than rediscovering it. /users CANNOT verify this. That
   table's Name column reads the staff profile or Clerk's
   first/last name, never User.name (users/page.tsx:132 — verify
   the line). A green-looking /users page would prove nothing.
   State this in your report and on the row.

4. WRITE THE QUERY for me to run in the Neon console against
   branch preview/staging. Requirements:
   - reads only, no mutation of any kind
   - selects User.name alongside the identifying columns needed to
     recognise the row (email, role, organizationId, createdAt) and
     whatever store linkage makes the expected value checkable
   - returns the STORE-role account created by the run below, and
     enough context that a wrong answer is legible as wrong
   - self-labelling: the result must make its own branch and org
     unambiguous when I paste it back, per DEBT-19 — five staging
     orgs answer to "Microsoft", so identify the org BY ID
   Give me the SQL in a single copyable block, and say in one line
   what PASS looks like and what FAIL looks like in that output.

5. WRITE MY RUN SHEET — the exact steps for the invite, in order,
   including anything the row specifies that this prompt omits.
   What I already know and you should confirm rather than restate:
   - invite role STORE with EXACTLY ONE store
   - use a FRESH address: indianathomas+store@gmail.com.
     indianathomas@gmail.com is now a member from the 2026-08-01
     run and would hit the 409 instead
   - at sign-up I must DELIBERATELY TYPE a first and last name —
     a person's name, the shape the convention exists to prevent.
     The dev instance requires username and merely ENABLES
     first/last, so typing nothing leaves the name blank and the
     derivation would fill a hole rather than override one. Filling
     a hole is NOT a pass.
   - Clerk dev-instance mail lands in Gmail's Junk folder
   Tell me which store to pick and why, if it matters.

6. Report anything contradicting the row or this prompt.

STOP AFTER PART ONE. Do not edit ROADMAP.yaml yet. I will run the
invite and the query and paste the result back.

────────────────────────────────────────────────────────────────
PART TWO — after I paste the result
────────────────────────────────────────────────────────────────
On PASS: clear Task 7's blocker in house style — preserve the
original text, record the run, the branch, the org by ID, the
typed name, and the derived value. Note explicitly that this
closes the LAST open item on the PERM-6/PERM-7 pair, and that
PERM-6's rejecting branch remains untested-but-unreachable (not a
defect, not this blocker).

On FAIL: change nothing but the record. Write what was observed,
what was expected, and file the defect as its own row at the next
free DEBT id (verify unused). Do NOT fix it in this session — a
production defect on shipped code gets its own scoped session with
its own audit.

Statuses: PERM-7 stays `shipped` either way unless I say
otherwise. Staging evidence is not production evidence — DOCS-3
established that precedent today and it holds here.

STANDING RULES
- Treat every claim in this prompt as UNVERIFIED against HEAD.
- NO DATABASE ACCESS, any branch. You write SQL; I run it.
- Audit first, wait for my approval before any edit. Commit only
  when I say so. Never push.
- Gate: docs-only, eslint skipped. Bare npm run build, chained,
  redirect not pipe, per CLAUDE.md § Commit Gates.
- meta.updated is gone (DEBT-24, final).

REPORT BACK, part one
1. Task 7's blocker verbatim, and the row's own pass/fail.
2. The derivation code at HEAD with drift called out, and your
   read on override-vs-fill BEFORE I run anything.
3. The /users trap confirmed at file:line.
4. The SQL, copyable, with PASS/FAIL stated in one line.
5. My run sheet.
6. Contradictions.
