# DEBT-129 — TIER 2

TIER 2: contained fix to how User.name is kept in step with Clerk. No schema,
no migration, no new route, no new dependency. It touches the Clerk webhook and
the signed-in request path, so: brief read-only audit, ONE stop for Gary's go,
then build, two commits, STOP. Never push.

Out of scope (do not touch): DEBT-110 (Clerk webhook verifies the Svix
signature over re-serialised JSON). Same file, separate phase. If the fix below
can't be made without touching that code, STOP and say so.

## Repo gate (one command at a time, paste each result)

pwd                      → must end in Froot/froot
git status               → on staging, tree clean (this prompt may be untracked)
git log --oneline -1     → 54824e4

## The problem (DEBT-129, filed in 1809c73)

- The Clerk webhook writes User.name only when it first creates the User row.
  A name missing then, or changed later in Clerk, never reaches Froot.
- Gary's own User row (indianathomas, ADMIN, no staff record) has no name,
  though Clerk has "Gary Thomas" (the sidebar shows it).
- Effects: the Tasks and Communication email labels his messages "Team
  member"; the Messages feed's authorName() (src/lib/messages.ts:181) falls
  back to the email local part and shows "indianathomas".

## Audit (read-only) — report, then STOP

1. The webhook handler: which events it handles (user.created, user.updated,
   organizationMembership.*), and exactly where User.name is written. file:line.
2. Every other writer of User.name in the repo. Is there anywhere inside Froot
   an admin or user can set a name? If yes, the sync must not overwrite it —
   say how you'd tell a Froot-set name from a Clerk-copied one, or STOP.
3. The ENG-1 "last seen" write (lastSeenAt / lastSeenLocation): where it runs,
   how often (throttled?), and whether the Clerk user's firstName/lastName are
   already in hand there or would cost an extra Clerk API call.
4. Count, on dev br-broad-wave-a6vpjdw0 (branch id in the same output): Users
   with name null or empty, vs total. Read-only SELECT.

Then print the plan below with anything the audit changed, and STOP for Gary.

## Plan (planning-chat leans — NOT rulings; Gary rules at the stop)

A. Name rule, one shared helper: name = trim(firstName + " " + lastName) from
   Clerk. Empty → null. Never the username, never anything containing "@",
   never the email. One function used by both paths below.
B. Webhook: on user.created AND user.updated, write User.name from the helper
   (null stays null, never blanks an existing name with null).
C. Lazy backfill: at the ENG-1 last-seen touch point (or the nearest existing
   place a signed-in request already has the Clerk user), if User.name is null
   and the helper returns a name, write it. One conditional update, only when
   null — never on every request. No extra Clerk API call if avoidable; if one
   is unavoidable, say so at the stop.
D. No change to authorName() in the Messages feed or to the email's name order.
   Once names exist, both show them.

## Fixture

scripts/verify-debt-129.ts on dev br-broad-wave-a6vpjdw0 (branch in output):
- helper: "Gary"+"Thomas" → "Gary Thomas"; blanks → null; a value containing
  "@" → null; username is never used.
- webhook user.updated with a name → User.name set; with no name → existing
  name unchanged.
- lazy fill: null name + Clerk name → filled once; existing name → untouched;
  second call writes nothing.
- negative control: break the "@" guard, confirm a check fails, restore.
npm run build must pass.

## Commits (scope git add to touched files; never -A)

Commit 1 (fix): helper, webhook, lazy fill, fixture.
Commit 2 (docs): DEBT-129 row → status in_progress with the fix SHA and a
staging test list:
(a) sign in to staging as indianathomas, load any page, then send a Tasks and
    Communication preview → a message by you shows "Gary", not "Team member";
(b) /messages shows "Gary Thomas" (or "Gary") as author, not "indianathomas";
(c) change your first name in Clerk (staging instance) → within a minute
    Froot shows the new name; change it back.
DECISIONS: one DRAFT entry stating rule A and "Froot never invents a name".

## Report and STOP

SHAs, audit answers 1–4 with file:line, fixture count with branch, findings
classified FIX NOW / RULING NOW / COMMENT / ROW. Do not push.
