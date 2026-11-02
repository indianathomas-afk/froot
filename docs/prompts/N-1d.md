# N-1d — Label workflow fixes + Ingredients table layout — TIER 3

TIER 3: a schema change (relaxing NOT NULL) and a data backfill, plus UI.
Plan-first with hard stops. Two-commit pattern (work, then docs citing the
work SHA). `npm run build` gates commits; lint does not (DEBT-33). Never push.
Claude never connects to staging or production databases.

Saved as `/Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/N-1d.md`.

**Scope note:** items 1–3 come from Gary's first day using N-1b/N-1c on
production (2026-11-02). Item 4 (Ingredients table layout) and item 5 (the
promotion stamp) are **riders Gary asked for explicitly** in this phase. Batch
reading and reading from a link are **not** in N-1d — they move to **N-1e**
(rename the planned N-1d ROADMAP row's scope accordingly; preserve-and-mark).

**Standing rule for this series:** nothing is promoted to production until
Gary confirms it on staging.

## What Gary hit, and what N-1d changes

1. **Upload and Read label on any ingredient.** N-1b F6 locks the Proof box
   until nutrition exists, so on an ingredient with no numbers Gary had to
   type fake numbers to upload the label that contains the real ones.
   Production today: 177 food ingredients unlocked, 6 locked (Neon
   `br-sparkling-block-a620qvg4`, 2026-11-02). **Change:** a label document
   (and source link) can be attached, and Read label run, on any non-PREPARED
   ingredient. An ingredient whose record has proof but no basis/values counts
   everywhere as **"No nutrition"** — engine, completeness, "To fix", the
   template (exports as an empty row), the import (a row filling it is NEW).
2. **Verified requires an uploaded label document.** Twice Gary marked
   Coconut Milk Verified with chat's *estimated* numbers because a US Foods
   link alone satisfied N-1b F2. **Change:** VERIFIED requires a label
   document; the source link becomes optional reference only. Removing the
   last document resets to ESTIMATED. Backfill: any existing VERIFIED record
   with no document → ESTIMATED (report the count per branch; expected 0 on
   production since Almond Milk and Coconut Milk both now have documents).
3. **Printed bounds pre-fill with the low end of the FDA rounding band**,
   flagged on the review screen like N-1c F7, instead of blank:
   cholesterol "<5 mg" → 2; total/saturated/trans fat, total carbohydrate,
   dietary fiber, total/added sugars, protein "<1 g" → 0.5. Any other printed
   bound the code doesn't recognise stays blank and flagged. Cite the FDA
   source (21 CFR 101.9 rounding rules) in the audit; if you can't read it,
   say so — don't invent bands.
4. **Ingredients table layout** (`/inventory/ingredients`). With all columns
   the row actions (edit / archive / delete) fall off the right edge and need
   a horizontal scroll. **Change:**
   - let the Ingredients page use a wider container on wide screens (match
     any existing "wide page" pattern in the app; don't change other pages);
   - column order becomes: Ingredient · Category · GL Code · Pack · Vendor
     Price · Cost / Unit · Par / Reorder · Usage / wk · **actions (edit,
     archive, delete)** · **Last Edited** (Last Edited moves after the
     actions);
   - if the table still overflows on a laptop-width screen, keep the actions
     column visible (sticky) rather than hidden behind the scroll.
   Display only — no change to what the actions do.
5. **Promotion stamp for `560f350`** (2026-11-02, `--no-ff`, main
   `317ce2c..560f350`, staging fast-forwarded). Carried `bdd7c36`, `f5001d2`,
   `3698898` (stamps + two small fixes) and N-1c (`b396623`, `fc4133f`,
   `d8e8aaf`). No migration. Evidence: staging Read label on the Almond Breeze
   Original PDF matched the label exactly (8 fl. oz basis, 60 kcal … tree nuts;
   fiber "<1 g" flagged as 0.5); production `ANTHROPIC_API_KEY` set; first
   production read (Thirster Coconut Milk, US Foods label screenshot) applied
   and verified. → N-1c row `shipped`. Follow `docs/WORKFLOW.md` § 2 and
   `docs/prompts/STAMP-bdbeb47-317ce2c.md`.

## Phase 0 — repo gate (one command at a time)

`pwd` must end in `Froot/froot` (capital-F: STOP and tell Gary). `git status`:
on `staging`, clean apart from untracked prompts. HEAD `560f350`.
`git log --oneline -3`.

## Phase 1 — audit (read-only), then STOP

Write `/Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/N-1d_AUDIT.md`.

A. **Unlock:** every place that assumes a nutrition record has a basis/values
   (engine, completeness, template export, import planner, dialog, menu page,
   label routes' 409). The smallest schema change that allows proof without
   numbers (lean: make the basis columns nullable; a record with no basis is
   "no nutrition"). Anything that would silently treat a proof-only record as
   zero is a blocker.
B. **Verified rule:** where N-1b F2 is enforced (verify route, rules lib,
   N-1c Apply & mark verified, fixtures) and the backfill statement.
C. **Bounds:** where N-1c F7 is implemented and how to extend it.
D. **Ingredients table:** the component, the current container width, any
   existing wide-page pattern, and how the actions column is rendered.
E. **Template/import round-trip:** confirm "unedited template → zero changes"
   still holds with proof-only records.

**Forks — chat's leans; Gary rules at the STOP (these change N-1b F2/F6 and
N-1c, so they must be in his words):**

- **N1D-F1 Unlock.** Lean as item 1.
- **N1D-F2 Verified needs a document.** Lean as item 2, with the backfill.
- **N1D-F3 Bounds.** Lean as item 3.
- **N1D-F4 Table.** Lean as item 4; sticky actions only if still needed.

**STOP.** Report the audit path, a one-screen summary, the forks with leans,
anything RULING NOW. No code before Gary rules.

## Phase 2 — schema (after Gary's go), then STOP

Migration per `docs/MIGRATIONS.md`: the nullable change from A plus the
backfill from B. Baseline `migrate diff` against dev first. **STOP after the
migration file exists.** Gary applies it to dev (`npx prisma migrate deploy`
from the `froot` dir) and says go.

## Phase 3 — build (after Gary's go)

Items 1–4 as ruled, then the stamp (item 5) in the docs commit.

- **Fixture** `scripts/verify-n1d.ts` (pure where possible): proof-only record
  counts as no nutrition everywhere (engine, completeness, template, import →
  NEW); verify refused without a document even with a link; removing the last
  document resets to ESTIMATED; backfill logic; "<5 mg" cholesterol → 2 and
  "<1 g" → 0.5, both flagged; unknown bound blank + flagged; unedited template
  still zero changes.
- Re-run N-1, N-1a, N-1b, N-1c fixtures; all must pass (update any that pinned
  the old F2/F6 behaviour, and say which).
- `npm run build` before each commit; stage only touched files.

## Docs commit

ROADMAP: N-1d row (scope as above) `in_progress` with the work SHA; N-1e
(batch reading + link reading) filed as planned; N-1c → shipped (item 5).
DECISIONS: Gary's N1D rulings in his words, DRAFT. MIGRATIONS entry. DEPLOY_LOG
stamp for `560f350`. Commit this prompt and the audit.

## Report and stop

Work SHA, docs SHA, migration name, backfill counts expected, files touched,
prisma commands (verbatim), fixture results, and a staging test plan: upload +
Read label on an ingredient with no nutrition; try to verify with only a link
(refused); a "<5 mg" label; the Ingredients table at laptop width with actions
visible and Last Edited last. Do not push.
