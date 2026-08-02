# PERM-6c — close entry (1)'s three uncovered items

Session prompt, verbatim. 2026-08-01.

---

NEW SESSION — PERM-6c: close entry (1)'s three uncovered items.
ROADMAP.yaml only. No code, no schema, no env changes. NO DATABASE
ACCESS — I ran every query; results below.

Save this prompt to docs/prompts/PERM-6c_coverage_closed.md before
starting any work. If a file already exists at that path, do NOT
overwrite it — read it, report what it contains, and ask me where
this goes.

ALSO: docs/prompts/PERM-6b_coverage_close.md is UNTRACKED from the
prior session. Commit it with this session's work — a prompt file
left untracked is how DEBT-SWEEP's went missing.

Read before doing anything: PERM-6 blockers entry (1) "WHAT THE
CLEARED GATE DOES NOT COVER" IN FULL; PERM-6's notes and NOT
COVERED block; PERM-7; PERM-2's pass (the origin of the STAFF-role
gap); DEBT-41; DEBT-16; CLAUDE.md § Database Evidence.

THE RUN, 2026-08-01 evening, branch preview/staging (neon.branch_id
br-square-feather-a63z92vz, verified by the query itself per the
2026-08-01 convention), org cmr54z65v000105jxczpt72w1 BY ID.

SETUP. Scratch store "PERM-6b" created via /stores (id
cmsbe0giw000004l7e3zhm22n) — deliberately a throwaway rather than
"Default Test Account", on your own analysis that deleting a real
store silently destroys assignments, goals and caches and that
handleDelete swallows failures. Staff member "PERM-6b Staff"
created via /staff → Add Staff Member, email
indianathomas+staff@gmail.com, two stores (Carson + PERM-6b),
primary Carson, fullNameLocked. Then Invite to self-service.

ITEM B — POST /api/staff: exercised by the create above, accepting
path. Record it as accepting-path-only and NON-DISCRIMINATING, per
your own B2 reasoning — the UI cannot construct a duplicate, a
foreign id or an orphan primary, so pre-PERM-6 code produces the
identical result. B-2 and B-3 (the discriminating console calls)
were NOT run. Say so plainly; do not let this read as more than it
is.

ITEM C — THE REJECTING BRANCH, EXECUTED FOR THE FIRST TIME.
Pre-delete snapshot: n_store_ids 2, owned_now 2, stores
{Carson, PERM-6b}. Scratch store deleted via /stores, absence
confirmed by reload. Post-delete snapshot, the armed state:
n_store_ids 2, owned_now 1, stores_still_existing {Carson} — the
stale id remained in the array, confirming your finding that
PendingInvite.storeIds has no FK and nothing cascades it.
Invite accepted. Post-acceptance:
  user_id cmsbeaqn3000504l7uy2dd3wl
  role STAFF
  n_assignments 1  (invite carried 2)
  assigned_stores {Carson}
  defaultStoreId cmrd1a3es000104kzao4mf69v → default_store_name Carson
  linked_staff_member_id cmsbe40q9000104l7fm3t6bp4
  surviving_pending_invite 0
  name null
Record the DEFAULT STORE as the discriminating signature and say
why: the default write keys off owned.length === 1, not
pending.storeIds.length, so a two-store invite ending with one
assignment AND a default set is a state only the filtered path
produces. n_assignments alone would not discriminate.
NOT captured: the Vercel runtime log line. So the FILTERED PATH is
proven from the database; the console.warn STATEMENT itself is
inferred, not observed. Entry (1) says "filtered, warned" — record
which half is which rather than claiming both.
name null is consistent with PERM-7c's closure: no name is ever
collected, and the store-name derivation fires only for STORE-role
invites with exactly one store.

ITEM A — THE STAFF ROLE, in PERM-2's sense. Signed in AS the STAFF
principal (username perm-6-staff), both returned 403 Forbidden:
  /api/square/locations  ← PERM-6 Task 4, the route whose finding
                            names STAFF explicitly
  /api/staff             ← PERM-2's guard, a control from a
                            different enforcement point
Two 403s from two different guards, driven as the role, which is
what "exercised" has meant on this row since PERM-2's pass.

TASKS
1. Close entry (1)'s items (2), (3) and (4) in house style —
   original text preserved, nothing deleted, resolution prepended.
   Record each item's evidence and its LIMITS as stated above.
2. Entry (1)'s remaining live content is now its own status
   rationale. Assess whether it is closeable as a blocker entry —
   and note this is one of DEBT-41's two half-closed exemplars, so
   the vocabulary question is live here. RECOMMEND; do not decide.
   Do NOT mark it resolved: true under P-4's scheme without my
   ruling.
3. STATUS: both phases stay `shipped`. Staging evidence is not
   production evidence — DOCS-3's precedent, restated in PERM-7c
   and in entry (1)'s own text ("The flip is Gary's ruling to make,
   not a bookkeeping consequence of clearing a blocker"). Quote
   that line and confirm you are not doing what it forbids.
4. Note what remains uncovered on the pair after this: B-2/B-3
   never run; DEBT-16's collision pre-check still untested (three
   fresh addresses); PERM-7's Clerk error branch still dormant on
   its own code.
5. Fixtures left on staging, for a future cleanup session — do NOT
   delete them now: staff member PERM-6b Staff, user
   indianathomas+staff@gmail.com, and the earlier +store/+store2/
   +store3 accounts if any survive. Also a stale ADMIN PendingInvite
   for Taylin@keva.com with zero stores, unrelated to this run.
   File as a row or a note, your call which is more legible.

STANDING RULES
- Treat every repo-checkable claim as UNVERIFIED at HEAD; the
  staging observations are mine, take those.
- Audit first, plan, wait for approval, then edit. Commit only when
  I say so. Never push.
- Gate: docs-only, eslint skipped. Bare npm run build, chained,
  redirect not pipe.
- meta.updated is gone (DEBT-24, final).

REPORT BACK
1. Entry (1) quoted at HEAD, then the exact edits.
2. Your recommendation on task 2, with the DEBT-41 interaction.
3. Confirmation of task 3.
4. Debt counts unchanged unless task 5 adds a row — say which.
5. Bare build green. The unpushed-commits line — I run all pushes.
