# TYPE-1 — `Template.type`: a required column with no input

**Audit performed:** 2026-08-07
**Repo:** `~/Claude_Projects/Froot/froot`
**Branch:** `staging`
**HEAD at audit:** `2d5b93d` (clean tree)
**Scope:** read-only audit of `Template.type` — every write path, every read
path, and the colour map. No database was queried by this session. No code was
changed by this session.

**Why this file exists, and why it is late.** The TYPE-1 investigation session
produced its findings in a transcript and did not write them down. CLAUDE.md
§ *Where documents live* requires the opposite — *"AN AUDIT-ONLY SESSION MUST
WRITE ITS FINDINGS TO `docs/prompts/<NAME>_AUDIT.md` BEFORE IT REPORTS"*, ruled
2026-08-07 (DEBT-45) — and that rule was in the tree, committed in `7d984be`,
before TYPE-1 ran. This file pays that debt. It is written by the TYPE-2
session, and every claim in it was **re-verified against the working tree at
`2d5b93d` by reading the files**, not transcribed from the transcript. Three of
TYPE-1's statements did not survive that re-read; they are corrected in place
and flagged, at §3.1, §1.3 and §6.

It is a claim wholesale and is not edited afterwards.

---

## 0. Headline

`Template.type` is a **required, unconstrained, free-text column that the
template form cannot set.** The form carries the state and puts it in the save
payload, but no control was ever rendered for it. On create the state is `""`,
so `POST /api/templates` falls through to its `|| "Mid-Shift"` default and
stamps **"Mid-Shift" on every template made through the Create Template form**,
whatever the template actually is.

The eight values live in the database today came from a **one-off seed script**,
not from the product. The colour map that renders them is a **hardcoded literal
in a client component** and includes a ninth style, `"Audit"`, that no write
path has ever produced.

Every read of the column is display-only. **Nothing filters, sorts, groups,
gates or branches on `Template.type`** — verified by grep across `src/` for a
`where`/`orderBy` on the field: zero hits (§3.3). So the column has, at head,
exactly one job: printing a word on six screens.

---

## 1. The column

### 1.1 Schema

`prisma/schema.prisma:301-322`:

```prisma
model Template {
  id               String   @id @default(cuid())
  organizationId   String
  name             String
  description      String?
  type             String                              // ← :306
  frequency        String   @default("Daily")
  availabilityType String   @default("StoreHours")
  ...
}
```

`type` is `String` — **NOT NULL, and no `@default`.** Note the contrast with its
two immediate neighbours: `frequency` and `availabilityType` are also free-text
strings, but both carry a schema-level default. `type` does not, which is why
every write path has to invent one in application code, and why three separate
files each spell `"Mid-Shift"` independently (§2.5).

There is **no index** on `Template.type`, and no unique constraint anywhere that
mentions it.

### 1.2 No enum, no canonical list, no validation

There is no `TemplateType` enum, no `TEMPLATE_TYPES` constant, no Zod
`z.enum(...)`, and no equivalent of `src/lib/phases.ts` — which is what
`operationalPhase` got from DEBT-1b, and which is the shape a validated string
column takes in this codebase. `type` has none of it. Any string, including the
empty string, is accepted by the schema.

This is **not** the deliberate free-text decision that `Task.sectionName` got
from DEBT-2b (`docs/DEBT-2_AUDIT.md` §6), where the freedom was chosen and the
blank case is explicitly rejected at both API choke points. Nothing was decided
here. The column is unconstrained by omission, and blank is not rejected either
(§2.2).

### 1.3 Nine styles, eight values, one orphan

`src/app/(app)/templates/templates-client.tsx:12-22`:

```ts
const TYPE_COLORS: Record<string, string> = {
  Opener: "bg-orange-100 text-orange-700 border-orange-200",
  Closer: "bg-purple-100 text-purple-700 border-purple-200",
  "Mid-Shift": "bg-blue-100 text-blue-700 border-blue-200",
  Cleaning: "bg-green-100 text-green-700 border-green-200",
  Audit: "bg-yellow-100 text-yellow-700 border-yellow-200",       // ← orphan
  Management: "bg-red-100 text-red-700 border-red-200",
  Coffee: "bg-amber-100 text-amber-700 border-amber-200",
  Berries: "bg-pink-100 text-pink-700 border-pink-200",
  "Peet's Coffee": "bg-amber-100 text-amber-700 border-amber-200",
}
```

Nine keys. **Eight of them match a value the seed script writes; `"Audit"` matches
nothing.** No write path in the repository — form, POST, PATCH, import, seed —
produces the string `"Audit"`. It is a style waiting for data that never
arrived.

`TypeBadge` (`:24-31`) falls back to `bg-gray-100 text-gray-700 border-gray-200`
for any unknown key, so an unrecognised type renders grey rather than breaking.
That fallback is the only thing making the free-text column survivable on the
list page today.

**Correction to TYPE-1, which described this map as a "hardcoded map ...
including an orphaned 'Audit' style" and left the count implicit.** `Coffee` and
`"Peet's Coffee"` are **the same style** — both `amber` — so the nine keys
render in only **eight distinct colours**. That matters for the preset design in
TYPE-2: whatever preset list replaces this map has to tolerate two types sharing
a colour, because the live data already does.

---

## 2. Every write path

Four paths write `Template.type`. They were mapped **by reading each file**, not
by grepping for the field name — because one of them does not name it. This is
the same trap DEBT-59 recorded for the offset columns
(`docs/prompts/DEBT-59_AUDIT.md` §2.2), and it catches `type` identically.

### 2.1 `POST /api/templates` — create — **stamps "Mid-Shift"**

`src/app/api/templates/route.ts:84-95`:

```ts
const template = await prisma.template.create({
  data: {
    organizationId: org.id,
    name: templateData.name,
    description: templateData.description || null,
    type: templateData.type || "Mid-Shift",          // ← :89
    ...
```

The route validates `sectionName` (`:69-72`) and `operationalPhase` (`:76-82`)
by name and rejects bad values with a 400. **`type` is neither validated nor
rejected — it is defaulted.** Any falsy value, including `""` and the value the
form actually sends on create, silently becomes `"Mid-Shift"`.

### 2.2 `PATCH /api/templates/[id]` — update — **through an unnamed spread**

`src/app/api/templates/[id]/route.ts:37` destructures the body:

```ts
const { tasks, storeIds, appliesTo, ...templateData } = body
```

and `:105-112` spreads the remainder straight into the update:

```ts
return tx.template.update({
  where: { id },
  data: {
    ...templateData,                                  // ← type lands here
    appliesTo: appliesTo ?? "all",
    ...
```

**`type` is written on every template edit and the file never mentions the
word.** A repo-wide grep for `type` in this route returns only an unrelated
`IncomingTask` type alias at `:33`. The route's own comment at `:51-55` records
this trap for `startOffsetHours`/`endOffsetHours`; it applies to `type` too, and
is not stated there.

Two consequences worth naming:

- **No default and no validation on this path.** Unlike POST, there is no
  `|| "Mid-Shift"` here. A PATCH body carrying `type: ""` writes an empty
  string into a NOT NULL column, and the column accepts it. Nothing in the UI
  produces that today (§2.3), but nothing rejects it either.
- **It is the reason the value survives editing.** See below.

### 2.3 The form — state and payload, no input

`src/app/(app)/templates/template-form.tsx`:

```ts
const [type, setType] = useState(initialData?.type ?? "")     // :624
```

```ts
const payload = {
  name, description, type, frequency,                          // :798
  availabilityType: availType,
  ...
```

**`setType` is never called.** It is declared at `:624` and referenced nowhere
else in the 1239-line file. The Template Information card (`:917-1010`) renders,
in order: Checklist Name, Description, *"When should this checklist be
generated?"* (frequency), *"When is this checklist run?"* (availabilityType),
the StoreHours sub-card (Operational Phase + the two DEBT-59 offsets), and
*"Applies to"*. **There is no Type control anywhere on the page.**

So the state is a pure pass-through, and it behaves differently on the two
paths:

| | `initialData` | state value | what lands in the DB |
|---|---|---|---|
| **Create** | absent | `""` | `"Mid-Shift"` — POST's `\|\|` fires (§2.1) |
| **Edit** | present | the row's stored `type` | the same value, unchanged — PATCH's spread (§2.2) |

The edit path is a faithful round-trip *by accident*: `type` is NOT NULL and
every existing row is non-empty, so the value the form reads back is the value
it writes. Nothing enforces that. It is a property of the data, not of the code.

### 2.4 `POST /api/templates/import` — CSV — **the only honest write path**

`src/app/api/templates/import/route.ts:135`:

```ts
type: head.template_type?.trim() || "Mid-Shift",
```

with the column declared at `:43` as `template_type: z.string().optional().nullable()`
— accepted, trimmed, unvalidated against any list, and defaulted to `"Mid-Shift"`
when blank.

**This is the only path in the product where a value a human chose actually
reaches the column.** Everything else either invents `"Mid-Shift"` or copies a
value that is already there. Any change to type handling has to keep this path
working, because removing it would leave the column with no honest writer at
all.

### 2.5 `scripts/import-keva-templates.ts` — the seed — **where the live data came from**

Eight literal `type:` values, at `:22`, `:81`, `:123`, `:162`, `:213`, `:246`,
`:273`, `:308`:

`Opener` · `Mid-Shift` · `Closer` · `Cleaning` · `Management` · `Coffee` ·
`Berries` · `Peet's Coffee`

written through at `:354` (`type: tmpl.type`). This is a **script, not a route** —
it is not a product path and no operator can reach it.

The eight seeded strings are exactly the eight non-orphan keys in `TYPE_COLORS`
(§1.3). **The colour map was written to match the seed script, and the product
was never given a way to add a ninth.** That is the whole story of this column
in one sentence.

`"Mid-Shift"` appears as a literal in **three** places that write it —
`route.ts:89`, `import/route.ts:135`, `import-keva-templates.ts:81` — plus once
as a colour key at `templates-client.tsx:15`. There is no shared constant.

---

## 3. Every read path

### 3.1 Six rendering sites — **correction: TYPE-1 said five**

| # | Site | What it renders |
|---|---|---|
| 1 | `src/app/(app)/templates/templates-client.tsx:264` | `<TypeBadge type={template.type} />` — the coloured pill on the list |
| 2 | `src/app/(app)/templates/[id]/page.tsx:60` | `Type: <strong>{template.type}</strong>` — detail header |
| 3 | `src/app/print/template/[id]/page.tsx:82` | `Type: <strong>{template.type}</strong>` — printed template sheet |
| 4 | `src/app/(app)/checklists/page.tsx:129` | grey pill beside the store brand on each checklist card |
| 5 | `src/app/print/checklist/[id]/page.tsx:127` | `{store.name} • {template.type}` — printed checklist subtitle |
| 6 | `src/app/(app)/store-view/checklist/[id]/checklist-execution-client.tsx:147` | `{store.name} • {template.type}` — execution screen header |

**Six, not five.** TYPE-1 recorded five. Which one it missed cannot be
recovered from the transcript, but the two easiest to lose are #5 and #6: they
are the only two that reach the column through `checklist.template.type` rather
than a `template` variable, so a grep for `template.type` finds them while a
grep scoped to the templates directory does not.

**Only #1 is coloured.** The other five render the raw string in the ambient
text style. So "badge colours" today means *one screen*, and the other five
sites will keep working through any colour change without being touched.

### 3.2 Two API carries that render nowhere

| Site | Field | Consumed by |
|---|---|---|
| `src/app/api/checklists/route.ts:59` | `templateType: c.template.type` | **nothing** — `templateType` appears in no other file in `src/` |
| `src/app/api/stores/[id]/templates/route.ts:60` | `type: t.type` | declared on `TemplateOption` at `store-view-client.tsx:18`, **never rendered** |

Both are dead weight on the wire. Neither is a hazard; both are worth knowing
about, because a future migration that changes the shape of `type` will trip
the second one's TypeScript declaration and not the first one's.

### 3.3 Nothing reads it as data

Grepped across `src/` (excluding `src/generated/`) for a Prisma `where` or
`orderBy` naming `type` on `Template`: **zero hits.** The only `where: { type: ... }`
matches in the tree are on `InventoryAdjustment`
(`inventory/adjustments/page.tsx:72`, `adjustments/transfers/destinations/route.ts:19`,
`adjustments/transfers/route.ts:67`) — a different model.

There is no filter control, no sort control, no grouping, and no code path that
branches on the value. **`Template.type` has never been used for anything but
display.**

### 3.4 `Checklist` does not snapshot it

`prisma/schema.prisma` `model Checklist` carries `templateId` and reads the type
through the relation. There is **no denormalised copy** of the type on
`Checklist`, `Task` or `TaskLog`. Sites #4, #5 and #6 above all resolve it live
through the join.

This is load-bearing for TYPE-2: it means retiring the string column later has
**no second copy to chase**, and it means a rename of a type is instantly
visible on historical checklists — which is a product decision someone should
make deliberately rather than discover.

---

## 4. The duplicate path — **correction to "every UI-created template"**

`src/app/(app)/templates/templates-client.tsx:125-153` — the Duplicate button —
POSTs a full body including `type: template.type` (`:131`).

So `POST /api/templates` receives a real type on this path, `|| "Mid-Shift"`
does not fire, and the copy keeps the original's type. **Duplicating an
"Opener" produces an "Opener".**

TYPE-1's statement that *"POST stamps 'Mid-Shift' on every UI-created
template"* is therefore true of the **Create Template form** and false of
**Duplicate**. The distinction is not academic: Duplicate is the only way an
operator can currently create a template that is not a "Mid-Shift", and it is
almost certainly how any non-seeded, non-imported variety in the live data got
there. Anyone reading the data to answer *"which types are actually in use"*
needs to know that.

---

## 5. Blast radius in data — the query to run

Not run by this session (CLAUDE.md § *Environment Variables* — no deployed
credential reaches this machine). To be run by Gary in the Neon console, per
branch, before any migration:

```sql
SELECT current_setting('neon.branch_id', true) AS branch,
       o."id"   AS org_id,
       o."name" AS org_name,
       t."type",
       COUNT(*) AS templates
FROM "Template" t
JOIN "Organization" o ON o."id" = t."organizationId"
GROUP BY 1, 2, 3, 4
ORDER BY o."id", COUNT(*) DESC;
```

Grouped **by org id as well as by type** deliberately: the taxonomy TYPE-2
proposes is per-org, so the migration seeds one row per distinct
`(organizationId, type)` pair, and the count of those pairs — not the count of
distinct strings — is the number of rows it creates. Org named by ID per
CLAUDE.md § *Database Evidence*.

Two things this query answers that nothing in the code can:

1. **Whether any row carries a type outside the eight seeded values** — i.e.
   whether the CSV import (§2.4) or Duplicate (§4) has introduced varieties that
   render grey today.
2. **Whether `"Audit"` exists anywhere.** The code says no path writes it. The
   data is the only place that claim can be falsified.

Also worth running, since PATCH accepts it (§2.2):

```sql
SELECT current_setting('neon.branch_id', true) AS branch, COUNT(*)
FROM "Template" WHERE "type" = '' OR "type" IS NULL;
```

Expected zero. A non-zero result would mean the NOT NULL column is holding
blanks, and the TYPE-2 backfill would need a rule for them.

---

## 6. What this column is not — **correction to the "silent default" framing**

TYPE-1 framed `type: templateData.type || "Mid-Shift"` as the defect. It is the
*visible* defect, but it is downstream of the actual one.

**The actual defect is that the form was shipped with the field wired end to end
and the control omitted.** The state exists. The payload key exists. The API
handles it. The colour map renders it. Every layer of the feature is present
except the ten lines of JSX that would let a person choose. `"Mid-Shift"` is not
a decision that was made badly — it is the fallback catching a value that was
never collected, working exactly as written.

That distinction sets the shape of the fix. Removing the `||` default without
adding the control turns every template creation into a 500 or a NOT NULL
violation. **The control is the fix; the default is a symptom.**

---

## 7. Constraint discovered while auditing: Tailwind 4 cannot render a class string from the database

Not part of TYPE-1's brief, recorded here because it decides the colour design
and would otherwise be found the expensive way.

This project runs **Tailwind CSS 4, CSS-first**: `src/app/globals.css:1` is
`@import "tailwindcss"`, there is **no `tailwind.config.*` file** in the repo,
and there is **no `safelist`**. Tailwind 4 generates utility classes by scanning
source text for literal class names.

Therefore a `TemplateType` row storing `"bg-teal-100 text-teal-700
border-teal-200"` would render **unstyled** — the strings never appear in any
source file, so those classes are never generated. The badge would silently lose
its colour, on the one screen that has colour at all.

**A colour stored in the database must be a KEY that maps to a class string
written literally in a `.ts` file.** This is a hard build-system constraint, not
a preference, and it is the strongest argument for the preset-pair approach over
freeform hex — stronger than the design-consistency argument, because it is not
arguable.

---

## 8. The house pattern this should follow

Two existing models are per-org, operator-managed taxonomies with exactly the
shape a `TemplateType` needs (`prisma/schema.prisma`):

```prisma
model IngredientCategory {
  id             String  @id @default(cuid())
  organizationId String
  name           String
  glCode         String?
  sortOrder      Int     @default(0)
  organization   Organization @relation(fields: [organizationId], references: [id])
  ingredients    Ingredient[]
  @@unique([organizationId, name])
}

model LossReason {
  id             String  @id @default(cuid())
  organizationId String
  label          String
  isDefault      Boolean @default(false)
  sortOrder      Int     @default(0)
  organization   Organization @relation(fields: [organizationId], references: [id])
  adjustments    InventoryAdjustment[]
  @@unique([organizationId, label])
}
```

`@@unique([organizationId, name])` and `sortOrder` are the two conventions to
carry over. `LaborPosition` adds `active Boolean @default(true)` and
`@@index([organizationId])`, which is the fuller version of the same idea.

**A `TemplateType` model is not a new pattern in this codebase — it is the third
instance of an established one.**

---

## 9. Permission surface at head

- **`templates.manage` — `ADMIN_ONLY`** (`src/lib/permissions.ts:156`).
  Enforced by `denyUnlessTemplatesManage()` (`src/app/api/templates/access.ts`)
  on every `/api/templates` handler, and by `src/app/(app)/templates/layout.tsx`
  on every templates page.
- **`settings.access` — `ADMIN_ONLY`** (`src/lib/permissions.ts:192`), coarse by
  ruling (Gary, 2026-08-04) and deliberately held out of `ENFORCED_CAPABILITIES`.

So both candidate homes for a type-management UI are ADMIN-only today, and a
type manager placed in either inherits ADMIN without any new mechanism.

**Stale comment, noted not fixed.** `permissions.ts:156` still reads
`// §3 #2: templates layout admits MANAGER — needs ruling at migration`. The
layout's own comment says that ruling landed — *"PERM-2 §3 #2: templates are
corporate-controlled ... ADMIN only, and all three layers now agree ... This
layout previously admitted MANAGER"*. The registry comment describes a state
that no longer exists. No behaviour depends on it; it is a comment that lies,
of the same species as the `square.manage` value R4 corrected on 2026-08-06.

---

## 10. Summary — TYPE-1's findings, re-verified

| TYPE-1 claim | Verdict at `2d5b93d` |
|---|---|
| `Template.type` is `String` NOT NULL, no default | **Confirmed** — `schema.prisma:306` |
| Form has state and payload but no input | **Confirmed** — `template-form.tsx:624`, `:798`; no control in `:917-1010` or anywhere in the file |
| POST stamps `"Mid-Shift"` on every UI-created template | **Corrected** — true for the Create form, **false for Duplicate**, which carries the source type (§4) |
| The 8 live values came from `scripts/import-keva-templates.ts` | **Confirmed** — `:22, :81, :123, :162, :213, :246, :273, :308` |
| Five read sites, all display-only | **Corrected — six** rendering sites, plus two API carries that render nowhere (§3.1, §3.2). "All display-only" **confirmed**: zero `where`/`orderBy` on the field (§3.3) |
| Colours are a hardcoded map at `templates-client.tsx:12-22`, including an orphaned `"Audit"` | **Confirmed**, with the addition that nine keys yield only **eight distinct colours** — `Coffee` and `Peet's Coffee` share `amber` (§1.3) |

**New, not in TYPE-1:**

- PATCH writes `type` through an unnamed spread, with **no default and no
  validation** — an empty string is accepted into a NOT NULL column (§2.2).
- CSV import is the **only path where an operator-chosen value reaches the
  column** (§2.4).
- `Checklist` does **not** snapshot the type — no second copy to migrate (§3.4).
- Tailwind 4 CSS-first with no safelist means **a class string stored in the DB
  will not render** (§7).
- `IngredientCategory` and `LossReason` are the existing house pattern for a
  per-org managed taxonomy (§8).
- `permissions.ts:156` carries a stale comment about the templates layout
  admitting MANAGER (§9).
