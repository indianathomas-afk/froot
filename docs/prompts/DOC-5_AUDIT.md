# DOC-5 — Audit: document categories as a managed per-org entity

2026-09-28 · read-only · session prompt `docs/prompts/DOC-5.md`

**Repo gate:** on `staging`, level with `origin/staging`. The only untracked file is `docs/prompts/DOC-5.md`. `d929d1d` (the QREV-1 promotion merge) and `7605741` (its stamp) are both ancestors of HEAD. `DOC-5` does not appear anywhere in `docs/ROADMAP.yaml`, `docs/*.md`, or `src/generated/roadmap.ts`, so the id is free.

---

## 1. Every reader and writer of `HrDocument.category`

**THE HEADLINE FINDING: `HrDocument.category` is shared by the library AND by agreement forms.** Forms are `kind: "FillableForm"` rows on the same table, built at `/hr/forms`. They are validated against the same `HR_DOCUMENT_CATEGORIES` enum, rendered with the same `HR_CATEGORY_STYLES` chips, and shown on `/staff/[id]`. The prompt does not mention forms. See fork **F7**.

### Source of truth (constants)

| file:line | R/W | what |
|---|---|---|
| `src/lib/hr-documents.ts:4-11` | def | `HR_DOCUMENT_CATEGORIES` tuple + `HrDocumentCategory` type |
| `src/lib/hr-documents.ts:13-19` | def | `HR_CATEGORY_LABELS` (`PayAgreement`→"Pay Agreement", `HRManagement`→"HR Management") |
| `src/lib/hr-documents.ts:22-28` | def | `HR_CATEGORY_STYLES`: **literal class strings**, not badge-preset keys. Handbook is **orange** here, not amber (see F1) |
| `prisma/schema.prisma:1862` | def | `category String // Handbook \| PayAgreement \| Policy \| HRManagement \| Other`: NOT NULL, no default |

### Library (`/hr/documents`)

| file:line | R/W | what |
|---|---|---|
| `src/app/(app)/hr/documents/page.tsx:57` | R | `orderBy: [{ category: "asc" }, …]`, alphabetical on the raw string |
| `src/app/(app)/hr/documents/page.tsx:65` | R | maps `category: d.category` into the row |
| `src/app/(app)/hr/documents/documents-client.tsx:88,93-96` | R | filter chips come from `HR_DOCUMENT_CATEGORIES.filter(present)`. **They show no counts**, and they only render when more than one category is present |
| `src/app/(app)/hr/documents/documents-client.tsx:101-104` | R | section grouping iterates the **enum**. A row whose string is not in the enum is **silently dropped from the active list**. The archived list does not drop it. Latent today, because every writer is enum-validated |
| `src/app/(app)/hr/documents/documents-client.tsx:150,159` | R | chip label and section header |
| `src/app/(app)/hr/documents/documents-client.tsx:228,244-245` | R | row chip (no `?? Other` fallback here, unlike the other readers) |
| `src/app/(app)/hr/documents/documents-client.tsx:394,419,611-618` | W (UI) | Add Document dialog: category Select, default `"Handbook"` |
| `src/app/(app)/hr/documents/documents-client.tsx:706,720-721,771-778` | W (UI) | **Edit Document (pencil) dialog: category Select already present** (item 5) |
| `src/app/(app)/hr/documents/[id]/page.tsx:102` | R | detail page payload |
| `src/app/(app)/hr/documents/[id]/document-detail-client.tsx:110,129-130` | R | detail header chip |

### Library API

| file:line | R/W | what |
|---|---|---|
| `src/app/api/hr/documents/route.ts:50,64` | W (validate) | `z.enum(HR_DOCUMENT_CATEGORIES)` on the file and Link branches |
| `src/app/api/hr/documents/route.ts:132` | **W** | create, Link branch |
| `src/app/api/hr/documents/route.ts:151,201` | **W** | create, file branch |
| `src/app/api/hr/documents/[id]/route.ts:16` | W (validate) | PATCH `category: z.enum(...).optional()` |
| `src/app/api/hr/documents/[id]/route.ts:67-70` | **W** | PATCH `...rest` spreads `category` into the update |
| `src/app/api/hr/documents/[id]/audience/route.ts`, `…/versions` | none | do not touch category |

### Forms (`/hr/forms`), same column

| file:line | R/W | what |
|---|---|---|
| `src/app/api/hr/forms/route.ts:10,34,40` | **W** | create, `z.enum(HR_DOCUMENT_CATEGORIES)` |
| `src/lib/hr-forms.ts:84,91,101` | **W** | `createFillableForm` writes `category` |
| `src/app/api/hr/forms/[id]/route.ts:12,39,51` | **W** | PATCH metadata (title/category/archive) |
| `src/app/api/hr/forms/[id]/link/route.ts` | none | pairs forms, no category |
| `src/app/(app)/hr/forms/page.tsx:36` | R | list payload |
| `src/app/(app)/hr/forms/forms-client.tsx:80-81` | R | list chip |
| `src/app/(app)/hr/forms/forms-client.tsx:124,135,172-178` | W (UI) | New Form dialog, default `"HRManagement"` |
| `src/app/(app)/hr/forms/[id]/page.tsx:56` | R | builder payload |
| `src/app/(app)/hr/forms/[id]/form-builder-client.tsx:62,120,198-204` | W (UI) | builder metadata Select |

### Staff portal (`/my/documents`)

| file:line | R/W | what |
|---|---|---|
| `src/app/(my)/my/documents/page.tsx:81` | R | reference-library select |
| `src/app/(my)/my/documents/page.tsx:306` | R | **renders the RAW string**: staff see `PayAgreement` / `HRManagement` today, not the labels. This is an existing display bug, and DOC-5 fixes it for free by switching to the relation name |
| `src/app/(my)/my/documents/data.ts:37,146` | R | To-sign rows carry `category`. **No consumer renders it.** It is a dead wire |
| `src/app/(my)/my/documents/page.tsx:96,253` | none | that is `StaffDocument.category` (free-text, out of scope) |

### `/staff/[id]`

| file:line | R/W | what |
|---|---|---|
| `src/app/(app)/staff/[id]/page.tsx:292` | R | documents rows (Acknowledgment) |
| `src/app/(app)/staff/[id]/page.tsx:365,378,392,407` | R | forms rows (form + linked sub-form) |
| `src/app/(app)/staff/[id]/staff-documents.tsx:115-116` | R | chip |
| `src/app/(app)/staff/[id]/staff-form-documents.tsx:111-112` | R | chip |
| `src/app/(app)/staff/[id]/staff-uploaded-documents.tsx`, `api/staff/[id]/documents/**` | none | `StaffDocument.category`, out of scope |

### Compliance

| file:line | R/W | what |
|---|---|---|
| `src/lib/hr-compliance.ts:52,539` | R | `ComplianceDocItem.category` is populated, but **no consumer renders it**. I checked all eight importers (`/hr/compliance` page + staff table, `/staff`, `/staff/[id]/staff-compliance.tsx`, the dashboard banner, `/my`, `/api/dashboard/my-compliance`, `/my/documents/data.ts`). It is a dead wire |

### Not readers (checked, zero hits)

- **Signed-record / PDF generation** (`src/lib/hr-signed-pdf.ts`): no reference to category.
- **Search** (`src/lib/search.ts`, `/api/help/search`): HrDocument is not indexed.
- **Import/export:** no HrDocument import or export exists (the only export is `api/hr/training/export`).
- **Help articles** (`docs/guide/hr-documents.md`, `hr-forms.md`, `hr-hub.md`, `hr-signing.md`): they mention handbooks and policies as prose examples, not as named categories. Nothing needs editing. Optional COMMENT: a one-line "Manage Categories" mention in `hr-documents.md`.
- **Clerk webhook:** does not seed documents today (see F1, where it would join HR-20's `ensureStarter*` calls at `api/webhooks/clerk/route.ts:61,97`).

### Fixtures and scripts (writers)

| file:line | W value |
|---|---|
| `scripts/seed-key-agreement.ts:87,97` | `"HRManagement"` (FillableForm) |
| `scripts/verify-doc1c-compliance.ts:131,230` | `"Handbook"`, `"PayAgreement"` |
| `scripts/verify-hr8-compliance.ts:87,227` | `"Handbook"`, `"PayAgreement"` |
| `scripts/verify-self1-identity.ts:237` | `"Policy"` |

These keep working unchanged under F3, because the legacy column stays NOT NULL and they write it directly. With nullable `categoryId` they create uncategorized rows, which is legal under F2. No fixture edit is required.

## 2. Behavior keyed on a category value

**None.** I grepped every `category ===`/`!==`/`where: { category }` and every literal of the five values. No surface hides, gates, routes, or computes on a category value. The only value-specific code paths are these, and none of them is behavior:

- **Defaults:** Add Document preselects `"Handbook"` (`documents-client.tsx:394`). New Form preselects `"HRManagement"` (`forms-client.tsx:124`). Both become "first category by sortOrder" or a named default. See F7(c).
- **Ordering:** `page.tsx:57` sorts alphabetically on the raw string, and the client then regroups by enum order. Both are replaced by `sortOrder`.
- **Latent drop:** unknown strings vanish from the active grouping (`documents-client.tsx:101`). This is fixed structurally by DOC-5.

Every category can safely become renameable and deletable.

## 3. HR-20's Manage Categories dialog, as built

File: `src/app/(app)/hr/training/category-manager-dialog.tsx` (366 lines). Mounted at `training-client.tsx:654-657` (outline button with a `Tags` icon) and `:1013-1022`. Only rendered when `canManage`, which means ADMIN.

- **Delete while in use:** it is a **409 block with the count, plus a separate reassign act. It never reassigns and deletes in one step.** In the dialog, an in-use row shows a **Reassign** button in place of the trash icon. That button opens a sub-dialog that picks a target and POSTs `/api/hr/training/categories/[id]/reassign`, which is its own route (the TPL-1b shape). The count then drops to zero and the trash icon appears. The server backstop is `DELETE /…/[id]`, which counts **every** module, archived included, returns 409 `{ error, moduleCount }` when that count is above zero, and relies on FK `ON DELETE RESTRICT` behind it. A zero-count delete goes through an AlertDialog confirmation. The copy reads: "A category in use cannot be deleted. Reassign its modules … the count includes archived modules."
- **Rename:** a plain PATCH. When the category is in use, a confirmation shows the affected count first. There is no transaction, because nothing else is mirrored.
- **Reorder:** up and down chevrons. Each move is **two PATCHes that swap `sortOrder` with the neighbour**. There is no drag handle and no bulk-reorder endpoint. New categories are created with `sortOrder: categories.length`.
- **Colors:** `BADGE_PRESET_KEYS` from `src/lib/badge-presets.ts`, via a local `ColorSelect`. The server validates with `isBadgePresetKey`.
- **Validation:** `shared.ts` holds the zod schema, a case-insensitive `findNameConflict` that returns 409, and `isUniqueViolation` (P2002 → 409) for the race.
- **Guard:** `requireHrTrainingAccess()` is used on all five routes (GET, POST, PATCH, DELETE, reassign POST). It checks availability, then the hr module, then ADMIN.
- **Reusable for another entity?** **No, not without editing it.** The URLs (`/api/hr/training/categories…`), the exported `TrainingCategory` type with its `moduleCount` field, and the copy ("module", "Training Categories") are all hardcoded. Making it generic would change Training's file, which supports F6 (copy).

**Documents has an exact-shape guard already:** `requireHrDocumentAccess({ admin: true })` (`api/hr/documents/access.ts:11`). The forms routes use the same guard.

## 4. Neon query for Gary (run on each branch, do not paste ids across)

Change the literal in the first column on each branch: `br-broad-wave` (dev), `br-square-feather` (staging), `br-sparkling-block` (production).

```sql
SELECT
  'br-broad-wave'                                            AS branch,   -- EDIT PER BRANCH
  o."name"                                                   AS org,
  d."organizationId",
  d."category",
  COUNT(*)                                                   AS total,
  COUNT(*) FILTER (WHERE d."kind" <> 'FillableForm')         AS library_docs,
  COUNT(*) FILTER (WHERE d."kind" =  'FillableForm')         AS forms,
  COUNT(*) FILTER (WHERE NOT d."isActive")                   AS archived
FROM "HrDocument" d
JOIN "Organization" o ON o."id" = d."organizationId"
GROUP BY o."name", d."organizationId", d."category"
ORDER BY o."name", d."category";
```

The `forms` column sizes F7. Any `category` outside the five legacy values gets its own row under F1.

## 5. The pencil (Edit Document) dialog

**It already exposes category.** `EditDocumentButton` (`documents-client.tsx:701-800`) has a Category Select fed from `HR_DOCUMENT_CATEGORIES` (`:769-780`), PATCHes `category` (`:720`), and the route accepts it (`api/hr/documents/[id]/route.ts:16`). Phase 2 swaps its source. It does not need to add the field.

## Additional findings

- **A. No `teal` badge preset.** The staging test plan's step 2 adds "Food Safety in teal", but `BADGE_PRESETS` has gray, orange, amber, green, blue, purple, pink, and red. Adding teal is additive, and the file says as much (`badge-presets.ts`: "Adding a colour here is additive and safe"). It would also appear in Training's, Templates', and every other preset picker. **RULING NOW (F8).**
- **B. Handbook's live colour is orange, not amber.** The prompt's F1 says amber. Both keys exist, so this is a choice, not a substitution. Amber matches the prompt, and orange matches what users see today. **RULING NOW (folded into F1).**
- **C. `/my/documents` shows raw category strings** (`PayAgreement`). DOC-5 fixes this as a side effect. **FIX NOW (inside scope).**
- **D. Dead wires:** `ComplianceDocItem.category` and `/my/documents/data.ts` `category` are populated but never rendered. Switching them costs a join for no display. Lean: switch them to the relation name anyway, so no reader is left on the stale legacy string. **COMMENT.**
- **E. API path.** The prompt names `/api/document-categories`. Every HR route lives under `/api/hr/**`, and the training precedent is `/api/hr/training/categories`. Lean: `/api/hr/documents/categories` (this is a static segment, so it beats `[id]` in the Next router), or `/api/hr/document-categories`. **RULING NOW (F9).**

---

## Forks

Gary's leans are pre-filled, plus the three the audit adds (F7 to F9). **Confirm or overturn each one in your own words.**

- **F1 Seed + backfill.** Five rows per org, all renameable and deletable: Handbook (**amber** per the prompt, or **orange** to match today; finding B), Pay Agreement (green), Policy (blue), HR Management (purple), Other (gray). All are existing preset keys, so no substitution is needed. Seed **every org** (zero-count guard + `ON CONFLICT DO NOTHING`), then backfill `categoryId` by name mapping. Any other distinct string found in item 4 gets its own gray row, named exactly, appended after the five. The seed list must match `STARTER_DOCUMENT_CATEGORIES` exactly, and `ensureStarterDocumentCategories` joins HR-20's two Clerk-webhook call sites (the HR-20 precedent, "migration + webhook"). **Lean: yes.** *Open sub-point: amber or orange.*
- **F2 Nullable `categoryId`.** "Uncategorized (n)" chip. **Lean: yes.**
- **F3 Legacy string.** Kept as NOT NULL. Create writes the chosen category's name, or `"Other"`. Rename and reassign do not cascade into it. It gets a schema comment. *Sub-point the prompt leaves implicit:* the **Edit dialog's PATCH changes `categoryId` only** and leaves the legacy string stale, consistent with "only create writes it". **Lean: yes, and edit does not write it either.**
- **F4 Delete in use.** Copy HR-20: a 409 block with the count, archived included, plus a separate `…/[id]/reassign` route and a Reassign button in the dialog. **Lean: copy.**
- **F5 Who manages.** ADMIN via `requireHrDocumentAccess({ admin: true })`. **Lean: yes.**
- **F6 Component.** Copy the dialog to `src/app/(app)/hr/documents/document-category-manager-dialog.tsx`. Training's file is untouched. **Lean: copy.**
- **F7 (NEW) Forms share the column.** Choose one:
  - **(a) One taxonomy.** Forms read and write `categoryId` too: the New Form and builder selects are fed from the org's categories, and form chips (on `/hr/forms` and `/staff/[id]`) use the relation. The dialog's in-use count covers **documents + forms**, and the 409 message names both. The backfill covers form rows too. **Lean: (a).** Two taxonomies for one column would be worse, and the Key Agreement already reads "HR Management".
  - **(b)** Forms stay on the legacy enum. This leaves the enum alive, gives forms a stale column by design, and means a rename never reaches them.
  - **(c)** Under (a), the New Form default: first category by `sortOrder`, or none (Uncategorized). **Lean: none.** An empty default is honest, and "HRManagement" may not exist after a rename.
- **F8 (NEW) Teal.** Add a `teal` badge preset (additive; it appears in every preset picker), or change test-plan step 2 to an existing colour. **Lean: add teal.**
- **F9 (NEW) Route path.** `/api/hr/documents/categories` (under the HR namespace, beside its entity), or the prompt's literal `/api/document-categories`. **Lean: `/api/hr/documents/categories`.**

## Out-of-scope triage

| finding | class |
|---|---|
| `/my/documents` raw-string display (C) | **FIX NOW**, removed by the switch itself |
| Dead `category` wires in compliance and `data.ts` (D) | **COMMENT** in the work, switched with the rest |
| Teal preset (A) | **RULING NOW** (F8) |
| Handbook amber vs orange (B) | **RULING NOW** (F1) |
| Forms share the column | **RULING NOW** (F7) |
| Optional one-line "Manage Categories" mention in `docs/guide/hr-documents.md` | **COMMENT**, bundled into the build if you want it |

Counts: FIX NOW 1 · RULING NOW 3 · COMMENT 2 · ROW 0.

**STOPPED.** Nothing built, nothing committed. Waiting for Gary's rulings on F1 to F9 and the item 4 Neon results from all three branches.
