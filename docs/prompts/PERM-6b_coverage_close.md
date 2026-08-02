# PERM-6b — Coverage Close (session prompt)

Saved 2026-08-01. Verbatim prompt as issued.

---

NEW SESSION — PERM-6b: establish what "the STAFF role is still
unexercised" actually requires, then tell me the reachable path for
each of PERM-6's three uncovered items. AUDIT ONLY in part one. No
edits, no code, no schema, NO DATABASE ACCESS — you write queries,
I run them in the Neon console.

Save this prompt to docs/prompts/PERM-6b_coverage_close.md before
starting any work. If a file already exists at that path, do NOT
overwrite it — read it, report what it contains, and ask me where
this goes.

Read before doing anything: docs/ROADMAP.yaml PERM-6 blockers entry
(1), "WHAT THE CLEARED GATE DOES NOT COVER", IN FULL; PERM-6's task
list; PERM-7; DEBT-17; DEBT-41 (the half-closed vocabulary row filed
by P-4); CLAUDE.md § Database Evidence.

CONTEXT — two UI facts established by hand tonight, staging:
- /users → Invite User offers ADMIN, MANAGER, STORE only. There is
  NO Staff option. So STAFF cannot be reached by inviting.
- /users → Edit User DOES offer Staff, labelled "Personal HR access
  only — requires a linked staff profile". Tommy Thomas
  (corporate@keva.com) currently sits at STAFF with two locations,
  and an earlier query confirmed role STAFF, n_assignments 2.

TASK — for each of entry (1)'s three uncovered items, tell me the
REACHABLE PATH, or that there isn't one:

A. THE STAFF ROLE. What does the entry mean by unexercised — a
   STAFF user provisioned through a PERM-6-hardened write path, or
   something narrower? Which route sets role STAFF at HEAD
   (file:line), and is it in PERM-6's changed set? Then: is Tommy
   Thomas's existing STAFF row evidence that this ALREADY ran, or
   does it predate the phase? Give me a query to settle it — his
   User row's provenance against PERM-6's commit dates. If it
   already ran, say so; the item may be closeable on the record
   rather than by another test.

B. TASK 1 — POST /api/staff. Confirm the route and what PERM-6
   hardened in it. Give me the exact UI steps and the query that
   proves the write landed through the hardened path.

C. THE REJECTING BRANCH. `owned.length !== pending.storeIds.length`.
   Confirm the condition and file:line at HEAD. I proposed deleting
   a store between invite and acceptance. Assess that: does a
   deleted store actually produce the mismatch, or does a cascade /
   FK make the storeId vanish some other way first? If it works,
   give me the steps and the query that proves the branch RAN
   (filtered, warned) rather than the invite simply failing. If it
   does not work, say so and give me the alternative.
   NOTE: "Default Test Account" is a store on staging with no store
   number — verify it is safe to delete (no Square link, no sales
   data, nothing depending on it) before recommending it.

D. Say plainly whether closing all three would let PERM-6 and
   PERM-7 flip to `verified`, or whether staging evidence keeps
   them at `shipped` per the DOCS-3 precedent. My read is the
   latter — argue if you disagree.

STOP AFTER PART ONE. Report, wait for my approval, then we run it.

STANDING RULES
- Treat every claim here as UNVERIFIED at HEAD.
- NO DATABASE ACCESS. You write SQL; I run it. Every query
  self-labels its branch per the new CLAUDE.md convention — select
  neon.branch_id AND name the branch.
- Never push.
