# DOC-5 — Document categories become a managed per-org entity

**TIER 3** (schema: new table + FK + seed/backfill migration). Audit → STOP for rulings → build → STOP after migration generation → Gary applies to dev → fixture → commit. Commit only, never push.

Repo: `/Users/garythomas/Claude_Projects/Froot/froot` · Branch: `staging`

## Repo gate (before anything else)

1. Confirm the current branch is `staging` and the tree is clean.
2. Confirm `staging` contains the QREV-1 promotion merge `d929d1d` and its stamp `7605741`, meaning main has been merged back. If either is missing, STOP and report. Do not merge anything yourself.
3. Read `/Users/garythomas/Claude_Projects/Froot/froot/docs/ROADMAP.yaml` and confirm `DOC-5` is a free id. If it is taken, use the next free `DOC-n` and say so. Never assume the "next free" note is current (DEBT-84).

## What Gary asked for

On `/hr/documents`, an ADMIN can add, rename, recolor, reorder, and delete document categories, using the same setup as `/training` → Manage Categories (HR-20). Chips are color-coded with counts. Section headers and the Add/Edit Document category dropdown come from the org's categories, not a hardcoded list.

## Precedent to copy

HR-20 (`TrainingCategory`, migration `20260810194426_hr20_training_category_entity`, `src/lib/training-categories.ts`, the Training Manage Categories dialog). Copy it exactly in shape:
- `@@unique([organizationId, name])`, `sortOrder`, `@@index([organizationId])`.
- `colorKey` stores a **key** from `src/lib/badge-presets.ts`, never a class string (Tailwind 4 constraint).
- No `active` column.
- The FK is `onDelete: Restrict`, **annotated explicitly** in schema.prisma (the TPL-1a/HR-20 drift lesson).

## Phase 1 — Audit (read-only), then STOP

Write `/Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/DOC-5_AUDIT.md` covering:

1. **Every reader and writer of `HrDocument.category`** (file:line), including the library page, Add/Edit Document dialogs and their API routes, `/my/documents`, `/staff/[id]` (documents and forms rows), `/hr/compliance`, signed-record/PDF generation, import/export, search, help articles, and fixtures. Mark each as a read or a write.
2. **Any behavior keyed on a category value** (e.g. `category === "HRManagement"` hiding something). A category that drives behavior cannot become renameable or deletable without a ruling. List each one found, or state plainly that none exist.
3. **The HR-20 Manage Categories dialog as built.** Document how delete-while-in-use behaves (409 block vs reassign-then-delete), how reorder is done, where color options come from, and whether the component can take a different entity without touching Training's behavior.
4. **Neon query for Gary to run** on each branch (dev `br-broad-wave`, staging `br-square-feather`, production `br-sparkling-block`). It should return the distinct `category` values per org with counts, and put the branch literal in the output. Do not run it yourself.
5. **The pencil (edit) dialog** on a library row. Report whether it exposes category today.

Then STOP and present the forks below with the audit's evidence. Build nothing.

### Forks (Gary's leans pre-filled; confirm or overturn in his own words)

- **F1 Seed + backfill.** Seed each org with the five current values as renameable, deletable rows: Handbook (amber), Pay Agreement (green), Policy (blue), HR Management (purple), Other (gray). Use keys that exist in badge-presets, and substitute the nearest existing key if one doesn't. Backfill `categoryId` by mapping `Handbook`, `PayAgreement`→Pay Agreement, `Policy`, `HRManagement`→HR Management, `Other`. Any other distinct string found in item 4 gets its own category row with that exact name, so no document ends up uncategorized. The seed list must match a `STARTER_DOCUMENT_CATEGORIES` constant exactly (HR-20 rule). Make it idempotent (zero-count guard + `ON CONFLICT DO NOTHING`). **Lean: yes.**
- **F2 Nullable `categoryId`.** Uncategorized is a legal resting state, as in HR-20, and gets an "Uncategorized (n)" chip. **Lean: yes.**
- **F3 Legacy `category` string.** Keep the column (additive only). All readers switch to the relation. The create paths keep writing it, because it is NOT NULL, using the chosen category's name, or `"Other"` when uncategorized. Rename and reassign do **not** cascade into it, so it is stale by design, like `Template.type`. Put a schema comment on it saying so. Retirement is a later destructive row. **Lean: yes.**
- **F4 Delete while in use.** Copy HR-20's dialog behavior exactly, whatever item 3 found. **Lean: copy, don't invent.**
- **F5 Who manages.** ADMIN only, matching every other document-configuration route. **Lean: yes.**
- **F6 Component.** Copy and adapt the Training dialog into a documents dialog. Do not refactor Training's component into a shared one in this session, so Training's blast radius stays zero. **Lean: copy.**

## Phase 2 — Build (after Gary's go)

1. Add the `HrDocumentCategory` model and `HrDocument.categoryId String?` with the relation (`onDelete: Restrict`, annotated) to schema.prisma, plus the F3 comment on the legacy column.
2. Generate the migration with `prisma migrate diff --from-config-datasource` against dev, then hand-append the seed + backfill block per F1 with an HR-20-style header comment. **The only prisma command you may run is `migrate diff`. Never run dev/deploy/reset/execute.**
3. **STOP.** Report the migration file path and contents. Gary runs `npx prisma migrate deploy` on dev and says go. Commit nothing before that.
4. After Gary says go, build the rest:
   - The `/api/document-categories` routes, modeled on the training-category routes and ADMIN-only.
   - The **Manage Categories** button in the Document Library header, left of Add Document, with a matching outline style.
   - Dynamic colored chips with counts, including "Uncategorized".
   - Library sections ordered by `sortOrder`.
   - The Add Document and Edit Document dropdowns fed from the org's categories. Add category to the edit dialog if the audit found it missing.
   - Every reader from audit item 1 switched to the relation name, falling back to "Uncategorized".
5. Write a fixture `scripts/verify-doc5-categories.ts` that checks:
   - seed idempotency;
   - that every pre-existing document is backfilled (zero null `categoryId` after the seed on a fixture org with the five legacy strings plus one unknown string);
   - that rename changes the displayed name and leaves the legacy string alone;
   - that delete-in-use behaves per F4;
   - that a non-ADMIN gets 403 on every write route;
   - that create writes the legacy string per F3.
6. Run the fixture, then `npm run build`. Report every prisma command run, verbatim. Note that `npm run build` runs `prisma generate`.
7. Make two commits:
   - the work commit;
   - the docs commit: ROADMAP row DOC-5 `in_progress` with the work SHA, a DECISIONS.md draft of F1–F6 (Gary ratifies at PRE-PUSH-CHECK), and a MIGRATIONS.md entry.

   Stage only the files you touched. Never use `git add -A`.

## Out of scope

- Role-level document visibility (DOC-4).
- Retiring the legacy `category` column.
- Any change to Training categories.
- `StaffDocument.category` (a separate free-text label).

Classify out-of-scope findings as FIX NOW / RULING NOW / COMMENT / ROW before the report.

## Staging test plan (for the report; Gary runs it after push)

As `indianathomas` (ADMIN) on `/hr/documents`:
1. The Keva Juice Employee Handbook sits under Handbook, and the I-9 sits under Other.
2. Add "Food Safety" in teal, reorder it to the top, and reload. Its order and color persist.
3. Rename Policy → "Policies". The chip, section header, and dropdown all update.
4. Try to delete Handbook while the handbook uses it. Expect the F4 behavior.
5. Delete an unused category. It disappears.
6. Log in as Tommy (STORE). There is no Manage Categories button, and `/my/documents` shows the category names.
