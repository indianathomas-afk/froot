# DEBT-59 — Availability offsets: optional, blank by default

**Audit performed:** 2026-08-07
**Repo:** `~/Claude_Projects/Froot/froot`
**Branch:** `staging`
**HEAD at audit:** `ac59d64` (clean tree)
**Scope:** read-only audit + proposed plan. No database was queried by this
session. No code was changed by this session.

This is the audit artifact required by CLAUDE.md § *Where documents live*
("AN AUDIT-ONLY SESSION MUST WRITE ITS FINDINGS TO `docs/prompts/<NAME>_AUDIT.md`
BEFORE IT REPORTS"), written before the Part 1 report was delivered and before
any approval to execute. It is a claim wholesale and is not edited afterwards.

---

## 0. Headline — the row overstates the work

DEBT-59 says the fix is *"a form default plus a nullable column"*. **The column
half does not exist as work.** `Template.startOffsetHours` and
`Template.endOffsetHours` are **already nullable, with no Prisma-level
`@default`, and have been since the initial migration.**

```
prisma/schema.prisma:310    startOffsetHours Int?
prisma/schema.prisma:311    endOffsetHours   Int?

prisma/migrations/20260627002005_init/migration.sql:109    "startOffsetHours" INTEGER,
prisma/migrations/20260627002005_init/migration.sql:110    "endOffsetHours"   INTEGER,
```

`INTEGER` with no `NOT NULL` and no `DEFAULT`. So:

- **No schema change is required.** No migration, no SQL for Gary to run, no
  additive-only question to answer, no dev-first ordering constraint against the
  code change. The whole "schema" limb of the row's plan is already satisfied.
- Every server-side write path **already** persists `null` correctly when it is
  handed one (§2). The nullability is not merely allowed by the column — it is
  exercised today by real rows (§2.4, §2.5).

**The entire defect lives in two lines of React state.** That is the finding
that shrinks this row from S to XS.

---

## 1. Where 1 and 2 enter

Exactly one place in the application:

```
src/app/(app)/templates/template-form.tsx:637
  const [startOffset, setStartOffset] = useState(initialData?.startOffsetHours ?? 1)
src/app/(app)/templates/template-form.tsx:638
  const [endOffset, setEndOffset] = useState(initialData?.endOffsetHours ?? 2)
```

The `?? 1` / `?? 2` fire in two distinct situations, and it is worth separating
them because they are not the same defect:

1. **Create.** `initialData` is undefined, so state initialises to 1 and 2 and
   the operator sees a pre-filled window they did not choose.
2. **Edit of a row that already holds NULL.** `initialData.startOffsetHours` is
   `null`, `?? 1` fires, and the form shows 1 and 2. Saving that template —
   *for any unrelated reason, e.g. renaming it or adding a task* — converts a
   genuine NULL into a written 1/2. **This is the more corrosive half:** it
   destroys existing blank data on an edit that had nothing to do with the
   window, and it means the population of 1/2 rows grows over time without
   anyone touching the offsets.

The submit path is unconditional for `StoreHours` templates:

```
src/app/(app)/templates/template-form.tsx:793-794
  startOffsetHours: availType === "StoreHours" ? startOffset : null,
  endOffsetHours:   availType === "StoreHours" ? endOffset   : null,
```

Note the ternary already writes `null` for `AllDay` — further proof the whole
stack tolerates null end-to-end. The invented default therefore lands **only on
`StoreHours` templates**, which narrows the blast radius (§4).

### 1.1 A second, unrelated defect in the same two inputs

```
src/app/(app)/templates/template-form.tsx:962
  <Input type="number" value={startOffset} onChange={(e) => setStartOffset(Number(e.target.value))} min={0} max={24} />
src/app/(app)/templates/template-form.tsx:966
  <Input type="number" value={endOffset}   onChange={(e) => setEndOffset(Number(e.target.value))}   min={0} max={24} />
```

`Number("")` is `0`. **Today, an operator who clears the field writes 0, not
null** — there is currently no way to express "blank" through this form at all,
which is the mechanical reason the row's ask is a code change and not a copy
change. The fix in §6 has to handle this or it will simply move the invented
value from 1/2 to 0/0.

### 1.2 The labels claim the fields are required

```
src/app/(app)/templates/template-form.tsx:961  Label ... "Starts (hours before opening)" ... *
src/app/(app)/templates/template-form.tsx:965  Label ... "Ends (hours after opening)"    ... *
```

Both carry the ` *` required marker, matching `Operational Phase *` above them.
Nothing enforces it — `handleSave`'s only guard is
`disabled={saving || blankSectionCount > 0}` (`:899`), which does not look at
the offsets. So the asterisk is **already false today**; it is copy asserting a
constraint no code holds. It must come off as part of this row, because leaving
it would tell operators the blank they are now allowed to leave is illegal.

### 1.3 The existing DEBT-29 comment block

`:631-636` records why the inputs stay visible rather than hidden. Two of its
three clauses are superseded by this row and one survives:

- *"nothing reads them back — no availability gate exists"* — **still true**
  (§3).
- *"Hiding the inputs would not stop the write"* — **still true**, and is why
  DEBT-59 changes the write rather than the visibility.
- *"sending null instead changes what the CSV export emits, breaking parity with
  files already on disk"* — **this is now measurably wrong**, see §2.4/§2.5. The
  round-trip is symmetric and lossless for null in both directions. The comment
  must be rewritten, not deleted: the visible-and-labelled decision stands, the
  export-parity justification for the defaults does not.

---

## 2. Every write path, and what lands in the DB on each

Enumerated by grepping `template.create|update|upsert` over `src/` and
`scripts/` (excluding `src/generated/`), then reading each hit — because
`PATCH /api/templates/[id]` writes these columns **without ever naming them**
and a field-name grep alone misses it. That trap is documented at
`src/app/api/templates/[id]/route.ts:51-55`; this audit confirms it is still
live.

### 2.1 `POST /api/templates` — create
```
src/app/api/templates/route.ts:93-94
  startOffsetHours: templateData.startOffsetHours ?? null,
  endOffsetHours:   templateData.endOffsetHours   ?? null,
```
Faithful. Absent or null → `NULL`. **No coercion. No change needed.**
There is no Zod schema on this route; the offsets are unvalidated here, which
means nothing rejects a null.

### 2.2 `PATCH /api/templates/[id]` — update
```
src/app/api/templates/[id]/route.ts:109
  data: { ...templateData, ... }
```
Wholesale spread. Prisma treats an explicit `null` on a nullable field as
`SET NULL`, so a form payload of `startOffsetHours: null` persists as `NULL`.
Faithful. **No change needed** — but note this route validates
`operationalPhase` and nothing else, so it will also faithfully persist the `0`
from §1.1.

### 2.3 `POST /api/templates/import` — CSV import
```
src/app/api/templates/import/route.ts:31-38   const numish = z.preprocess(v => v === "" || v == null ? undefined : ..., z.number().optional())
src/app/api/templates/import/route.ts:57-58   template_start_offset_hours: numish
                                              template_end_offset_hours:   numish
src/app/api/templates/import/route.ts:139-140 startOffsetHours: head.template_start_offset_hours ?? null,
                                              endOffsetHours:   head.template_end_offset_hours   ?? null,
```
**An empty CSV cell already imports as `NULL`.** `numish` maps `""`, `null` and
`undefined` to `undefined`, and `.optional()` accepts it; the `?? null` then
writes NULL. A numeric cell still imports as its number. **No change needed, and
no both-shapes handling is needed** — see §2.5.

### 2.4 `GET /api/templates/export` — CSV export
```
src/app/api/templates/export/route.ts:40-41   if (value === null || value === undefined) return ""
src/app/api/templates/export/route.ts:92-93   t.startOffsetHours, t.endOffsetHours,
```
A `NULL` offset **already exports as an empty cell**. **No change needed.**

### 2.5 The round-trip, resolved

The row lists as IN SCOPE, quoting DEBT-29's reasoning: *"Emitting null changes
what the export writes, and files already on disk were written under the old
shape, so the import side has to accept both."*

**The audit finds no work here.** The two sides are already symmetric:

| DB value | export writes | re-import parses | DB value after |
|---|---|---|---|
| `NULL`   | `` (empty cell) | `undefined` → `?? null` | `NULL` |
| `1`      | `1`             | `1`                     | `1`    |

"Both shapes" is not a future problem the import must learn to handle — the
import **already** handles both, and always has. A CSV on disk written before
this change contains numbers in those columns and will keep importing as those
numbers; a CSV written after may contain empty cells and will import as NULL.
Both are correct, and neither errors. Nothing about DEBT-59 changes the export
or import code.

The one true statement in that clause is that **the export's output will change
in appearance** once templates start carrying NULL — an empty cell where a
number used to be. That is the intended, honest result, not a parity break.

### 2.6 `scripts/import-keva-templates.ts` — the seed script (NOT a form path)

A one-off seeding script, hardcoded to `TARGET_ORG_ID =
'cf888f2d-f234-48c7-8097-fd5b44b5b3dd'` (`:13`). It writes offsets per template
at `:349`, passing `tmpl.startOffsetHours ?? null` (`:358-359`).

**This matters for the existing-data question and is the audit's second
substantive finding.** Its eight templates carry *varied, evidently authored*
offsets:

| Template | availabilityType | start | end |
|---|---|---|---|
| Opener Checklist | StoreHours | **1** | **2** |
| Mid-Shift Checklist | StoreHours | 2 | 2 |
| Closer Checklist | StoreHours | **1** | **2** |
| Cleaning Checklist | AllDay | null | null |
| Management Tasks | AllDay | null | null |
| Coffee Checklist | StoreHours | 1 | 1 |
| Berries & Bouquets | AllDay | null | null |
| Peet's Coffee | StoreHours | 1 | 1 |

Five distinct combinations across eight rows, including three explicit nulls —
this is not a script that pasted the form default eight times. But **two of them
are exactly 1/2**, and those two are indistinguishable by value from a row the
form invented.

**So the ambiguity DEBT-59 warns will arrive when a gate ships already exists
today, for at least two known rows.** The row's premise — *"rows carrying
exactly 1/2 were almost certainly never chosen"* — is not safe as stated. A
backfill of `WHERE startOffsetHours = 1 AND endOffsetHours = 2` would erase two
deliberate values. This does not change what the code fix should be; it changes
the recommendation on existing data (§5).

Whether this script should stop hardcoding offsets is **out of scope** — it is a
frozen record of an actual import that already ran, not a live write path, and
changing it would be a rider.

---

## 3. Read paths: none

Confirmed at `ac59d64` by grepping both field names across `*.ts`, `*.tsx`,
`*.prisma`, `*.sql` (excluding `src/generated/` and `node_modules`) and reading
every hit. **Zero reads.** The complete set of non-write references is:

- `src/app/(app)/templates/templates-client.tsx:53-54` — type declaration only.
- `src/app/(app)/templates/templates-client.tsx:135-136` — `duplicate()` copies
  the source template's values through to `POST /api/templates` verbatim. This
  is a **faithful pass-through**, including of `null`. No change needed; it will
  propagate blanks correctly the day blanks exist.
- `src/app/(app)/templates/template-form.tsx:57-58` — prop type declaration.

No code path joins either column to `StoreHours` (`prisma/schema.prisma:168-177`)
at generation, listing, print, or cron. The sibling field `availabilityType` is
read in exactly one place — a display badge at `templates-client.tsx:271` — and
the offsets are not read even there. DEBT-48's finding at its head reproduces
exactly.

**No validation anywhere requires the fields to be present or numeric.** The
only validation on any template write path is `operationalPhase` (`route.ts:76-82`,
`[id]/route.ts:56-65`) and non-blank `sectionName`. The import's `numish` is
explicitly `.optional()`.

---

## 4. Blast radius in data — the query to run

**Not run by this session.** CLAUDE.md § Environment Variables forbids pulling
deployed credentials; this query goes through the Neon console, per branch, by
Gary.

Two things narrow the radius before any row is counted:

- `AllDay` templates are already `NULL` on both columns
  (`template-form.tsx:793-794` ternary), so only `availabilityType = 'StoreHours'`
  rows can carry the invented default.
- Per §2.6, `1/2` is a value the seed script also wrote deliberately, so the
  count below is an **upper bound** on "invented", not a measurement of it. The
  breakdown by `createdAt` and org is included precisely so a seeded row can be
  told from a form-written one.

```sql
-- DEBT-59 blast radius. Run once per Neon branch (dev, preview/staging,
-- production). The anchor columns and the counts come from the SAME query, so
-- the label cannot drift from the result (CLAUDE.md § Database Evidence).
SELECT
  current_database()                              AS db,
  current_setting('neon.endpoint_id', true)       AS endpoint_id,
  current_setting('neon.branch_id',   true)       AS branch_id,
  t."availabilityType",
  CASE
    WHEN t."startOffsetHours" IS NULL AND t."endOffsetHours" IS NULL THEN 'both NULL'
    WHEN t."startOffsetHours" = 1    AND t."endOffsetHours" = 2      THEN 'exactly 1/2 (form default shape)'
    WHEN t."startOffsetHours" IS NULL OR  t."endOffsetHours" IS NULL THEN 'one NULL, one set'
    ELSE 'other values'
  END                                             AS bucket,
  COUNT(*)                                        AS templates,
  COUNT(*) FILTER (WHERE t."isArchived")          AS archived,
  MIN(t."createdAt")                              AS first_created,
  MAX(t."createdAt")                              AS last_created
FROM "Template" t
GROUP BY 1,2,3,4,5
ORDER BY t."availabilityType", bucket;
```

And, to separate seeded rows from form-written ones in the `1/2` bucket — the
distinction §2.6 says the value alone cannot make:

```sql
-- DEBT-59 — the eight seed-script names, with their offsets and org, so a
-- deliberate 1/2 can be told from an invented one. Same anchor rule.
SELECT
  current_database()                        AS db,
  current_setting('neon.endpoint_id', true) AS endpoint_id,
  t."organizationId",
  t.name,
  t."availabilityType",
  t."operationalPhase",
  t."startOffsetHours",
  t."endOffsetHours",
  t."createdAt"
FROM "Template" t
WHERE t."startOffsetHours" = 1 AND t."endOffsetHours" = 2
ORDER BY t."organizationId", t."createdAt";
```

Read the result with the branch **named** alongside the anchor columns, per
CLAUDE.md § Database Evidence. Orgs are identified by ID, not name.

**What the numbers would mean:**

- Large `both NULL` count on `StoreHours` rows → most templates predate or
  escaped the form; the fix is urgent because §1's edit-path would convert them
  one save at a time.
- `exactly 1/2` rows whose names are **not** in §2.6's table, or whose org is not
  `cf888f2d-f234-48c7-8097-fd5b44b5b3dd` → genuinely invented, no seed
  explanation available.
- `other values` → operators demonstrably do set these fields on purpose, which
  raises the cost of a blanket backfill.

---

## 5. Existing data — OPEN QUESTION for Gary, with a recommendation

**Recommendation: do NOT backfill. Ship the code fix alone.**

Reasons, in order of weight:

1. **§2.6 breaks the premise.** The row's case for backfilling is that a 1/2 row
   was "almost certainly never chosen". The seed script wrote a deliberate 1/2
   to at least two templates. A `WHERE start = 1 AND end = 2` update is therefore
   known-lossy before it runs, and it destroys exactly the kind of information
   the row exists to protect.
2. **A backfill is destructive; the code fix is not.** Once a chosen 1/2 is
   nulled, nothing distinguishes it from a template that never had a window —
   which is the same irreversibility DEBT-59 is filed to prevent, applied in the
   opposite direction.
3. **The urgency argument does not apply to old rows.** The reason to act now is
   that no gate reads the fields. That reason is fully satisfied by stopping the
   write. Correcting historical rows stays cheap for exactly as long as no gate
   exists — i.e. it can be done later on the same terms, with better information
   (the counts, plus whatever the feature phase decides an offset means).
4. **The feature phase has to look at this data anyway.** DEBT-48's scoping must
   decide what a window means and what an absent one means. That is the sitting
   where "which of these rows meant it" gets decided, with the semantics in hand.

**What would flip it to backfill:** if §4 shows a large `exactly 1/2`
population **in orgs other than `cf888f2d-f234-48c7-8097-fd5b44b5b3dd`**, or
with `createdAt` clustered well after the seed run, *and* the `other values`
bucket is near-empty. That combination would say operators never set these
fields deliberately and the 1/2 rows are uniformly form residue — at which point
nulling them loses nothing and spares the feature phase a data-archaeology
problem. A narrowly-scoped backfill excluding the eight seed names in the target
org would be the safer form even then.

Either way the decision is Gary's, and **the code fix does not depend on it** —
the two are independently shippable in either order.

---

## 6. Proposed code change (one phase, this row only)

All of it in `src/app/(app)/templates/template-form.tsx`. No schema change, no
migration, no API change, no export/import change.

1. **State becomes nullable, with no invented default** (`:637-638`):
   ```ts
   const [startOffset, setStartOffset] = useState<number | null>(initialData?.startOffsetHours ?? null)
   const [endOffset,   setEndOffset]   = useState<number | null>(initialData?.endOffsetHours   ?? null)
   ```
   This fixes both create (blank) and edit-of-a-NULL-row (stays blank, §1).

2. **Inputs render and accept blank** (`:962`, `:966`) — fixes §1.1 so clearing
   the field yields `null`, not `0`:
   ```tsx
   value={startOffset ?? ""}
   onChange={(e) => setStartOffset(e.target.value === "" ? null : Number(e.target.value))}
   ```
   Plus a `placeholder` stating what blank means.

3. **Placeholder / helper copy.** It must say only what is true at
   `ac59d64`. Nothing reads these fields, so blank cannot honestly mean "always
   available" — that would promise the very gate DEBT-29 stripped the copy of
   promising, and would be a fresh instance of the defect DEBT-29 closed.
   Proposed placeholder: **`Optional`**. Proposed replacement for the helper line
   at `:973`: *"Optional. Recorded for reference — not yet used to show or hide
   checklists. Leave blank if no window has been decided."*

4. **Drop the ` *` from both labels** (`:961`, `:965`) — §1.2; nothing enforces
   them and the fields are now explicitly optional. The `Operational Phase *`
   asterisk above them **stays**: that field *is* enforced, at
   `route.ts:76-82` and `[id]/route.ts:56-65`.

5. **Rewrite the DEBT-29 comment at `:631-636`** — §1.3. Keep the
   visible-and-labelled decision and its reasoning; remove the export-parity
   claim, which §2.4/§2.5 disprove; record that DEBT-59 stopped the write and
   that the columns were nullable all along.

The submit ternary at `:793-794` needs **no change** — `availType === "StoreHours"
? startOffset : null` already yields `null` when `startOffset` is `null`.

**Out of scope, explicitly, whatever else is noticed:** DEBT-48's feature phase,
DEBT-36's Section entity, DEBT-32's list-folding, the unvalidated spread at
`[id]/route.ts:109`, and the seed script's hardcoded values.

---

## 7. Regression check — what proves nothing broke

Nothing reads these fields, so no behaviour can regress; what must be proved is
that the *write* is now blank-preserving and that no surface throws on a null.
`npm run build` is the type gate for the `number → number | null` widening
(`npm run lint` is not a gate — DEBT-33).

Manual pass, each observation labelled with its **Clerk instance + org ID** per
CLAUDE.md § Browser Evidence:

1. **New template renders blank.** `/templates/new`, availability
   `Relative to Store Hours` → both offset inputs empty, showing the placeholder,
   labels without `*`.
2. **Save with blanks round-trips as NULL.** Save it, reopen for edit → inputs
   still blank. (Confirms the create path *and* that reopening a NULL row no
   longer re-invents 1/2 — the §1 case-2 defect.)
3. **A set value still round-trips.** Enter 3 and 4, save, reopen → 3 and 4.
4. **Clearing a set value blanks it.** On that same template clear both, save,
   reopen → blank, not `0`. (This is the §1.1 fix; `0` here is a failure.)
5. **Editing an unrelated field preserves blank.** On the blank template from (2),
   change only the name, save, reopen → offsets still blank. (The corrosive case.)
6. **Export emits empty cells.** `GET /api/templates/export` → the blank
   template's `template_start_offset_hours` / `template_end_offset_hours` cells
   are empty; a set template's still carry numbers.
7. **Re-import round-trips both.** Import that same CSV back → blank stays NULL,
   numeric stays numeric, zero row errors.
8. **`AllDay` unchanged.** Switch a template to `All Day`, save → both columns
   NULL, as before this change.
9. **Duplicate propagates blank.** Duplicate the blank template from the list →
   the copy carries NULL, not 1/2.

Steps 6–7 are the DEBT-29 round-trip concern; per §2.5 they are expected to pass
without any code change, and are listed to *demonstrate* that rather than to
assume it.

---

## 8. Summary of audit findings vs. what the row claimed

| Row's claim | Audit finding |
|---|---|
| "a form default plus a nullable column" | The column is **already nullable with no default** since the init migration. Schema work: **none**. |
| Offsets "default to 1 and 2 … written on every save" | **Confirmed** (`template-form.tsx:637-638`, `:793-794`), and worse than stated: the `??` also **overwrites existing NULLs** on any unrelated edit. |
| "Nothing reads them back" | **Confirmed** at `ac59d64`. Zero read sites; zero validation requiring them. |
| Export/import parity "has to accept both" shapes | **Already does, both directions.** Export emits `""` for NULL; import maps `""` → NULL. **No work.** |
| Rows at 1/2 "were almost certainly never chosen" | **Not safe.** The seed script deliberately wrote 1/2 to `Opener Checklist` and `Closer Checklist`. A value-matched backfill would erase chosen data. |
| (not in the row) | Clearing an offset input today writes **`0`**, not null — there is currently no way to express blank at all. |

**Net:** smaller than filed (no migration, no API change, no import/export
change), but with one finding that argues **against** the backfill the row
leaned toward.
