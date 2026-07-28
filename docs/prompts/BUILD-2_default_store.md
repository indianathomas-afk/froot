# BUILD-2 — Default store for multi-store users (`User.defaultStoreId`)

**Track:** BUILD
**Branch:** staging
**Type:** Schema + wiring
**Size:** S
**Depends on:** BUILD-1 (shipped 2026-07-27 — this phase is unblocked)
**Feeds:** UX-2 (c), PERM-7
**Created:** 2026-07-27 (rescoped from the original `isPrimary` design)

---

## READ THIS FIRST — the original design was wrong

This phase originally said to mirror `StoreStaffAssignment.isPrimary` by adding
an `isPrimary` flag to `StoreUserAssignment`. **That cannot work.**

Admins have **no `StoreUserAssignment` rows at all.** Every page scopes with
`...(isAdmin ? {} : { id: { in: storeIds } })` (`src/lib/auth.ts:137-142` and
every consuming page), and the UI hides the store picker for ADMIN entirely
("Admins have access to all locations automatically",
`src/app/(app)/users/user-actions.tsx:230`). There would be no row to carry the
flag.

That is **disqualifying, not inconvenient** — the ADMIN device account PERM-7
provisions is exactly the case that most needs a default store.

**Correct shape: a nullable `defaultStoreId` FK on `User`**, `onDelete: SetNull`.
One additive column, works for every role.

See `DECISIONS.md` 2026-07-27, "Default store lives on `User`".

---

## Also read: the theory this phase is NOT fixing

It was assumed the "which store loads by default" problem came from
nondeterministic ordering. **An audit refuted that.** Every page selects with
`orderBy: { name: "asc" }` and takes `stores[0]`, so today's default is
deterministic — just *arbitrary* (alphabetically first).

`dbUser.storeAssignments` genuinely has no `orderBy`, but it is only ever used as
a `WHERE id: { in: storeIds }` filter and never indexed into.

**So this phase gives users a CHOSEN default. It is not fixing a random one.**
Do not spend time adding sort determinism — that is not the bug. (The real causes
of the "random feel" are in UX-2.)

---

## Task 1 — schema

Add to `User`:

```prisma
defaultStoreId String?
defaultStore   Store?  @relation("UserDefaultStore", fields: [defaultStoreId], references: [id], onDelete: SetNull)
```

Additive, nullable, no backfill. `SetNull` so deleting a store doesn't cascade
into user rows.

**Follow the hand-authored migration flow in `CLAUDE.md`** — `migrate diff` to
generate, review the SQL, `db execute`, `migrate resolve --applied`,
`prisma generate`. `migrate dev` is broken (P3018) and `db push` is retired.

## Task 2 — validation

`defaultStoreId` must be a store the user can actually see:

- Non-admin: must be one of their `StoreUserAssignment` rows.
- Admin: any store in the org.

**Re-validate on read, not only on write.** A user's assignments can change after
the default is set — via the Clerk webhook on membership churn
(`src/app/api/webhooks/clerk/route.ts:180` deletes all assignments), or an admin
edit. A default pointing at a store the user no longer has must fall back
silently to alphabetically-first, exactly as the existing dashboard/forecasting
localStorage readers already do.

## Task 3 — set it

- **Edit User modal** — a "Default location" select, sourced from the stores
  already selected in that same modal.
- **PERM-7 provisioning** — a device account's default is its own store,
  set automatically.
- Consider letting a user set their own default without admin rights. Decide and
  record; a manager changing their own landing page is not a permission
  decision, but it is a write to their own `User` row.

## Task 4 — leave consumption to UX-2

This phase adds the column, validation, and the ways to set it. **UX-2 wires it
into the store-selection context.** Landing the column first keeps the migration
separate from a ~14-file refactor.

If UX-2 (a)/(b) have not landed, setting a default will have no visible effect
beyond the modal. That is expected — say so in the report rather than wiring it
into one surface as a demo, which would add a fifteenth uncoordinated selector.

---

## Constraints

- One additive column. No changes to `StoreUserAssignment`.
- Do not touch `../froot_docs/`.
- Never run migrations by hand against staging or production — `migrate deploy`
  in the Vercel build applies them.
- Commit when asked; **never push**.

## Done criterion

Migration committed with the code, `next build` green, BUILD-2 row updated to
`staging` with its commit SHA, and the migration listed in `MIGRATIONS.md`.

## Report back

1. The migration name and its SQL.
2. The validation rules, including the stale-default fallback.
3. The self-service decision from Task 3.
4. The explicit unpushed-commits line.
