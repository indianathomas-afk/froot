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

## Task 1a — STOP. Production duplicate pre-check, results to Gary first

**This phase carries a second migration**, moved here from PERM-6: a partial
unique index on `StoreStaffAssignment` enforcing one `isPrimary` per staff
member. Both DDL changes ride one deploy.

**A partial unique index FAILS TO CREATE if any staff member already has two
`isPrimary` rows.** So the data must be known-clean first — and checked in the
right database.

### The trap, and it is new

Local `.env` `DATABASE_URL` now resolves to **`ep-late-water-a6k53nv2` — the DEV
branch.** Production is `ep-green-smoke-a6xthq4r`; staging is
`ep-odd-rain-a6gr4xmm`.

So `npx prisma studio`, `prisma db execute`, or any local `tsx` script reads
**dev** and returns a **false all-clear.** Before BUILD-1/DEBT-4 the repoint had
not happened and local pointed *at* production, so this specific mistake was not
possible. The repoint — otherwise correct and desirable — made it possible.

**A result with no host recorded beside it does not count.**

### Preferred method

Run it in the **Neon console against the production branch.** That keeps
production credentials out of the working tree (DEBT-4's own guidance), and the
branch is visible in the UI rather than inferred from an env var.

### The queries — as actually run, with results

No `@@map` in `schema.prisma`, so identifiers are quoted PascalCase/camelCase.
These return **names, not bare `cuid()`s**, so a hit is immediately actionable.

**No org filter, deliberately** — a unique index is global, so a duplicate in any
organization blocks it, not just Keva.

#### Query A — the blocker check ✅ RUN 2026-07-27, ZERO ROWS

```sql
SELECT
  sm."displayName",
  sm."fullName",
  sm."status",
  COUNT(*) AS primary_count,
  string_agg(
    COALESCE(st."storeNumber" || ' – ', '') || st."name",
    ', ' ORDER BY st."name"
  ) AS primary_stores,
  sm."id" AS staff_member_id
FROM "StoreStaffAssignment" ssa
JOIN "StaffMember" sm ON sm."id" = ssa."staffMemberId"
JOIN "Store"       st ON st."id" = ssa."storeId"
WHERE ssa."isPrimary"
GROUP BY sm."id", sm."displayName", sm."fullName", sm."status"
HAVING COUNT(*) > 1
ORDER BY COUNT(*) DESC, sm."displayName";
```

**RESULT: zero rows.** Run by Gary in the Neon console, project `froot`,
database `neondb`, branch **`production`**. The index can be created; the gate on
this phase is closed. Re-run only if a long gap opens before the migration —
and note that staleness is fail-closed, since a later duplicate makes index
creation fail rather than corrupt anything.

#### Query B — companion, NOT a blocker ⚠️ RUN 2026-07-27, TWO ROWS

```sql
SELECT
  sm."displayName",
  sm."status",
  COUNT(*) AS assignment_count
FROM "StaffMember" sm
JOIN "StoreStaffAssignment" ssa ON ssa."staffMemberId" = sm."id"
GROUP BY sm."id", sm."displayName", sm."status"
HAVING COUNT(*) FILTER (WHERE ssa."isPrimary") = 0
ORDER BY sm."displayName";
```

**RESULT: Gary Thomas and Kelton Thomas, both ACTIVE, 9 assignments each, zero
primary.** A partial unique index permits zero primaries, so this does not block
the migration — but `primaryStoreName()` then falls through to
`storeAssignments[0]`, an arbitrary one of nine. Logged as **DEBT-9**.

#### Query C — is DEBT-9 already live? ✅ RUN 2026-07-27, ZERO ROWS

Decides whether the missing primary has already produced signed records naming
an arbitrary store. Written generally so it catches anyone with no primary
rather than hardcoding the two names.

```sql
WITH no_primary AS (
  SELECT sm."id", sm."displayName"
  FROM "StaffMember" sm
  JOIN "StoreStaffAssignment" ssa ON ssa."staffMemberId" = sm."id"
  GROUP BY sm."id", sm."displayName"
  HAVING COUNT(*) FILTER (WHERE ssa."isPrimary") = 0
)
SELECT np."displayName", 'Acknowledgment' AS record_type,
       a."documentTitle" AS document, a."storeName" AS captured_store, a."signedAt"
FROM "HrDocumentAcknowledgment" a
JOIN no_primary np ON np."id" = a."staffMemberId"
UNION ALL
SELECT np."displayName", 'FormSubmission',
       fs."formTitle", fs."storeName", fs."signedAt"
FROM "FormSubmission" fs
JOIN no_primary np ON np."id" = fs."staffMemberId"
ORDER BY 1, 5;
```

Reading it:

- **Zero rows** — neither has signed anything. Theoretical; fix the primaries and
  move on.
- **Same `captured_store` throughout** — the arbitrary pick has been stable so
  far. That is luck, not safety.
- **Different `captured_store` for the same person** — already live, and executed
  documents disagree about where that person works. **Whether historical signing
  snapshots get corrected is Gary's call**, not something to quietly rewrite.

**RESULT: zero rows.** Run by Gary in the Neon console, branch **`production`**,
116ms. Neither Gary Thomas nor Kelton Thomas has signed anything — no
acknowledgments, no form submissions. **DEBT-9 is therefore theoretical, not
live: no executed document carries an arbitrarily-picked store name, and there
is nothing historical to correct.** The fix is purely forward-looking — set both
primaries before either signs anything, and before BUILD-2's index lands.

**Bring results to Gary, naming the host you ran them against, before any
migration is authored.**

### Why this matters more than it looks

`primaryStoreName()` (`src/lib/hr.ts:44-49`) picks with
`.find(a => a.isPrimary) ?? storeAssignments[0]` on an unordered query. With two
primaries it returns an arbitrary one — possibly a different one per request.
That value is **persisted at signing time**
(`api/hr/documents/[id]/acknowledgments/route.ts:172`,
`api/hr/forms/[id]/submissions/route.ts:143`) and **stamped into the signed
PDF**, including the certificate line at `src/lib/hr-signed-pdf.ts:615`.

Two documents signed by the same person on the same afternoon could name
different stores, permanently. The consequence is a legal record, not a pixel.

(Note the codebase is already split: `hr-signed-pdf.ts:764` queries with
`orderBy: [{ isPrimary: "desc" }, { store: { name: "asc" } }]` and *is*
deterministic under duplicates. `primaryStoreName()` has no tie-break.)

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

- **Do not author any migration before Task 1a's production pre-check has been
  run and its results shown to Gary.** This is a hard gate, not a courtesy.
- One additive column on `User`, plus the `StoreStaffAssignment` partial unique
  index. No changes to `StoreUserAssignment`.
- Do not touch `../froot_docs/`.
- Never run migrations by hand against staging or production — `migrate deploy`
  in the Vercel build applies them.
- Commit when asked; **never push**.

## Done criterion

Migration committed with the code, `next build` green, BUILD-2 row updated to
`staging` with its commit SHA, and the migration listed in `MIGRATIONS.md`.

## Report back

1. **Task 1a's results, naming the database host they were run against.** If the
   host is not `ep-green-smoke-a6xthq4r`, the check does not count — say so and
   re-run it rather than reporting a clear.
2. The migration names and their SQL.
3. The validation rules, including the stale-default fallback.
4. The self-service decision from Task 3.
5. The explicit unpushed-commits line.
