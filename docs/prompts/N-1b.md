# N-1b — Nutrition proof: source links, label documents, Estimated/Verified — TIER 3

TIER 3: schema migration, file storage, new routes. Plan-first with hard stops.
One phase, no riders. Two-commit pattern (work, then docs citing the work
SHA). `npm run build` gates commits; lint does not (DEBT-33). Never push.
Claude never connects to staging or production databases.

Saved as `/Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/N-1b.md`.

## Why

N-1 / N-1a are live on production (promotion `bdbeb47`, 2026-11-01; nutrition
module on for Keva org `cf888f2d-f234-48c7-8097-fd5b44b5b3dd`). The first real
nutrition file was built by planning chat from USDA values and *typical* label
values — estimates. The very first spot check proved why that matters: Keva's
almond milk is Almond Breeze **Original** (sweetened); chat had assumed
unsweetened. The supplier spec sheet (a PDF) holds its Nutrition Facts panel as
an **image**, so text extraction returned no numbers at all.

Gary's direction (2026-11-01): build checks and balances so every ingredient's
nutrition can carry its proof, and so Froot always knows which numbers are
**Estimated** and which are **Verified** against a real label. Think universal:
any supplier, any format (product-page link, PDF, PNG, JPG, phone photo).

Series: N-1b (this: proof + status, no AI) → N-1c (AI "read the label" from an
uploaded document or link, human confirms) → N-2 label preview → N-3 public
menu, which will show customers **only Verified** nutrition and allergens.

**Standing rule for this series:** nothing is promoted to production until Gary
confirms it on staging.

## What N-1b delivers

1. **Per-ingredient nutrition proof** (on the nutrition record):
   - `sourceUrl` — product page or spec-sheet link (optional, http/https only).
   - **Label document** — one uploaded file per ingredient (PDF, PNG, JPG/JPEG,
     WEBP; HEIC if the storage path supports it): stored file reference,
     original filename, content type, size, uploadedBy/At. Replacing it keeps
     no history in N-1b (DEBT row if the audit thinks history matters).
   - **Status** `ESTIMATED | VERIFIED`, plus `verifiedByUserId`, `verifiedAt`.
2. **Verification rules** (lean — Gary rules at the STOP):
   - VERIFIED can only be set by an ADMIN in the ingredient dialog, and only
     when the record has a label document **or** a source URL.
   - Any later change to the numbers, basis, or allergens through the import
     sets the record back to ESTIMATED. Changes made in the dialog ask "Still
     verified?" (keep or reset).
   - The CSV import can set `source_url` but can **never** set VERIFIED.
3. **Backfill:** every existing nutrition record becomes ESTIMATED.
4. **Template / import:** add `source_url` (writable) and `status`
   (read-only — exported for information, ignored on import) to the N-1a
   template, keeping N-1a's zero-changes round-trip guarantee.
5. **Ingredient dialog:** in the Nutrition & allergens section — source link,
   upload/replace/view the label document, the status badge, and (ADMIN) a
   "Mark verified" action with the rule above.
6. **Menu Nutrition:** per item "Verified" only when every food ingredient is
   VERIFIED; the summary adds "N of M items verified"; a filter for
   Estimated; the "To fix" list gains a "not verified" reason ranked the same
   way. **Stale:** VERIFIED older than 12 months shows "Re-check label"
   (counts as not verified for the summary).

Out of scope: AI label reading (N-1c), FDA rounding/labels (N-2), public pages
(N-3), document version history, cross-contact ("may contain") allergens.

## Phase 0 — repo gate (one command at a time, paste results)

`pwd` must end in `Froot/froot` (capital-F: STOP and tell Gary). `git status`:
on `staging`, clean apart from untracked prompts. `git log --oneline -3`
(HEAD should be `bdbeb47`, the N-1/N-1a promotion merge, or a later staging
commit).

## Phase 1 — audit (read-only), then STOP

Write `/Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/N-1b_AUDIT.md`.

A. **File storage.** What does Froot already use for uploaded files (Vercel
   Blob? another store? which features — HR documents, checklist photos,
   artifacts?) Env vars, size limits, public vs private URLs, how existing
   features serve a file to a signed-in user. Nutrition labels are not secret
   but should not be world-listable; recommend the existing pattern. If no
   storage exists, STOP: RULING NOW.
B. **N-1 code paths** that write nutrition: the dialog PUT, the import apply,
   bulk not-food. Every one must apply the reset-to-ESTIMATED rule. List them.
C. **N-1a round-trip:** confirm the added columns keep "unedited template →
   zero changes", and how `status` is ignored on import.
D. **Permissions:** who can view a label document (lean: anyone with
   `nutrition.view`), who uploads/verifies (ADMIN, `nutrition.manage`).
E. **Upload safety:** content-type and size validation, filename handling,
   and that a document is reachable only by users of the same org.

**Forks — chat's leans; Gary rules at the STOP:**

- **N1B-F1 Where status lives.** Lean: on `IngredientNutrition` (it covers the
  numbers and the ingredient's allergens together). An ingredient with
  allergens but no nutrition record has no status (shows as not verified).
- **N1B-F2 What VERIFIED requires.** Lean: a label document or a source URL,
  set by ADMIN in the dialog only. Import never verifies.
- **N1B-F3 Reset rule.** Lean: import changes reset to ESTIMATED; dialog
  changes ask.
- **N1B-F4 Stale window.** Lean: 12 months.
- **N1B-F5 Storage.** Whatever audit A finds Froot already uses; one document
  per ingredient; max 10 MB.

**STOP.** Report the audit path, a one-screen summary, the forks with leans,
anything RULING NOW. No code before Gary rules.

## Phase 2 — schema (after Gary's go), then STOP

Schema change + migration per `docs/MIGRATIONS.md`, including the backfill to
ESTIMATED. Run the `migrate diff` baseline against dev first so the file holds
only N-1b. **STOP after the migration file exists.** Gary applies it to dev
(`npx prisma migrate deploy` from the `froot` dir) and says go.

## Phase 3 — build (after Gary's go)

Deliverables 1–6 as ruled. Then:

- **Fixture** `scripts/verify-n1b-proof.ts`: VERIFIED refused without document
  or URL; import never sets VERIFIED; import number change resets VERIFIED →
  ESTIMATED; an unedited N-1a template (with the new columns) still plans zero
  changes; item verified only when every food line is VERIFIED; stale at 12
  months counts as not verified; not-food lines ignored for verification.
- Re-run the N-1 and N-1a fixtures; both must still pass.
- Routes added to `docs/PERMISSIONS_INVENTORY.md`.
- `npm run build` before each commit; stage only touched files.

## Docs commit

ROADMAP: N-1b row `in_progress` with the work SHA; add N-1c (AI label reader)
as a planned row if not present (read the file for conventions and next free
ids). DECISIONS: Gary's N1B rulings in his words, DRAFT (ratified at
PRE-PUSH-CHECK). MIGRATIONS entry for the new migration. Commit this prompt and
the audit.

## Report and stop

Work SHA, docs SHA, migration name, files touched, prisma commands (verbatim;
note `npm run build` runs `prisma generate`), fixture results (N-1, N-1a,
N-1b), and a short staging test plan for Gary (upload a real label PDF, verify,
edit via import → back to Estimated, check Menu Nutrition's verified count).
Do not push.
