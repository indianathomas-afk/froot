# DEBT-9 — Corporate work-location designation

**Written:** 2026-08-02
**Repo:** `indianathomas-afk/froot` — Next.js 16 App Router, React 19,
TypeScript, Tailwind 4, Prisma 7 on Neon, Clerk, Square OAuth, Vercel.
**Session shape:** Phase 0 is a READ-ONLY audit that ends and waits for Gary's
approval. Nothing is edited before that approval. Phases 1–4 run only after it.

---

## The problem, in one paragraph

`primaryStoreName()` (`src/lib/hr.ts`) resolves a staff member's store as
`.find(a => a.isPrimary)` falling back to the first assignment in an
isPrimary-desc-then-name-asc ordering. That value is frozen at signing time
onto `HrDocumentAcknowledgment.storeName` and `FormSubmission.storeName` and
stamped into the signed PDF (`src/lib/hr-signed-pdf.ts:615, :426, :670`). On
branch `production`, Gary Thomas and Kelton Thomas are both ACTIVE with **9
`StoreStaffAssignment` rows and zero `isPrimary`**. The first HR document
either signs would stamp an alphabetical accident — "Carson" — into a legal
record.

## Why the obvious fix is wrong

Nine assignments is not an oversight. Square's `TeamMember.assigned_locations`
is either `EXPLICIT_LOCATIONS` with a list, or
`ALL_CURRENT_AND_FUTURE_LOCATIONS` with no list at all. Gary and Kelton are
corporate — available at every location, homed at none — so Square reports
`ALL_CURRENT_AND_FUTURE_LOCATIONS` and Froot's sync expanded it into nine rows
with nothing to derive a primary from. **Square has no concept of a primary or
master location.** Setting a primary by hand would write a store name that is
simply untrue, and the condition regenerates.

There is also no forcing deadline. BUILD-2's partial unique index permits zero
primaries, and HR is not in production yet (gated on a separate Clerk org
rename). Nothing can be signed before this ships.

---

## Rulings already made — do not re-litigate

These were decided by Gary on 2026-08-02. Implement them; do not reopen them
in the audit.

1. **A field on `StaffMember`, NOT a Store row.** An "Admin"/"Corporate"
   `Store` row was explicitly rejected: `Store` rows are Square-linked and a
   synthetic one leaks into every store picker, forecast, coverage
   calculation, checklist scope, roster, and the `/staff` grouping.
2. **The label is "Corporate"**, not "Admin". It appears on signed legal
   documents; "Admin" reads as a software role.
3. **No chip-clicks.** The interim "just set a primary by hand for those two"
   stopgap is CANCELLED. It would write a false value the field then
   supersedes, and nothing forces it.
4. **Corporate staff are EXCLUDED from `/hr/compliance` By Store rollups** —
   not given their own bucket there. No store manager is responsible for
   corporate staff, and including them would permanently drag some store's
   compliance number down. They REMAIN in org-wide KPI cards and the
   org-wide employee table (ADMIN view).
5. **`/staff` still lists them** under a Corporate group heading — they must
   remain visible and manageable in the directory.
6. **Warn, don't throw.** `primaryStoreName()` must never throw on the
   ambiguous case. Failing mid-signing-ceremony for someone who cannot fix it
   is worse than a wrong-but-stable value. The guard is a warning where an
   admin is already looking.

---

## PHASE 0 — Audit (READ-ONLY, ends and waits)

No edits. No new files. No `npm install`. **No git commands of any kind** —
not `status`, not `diff`, not `log`. Gary runs all git.

Exclude generated and doc files from every grep:
`-g '!src/generated/**' -g '!docs/**' -g '!node_modules/**'`
(`src/generated/roadmap.ts` is in Tailwind's content scan path and roadmap
prose has previously manufactured false grep evidence.)

### 0a — Read path
Every caller of `primaryStoreName()`. For each: file:line, what it does with
the value, and whether the result is displayed, or frozen into a record.

### 0b — Grouping surfaces
Everywhere staff are grouped or bucketed by primary store. Known starting
points: the `/staff` directory page, `/hr/compliance` By Store table
(`src/lib/hr-compliance.ts`). Find any others. Report how each derives the
bucket.

### 0c — Schema
The `StaffMember` and `StoreStaffAssignment` models as currently defined.
Note the BUILD-2 partial unique index on `isPrimary` if present, and confirm
whether zero primaries are legal under it.

### 0d — Does the Square staff sync overwrite `isPrimary`?
**Open question Gary cannot answer from memory.** Find the Square team-member
sync code. Determine by reading it whether a sync run:
  - deletes and recreates `StoreStaffAssignment` rows (clobbers `isPrimary`), or
  - upserts and preserves the flag.
State which, with the file:line that decides it. If the code is ambiguous,
say so rather than guessing — this determines whether hand-set primaries
across the whole roster silently vanish on the next sync.

### 0e — Are the nine assignments load-bearing?
Does anything in the app grant permission, scope, or visibility from
`StoreStaffAssignment` rows for a user whose role is ADMIN? Or is ADMIN
access role-derived, making the rows purely descriptive? Report findings.
**Do not act on this** — it is context for a future phase, logged as COMMENT.

### 0f — Does the sync capture `assignment_type`?
Does Froot store Square's `assigned_locations.assignment_type`
(`EXPLICIT_LOCATIONS` vs `ALL_CURRENT_AND_FUTURE_LOCATIONS`) anywhere today?
If yes, note where. If no, say so. Auto-deriving the Corporate flag from
Square is OUT OF SCOPE for this session — this question only records whether
it would be cheap later.

### Present and STOP
Summarise findings, propose the concrete edit plan for phases 1–4 including
the exact migration SQL, and **wait for Gary's approval before any edit.**

---

## PHASE 1 — Schema (additive only)

Additive only. **No column drops. No destructive migrations.** Present the SQL
for approval and echo the database host before anything runs.

Add a nullable field to `StaffMember` marking corporate work location. Propose
the name and type in Phase 0 and let Gary rule; a boolean flag and a nullable
label string are both defensible, and the choice should follow what the
grouping surfaces actually need.

Existing rows are unaffected — absent/false means "homed at a store", which is
the current behaviour for everyone.

---

## PHASE 2 — Read path (behaviour-preserving for non-corporate)

`primaryStoreName()` prefers the Corporate designation when set, returning
`"Corporate"`. Otherwise the existing resolution is **completely unchanged**.

Keep the internal ordering that BUILD-2 added — do not trust caller ordering.

Extend the existing comment block in `src/lib/hr.ts` to record why the
Corporate branch exists (Square has no primary location; corporate staff are
`ALL_CURRENT_AND_FUTURE_LOCATIONS`), so the next reader does not undo it.

**Verify before moving on:** for every staff member with the flag unset, the
returned value is byte-identical to today's. State how you verified this.

---

## PHASE 3 — Surfaces

a. **`/staff`** — a Corporate group heading listing corporate staff. Their
   Locations column behaviour is Gary's call at the Phase 0 presentation:
   listing nine store chips may be accurate but noisy.

b. **`/hr/compliance`** — corporate staff excluded from the By Store table
   per ruling 4, retained in org-wide KPI cards and the employee table.
   Check whether removing them from By Store changes any denominator that
   feeds an org-wide number; if it does, report it rather than silently
   accepting the shift.

c. **`/staff/[id]` warning** — when a NON-corporate staff member has 2+ store
   assignments and no primary, warn in the existing affordance style. The
   precedent is already in that component: *"No store assigned — signed
   documents stamp a blank store. Assign a store below."* Match its wording,
   placement, and visibility gating. Corporate staff must NOT trigger it.

d. **An admin control to set the Corporate designation**, in the existing
   `StaffEditActions` surface, ADMIN-gated to match the existing primary-store
   chip path. If Phase 0 finds this surface more involved than expected, say
   so and propose SQL-only for now instead — do not expand the session to
   absorb it.

---

## PHASE 4 — Data

Set the Corporate designation for Gary Thomas and Kelton Thomas.

**Staging first, then production.** Write the SQL; Gary runs it in the Neon
console. Every result — before and after — must name its branch and carry
`neon.branch_id`, or it does not count as evidence.

Provide, for each environment:
  - a BEFORE query showing both members' current assignment count and primary
    count
  - the UPDATE
  - an AFTER query proving the flag is set and that **no other staff member's
    row changed**

---

## Verification before the session closes

- `next build` green.
- (`npm run lint` is NOT a valid gate — baseline is red with React Compiler
  errors, DEBT-33.)
- A named check that non-corporate staff resolve exactly as before.
- Browser verification list for Gary: what to click on `/staff`,
  `/staff/[id]`, and `/hr/compliance`, and what he should see on each.

---

## Standing constraints

- **No git commands.** Gary runs every one.
- No `vercel env pull` in any environment.
- Out-of-scope findings are logged as text in the session and never fixed
  inline.
- Database host echoed before any migration runs.

## Close

End with the standard triage **before** the report body:

**FIX NOW / RULING NOW / COMMENT / ROW** — a row is the last resort.

Expected COMMENTs from this session, based on what Phase 0 asks:
  - 0d sync-clobber finding
  - 0e load-bearing finding
  - 0f `assignment_type` capture, as input to a future auto-derivation phase
