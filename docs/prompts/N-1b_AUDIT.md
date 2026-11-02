# N-1b AUDIT — nutrition proof: source links, label documents, Estimated/Verified

TIER 3. Phase 1, read-only. Written 2026-11-01 against `staging` at `bdbeb47`
(the N-1/N-1a promotion merge). No file outside this one was touched, no
database was queried, no prisma command was run.

Repo gate (Phase 0), verbatim:

- `pwd` → `/Users/garythomas/Claude_Projects/Froot/froot`
- `git status` → on `staging`, up to date with `origin/staging`; only untracked
  file `docs/prompts/N-1b.md`
- `git log --oneline -3` → `bdbeb47 Merge branch 'staging'` ·
  `b143e5f docs(N-1a PRE-PUSH-CHECK)…` · `bc3d621 docs(N-1a)…`

---

## A. File storage

**Froot uses Vercel Blob (`@vercel/blob ^2.5.0`) and has THREE stores, in TWO
patterns.** There is no other file store.

### A1. The public default store — `BLOB_READ_WRITE_TOKEN` (SDK resolves it implicitly)

| Feature | Route | Types | Cap |
|---|---|---|---|
| Template task reference attachments | `api/upload/task-attachment` (+ `[taskId]`) | PDF, JPG, PNG | 10 MB |
| Checklist execution photos (CHK-7) | `api/upload/checklist-photo` | JPG, PNG, WEBP, HEIC/HEIF | 4 MB |
| Message attachments | `api/upload/message-attachment` | — | 10 MB |
| PO invoice photo/PDF (I-7) | `api/upload/po-invoice` | PDF, JPG, PNG | 10 MB |
| Calendar event attachment (R4, 2026-09-17) | `api/calendar/events/[id]/attachment` | PDF, JPG, PNG | 10 MB |
| Forecasting import file | `api/forecasting/import` | — | 5 MB |

All `put(..., { access: "public" })` through a Function body (`formData`), so
they are bounded by Vercel's ~4.5 MB request limit regardless of the stated
cap (CHK-7's comment says so explicitly; the 10 MB caps are not reachable from
a browser). Org scoping happens at **upload** time only: the stored URL is a
public CDN URL, fetchable by anyone who holds it, with no session.
**"Not world-listable" — yes** (listing a store needs the RW token).
**"Reachable only by users of the same org" — no.** The calendar route's
comment records this as an accepted limitation for that sensitivity class, and
says moving to the private pattern "is a ruling".

### A2. The private pattern — authorize, then presign

- **`froot-hr`** — `HR_BLOB_READ_WRITE_TOKEN`, `src/lib/hr-files.ts`. HR
  documents, staff documents, training resources, signed records, certificates.
  PDF/PNG/JPG/DOC/DOCX, 25 MB.
- **`froot-guide`** — `GUIDE_READ_WRITE_TOKEN` (fallback
  `GUIDE_BLOB_READ_WRITE_TOKEN`), `src/lib/guide-files.ts`. Help screenshots.
  PNG/JPG/WEBP, 5 MB. The file header records the ruling that split it from
  `froot-hr` (HELP-1a fork 9, 2026-09-04): *"separate froot-guide store and
  token. Pattern shared, blast radius not."*

How the private pattern works (exemplar: `api/staff/[id]/documents/upload-url`
+ `api/staff/[id]/documents` + `api/hr/training/resources/[id]/download`):

1. **upload-url** (gated) → `issueSignedToken` + `presignUrl` for a PUT, with
   `allowedContentTypes: [declared type]` and `maximumSizeInBytes` baked into
   the signature, so the CDN enforces both even against a dishonest client.
   The pathname is namespaced `hr/{org.id}/<feature>/{entityId}/<safe name>-<random>`.
   **The browser PUTs straight to the store** — this is what makes files above
   ~4.5 MB possible at all.
2. **register** (gated again) → namespace pin (the URL's pathname must start
   with `hr/{org.id}/…/{entityId}/`), then `readHrFileMeta` = `head()` with the
   store's token (a URL in any other store fails here) and a server-side fetch
   of the bytes for size, content type and sha256. Client metadata is never
   trusted.
3. **read** (gated) → resolve the row org-scoped, unknown/cross-org → 404, then
   either **307 to a 5-minute signed GET URL** (HR — `getHrFileDownloadUrl`) or
   **stream the bytes same-origin** (guide — `streamGuideImage`, for `<img>`,
   `Cache-Control: private`). The delegation token is cached ~9 minutes.

Env provisioning per private store: connect the store in Vercel (Preview +
Production) and add the token to local `.env` by hand. The variable is named
from the **prefix chosen at connect time** (`<PREFIX>_READ_WRITE_TOKEN`) — the
`GUIDE` vs `GUIDE_BLOB` trap cost HELP-1a a session (2026-09-05).

### A3. Recommendation — and why this is a RULING NOW, not a lean

The prompt's bar is "not secret, but not world-listable", and item E asks that
"a document is reachable only by users of the same org". **The public store
meets the first and fails the second. Only the private pattern meets E.** So
"whatever Froot already uses" (F5) does not resolve on its own: Froot uses
both, and the two answer E differently.

Three options:

- **(i) New private store `froot-nutrition`** mirroring `guide-files.ts`
  (own token, own helper `src/lib/nutrition-files.ts`). Meets E; follows the
  "pattern shared, blast radius not" ruling. **Cost: Gary provisions a store
  and a token in three environments before an upload works anywhere** — the
  exact dependency R4 avoided for calendar. Recommended prefix `NUTRITION_BLOB`
  → `NUTRITION_BLOB_READ_WRITE_TOKEN`; the code reads the one name Gary
  actually creates, which he tells the session.
- **(ii) Reuse `froot-hr`** under `nutrition/{org.id}/…`. Meets E with no
  provisioning. Contradicts the blast-radius ruling: a nutrition credential (or
  a nutrition route bug) would sit one prefix away from signed employment
  records.
- **(iii) Public default store**, the calendar/PO pattern. No provisioning,
  but fails E outright, **and caps uploads at ~4.5 MB** (Function body), which
  a multi-page supplier spec PDF or a phone photo can exceed — below F5's
  10 MB.

**Audit's recommendation: (i).** Labels are not secret, but N-3 will show
customers "Verified" on the strength of these files, so they are the evidence
behind a public claim; that is closer to the private tier's purpose than to a
checklist photo's. **Phase 3 cannot be verified on staging until the store is
connected in Preview** — if (i) is ruled, provisioning is Gary's and should
happen before Phase 3 starts.

---

## B. Every N-1 code path that writes nutrition

Enumerated by **callers of the writes**, not by searching for a guard
(CLAUDE.md § Verifying a guard covers every path). Searched all of `src/` and
`scripts/` for `ingredientNutrition.*`, `allergens:` and `nutritionExempt:`
writes. **Four write paths, three routes:**

| # | Path | Writes | Gate | Reset rule needed |
|---|---|---|---|---|
| W1 | `api/nutrition/ingredients/[id]` **PUT** (dialog) | `Ingredient.allergens` + `nutritionExempt`, then `IngredientNutrition` **upsert** — or **`deleteMany` when `nutrition: null`** | `nutrition.manage` (ADMIN) | Yes — "Still verified?" |
| W2 | `api/nutrition/import/apply` POST | per row: `Ingredient` allergens/flag (only where they differ), `IngredientNutrition` upsert (only where it differs) | `nutrition.manage` | Yes — reset to ESTIMATED |
| W3 | `api/nutrition/ingredients/bulk-exempt` POST | `Ingredient.nutritionExempt` only (`updateMany`) | `nutrition.manage` | No (see B4) |
| W4 | (N-1b's new routes: document register/replace/remove, verify) | `IngredientNutrition` proof + status columns | `nutrition.manage` | — they set the state |

Checked and **not** writers: `api/inventory/ingredients/[id]` PATCH (MANAGER
may call it; it writes `kind` but never nutrition, allergens or the flag);
`api/inventory/ingredients/merge` (soft-deletes the merged ingredient; its
nutrition row stays on the deleted ingredient, recipe lines move to the
survivor, so the **survivor's** status governs afterwards — correct with no
change); `inventory/ingredients/bulk` and `import` (no nutrition fields); no
code path hard-deletes an `Ingredient` (the `onDelete: Cascade` on
`IngredientNutrition` is never exercised).

### B1. W1 deletes the record — and would delete the proof with it

The dialog sends `nutrition: null` whenever every nutrient field and the basis
amount are blank (`nutrition-section.tsx` `blank`), and the PUT then
`deleteMany`s the record. Under F1 the proof columns live on that record, so
clearing the numbers silently throws away the source URL, the document
reference and the status — and **orphans the blob**. Needs a rule (FORK
N1B-F7 below).

### B2. W2's change detection is too coarse for the reset rule

`sameNutrition()` (`src/lib/nutrition-import.ts`) compares basis, every
nutrient **and `sourceNote`**. A file that changes only the free-text source
note therefore produces a nutrition write today — and would reset VERIFIED.
The prompt's rule is "numbers, basis, or allergens". Phase 3 must split the
comparison: one predicate for "proof-relevant change" (basis + nutrients +
allergens), separate from "anything to write".

### B3. W2 writes allergens on a different row from the status

Allergens live on `Ingredient`, status (F1) on `IngredientNutrition`. A
`DETAILS_ONLY` row (allergens change, numbers do not) writes only `Ingredient`
today. The reset must therefore also fire on `allergensWrite !== null` and
touch the `IngredientNutrition` row if one exists — easy to miss, because the
nutrition upsert does not run for that row.

### B4. Not-food (W3, and W2's `NOT_FOOD` rows) does not touch numbers

Marking a VERIFIED ingredient not-food leaves its record and status alone;
the record is ignored while the flag is set. Lean: **no reset** (the flag is
not numbers/basis/allergens). If the flag is later cleared, the old
verification comes back — acceptable, since the numbers never changed. A
`NOT_FOOD` row that also changes allergens resets via B3. COMMENT, not a fork.

---

## C. N-1a round trip

The template is `IMPORT_COLUMNS` (writable, in import order) followed by
`TEMPLATE_HELPER_COLUMNS` (`category`, `reporting_unit`, `has_nutrition`).
`parseNutritionCsv` keeps **every** header, and the planner reads only the
cells it knows by name — so **an unknown column is ignored by construction**.

- **`status` goes in `TEMPLATE_HELPER_COLUMNS`.** It is ignored on import for
  the same reason `has_nutrition` is: no code reads it. Nothing needs to
  "strip" it. A user who edits it to `verified` changes nothing; the fixture
  pins that.
- **`source_url` goes in `IMPORT_COLUMNS`** (after `source`), pre-filled with
  the stored URL. Round-trip holds if, and only if, the planner treats an
  identical URL as unchanged. Semantics to mirror the `allergens` column: the
  **column absent → leave as is**; **present and blank → clear**; present and
  different → write. An unedited template carries the stored URL back, so it
  plans zero changes. The existing fixture check `3d` (`[0,0,0,0,6]`) stays
  valid with the new columns appended; N-1b's fixture adds the same check with
  a stored URL and a stored VERIFIED status.
- **Edge the template creates: `source_url` on a row with no record.** Under F1
  the URL lives on `IngredientNutrition`, which requires `basisAmount`. A row
  with a URL and no values on an ingredient with no record has nowhere to put
  it (FORK N1B-F6).
- `status` exported as `estimated` / `verified` / `re-check` (stale) / blank
  (no record). Display only.

---

## D. Permissions

Existing: `nutrition.view` = OPERATIONAL (ADMIN, MANAGER, STORE);
`nutrition.manage` = ADMIN_ONLY (`src/lib/permissions.ts:374-375`). Both
behind `requireNutrition()` (inventory AND nutrition modules → 403
`MODULE_NOT_ACTIVE`, then capability → 403). Neither is grantable/enforced
per-user. Every `/api/nutrition/*` path is behind `auth.protect()` (not in
`isPublicRoute`, `src/proxy.ts`).

Lean confirmed, no new capability needed:

| Action | Capability |
|---|---|
| View the label document, see source link and status | `nutrition.view` (ADMIN, MANAGER, STORE) |
| Upload / replace / remove the document, edit the URL | `nutrition.manage` (ADMIN) |
| Mark verified | `nutrition.manage` (ADMIN) — server re-checks that a document or URL exists |

New routes for `docs/PERMISSIONS_INVENTORY.md` §1l (proposed ids NU-5…NU-8):
document upload-url POST, document register POST / DELETE, document GET
(read), verify POST. **Lean: verify is its own route**, not a flag on the PUT,
so the F2 rule lives in exactly one handler; the PUT gains only
`keepVerified?: boolean` for the "Still verified?" answer (F3), and the
**server**, not the client, decides whether a proof-relevant change happened.

---

## E. Upload safety

Taken from the private pattern, plus three things the repo does not do yet:

1. **Content type** — allow-list PDF, PNG, JPEG, WEBP, HEIC/HEIF; baked into
   the presigned PUT signature; re-read from the store at register.
2. **Size** — 10 MB (F5), baked into the signature (`maximumSizeInBytes`).
   Presigned PUT is required to reach 10 MB at all (A1).
3. **Magic-byte sniff at register — NEW.** No route in Froot checks file
   signatures; all trust the declared type. Register already downloads the
   bytes to hash them, so checking the first bytes (`%PDF`, PNG signature,
   `FF D8`, `RIFF…WEBP`, `ftyp` heic/mif1) costs nothing. Lean: do it.
4. **Filename** — stored verbatim (≤255) for display only; the blob pathname
   uses `safeFileName` + random suffix under
   `nutrition/{org.id}/ingredients/{ingredientId}/`; the download sends the
   original name via `Content-Disposition` with RFC 5987 encoding.
5. **Org isolation** — register pins the namespace prefix to the caller's org
   and ingredient; read resolves `IngredientNutrition` → `Ingredient` with
   `organizationId: org.id` and returns **404** for unknown and cross-org alike.
6. **Delivery — 307 to a 5-minute signed URL (the HR route), not streaming.**
   A Vercel Function response is also capped near 4.5 MB, so streaming a 10 MB
   PDF through it fails; the guide pattern streams only because its files are
   ≤5 MB screenshots used in `<img>`.
7. **HEIC — NEW consideration.** Some browsers report an empty `file.type`
   for `.heic`; the client must map by extension before asking for the upload
   URL. Desktop Chrome/Firefox do not render HEIC inline — it downloads
   instead. Lean: accept it (a phone photo of the panel is the commonest proof
   there is) and show "download" rather than a preview for it. N-1c's AI read
   will need a conversion step; noted there, not here.
8. **sha256** stored with the document (the pattern already computes it) —
   cheap, and N-1c can key on it.
9. **Replace** deletes the previous blob after the new row commits (best
   effort, like PO invoices). No version history in N-1b. **Instead of a DEBT
   row, lean: an `AuditLog` row** on upload/replace/remove/verify/reset with
   file name, hash and status, written in the same transaction. That answers
   "which label backed this Verified claim" later at near-zero cost, without
   building history.

---

## Forks — chat's leans, Gary rules

From the prompt:

- **N1B-F1 Where status lives.** Lean: on `IngredientNutrition`; an ingredient
  with allergens but no record has no status (not verified). Audit agrees;
  the cost is B3 and F6/F7 below.
- **N1B-F2 What VERIFIED requires.** Lean: a document or a source URL, set by
  ADMIN in the dialog only; import never verifies. Audit adds: **removing the
  last proof (document deleted and URL cleared) resets to ESTIMATED
  automatically**, so the F2 invariant holds afterwards too, not just at the
  moment of verifying.
- **N1B-F3 Reset rule.** Lean: import changes reset; dialog changes ask.
  Audit adds two precisions for the ruling:
  - (a) "Change" = basis, any nutrient, or allergens — **not** `sourceNote`
    (B2) and **not** the not-food flag (B4).
  - (b) **Swapping the proof** — a new `source_url` through the import, or a
    replaced document / edited URL in the dialog — on a VERIFIED record: lean
    **import resets, dialog asks**, same as numbers, since the verification was
    made against the old proof.
- **N1B-F4 Stale window.** Lean: 12 months from `verifiedAt`; re-verifying
  restarts it. Stale shows "Re-check label" in the dialog as well as on Menu
  Nutrition.
- **N1B-F5 Storage.** Lean: "whatever Froot already uses", one document,
  10 MB. **Does not resolve — see A3; this is RULING NOW.**

New from the audit:

- **N1B-F6 Proof on an ingredient with no record.** Dialog: the link and
  upload controls are disabled until nutrition is saved ("Save nutrition
  first"). Import: a `source_url` on a row that creates no record is
  **INVALID** with "Add nutrient values before a source link". Lean: both.
- **N1B-F7 Clearing the numbers in the dialog (B1).** Lean: when the record
  holds a document or URL, the dialog **asks** before clearing, and a confirmed
  clear deletes the record, the proof and the blob together (an
  `AlertDialog`, per § Design System). Alternative: refuse to clear while a
  document exists.
- **N1B-F8 Menu items with no food ingredients** (all lines not-food, or empty
  recipe). "Every food ingredient VERIFIED" is vacuously true. Lean: such an
  item is **not** counted as verified and is left out of "N of M" — there is
  nothing to verify. A VERIFIED record that is partial (a nutrient blank
  because the label does not list it) still counts as verified; completeness
  is reported separately, as today.

---

## RULING NOW

1. **Storage — A3.** Choose (i) new private `froot-nutrition` store (audit's
   recommendation; Gary provisions it in Preview + Production + local `.env`
   and tells the session the token's exact variable name), (ii) `froot-hr`, or
   (iii) the public store. Nothing in Phase 2 depends on this — the schema is
   the same for all three — but Phase 3 does.

## COMMENT (no ruling needed)

- B4: not-food never resets status.
- Merge: survivor's status governs; no change needed.
- The migration's backfill is a `NOT NULL DEFAULT 'ESTIMATED'` column, so every
  existing row becomes ESTIMATED as the column is added; no separate `UPDATE`
  is needed. Phase 2 will confirm in the generated SQL.
- `IngredientNutrition` rows on an ingredient later switched to PREPARED (the
  inventory PATCH writes `kind`) linger unused — pre-existing N-1 behaviour,
  not N-1b's to change.

## Proposed shape (for Phase 2, after rulings)

`IngredientNutrition` gains (all additive):
`status NutritionStatus NOT NULL DEFAULT ESTIMATED`, `verifiedByUserId String?`,
`verifiedAt DateTime?`, `sourceUrl String?`, `labelFileUrl String?`,
`labelFilePathname String?`, `labelFileName String?`, `labelContentType String?`,
`labelSizeBytes Int?`, `labelFileHash String?`, `labelUploadedByUserId String?`,
`labelUploadedAt DateTime?`; new `enum NutritionStatus { ESTIMATED VERIFIED }`.
Stale is computed from `verifiedAt`, never stored.
