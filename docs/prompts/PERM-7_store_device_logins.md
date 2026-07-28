# PERM-7 — Store device logins provisioned from /stores

**Track:** PERM (permissions)
**Branch:** staging
**Type:** Implementation (feature) + DEBT-8 as Task 0
**Size:** M
**Depends on:** PERM-6 — **hard blocker, do not start before it lands**
**Created:** 2026-07-27

---

## What this phase is, and what it is not

It makes an **existing convention first-class**. A store device login is built by
hand today: invite a user on `/users`, pick role STORE, tick one store. Las
Brisas already has exactly this (Tommy Thomas / `corporate@keva.com`, role STORE,
assigned to #0014). Nothing names the pattern, enforces it, or provisions it in
one step.

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
by hand in both the Add Store form and the Edit Store dialog. `GET
/api/square/locations` spreads the entire Square object, so `business_email`
already reaches the client. The import dialog simply never maps it
(`src/app/(app)/stores/import-square-button.tsx:58-66`).

1. Map `business_email` → `contactEmail` on import.
2. Surface it on the store card, which today shows address, phone and timezone
   but never the email.

That alone resolves the reported confusion: one store's email currently has
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
The live Las Brisas account is named "Tommy Thomas" on a corporate address —
data that predates the ruling and contradicts it, which is precisely the argument
for producing the convention as a side effect of the flow rather than trusting
whoever fills in the form.

---

## VERIFY BEFORE DESIGNING AROUND THEM — two unknowns

Both are cheap to check and both can change the flow. Resolve them in Task 0
and report before building Tasks 1–7.

1. **Are the per-location Square mailboxes reachable?** The Clerk invite must be
   **accepted**. An unmonitored address means no device account. Mitigating:
   whoever sets up the iPad is physically at it, so acceptance is a one-time
   setup step, not a blocker.
2. **Does plus-addressing (`kevajuice+0014@icloud.com`) survive Clerk's email
   normalisation?** If it does, it answers the collision case below with one real
   mailbox and N distinct identities. **Do not assume it works.**

**The collision case is not optional to handle:** Square's `business_email` is
free text and is **not** guaranteed unique per location — many operators put one
address on every location. Clerk requires a unique email per user, so N locations
sharing an address means exactly one device login can be provisioned and the rest
hard-fail. Detect this and require a distinct address, rather than failing
opaquely at the Clerk call.

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
