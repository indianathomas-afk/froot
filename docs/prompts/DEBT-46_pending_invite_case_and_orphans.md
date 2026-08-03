# DEBT-46 — a PendingInvite can carry a live role grant nothing can see or revoke

**Written:** 2026-08-03
**Repo:** `indianathomas-afk/froot` — Next.js 16 App Router, React 19,
TypeScript, Tailwind 4, Prisma 7 on Neon, Clerk, Square OAuth, Vercel.
**Session shape:** Phase 0 is a READ-ONLY audit that ends and waits for Gary's
approval. Nothing is edited before that approval.

---

## The problem, in one paragraph

`PendingInvite` records what role an invited address will receive. Three code
paths read `PendingInvite.email` and **two of them disagree with the third
about case**. The path that CONSUMES the row — `webhooks/clerk/route.ts:103-105`
— is deliberately case-INSENSITIVE, commented "older rows may hold mixed-case
emails", so the grant always lands. The path that RENDERS it
(`users/page.tsx:46`, a `Map` keyed on the raw email, looked up at `:157` with
Clerk's `emailAddress`) and the path that REVOKES it
(`api/users/invitations/[invitationId]/route.ts:29-31`, a `deleteMany` on the
raw email) are both case-SENSITIVE. A mixed-case row is therefore invisible to
the page and immune to the revoke button, while still granting its role on
acceptance.

**It has already fired.** A `PendingInvite` for `Taylin@keva.com`, role ADMIN,
zero stores, sat invisible on `preview/staging` from 2026-07-09 to 2026-08-02
and was found by a database query, not by the product. It was deleted by hand.

**Two more things make it worse than a case bug:**

1. **The revoke route reports success when it deletes nothing.** Prisma's
   `deleteMany` returns `{ count: 0 }` rather than throwing, and the route
   returns `{ success: true }` at `:34` regardless. An admin clicked revoke,
   was told it worked, and nothing was deleted. A destructive operation that
   cannot distinguish "deleted the row" from "matched nothing" reports the
   same success for both.

2. **The render is Clerk-driven, not database-driven.** `users/page.tsx:156`
   maps over `pendingInvitations.data`, fetched at `:25` with
   `status: ["pending"]`; the database rows at `:37` are ONLY a lookup map.
   No code path anywhere lists `PendingInvite` rows on their own. So a row
   whose Clerk invitation is revoked, expired, or accepted-without-webhook
   renders NOWHERE — not as stale, not as orphaned, not at all.
   **Fixing the case bug does not fix this.** Revoked and expired invitations
   leave the same orphan.

**Why the grant is dangerous:** the webhook resolves the app role as
`pending?.role ?? roleMap[membership.role] ?? "STAFF"` — the PendingInvite
role BEATS the Clerk membership role. So the next invitation to that address,
**at any role**, makes the acceptor whatever the invisible row says.

**The precedence fires on the CREATE branch only.** `resolvedRole` is consumed
by a `user.upsert` whose UPDATE branch sets `{ email }` and nothing else
(`:145-155`), so the role is written only when no `User` row exists for that
`clerkUserId`. The grant lands on a first-time acceptor, a new Clerk account on
the same address, or an identity whose `User` row was deleted while its Clerk
user survived. It does NOT re-role an existing member. State this correctly if
you write about it — the broader version is wrong.

**The mixed case is legitimate and dated.** `POST /api/users` normalises to
lowercase at write time (`users/route.ts:102`, via `normalizeEmail` in
`lib/clerk.ts:4-7`), but that landed in `3c7d0a0` on **2026-07-22** — thirteen
days after the Taylin row was created. Every `PendingInvite` written before
that commit may hold mixed case. This is a real class, not one malformed row.

---

## What is NOT known, and must not be assumed

**Only ONE branch has been measured.** An all-invites query on
`preview/staging` (`br-square-feather-a63z92vz`) on 2026-08-02 found exactly
one surviving `PendingInvite`, `kevajuice14@icloud.com`, with
`mixed_case_unrevokable` FALSE.

**`production` and `preview/main` have NEVER been examined.** Both run the same
three read paths. Every pre-`3c7d0a0` row on those branches is in scope. Do not
write "the class is closed" or anything like it.

---

## PHASE 0 — Audit (READ-ONLY, ends and waits)

No edits. No new files. No `npm install`. **No git commands that write.**
Read-only git (`status`, `log`, `diff`) is permitted.

Exclude generated and doc files from every grep:
`-g '!src/generated/**' -g '!docs/**' -g '!node_modules/**'`
(`src/generated/roadmap.ts` is in Tailwind's content scan path and roadmap
prose has previously manufactured false grep evidence.)

### 0a — Every reader and writer of `PendingInvite.email`
Find them all, not just the three named above. For each: file:line, whether it
is case-sensitive or normalised, and whether it reads, writes, or deletes.
Report any path the description above missed — the three are what a previous
audit found, not a proven complete set.

### 0b — The revoke route's failure semantics
Read `api/users/invitations/[invitationId]/route.ts` in full. Confirm the
`{ count: 0 }` → `{ success: true }` behaviour at HEAD and report what the
client does with the response.

### 0c — The render path
Confirm `users/page.tsx` builds its list from Clerk and uses the database only
as a lookup map. Then answer the question the fix depends on: **is there any
surface anywhere that could show a `PendingInvite` with no matching Clerk
invitation?** If not, say so plainly — that is the design gap.

### 0d — Blast radius of normalising on read
If the two case-sensitive paths normalise, what else changes? Specifically:
could two rows that are currently distinct collide? Is there any uniqueness
constraint on `PendingInvite.email`, and is it case-sensitive?

### 0e — The measurement query
Write (do not run) a query that will run on **each of `production`,
`preview/main`, and `preview/staging`** and report, per branch:
  - every `PendingInvite` row with `email`, `role`, `storeIds`, `createdAt`,
    and `organizationId`
  - a boolean column for `email <> lower(email)`
  - whether a `User` already exists in that org for the same address,
    case-insensitively — because that determines whether the precedence
    would actually fire (create branch vs update branch)

Each result must carry `current_setting('neon.branch_id', true)` in the
select list. Gary runs these in the Neon console.

**Guard against a defective check.** A previous confirmation query on this
exact row returned `n = 1` with an EMPTY detail string, because the detail
expression concatenated `array_length(p."storeIds", 1)` — NULL for an empty
array — and `NULL || text` is NULL, so `string_agg` had nothing to aggregate.
Zero stores, the thing that made the invite notable, is what blanked the
evidence describing it. Use `coalesce(array_length(...), 0)`. Treat a check
whose count and whose detail can disagree as a defective check.

### Present and STOP
Summarise, propose the edit plan for the phases below, and **wait for Gary's
approval before any edit.** Include the measurement queries so he can run them
while you wait.

---

## The fix, in three parts — scope them separately

These have very different sizes and risks. Propose them as separate phases and
say plainly which you think should ship in this session.

**(1) Normalise on read.** The two case-sensitive paths use the same
normalisation the write path already uses (`normalizeEmail`, `lib/clerk.ts:4-7`).
Small. Behaviour-preserving for every correctly-cased row.

**(2) Make the revoke honest.** Check `deleteMany`'s count; return 404 on zero
rather than `{ success: true }`. Smaller than (1) and independently valuable —
it is the change that would have made the original failure visible.

**(3) Render an orphaned PendingInvite.** The real work and a design question,
not a patch. Today `/users` cannot display a row whose Clerk invitation is
gone. **Do not design this in Phase 0.** Report what it would take and let
Gary rule on whether it belongs in this session or its own phase.

A fourth option exists and is Gary's to rule on, not yours to take: backfill
`lower(email)` and add a case-insensitive uniqueness constraint. That is a
data migration against three branches and is out of scope unless he says
otherwise.

---

## Standing constraints

- **No git commits, no pushes.** Gary runs every one.
- Additive-only schema. No column drops, no destructive migrations. Any SQL
  that mutates is presented for approval, and the database host is echoed
  before it runs.
- No `vercel env pull` in any environment.
- `npm run lint` is NOT a valid gate — the baseline is red with React Compiler
  errors (DEBT-33). Use scoped `npx eslint <touched files>` plus `npm run build`.
- Out-of-scope findings are logged as text and never fixed inline.
- Database evidence names its branch and carries `neon.branch_id`.
- Browser evidence names its org id.

## Close

End with the standard triage **before** the report body:

**FIX NOW / RULING NOW / COMMENT / ROW** — a row is the last resort.
