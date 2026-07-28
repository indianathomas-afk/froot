# PERM-7 — Store device logins provisioned from /stores

**Track:** PERM (permissions)
**Branch:** staging
**Type:** Implementation (feature) + DEBT-8 as Task 0
**Size:** M
**Depends on:** PERM-6 — **hard blocker, do not start before it lands**
**Created:** 2026-07-27

---

> **CORRECTED 2026-07-28.** This file was written at 19:51 on 2026-07-27, hours
> before PERM-6 landed (`d4a6bdc`), and its opening example was never checked
> against production. Corrections are inline below and marked. Where this file
> and `docs/ROADMAP.yaml` disagree, the roadmap row is current.

## What this phase is, and what it is not

It **establishes** a convention. A store device login *would* be built by hand
today: invite a user on `/users`, pick role STORE, tick one store. Nothing names
the pattern, enforces it, or provisions it in one step.

**CORRECTION — the original live example was wrong on every count.** This
section used to read: *"Las Brisas already has exactly this (Tommy Thomas /
`corporate@keva.com`, role STORE, assigned to #0014)."* Verified read-only
against the **production** database on 2026-07-28, org `Keva Juice`
/ `org_3FhYUR4l0ue7egug1I0Ig8wxOVn`:

| Claimed | Production |
|---|---|
| Tommy Thomas | `User.name` is **null for all 8 users** |
| `corporate@keva.com` | **`kevajuice14@icloud.com`** — no `corporate@keva.com` user exists |
| role STORE | **MANAGER** |
| assigned to #0014 | **2 stores** (Las Brisas + South Reno); `storeNumber` is null |

And the load-bearing one: **there are zero users with role STORE anywhere in
production** (ADMIN 5, MANAGER 2, STAFF 1). The pattern has never been built
once, and the nearest live account is a two-store MANAGER — a counterexample to
"one store per device account".

This does not invalidate the design. One-store-per-device **remains the rule for
accounts this flow creates**. It changes what the phase is: net-new convention,
so Task 7's enforcement is the point rather than a tidy-up, and no existing
account is evidence for the shape.

**It is NOT a second permission model.** Verified 2026-07-27: there is no direct
user-creation path anywhere (provisioning is Clerk-invite-only), and Clerk
authenticates an *identity*, not a database row. So "assign a Store as a User"
necessarily mints a normal `User` with role STORE plus one
`StoreUserAssignment` — the same objects the invite flow already produces,
reached in one click from the page the admin is already on.

Making `Store` a permission-holding principal was **considered and rejected**: it
would fork the capability layer PERM-1 deliberately unified, forcing every
`can()` call site to ask "User or Store?" forever. If this phase starts drifting
toward a `Store`-as-principal design, stop and re-read this section.

**Read the PERM-7 row in `docs/ROADMAP.yaml` and the three 2026-07-27 entries in
`docs/DECISIONS.md` before starting.** They carry the rulings this phase
implements.

---

## Task 0 — DEBT-8: stop discarding Square's `business_email`

Do this first; the rest of the phase depends on it. **A seed cannot come from a
column nothing populates.**

`Store.contactEmail` exists (`prisma/schema.prisma:118`) and is already editable
by hand in both the Add Store form and the Edit Store dialog.

**CORRECTION — this task's premise changed and one of its two steps was already
done.** As landed 2026-07-28, it is three parts, not two:

1. **Re-add `business_email` to the allow-list**
   (`src/app/api/square/locations/route.ts:63-83`). The original text said the
   route *"spreads the entire Square object, so `business_email` already reaches
   the client."* PERM-6 Task 4 replaced that spread with an explicit allow-list,
   so it no longer does. Deliberate, not an oversight — Gary's 2026-07-27 rule
   is widen when a consumer exists, don't pre-widen. This task is that consumer.
   Note the route is also now ADMIN-gated (`can(role, "stores.manage")`).
2. **Map `business_email` → `contactEmail` on import**
   (`src/app/(app)/stores/import-square-button.tsx:58-72`).
3. **NEW — a per-store "Resync from Square"**
   (`src/app/api/stores/[id]/resync-square/route.ts`). Without it steps 1–2
   populate **nothing**: `contactEmail` is null on 10 of 10 production stores,
   the import dialog is the only writer of these fields, and it filters out
   already-imported locations. All nine Square-linked production stores were
   permanently unreachable — including Las Brisas, the store the phase was
   designed around. Gary's Ruling 3, 2026-07-28: a one-shot script fixes today
   and nothing after it. The button is also the remedy Task 5's drift indicator
   points at.

~~2. Surface it on the store card, which today shows address, phone and
timezone but never the email.~~ **Already shipped.** The card has rendered
`contactEmail` behind a `Mail` icon since the initial commit —
`src/app/(app)/stores/page.tsx:182-187`, dated to `1cfdf76` (2026-06-26) by
`git log -L 182,187`. The claim was wrong when written, not broken by PERM-6.

That resolves the reported confusion: one store's email currently has
three uncoordinated answers (Square, `/stores`, `/users`).

---

## Task 1 — "Create device login" action on /stores

ADMIN-only. Creates a `User` + **one** `StoreUserAssignment` to that store.

**One store per device account.** This is what sidesteps BUILD-2 for devices — a
one-store account has no primary-store ambiguity. Do not add a multi-store
picker here; a human who needs several stores is a normal user invited on
`/users`.

## Task 2 — role is choosable, defaulting to STORE

Offer Admin / Manager / Store. Default **STORE**. Mark **MANAGER recommended** —
it keeps store scoping (the picker stays visible for non-ADMIN roles), so the
device stays pinned to its own location while still granting broad operational
reach.

**This is role choice, not a capability override.** Per `DECISIONS.md`
2026-07-27, PERM-5's restrict-only invariant is untouched by this — an ADMIN
device account is not an "elevated STORE user", it is a user whose role is
ADMIN. Do not route this through PERM-5's override layer.

## Task 3 — count-aware warning when the role is above STORE

The store picker is hidden for ADMIN (`user-actions.tsx:104,230` — "Admins have
access to all locations automatically"), so an **ADMIN device account sees every
store in the org**.

The warning must state the **actual blast radius**, computed from the org's
store count:

> "This gives the shared device at Carson access to all 12 of your locations,
> including financial data for stores this device isn't at."

That sentence is unalarming for a single-location operator and stopping for a
twelve-store one — same control, calibrated by real exposure, with the product
making no judgement about who is sophisticated.

Name **concrete** consequences, never "elevated access":

- **Square disconnect** is ADMIN-gated by SEC-1 and drops the live org-wide
  token. A shared iPad with a button that breaks sales sync for the whole
  business is the sharpest item on this list.
- Dashboard goal `PUT` is ADMIN-only per PERM-2.
- F-5's goal-edit audit log records the **device address, not a person** — you
  learn the building, not who.
- The credential is shared and has no per-person revocation.

Use an `AlertDialog` (CLAUDE.md design system: destructive actions require one).

## Task 4 — make it ambient, not a moment

A one-time modal is forgotten in a week. Add a **persistent badge** on `/stores`
and `/users` for any device login above STORE, so the next admin inherits the
knowledge.

## Task 5 — email seeded from Square, never live-synced

Pre-fill the login email from `Store.contactEmail` (populated in Task 0),
editable before submit.

**One-way seed. After provisioning, Clerk owns the credential.** Per
`DECISIONS.md` 2026-07-27 — a live sync would mean editing a location's email in
Square silently rewrites the credential and locks the iPad out of its own
account, through an action nobody would connect to logins.

Add a **drift indicator** on `/stores` when Square's email later differs from the
device login. Surfaced, not silently reconciled and not silently ignored.

**Do not retro-repoint existing accounts.** Las Brisas stays on
`corporate@keva.com`; the drift indicator shows it.

## Task 6 — replace the ambiguous "Has Account" badge

`src/app/(app)/stores/page.tsx:109-114` computes it as
`store.userAssignments.length > 0` — a **count, not a concept**. A MANAGER
assigned to three stores lights it up on all three.

Make it role-aware ("Device login" vs "Manager access"), show **who**, and
**link to `/users`**. This is the first thing the phase buys: the ability to
answer "does this store have a login, and whose is it?" on the page where the
question is actually asked.

## Task 7 — enforce STORE-is-a-device through the flow

Default the account **name to the store** and the **email to the location's**.

**CORRECTION — the cited evidence was wrong; the argument survives.** The "Tommy
Thomas on a corporate address" example does not exist in production (`User.name`
is null for every user). But with **zero STORE accounts in production**, there is
no precedent to inherit — so whatever this flow produces *is* the convention.
That is a stronger argument for enforcement, not a weaker one.

**How, with no schema change (Gary's Ruling 4, 2026-07-28).** The invite carries
only email + role; `User.name` is written by the Clerk webhook from the invitee's
own first/last name (`src/app/api/webhooks/clerk/route.ts:119`) — whatever a
human types at sign-up. `PendingInvite` has no name column and schema is frozen,
so provisioning cannot set the name directly. The webhook derives it instead:
when `pending.role === "STORE"` **and** the invite carries exactly one storeId,
`User.name` defaults to that store's name.

**Create-only.** It goes in the `create` branch of the upsert, never `update`, or
every subsequent Clerk event for that user resets a name someone has since
corrected. **If it can't be cleanly confined to create, cut Task 7 and file it
rather than bodging it.**

---

## RESOLVED 2026-07-28 — the two unknowns

Both were resolved with evidence before any code was written. Full record in
`DECISIONS.md` 2026-07-28.

1. **The per-location mailboxes are reachable.** `kevajuice14@icloud.com` and
   `kevajuice06@icloud.com` are already live production Clerk identities with
   `User` rows and store assignments, so those addresses have completed a
   sign-up. Not distinguishable from a Clerk-dashboard add without production's
   `CLERK_SECRET_KEY` (Sensitive; pulls as `[SENSITIVE]`).
2. **Plus-addressing survives.** Clerk never canonicalises subaddresses — it
   only optionally *blocks* them, via `block_email_subaddresses`. That flag is
   **`false` on both instances**, read 2026-07-28 from Clerk's public Frontend
   API `GET /v1/environment` at `clerk.usefroot.com` and
   `verified-snapper-7.clerk.accounts.dev`. Backend API `GET
   /instance/restrictions` is **405** (PATCH-only), so `/v1/environment` is the
   one-call re-check. **This rests on a dashboard setting nothing in the repo
   pins** — if collision handling ever breaks, read that flag first.

Incidental, and it shapes the staging pass: the dev instance has `username` as a
**required** identity attribute and production does not, so a staging sign-up is
a different shape than production — and it is exactly the BUG-2 hazard the
webhook already guards against.

**The collision case is not optional to handle**, and it is **live, not
hypothetical**: the production Square account returns 19 locations, with
`corporate@keva.com` on **four** and `gary@kevajuice.com` on two. All nine
currently-imported stores hold distinct addresses, so it is latent today and
fires on the next import.

**Handling (Gary, 2026-07-28):** prefill the plus-addressed variant as an
**editable suggestion**, rather than demanding a distinct address — a
single-mailbox operator has nowhere to go. Detect by error **code** via
`isClerkAPIResponseError` → `err.errors[0].code`
(`already_a_member_in_organization`, `organization_invitation_not_unique`, both
HTTP 400), never by message text.

---

## Constraints

- No schema change. If one seems necessary, stop and re-scope — it probably means
  the design drifted toward `Store`-as-principal.
- Do not touch `../froot_docs/`.
- Commit when asked; **never push**.

## Done criterion

`next build` green, PERM-7 row updated to `staging` with its commit SHA, DEBT-8
closed, and a staging pass covering: provisioning at STORE, provisioning at ADMIN
(warning text correct for a 12-store org), the collision case, and the drift
indicator against Las Brisas.

## Report back

1. The two unknowns, resolved with evidence.
2. Each task, with file:line.
3. Whether the collision case was reproducible, and how it now fails.
4. Anything in this prompt that contradicted the repo.
5. The explicit unpushed-commits line.

---

# Re-run plan (written 2026-07-28, after a void pass)

The 2026-07-28 pass tested a deployment that predated every PERM-7 commit, so
**nothing in this phase has ever executed anywhere.** This plan is ordered so
the cheapest, highest-information checks run first and only one step consumes a
fresh identity.

**Target org: `cmr54z65v000105jxczpt72w1` on branch `preview/staging`.** Address
it by ID, never by its display name "Microsoft" — five orgs on that branch share
that name (DEBT-19). It is the only org there with Square connected, which is
what makes Tasks 0 and 5 exercisable at all.

## Step 0 — the gate (blocking)

Push, wait for the deploy, then:

```bash
git rev-parse --short HEAD
npx vercel inspect <staging-alias> --json | grep -i githubCommitSha
```

**If these differ, stop.** Everything below is void otherwise — including the
passes. See `CLAUDE.md` § Staging Verification.

Record every DB result with its branch on the same line (`CLAUDE.md`
§ Database Evidence).

## Step 1 — use a plus-address on a mailbox you control

**Invite `indianathomas+froot0014@gmail.com`** (or any `+tag` on a mailbox you
own). This is the plan, not a fallback.

Three reasons it is the right default rather than a workaround:

1. **It is deliverable.** Accepting an org invitation requires the ticket link,
   and the ticket arrives by email. An address with no inbox cannot complete the
   flow.
2. **It consumes no new account.** The whole worry about burning test identities
   goes away — one real mailbox yields as many distinct Clerk identities as
   needed.
3. **It exercises the collision remedy itself.** Plus-addressing is what PERM-7
   suggests to an operator whose Square locations share one `business_email`
   (`DECISIONS.md` 2026-07-28). Using it here tests the recommendation instead of
   only asserting it.

> **Note on `+clerk_test`, deliberately NOT the plan.** On a development
> instance, addresses carrying the `+clerk_test` subaddress are test addresses
> that send no real mail. That is genuinely useful for sign-up verification
> codes, and it was initially proposed here to avoid consuming identities. It
> was dropped on reflection: **no email means no ticket link, and an org
> invitation cannot be accepted without one.** If someone wants to confirm that
> for themselves it costs one invite — but do not build a sequence around it,
> and do not let it displace the plus-address above, which is better on every
> axis that matters here.

## Step 2 — checks needing NO sign-up (run all before any acceptance)

These create nothing, or reuse `gary@keva.com` (role STORE, 1 store) which
already exists in the target org.

| # | Check | Proves | Cannot prove |
|---|---|---|---|
| 2a | **Collision.** Invite `gary@keva.com` again — already a member. | The 409 with the plus-address suggestion, replacing the raw "Bad Request". **Highest value: it is the check that failed, and it costs nothing.** | Nothing about the Square-derived collision (same address on N locations) |
| 2b | **Task 0 resync.** Click Resync from Square on a store in the target org, then query `contactEmail`. | DEBT-8 end to end: allow-list → import mapping → the resync path that is the only route to already-imported stores | That the *import* mapping works for a NEW location |
| 2c | **Task 3 warning.** Open Create device login, select Admin, read, **cancel**. | The sentence states the org's real store count — count-awareness, not a generic warning | Nothing about what the role actually grants |
| 2d | **Task 6 badge.** Look at the store `gary@keva.com` is assigned to. | "Has Account" is gone; role-aware badge names the account and links to /users | — |
| 2e | **Task 5 drift.** After 2b, if `contactEmail` ≠ the device login's email. | The drift chip appears — surfaced, not silently reconciled | — |

**Expected in 2d, and not a bug:** the badge renders `name ?? email`, and
`gary@keva.com` has an empty `name` because it was created before Task 7
existed. It will show the email. That is correct, and it is a live illustration
of why Task 7 exists.

## Step 3 — the one check needing a fresh sign-up

**Task 7 name derivation.** Invite a new address (per Step 1) as role **STORE**
with **exactly one** store, accept it, then query
`SELECT name FROM "User" WHERE ...` naming the branch. Expect the store's name.

**At sign-up, DELIBERATELY TYPE a first and last name — a person's name, e.g.
"Tommy Thomas".** This is not optional decoration. Task 7's ruling is that the
store name *overrides* what the invitee typed; if you leave the name fields
blank, the derivation merely fills a hole and the override — the half the ruling
is actually about — is never exercised.

- **PASS** = `User.name` is the store's name and the typed name is gone.
- **FAIL** = the typed name survives → the derivation fills blanks rather than
  overriding, and the ruling is not implemented.
- **Left blank** = record as "fill verified, override UNTESTED", never as
  "Task 7 verified".

Only this step needs a new identity, because the derivation is deliberately
create-only (`DECISIONS.md` 2026-07-28).

Re-exercises PERM-6 Task 2's accepting path as a side effect — already covered,
so it confirms rather than extends.

## What a staging pass structurally CANNOT establish

- **The production sign-up shape.** The development instance requires a
  `username`; production does not. Every staging acceptance therefore exercises
  the BUG-2 path (Clerk's `identifier` is a username, not an email). Useful —
  that path is real — but it is not production's.
- **PERM-6's rejecting branch** — see below.

**NOT in this list, though an earlier draft put it here: Task 7's override.**
That was an overstatement. It is not structurally impossible on staging, it just
requires deliberate test design — `first_name`/`last_name` are enabled on both
instances. **Step 3 above must type a person's name at sign-up**, or the pass
proves only the fill. Full statement on the PERM-7 row's first blocker, which is
where promotion-time readers will look.
- **PERM-6's rejecting branch.** No UI can send an invalid or foreign-org
  storeId (the dialog offers only the org's own stores), so the webhook's
  filter-and-warn path stays uncovered. Closing it needs a hand-made request or
  a store deleted between invite and acceptance — a separate deliberate
  exercise, not part of this pass.
