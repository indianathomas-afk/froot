# Session Prompt — DEBT-10 then DEBT-17

Session: DEBT-10 then DEBT-17. Save this file to
docs/prompts/DEBT-10_team_members_pii.md before starting any work.

Read docs/ROADMAP.yaml rows DEBT-10 and DEBT-17, plus CLAUDE.md, before
doing anything else. Those rows carry the findings with file:line. This
message is the task order and the constraints.

Standing rules for this session:
- Treat this prompt's claims as UNVERIFIED, and the ROADMAP rows' claims
  too. Re-verify every file:line against the current checkout before
  acting. If a reference has drifted, report the real location rather
  than following it silently.
- Any database result you cite must name the Neon branch on the same
  line. A result without a named branch does not count.
- No `vercel env pull`, any environment. Neon console only.
- Before writing down any causal explanation, state what evidence would
  disconfirm it. Four causal chains were wrong in the last session; the
  common failure was building past a contrary or absent observation
  because the alternative was a cleaner story.

---

PART 1 — DEBT-10 (fix it)

GET /api/square/team-members has no role gate and spreads the whole
Square object. The payload includes every employee's email and phone.
Any authenticated org member, including STORE and STAFF, can read it.
DEBT-10 carries a check-by date of 2026-07-31; this session clears it.

The fix is the same two-part shape as PERM-6 Task 4 on
/api/square/locations — copy that route's structure:
  a. Gate through can() at the correct tier. No inline role === "…".
  b. Replace the spread with an explicit field allow-list.

DEBT-10's FIX paragraph already asserts an answer: sole caller is the
staff import dialog at staff/staff-buttons.tsx:167, rendering only under
isAdmin per staff/page.tsx:92, gate at staff.sync.square (ADMIN_ONLY).
Re-derive that independently rather than copying it forward. If a second
consumer has been added since 2026-07-27, or the dialog has moved,
carrying the old answer would be exactly the failure this session is
guarding against.

Disconfirming evidence to look for specifically: any other fetch or call
to /api/square/team-members anywhere in the tree, and any non-admin
render path that reaches the dialog.

Before writing the allow-list: report every consumer and which fields
each one actually reads, with file:line. Include a field only if a
consumer reads it. If a consumer reads email or phone, say where and why
before including them — those are the fields that make this a PII
finding rather than a tidiness one. If a consumer genuinely needs them,
the answer is to gate the route properly and keep them, not to drop them.

For the capability tier: name the callers and the pages they render
under, then recommend a tier. Do not widen in anticipation of a future
caller. If no caller exists at all, say so — that changes the answer.

Answer this explicitly: is the route reachable in production today by a
STORE or STAFF account, or is it admin-only by UI placement with the gap
being API-surface only? PERM-6 Task 1 turned out to be the latter. Say
which this is, and say what you checked to determine it.

Audit first. Present the plan — guard before → after with file:line,
plus the proposed allow-list with per-field justification — and wait for
my approval before editing.

---

PART 2 — DEBT-17 (audit only, do not fix)

src/app/(app)/users/page.tsx creates User rows from Clerk org membership
alone, ignoring PendingInvite, so visiting /users before the webhook
lands can persist a role the admin never chose. It writes STAFF. It
ships in production today. The last session described it as a "real but
unexercised race."

Audit and bring me a recommendation. Do not implement.

1. Confirm the race is real against current code, with file:line. If
   intervening work has closed it, say so.
2. What is the actual window — how long between the org membership
   existing and the webhook writing the row? Seconds, or can it persist?
3. What happens to the wrong row once the webhook arrives? Does the
   upsert correct it, or does the row survive with the wrong role? That
   determines whether this is transient or permanent, and it changes the
   severity.
4. Options for the fix, with your recommendation: should the page stop
   creating rows entirely and render membership without persisting;
   should it read PendingInvite the way the webhook does; or something
   else. Name the trade-off for each.
5. Is there evidence this has actually occurred — a User row whose role
   doesn't match its PendingInvite? If a read-only query would settle
   it, write the query for me to run and name the branch it should run
   on. Do not run it yourself.

The decision on 4 is mine. Bring the fork, don't pick it.

---

Constraints
- Branch: staging. Commit when I ask. Never push.
- DEBT-10 may change code. DEBT-17 is audit only this session.
- No schema, no migration, no dependency changes.
- Don't touch ../froot_docs/.
- Out-of-scope findings get written down as text, never fixed inline.
- DEBT-10's fix and any DEBT-17 docs are separate commits.

Done criterion
DEBT-10 fixed with the gate and allow-list, `next build` green, the
DEBT-10 row updated with its commit SHA and its check-by line resolved
into notes rather than deleted. DEBT-17 audited, recommendation
recorded, row still open.

Report back
1. DEBT-10: guard before → after with file:line, the allow-list with
   per-field justification, and the production-reachability answer with
   what you checked.
2. Any file:line in this prompt or in the rows that had drifted.
3. DEBT-17: the five audit answers, your recommendation on 4, and the
   query for 5 if one exists.
4. Anything in this prompt that contradicted the repo — say so rather
   than reconciling it silently.
5. The explicit unpushed-commits line.

---

## Appendix (added 2026-07-28) — DEBT-17 evidence queries

Written during the audit for Gary to run in the Neon console. **Neither has
been run.** No branch-labelled result exists yet. Run on `production` first,
then `preview/staging`; label every result with its branch (CLAUDE.md §
Database Evidence). Both are strictly read-only.

Context for why Q1 will usually be empty: the Clerk webhook deletes the
matching `PendingInvite` (`webhooks/clerk/route.ts:195`) whether or not
`/users` won the race, so a surviving disagreement only exists where the
webhook never landed at all.

```sql
-- Q1: webhook never landed — surviving PendingInvite whose role disagrees
--     with an existing User row for the same email.
SELECT u."organizationId", u.email, u.role AS user_role,
       p.role AS invited_role, p."storeIds", u."createdAt" AS user_created,
       p."createdAt" AS invite_created
FROM "User" u
JOIN "PendingInvite" p
  ON p."organizationId" = u."organizationId"
 AND lower(p.email) = lower(u.email)
WHERE u.role <> p.role
ORDER BY u."createdAt" DESC;
```

```sql
-- Q2: post-webhook signature — role STAFF but holding store assignments.
--     Store assignments for a STAFF user normally come only from a
--     PendingInvite the webhook materialised. FALSE POSITIVES: an admin can
--     assign stores to a STAFF user by hand via users/[id]/route.ts:136.
--     This is a lead, not proof.
SELECT u."organizationId", u.email, u.role, u."createdAt",
       count(a.id) AS store_assignments
FROM "User" u
JOIN "StoreUserAssignment" a ON a."userId" = u.id
WHERE u.role = 'STAFF'
GROUP BY u.id, u."organizationId", u.email, u.role, u."createdAt"
ORDER BY u."createdAt" DESC;
```
