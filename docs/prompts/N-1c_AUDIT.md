# N-1c — Phase 1 audit (read-only)

Session: TIER 3, 2026-11-02. Prompt: `docs/prompts/N-1c.md`.
Repo gate: `pwd` = `/Users/garythomas/Claude_Projects/Froot/froot`; branch
`staging`, up to date with `origin/staging`, clean apart from untracked
`docs/prompts/N-1c.md`; HEAD `3698898` (STAMP-bdbeb47-317ce2c PRE-PUSH-CHECK).

No database was queried in this audit (no branch evidence below). No file other
than this one was written. No code was changed.

---

## A. Anthropic in Froot today — NONE

- `grep -rliE "anthropic" src scripts` → **0 files**. No `claude-*` model
  string, no `ANTHROPIC_API_KEY`, no OpenAI/Gemini either. Instagram captions
  and the help guide do not call any model.
- `package.json` has no `@anthropic-ai/sdk`; `node_modules/@anthropic-ai` does
  not exist.
- Outbound HTTP elsewhere is plain `fetch` with no SDK: `src/lib/notify.ts:95`
  (Resend, no `resend` package), `src/lib/instagram.ts:72,96`, `src/lib/square.ts`.
- **Consequence: a key and an env var are RULING NOW** (see § RULING NOW).
  Nothing to reuse for timeouts, retries or error handling; the closest house
  pattern is notify.ts (fetch + explicit error mapping) and the 12 s Square
  fetch timeout noted on the F-1 hardening row.

## B. Model and API facts (read 2026-11-02)

All `docs.claude.com` URLs 302 to `platform.claude.com/docs/en/…`; read there.
Items marked [summary] came from a summarised page section, not verbatim text —
re-check them in Phase 2 before relying on them.

**Models** — https://platform.claude.com/docs/en/about-claude/models/overview,
https://platform.claude.com/docs/en/about-claude/pricing

| API string | Input $/MTok | Output $/MTok | Note |
|---|---|---|---|
| `claude-fable-5-1` | 10 | 50 | most capable |
| `claude-opus-5-5` | 4 | 20 | docs: "start with Claude Opus 5.5 for most workloads" |
| `claude-sonnet-5-5` | 2 | 10 | |
| `claude-haiku-5-5` | 0.10 | 0.50 | ≤100k-token prompts; docs: "for high-volume … extraction" |

- The overview states every model ID is a pinned snapshot, "including the
  dateless IDs used from the 4.6 generation on". So `claude-sonnet-5-5` is
  already a pinned string; there is no dated variant to pin to instead.
- All current models take image input; "All active models support PDF
  processing" (pdf-support page). 1M context, 128K max output.

**Images** — https://platform.claude.com/docs/en/build-with-claude/vision

- Types: JPEG, PNG, GIF, WebP. **HEIC is not supported.**
- Max 10 MB per image **base64-encoded**, 8000×8000 px. Base64 inflates ~33%,
  so an image file over ~7.5 MB will not fit raw. N-1b accepts up to 10 MB
  (`LABEL_MAX_BYTES`), so large phone photos must be downscaled or refused.
- Tokens ≈ ⌈w/28⌉ × ⌈h/28⌉; images above the model's tier limit are downscaled
  [summary: ~2,576 px long edge / ~4,784 visual tokens on recent models].
- Sources: base64, URL, or Files API `file_id`. Images should come before the
  text in the message.

**PDFs** — https://platform.claude.com/docs/en/build-with-claude/pdf-support

- Block: `{"type":"document","source":{"type":"base64","media_type":"application/pdf","data":…}}`;
  URL and `file_id` sources also exist.
- Limits: 128 MB request, 600 pages (100 under a 1M context), no
  password/encryption.
- "The system converts each page of the document into an image. The text from
  each page is extracted and provided alongside each page's image." ~1,500–3,000
  tokens per page. **This is why the Almond Breeze spec sheet will read:** its
  panel is an image, and each page goes through vision as an image, so
  text-extraction failing (as it did in N-1b) does not matter.

**Structured output** — https://platform.claude.com/docs/en/build-with-claude/structured-outputs

- `output_config.format = { type: "json_schema", schema }`; status stable, no
  beta header needed (the old `output_format` + `structured-outputs-2025-11-13`
  header is deprecated). Available on every model. Strict tool use
  (`"strict": true`) is the alternative.
- Constraints [summary]: every object needs `additionalProperties: false`;
  no `minimum`/`maximum`/`minLength`/`maxLength`; unions via `anyOf` /
  `["number","null"]`; no recursion; `stop_reason` `refusal` or `max_tokens`
  can still yield non-matching output.
- **Design consequence:** the schema guarantees shape, not truth, and the model
  can still stop early. The server still parses the result with Zod and treats
  anything that fails as a failed read (deliverable 6: "never a half-filled
  form presented as complete"). The fixture's "malformed model output rejected
  cleanly" case covers exactly this.

**Request size / timeouts:** 128 MB request limit. No timeout guidance on the
pages read. Files API page not read (not needed — see C).

## C. Reading the stored document server-side

Already solved in N-1b. `readLabelMeta()` (`src/lib/nutrition-files.ts`) does
`head(fileUrl, { token })` then
`fetch(info.url, { headers: { authorization: \`Bearer ${token}\` } })` and reads
the bytes. `head()` with the froot-nutrition token only resolves blobs in that
store. Phase 2 adds a sibling `readLabelBytes(fileUrl)` (same two calls, returns
bytes + stored content type) — no new mechanism.

**The bytes go to Anthropic as base64, never as a URL.** A URL source would
mean minting a presigned GET (`getLabelDownloadUrl`, 5-minute TTL) and handing
it to a third-party fetcher — that is exactly the "public URL" the prompt rules
out. The Files API would put a copy of the document on Anthropic's side with
its own retention; also unnecessary for one-shot reads.

Route order is the house order: `requireNutrition("nutrition.manage")` →
`findOrgIngredient(ctx.org.id, id)` (org-scoped) → `nutrition.labelFileUrl`
must exist → read bytes → call. The ingredient id never reaches the blob
pathname except through the stored record, so a cross-org read is impossible
by construction (same as `GET …/label`).

Size: 10 MB of bytes in a Function is fine; the 4.5 MB limit is on the
**inbound request body**, and this route's request body is empty.

**HEIC:** `sharp@0.34.5` is present only transitively (`next@16.2.9 → sharp`).
Its `format.heif` reports input suffix `.avif` only, and `sharp.versions` shows
`heif 1.20.2` + `aom` with no HEVC decoder (libde265) — so it decodes AVIF, not
iPhone HEIC. No `heic-convert`/`heic2any`/`libheif-js` in the tree. **No HEIC
library exists in the repo** → per the N1C-F5 lean, Read label on a HEIC
document is disabled with "Upload a JPG or PNG to read it (on iPhone: Share →
Save as JPEG, or set Camera → Formats → Most Compatible)". The HEIC still stays
attached as proof — N-1b accepted it on Gary's ruling and nothing changes that.

**Images over the base64 limit:** sharp *can* resize JPEG/PNG/WebP, but it is
not a direct dependency, and relying on a transitive one is fragile. Lean for
Phase 2: refuse images whose base64 would exceed 10 MB with a clear "photo too
large to read — retake or export smaller" message, and do not add sharp. If
Gary would rather resize, that is adding `sharp` as a direct dependency
(listed under RULING NOW as optional).

## D. Unit matching — `src/lib/units.ts`

`units.ts` has **no text parser**. It is a lookup keyed by Froot's canonical
unit strings, with `unitDimension`, `compatibleUnits` and `convert` (returns
null across dimensions — the N1-F1 guarantee the matcher must lean on).

Canonical keys: weight `oz (dry)`, `lbs`, `g`; volume `fl. oz`, `gal`, `L`,
`qt`, `pt`, `cup`, `tbsp`, `tsp`, `mL`; count `each`, `serving`.
`nutritionInputError` → `basisUnitError` requires the basis unit to be in
`compatibleUnits(reportingUnit)`; for a count ingredient that is the reporting
unit itself (`each` ≠ `serving`).

What the matcher must add (pure code in a new `src/lib/label-serving.ts`, no
change to `units.ts`):

| Printed | Maps to | Status in units.ts |
|---|---|---|
| `mL`, `ml`, `mL.` | `mL` | key exists, aliases missing |
| `cup`, `cups`, `c` | `cup` | key exists, plural missing |
| `fl oz`, `fl. oz`, `fl.oz`, `FL OZ` | `fl. oz` | spelling differs |
| `Tbsp`, `tbsp`, `T`, `tablespoon(s)` | `tbsp` | aliases missing |
| `tsp`, `teaspoon(s)` | `tsp` | aliases missing |
| `g`, `gram(s)` | `g` | ok |
| `oz` (bare, on a label) | `oz (dry)` | **ambiguous** — see below |
| `lb`, `lbs` | `lbs` | `lb` missing |
| `kg`, `L`/`liter` | — / `L` | **`kg` missing entirely** |
| `bar`, `piece`, `slice`, `scoop`, `packet`, `container`, `pouch` … | `each` (count ingredient only) | count nouns missing |

Also missing: amount parsing — fractions (`1/4 cup`, `2/3 cup`), unicode
(`½`), decimals, `about`/`approx.` prefixes, and no-space forms (`240mL`).

Rules (deterministic):

1. Parse each printed serving — the main one and the parenthetical alternate —
   into `{ amount, unit }`. Unparseable ones are kept as text and listed.
2. Keep only those whose `unitDimension` equals the ingredient's
   reporting-unit dimension.
3. Prefer the US household measure over the metric parenthetical when both
   match (FDA makes the household measure primary and the metric figure is a
   rounded equivalent): `1 cup (240 mL)` on a `fl. oz` ingredient → `1 cup`,
   which `convert` makes exactly `8 fl. oz`. The prompt's expected basis
   ("8 fl oz for a fl-oz ingredient") matches this rule; 240 mL would give
   8.12.
4. Express the basis in the ingredient's reporting unit when the conversion is
   exact-enough, otherwise keep the printed unit (both are allowed bases).
5. Bare `oz` on a volume ingredient is **not** treated as `fl oz`. A label's
   bare `oz` is weight; mapping it to volume would be exactly the
   weight↔volume conversion N1-F1 forbids. A beverage label that prints bare
   "oz" falls through to "no serving in this ingredient's dimension".
6. No match → no basis. The review screen says why ("the label gives the
   serving only in grams; this ingredient is counted in fl. oz") and the
   ADMIN types the basis by hand. Values are still shown; only the basis is
   withheld.
7. Count ingredients: a count noun (`1 bar (40 g)`) → `1 <reportingUnit>`.

## E. Write path — Apply reuses the N-1b routes

- **Numbers/allergens:** `PUT /api/nutrition/ingredients/[id]`
  (`nutrition.manage`, ADMIN). It already validates (`nutritionInputError`),
  owns the F3 "Still verified?" 409, the F7 clear-proof 409, and the resets.
  The dialog's `save()` already drives those 409s. Apply = "fill the dialog's
  form from the reviewed values, then call the same `save()`". **No second
  write path.**
- **Verify:** `POST …/verify` (`{ verified: true }`) is "the one place VERIFIED
  is ever set". "Apply & mark verified" = `save()` then `setVerified(true)`,
  sequentially. If the second call fails the record is saved and Estimated —
  visible, and correct to leave (the person can click Mark verified).
  Interaction with F3: when the record is already VERIFIED and Apply changes
  numbers, the PUT asks "Still verified?". For "Apply & mark verified" the
  dialog answers `keepVerified: false` itself (the record is about to be
  re-verified from the label anyway), so the trail reads
  `nutrition.status.reset` → `nutrition.verified`, honestly.
- **Audit gap:** the PUT writes **no audit row on an ordinary save** — only on
  reset/clear. Deliverable 5 wants "one per apply". Smallest change: an
  optional `appliedFromRead: { readAuditId }` field on `PutSchema`; when
  present, the same transaction writes `nutrition.label.applied` (ingredient,
  read id, label hash, which fields the ADMIN edited away from the read). The
  route stays the only write path; the field changes nothing else.
- `AuditLog.action` is a `String` (`prisma/schema.prisma:906`), and
  `NutritionAuditAction` is a TypeScript union in `src/lib/nutrition-record.ts`.
  New actions `nutrition.label.read` / `nutrition.label.read.failed` /
  `nutrition.label.applied` need **no schema change**.

**Constraint found — N-1b F6 ("Proof controls stay disabled until nutrition
exists").** The dialog locks proof controls when there is no record
(`nutrition-section.tsx:167`), and the server refuses to register a label with
no record: `POST …/label` → 409 "Save nutrition before adding a label document"
(`label/route.ts`). So **Read label only works on an ingredient that already
has a saved nutrition record.** For a brand-new ingredient the ADMIN must save
something first, upload, then read. The label fields live on
`IngredientNutrition`, whose `basisAmount`/`basisUnit` are non-null, so lifting
F6 is not free (a schema change or a placeholder basis). Raised as fork
**N1C-F6** below.

## F. Cost, limits, duration

**Per read (estimate, not measured).** A one-page spec sheet: ~1.5–3k page
tokens + ~1.5k prompt/schema; a photo: ≤ ~4.8k visual tokens. Output ~600–1,000
tokens of JSON. Call it ~5k in / ~1k out; a 4-page spec sheet ~12k in.

| Model | 1 page / photo | 4-page PDF |
|---|---|---|
| `claude-haiku-5-5` | ~$0.001 | ~$0.002 |
| `claude-sonnet-5-5` | ~$0.02 | ~$0.034 |
| `claude-opus-5-5` | ~$0.04 | ~$0.07 |

Even a full first pass over every ingredient an org has (low hundreds) is a few
dollars on Sonnet. Cost does not decide the model; accuracy on small printed
numbers and allergen lines does. Measure on staging (the test plan's three
labels) before trusting any estimate here.

**Rate limit.** There is no app-wide rate limiter (the "rate limit" hits in
`src/` are Square/Instagram API-side). In-memory counters don't hold across
serverless instances. Lean: **count this org's `nutrition.label.read*` audit
rows in the window** — durable, already written per deliverable 5, served by
the existing `@@index([organizationId, entityType, createdAt])`, no schema.
Suggested: **30 reads per org per hour, 300 per day**, failures counted; 429
with "Try again in N minutes". Also: re-reading the *same file hash* within 24 h
returns the previous result from that read's audit metadata (extracted numbers
are not "image content") instead of calling the model again — this is the
`labelFileHash` keying the N-1c ROADMAP row anticipated. A "read again" button
can force a fresh call (still counted).

**Duration.** Account is on Vercel **Pro** (CRON-DIAG, recorded on the CRON-1
row). Existing routes use `maxDuration = 60`. A single label read is typically
10–30 s. Lean: `maxDuration = 60` on the read route, Anthropic fetch aborted at
45 s, no automatic retry (the person clicks again; a retry would double-spend
silently). Map 429/529 from Anthropic to "the reader is busy, try again in a
minute", 400 to "this file couldn't be read", and never surface the raw error.

---

## Forks — chat's leans; Gary rules

- **N1C-F1 Trigger.** Lean (chat): "Read label" button only, ADMIN clicks;
  never on upload. Audit agrees — it also keeps cost and the rate limit
  entirely user-driven.
- **N1C-F2 Apply vs verify.** Lean (chat): primary "Apply & mark verified"
  after the side-by-side, document attached; secondary "Apply only" keeps
  Estimated. Audit: implementable on the existing routes (§ E), with the F3
  answer the dialog supplies itself.
- **N1C-F3 Name mismatch.** Lean (chat): warning only; "Apply & mark verified"
  needs "This is the product we use" ticked when the warning shows. Audit adds:
  the check is deterministic code, not the model — token overlap between the
  printed product name and the ingredient's brand + name, plus a short list of
  variant words (Original, Unsweetened, Vanilla, Light, Zero, Sugar-free,
  Organic, Barista…) where a word present on one side and a *different* one on
  the other raises the warning even when the rest matches.
- **N1C-F4 Model.** Lean (chat): best current vision model at reasonable cost,
  pinned, one constant. Audit's lean: **`claude-sonnet-5-5`**, in one
  `LABEL_READ_MODEL` constant. Haiku 5.5 is 20× cheaper and the docs pitch it
  for extraction, but a misread allergen line is a safety error and a misread
  decimal on a 10 mg potassium value is invisible; at ~2¢ a read the saving is
  not worth the risk. The staging test plan should read the same three labels
  on both and compare — if Haiku matches, switching is a one-line change.
- **N1C-F5 HEIC.** Lean (chat): convert only if a library already exists.
  Audit: **none exists** (§ C — sharp lacks HEVC). So: HEIC stays attachable,
  Read label is disabled on it with the "share as JPEG" instruction.
- **N1C-F6 (new) Read needs a saved record.** N-1b F6 + the 409 in
  `POST …/label` mean Read label only works where nutrition already exists.
  Options: (a) keep F6 for N-1c — the ADMIN saves any estimate, uploads,
  reads; (b) lift F6 so a label can attach before a record — needs a schema
  change (nullable basis) or a placeholder basis, and is a migration STOP;
  (c) Read label accepts an uploaded-but-unregistered file and Apply then
  saves the numbers and registers the label in that order through the
  existing routes. Lean: **(a) for N-1c**, with the dialog saying so plainly
  ("Save the estimate first, then upload the label to read it"), and (c)
  considered for N-1d's batch flow, where "no record yet" will be the common
  case.
- **N1C-F7 (new) What "<1 g" applies as.** The columns are `Float?` —
  there is no way to store "<1 g". Options: (a) leave it blank (unknown, which
  N1-F5 treats honestly), flagged, the ADMIN types a number or leaves it;
  (b) prefill a visible 0.5 marked amber. Lean: **(a)** — the prompt says "not
  silently converted", and a prefilled number is the step before silent.
  Same treatment for a nutrient printed only as %DV.

## RULING NOW

1. **Anthropic API key + env var.** Name `ANTHROPIC_API_KEY` (the SDK's and the
   docs' default name, even though Phase 2 would use `fetch`). Scope **Preview +
   Production**, a **separate key per environment** (separate Anthropic
   workspace or at least separate keys, so a staging leak can be revoked alone),
   Sensitive. It is never typed by hand, so the password-manager rule does not
   bind, but Anthropic shows a key once — keep it anyway. Set a monthly spend
   limit on the Anthropic workspace as the hard backstop behind the per-org
   rate limit. Unset → the route answers 503 "Label reading isn't set up in this
   environment", the same shape as `NUTRITION_BLOB_READ_WRITE_TOKEN`. Locally it
   can't work anyway (no Development blob store). Added to CLAUDE.md's
   required-env block in Phase 2.
2. **Dependency.** Lean: **no new dependency** — call
   `https://api.anthropic.com/v1/messages` with `fetch`, as notify.ts does for
   Resend; the request is one POST with a fixed shape and the response is
   parsed by Zod regardless. Alternative: add `@anthropic-ai/sdk` (typed
   requests, built-in retry/timeout). Gary picks.
3. **Data leaving Froot.** Label documents (supplier spec sheets, phone photos
   of packaging) are sent to Anthropic for each read. No personal data by
   design; a phone photo could catch a background. Worth a conscious yes.
4. *(Optional, only if Gary wants large photos resized rather than refused)*
   add `sharp` as a direct dependency.

## No schema change expected

Confirmed: new audit actions are strings; rate limit and cache ride AuditLog;
the read result is transient until Apply. The only path that would need a
migration is N1C-F6 option (b).

## Files Phase 2 expects to touch

- new `src/lib/label-read.ts` (model call, schema, Zod parse — the one
  `LABEL_READ_MODEL` constant), `src/lib/label-serving.ts` (pure matcher,
  allergen mapper, name check)
- `src/lib/nutrition-files.ts` (`readLabelBytes`)
- `src/lib/nutrition-record.ts` (three audit action strings)
- new `src/app/api/nutrition/ingredients/[id]/label/read/route.ts` (POST)
- `src/app/api/nutrition/ingredients/[id]/route.ts` (optional
  `appliedFromRead` → `nutrition.label.applied` audit)
- `src/app/(app)/inventory/ingredients/nutrition-section.tsx` + a new review
  component beside it
- new `scripts/verify-n1c-label.ts`
- `docs/PERMISSIONS_INVENTORY.md`, `CLAUDE.md` env block
- Next 16 route conventions to be read from `node_modules/next/dist/docs/`
  before writing the route (AGENTS.md).

Allergen note for the mapper: FDA's January 2025 food-allergen guidance
narrowed "tree nuts" and dropped coconut from the list (stated from memory,
NOT read this session — verify against fda.gov in Phase 2); the mapper maps
almonds/cashews/walnuts/pecans/pistachios/hazelnuts/macadamia/Brazil nuts/pine
nuts → TREE_NUTS and leaves coconut as raw text flagged for the ADMIN rather
than deciding it. "May contain" / "processed in a facility" lines are shown
raw and never mapped (they are not the Contains statement).
