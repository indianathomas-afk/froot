# DEBT-44a — Staging cleanup: Organization shells + two loose ends

Session prompt, verbatim as given 2026-08-02.

---

NEW SESSION — DEBT-44a: clear the staging Organization shells and
settle two loose ends. AUDIT AND WRITE QUERIES ONLY in part one.
No edits until I rule. NO DATABASE ACCESS — you write SQL, I run it
in the Neon console per CLAUDE.md § Database Evidence.

Save this prompt to docs/prompts/DEBT-44a_staging_cleanup.md before
starting any work. If a file already exists at that path, do NOT
overwrite it — read it, report what it contains, and ask me where
this goes.

Read before doing anything: rows DEBT-44 and DEBT-19 IN FULL
(DEBT-19 is closed — its cleanup half was absorbed into DEBT-44);
PERM-7 in full, especially anything stating the one-store-per-
device-login premise; CLAUDE.md § Database Evidence and § Staging
Verification; prisma/schema.prisma for every FK pointing at
Organization.

WHAT IS ALREADY DONE, 2026-08-02, by me and by hand — verify at the
database rather than taking it:
- The Taylin@keva.com ADMIN PendingInvite is gone from /users.
- StaffMember "PERM-6b Staff" (cmsbe40q9000104l7fm3t6bp4) is gone
  from /staff.
- The User indianathomas+staff@gmail.com
  (cmsbeaqn3000504l7uy2dd3wl) is gone from /users.
- The Clerk user perm-6-staff is gone from the Clerk dashboard.
- The three PERM-7 device logins (+store, +store2, +store3) are
  absent from both /users and Clerk.
All four observations are UI-level. Item 1 below confirms them at
the database, because absence from a page is not absence from a
table.

────────────────────────────────────────────────────────────────
PART ONE — three queries for me to run
────────────────────────────────────────────────────────────────
Every query self-labels: select current_setting('neon.branch_id',
true) AND assert 'preview/staging', per the 2026-08-01 ruling.
Identify orgs BY ID, never by name — DEBT-19's whole point.

QUERY 1 — CONFIRM THE FIXTURES ARE ACTUALLY GONE.
Look for the named ids above and for anything else the PERM-6c and
PERM-7 runs left: StaffMember, User, StoreUserAssignment,
StoreStaffAssignment, PendingInvite. Report what a clean result
looks like and what a surviving orphan would look like. If the User
row is gone but its assignments are not, I want to see that.

QUERY 2 — THE ORGANIZATION SHELLS, and this is the one that needs
care. DEBT-19 recorded nine orgs on preview/staging: five named
"Microsoft", two "Keva Juice", one "Keva Smoothie Company", one
"My Organization". One has Square connected
(cmr54z65v000105jxczpt72w1, 4 users) — that is the live one and it
is NOT a candidate. Six had zero or one user.
DO NOT GIVE ME A DELETE STATEMENT YET. Give me an inventory query
that, for EVERY org on the branch, returns: id, name, clerkOrgId,
whether Square is connected, and a count for every table with an FK
to Organization — so a shell is provably empty rather than
apparently empty. Enumerate those FKs from the schema; do not
hand-list from memory.
Then tell me the DELETE SHAPE you would propose once I paste the
inventory back, including whether the FKs cascade or restrict, and
what happens to the CLERK side of an org whose DB row is deleted —
DEBT-44's own lesson is that a DB row removed while its Clerk
identity survives is a trap, and that lesson applies to orgs as
well as users.

QUERY 3 — THE LOOSE END NOBODY FOLLOWED UP.
gary@keva.com is role STORE with THREE store assignments (Las
Brisas, Carson, Meadowood Mall) in the org PERM-7 was tested in.
PERM-6b flagged this and it was never resolved. Establish from the
code first: does anything in the product actually REQUIRE a STORE
account to have exactly one store, or is one-store a convention of
the device-login DIALOG only (create-device-login-button.tsx
hardcodes storeIds: [store.id])? Quote the file:line. Then give me
a query for every STORE-role User on the branch with an assignment
count, so I can see whether this is one row or a pattern.
Say plainly which it is: a data problem, or a premise that was
never true.

────────────────────────────────────────────────────────────────
PART TWO — after I paste the results
────────────────────────────────────────────────────────────────
Propose the DELETE SQL for my approval, statement by statement, by
ID. I run it. Then record on DEBT-44: what was deleted, what
survived, the branch and org ids, and whether the row closes.
Query 3's finding gets recorded wherever it belongs — a new row, or
a line on PERM-7 — your recommendation, my ruling.

STANDING RULES
- Treat every claim here as UNVERIFIED at HEAD.
- NO DATABASE ACCESS, any branch. You write SQL; I run it.
- No code changes this session. No schema changes.
- Audit first, report, WAIT. Commit only when I say so. Never push.
- Gate: docs-only, eslint skipped. Bare npm run build, chained,
  redirect not pipe.
- meta.updated is gone (DEBT-24, final).

REPORT BACK, part one
1. The three queries, copyable, each self-labelling its branch.
2. The full FK inventory for Organization, from the schema, with
   each one's onDelete rule.
3. Query 3's code finding — required, or dialog convention only —
   with file:line.
4. Anything contradicting this prompt or the rows.
