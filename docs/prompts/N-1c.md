# N-1c — "Read label": AI reads an uploaded label, a person confirms — TIER 3

TIER 3: new external API dependency (Anthropic), new routes, possibly a new
env var. Plan-first with hard stops. One phase, no riders. Two-commit pattern
(work, then docs citing the work SHA). `npm run build` gates commits; lint does
not (DEBT-33). Never push. Claude never connects to staging or production
databases.

Saved as `/Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/N-1c.md`.

## Why

N-1b (live, promotion `317ce2c`) lets an ADMIN attach a label document to an
ingredient and mark its nutrition Verified. Today the numbers still have to be
typed from the label by hand. The first real verification proved the need:
Keva's almond milk spec sheet (Almond Breeze **Original**) is a PDF whose
Nutrition Facts panel is an **image** — plain text extraction returned no
numbers — and the label differed from the estimate (60 kcal / 7 g added sugar
per cup vs an assumed unsweetened product).

Gary's direction (2026-11-01): think universal — any supplier, any format
(spec-sheet PDF, PNG/JPG screenshot, phone photo of the box). Froot should read
the label and fill the numbers; a person always confirms before anything is
saved.

**Standing rule for this series:** nothing is promoted to production until Gary
confirms it on staging.

## What N-1c delivers

1. **"Read label" in the ingredient dialog** (Proof box), ADMIN only, enabled
   when a label document is attached (N-1b upload). It sends that stored
   document to Claude (vision; PDFs as documents, images as images) and asks
   for a structured result:
   - product name / brand as printed, and the "serving size" text as printed;
   - the serving as a number + unit, and any alternate serving printed in
     parentheses (e.g. "1 cup (240 mL)", "2 tbsp (30 g)");
   - every FDA Nutrition Facts value present, with "<1 g"-style values flagged
     (not silently converted);
   - the "Contains:" allergen line mapped to Froot's nine allergens, plus the
     raw text;
   - anything the model could not read, listed explicitly.
2. **Unit matching (deterministic code, not the model):** pick the printed
   serving that is in the ingredient's own dimension (volume ingredient → the
   mL/cup/fl oz/tbsp serving; weight ingredient → the g/oz serving; each →
   per piece). If no printed serving matches the ingredient's dimension, do not
   convert (N1-F1: no weight↔volume conversion) — show why and let the ADMIN
   enter the basis by hand.
3. **Review screen, side by side:** label value vs stored value for every
   nutrient and allergen, differences highlighted, flagged items ("<1 g",
   unreadable) called out, and a **name check** warning when the printed
   product name doesn't plausibly match the ingredient (the Original-vs-
   Unsweetened case). The ADMIN can edit any field before applying.
4. **Apply:** writes through the existing N-1b dialog save path (validation,
   F3 reset rules, audit log). Never auto-saves. See N1C-F2 for whether Apply
   also verifies.
5. **Audit trail:** one audit-log entry per read (ingredient, document,
   model used, success/failure — no image content), and one per apply.
6. **Guardrails:** ADMIN only; per-org rate limit; file types the API accepts
   (HEIC: convert server-side if a library already exists in the repo,
   otherwise ask the user for a JPG/PNG — audit decides); a clear error when
   the read fails, never a half-filled form presented as complete.

Out of scope (later, N-1d): reading from a pasted link (needs SSRF-safe
fetching), and batch reading many labels at once with a review queue. N-2
labels, N-3 public menu.

## Phase 0 — repo gate (one command at a time)

`pwd` must end in `Froot/froot` (capital-F: STOP and tell Gary). `git status`:
on `staging`, clean apart from untracked prompts. `git log --oneline -3`
(HEAD should be `3698898`, the STAMP-bdbeb47-317ce2c pre-push check, or later).

## Phase 1 — audit (read-only), then STOP

Write `/Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/N-1c_AUDIT.md`.

A. **Anthropic in Froot today.** Does any feature already call the Anthropic
   API (Instagram captions, help guide, anything)? SDK or fetch? Env var name,
   which Vercel environments have it, model strings used, timeouts, error
   handling. If none exists, adding a key and a dependency is RULING NOW.
B. **Model and API facts.** Check current Anthropic docs (docs.claude.com) for:
   the model to use for vision extraction and its exact API string, PDF and
   image input support (types, size/page limits), structured/JSON output
   options. Don't rely on memory; cite what you read.
C. **Reading the stored document server-side** from the private
   `froot-nutrition` store (N-1b `src/lib/nutrition-files.ts`) without
   exposing a public URL.
D. **Unit matching:** what `src/lib/units.ts` can parse from printed serving
   text (mL, cup, fl oz, tbsp, tsp, g, oz, lb, "each"), and what's missing.
E. **Write path:** confirm Apply can reuse the N-1b dialog PUT + verify routes
   (or their shared server functions) with no second write path.
F. **Cost and limits:** rough cost per read, a sensible per-org rate limit, and
   Vercel function duration needed.

**Forks — chat's leans; Gary rules at the STOP:**

- **N1C-F1 Trigger.** Lean: "Read label" button only (ADMIN clicks it); never
  read automatically on upload.
- **N1C-F2 Apply vs verify.** Lean: one button **"Apply & mark verified"**,
  available only after the ADMIN has reviewed the side-by-side and the
  document is attached (the label is the proof; a person confirmed it). A
  secondary "Apply only" keeps it Estimated.
- **N1C-F3 Name mismatch.** Lean: warning only, never a block (names on labels
  and in BevSpot rarely match exactly), but "Apply & mark verified" requires
  ticking "This is the product we use" when the warning shows.
- **N1C-F4 Model.** Lean: whichever current model the audit finds best for
  vision extraction at reasonable cost; pinned exact model string; one place in
  code to change it.
- **N1C-F5 HEIC.** Lean: convert server-side only if a library is already in
  the repo; otherwise ask for JPG/PNG (phones can share as JPG).

**STOP.** Report the audit path, a one-screen summary, forks with leans, and
anything RULING NOW (expected: API key / env var if none exists). No code
before Gary rules.

## Phase 2 — build (after Gary's go)

No schema change is expected; if one is needed, it is RULING NOW and the
migration STOP rule applies.

Build deliverables 1–6 as ruled. Then:

- **Fixture** `scripts/verify-n1c-label.ts`, pure, **no live API calls**: feed
  canned model outputs (including the real Almond Breeze Original panel:
  1 cup (240 mL), 60 kcal, fat 2.5 g, sat 0, trans 0, chol 0, sodium 150 mg,
  carb 8 g, fiber <1 g, total sugars 7 g, added 7 g, protein 1 g, vit D 0,
  calcium 450 mg, iron 0.7 mg, potassium 170 mg, Contains: almonds) and assert:
  serving chosen in the ingredient's dimension (8 fl oz for a fl-oz
  ingredient), "<1 g" flagged not silently converted, almonds → tree nuts,
  weight-only serving on a volume ingredient refused for basis, name-mismatch
  warning raised for "Unsweetened" label vs "Original" product, malformed model
  output rejected cleanly.
- Re-run N-1, N-1a, N-1b fixtures; all must pass.
- Routes added to `docs/PERMISSIONS_INVENTORY.md`; env var (if any) added to
  CLAUDE.md's required-env block.
- `npm run build` before each commit; stage only touched files.

## Docs commit

ROADMAP: N-1c row `in_progress` with the work SHA; N-1d (link reading + batch
queue) filed as planned if not present (read the file for conventions and next
free ids). DECISIONS: Gary's N1C rulings in his words, DRAFT. Commit this
prompt and the audit.

## Report and stop

Work SHA, docs SHA, files touched, env var (if any) and where it must be set,
fixture results, and a staging test plan: read the Almond Breeze PDF on
staging's Almond Milk and compare to the known panel; read a phone photo; read
a label whose product name doesn't match. Do not push.
