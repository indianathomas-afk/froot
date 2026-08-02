# PERM-7c — Close Task 7 on unreachability

NEW SESSION — PERM-7c: close Task 7 on the ground that the override
is unreachable, not merely untested. ROADMAP.yaml only. No code, no
schema, no migrations, no env changes. NO DATABASE ACCESS — I ran
every query; the results are below.

Save this prompt to docs/prompts/PERM-7c_task7_closure.md before
starting any work. If a file already exists at that path, do NOT
overwrite it — read it, report what it contains, and ask me where
this goes.

Read before doing anything: docs/ROADMAP.yaml row PERM-7 IN FULL,
especially Task 7's blocker; docs/prompts/PERM-7b_task7_name_
derivation.md (the audit that preceded this); PERM-6; DEBT-19;
DEBT-17; DECISIONS.md 2026-07-28 (the "not trusting the sign-up
form" ruling); CLAUDE.md § Database Evidence.

WHAT HAPPENED, 2026-08-01 evening. Three runs on staging, branch
preview/staging (neon_branch_id br-square-feather-a63z92vz, org
census 9), org cmr54z65v000105jxczpt72w1, all via /stores → Carson
→ Create device login, role STORE, one store:

RUN 1 — indianathomas+store@gmail.com. Username/password sign-up.
  User.name = "#0034 — Carson". n_assignments 1, is_default_store
  true, surviving_pending_invite 0.
RUN 2 — indianathomas+store2@gmail.com. Username/password sign-up,
  username "kevacarson2026". Same result, identical fields.
RUN 3 — indianathomas+store3@gmail.com. Attempted Google OAuth
  specifically to obtain a non-null first/last name. Clerk routed
  through Google, then returned to a Froot sign-up card asking for
  a USERNAME and nothing else. No name was ever collected.

THE FINDING, and it supersedes the blocker's framing. Task 7's
blocker says the override is "a test-design requirement, NOT a
structural impossibility", on the evidence that first_name/
last_name are ENABLED on both Clerk instances (verified 2026-07-28
via Frontend API GET /v1/environment). That inference does not
hold. ENABLED means OPTIONAL, and Clerk's sign-up flow renders only
REQUIRED fields. Observed three times, including through OAuth:
the flow presents username and password only. So no name is ever
collected, [first_name, last_name].join(" ") is always null, and
deviceName ?? (…) never has a competing value to beat.

THEREFORE the override is UNREACHABLE THROUGH THE PRODUCT AS
CONFIGURED, not merely untested. The hazard the ruling defends
against — a person's name landing on a shared store-device account
— cannot occur by this path. That is a stronger result than a
passing override test, and it is why this row closes.

RE-VERIFY BEFORE WRITING, do not take my word:
(a) route.ts's deviceName expression and the ?? precedence at HEAD,
    with file:line. Confirm the derivation is create-branch only
    and that update never writes name.
(b) The blocker's exact wording, quoted, including its recording
    rule ("fill verified, override UNTESTED" / never "Task 7
    verified"). My closure is a THIRD outcome that rule does not
    contemplate — say so explicitly rather than forcing my result
    into one of its two buckets.
(c) Whether anything in the repo asserts first/last are collected.

TASKS
1. Close Task 7's blocker in house style — original text preserved,
   nothing deleted. Record: the three runs with their branch and
   org by ID, the derivation confirmed three times including the
   numbered-store form (#0034 — Carson) executing for the first
   time anywhere, and the unreachability finding as the GROUND of
   closure.
2. State the REOPENING CONDITION prominently: if first_name/
   last_name are ever made REQUIRED in Clerk, or a sign-up path is
   added that collects a name, the override becomes reachable and
   untested and this row's closure no longer holds. Name it as a
   trigger a future reader can check.
3. Correct the blocker's "enabled ⇒ testable" inference in place,
   marked as a correction rather than an edit. The reasoning error
   — reading ENABLED as RENDERED — is the durable lesson and is
   worth more than the result.
4. Close PERM-6's "nobody checked that these are the same org"
   line: org_id cmr54z65v000105jxczpt72w1 ↔ clerk_org_id
   org_3G02wO4QlVVSWppi8aqlnSZnsDa, same org, confirmed by query.
   AND the character is a ZERO — org_3G**0**2wO… — where the row
   transcribes a letter O. My transcription was wrong; record the
   correction and that DEBT-19 is why identifying by name is unsafe
   here.
5. FILE DEBT-39 for the name race (verify the id is unused), per
   the ruling I gave PERM-7b and never got applied because that
   session stopped at part one. src/app/(app)/users/page.tsx:84
   writes User.name from Clerk first/last with NO deviceName
   derivation, and the webhook's update branch never writes name —
   so if the page wins the acceptance-time race, Task 7 is skipped
   permanently and silently. DEBT-17's fix mirrored ROLE between
   the two writers and left NAME unmirrored. Note it is currently
   masked by the same unreachability above — no name is collected,
   so there is nothing for the page to write — and that the two
   findings share one root cause and one reopening condition.
6. Record the branch-identity improvement as a convention note
   wherever CLAUDE.md § Database Evidence is referenced from the
   roadmap: current_setting('neon.branch_id', true) returns a real
   value on Neon (br-square-feather-a63z92vz), so a query can carry
   machine-verifiable branch identity instead of an asserted
   literal. Do NOT edit CLAUDE.md this session — recommend it and
   let me rule.

STATUS: PERM-7 stays `shipped`. Staging evidence is not production
evidence — DOCS-3 set that precedent today.

DO NOT write "closes the pair". PERM-6's uncovered items remain:
the rejecting branch, Task 1 (POST /api/staff), and the STAFF role.
Name what stays open.

STANDING RULES
- Treat every claim here as UNVERIFIED where checkable in the repo.
  The staging observations are mine — take those.
- Audit first, plan, wait for my approval, then edit. Commit only
  when I say so. Never push.
- Gate: docs-only, eslint skipped. Bare npm run build, chained,
  redirect not pipe.
- meta.updated is gone (DEBT-24, final).

REPORT BACK
1. (a)(b)(c) re-verified, drift called out.
2. The exact edits quoted, per row.
3. DEBT-39's id confirmed unused; open debt 16 → 17.
4. Your recommendation on the CLAUDE.md branch-identity note.
5. Bare build green, chained, no pipes.
6. The unpushed-commits line — I run all pushes.
