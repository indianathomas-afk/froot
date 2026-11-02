# N-1d — Phase 1 audit (read-only)

Session: N-1d, TIER 3. Prompt: `docs/prompts/N-1d.md`. Written 2026-11-02 at
HEAD `560f350` on `staging` (clean apart from the untracked prompt). No code,
schema or data was touched. No database was queried. Every claim below is from
reading the files cited, at that SHA.

The prompt's forks are N1D-F1–F4. This audit adds sub-questions under them,
marked **RULING NOW**, where the prompt's wording leaves the behaviour open
and the build would otherwise have to pick for Gary.

---

## A. Unlock — proof without numbers

### A.1 What "has nutrition" means today

`IngredientNutrition` (`prisma/schema.prisma:1593`) has `basisAmount Float`
and `basisUnit String` as NOT NULL. Every nutrient is already nullable. So
today **"a record exists" and "nutrition exists" are the same fact.** Every
consumer tests `ing.nutrition` (or `!n`, `!existing`) for presence. None tests
the basis.

A record with every nutrient null but a basis is already legal
(`nutritionInputError`, `src/lib/nutrition.ts:92`, skips nulls). The engine
treats it as a **partial** record — every nutrient unknown — not as zero
(`recipe-nutrition.ts:230`). The N-1a fixture pins this as "Mint Leaves"
(`scripts/verify-n1a-template.ts:69`). That shape is **not** "No nutrition": it
is listed as "partial" in To fix and counts toward "with nutrition". N-1d needs
a third shape that reads as NONE everywhere.

### A.2 Smallest schema change

Make `basisAmount Float?` and `basisUnit String?`. Nothing is dropped, so this
is additive (CLAUDE.md § What does NOT tier down). **Rule: a record whose basis
is null is a proof-only record and counts as "No nutrition" everywhere.**

The alternative — move the proof columns to their own table — touches every
proof route, plus the AuditLog shape and N-1c's read and reuse. That is much
larger and buys nothing N-1d needs.

**Integrity.** Code must never write values without a basis. That needs one
writer-side rule: a proof-only record has a null basis **and** all 15
nutrients null. Optionally, a DB `CHECK (("basisAmount" IS NULL) = ("basisUnit"
IS NULL))` in the migration. Prisma does not model CHECK constraints, so a
later `migrate diff` will neither generate nor drop it. → **RULING NOW
N1D-F1c** below.

### A.3 One chokepoint, then every consumer

Proposed pure helper in `src/lib/nutrition.ts` (or `nutrition-proof.ts`):
`hasNutrition(n) = n !== null && n.basisAmount !== null && n.basisUnit !== null`.
Then every place that decides "is there nutrition" goes through it:

| # | Place | Today | N-1d |
|---|---|---|---|
| 1 | `proofState` `src/lib/nutrition-proof.ts:40` | `!r` → NONE, else ESTIMATED/VERIFIED/STALE | no basis → **NONE**. Must take the basis in `ProofRecord`. This one change fixes the menu page's `proofOf`, the template `status` cell, the dialog badge and `rankBlockers`' unverified pass (`recipe-nutrition.ts:326` skips NONE). |
| 2 | Engine `loadNutritionGraph` `src/lib/recipe-nutrition.ts:70` | record → `{basisAmount, basisUnit, values}` | no basis → `nutrition: null`. The line then takes the existing **missing** path (`:221`): `missingIngredientIds`, totals null, "To fix" kind `missing`. No new engine branch needed. |
| 3 | `storedNutritionInput` `src/lib/nutrition-import.ts:308` | `!n` → null | no basis → **null**. Feeds the template (`template/route.ts:28`), the import planner (`nutrition-import.ts:329`) and the dialog PUT's verified-change test (`[id]/route.ts:127`, which uses `!` — see A.5). |
| 4 | `serializeNutrition` `src/lib/nutrition-record.ts:30` | always emits `basisAmount/basisUnit` as numbers | emits nulls + `proof: "NONE"`. The **client** must then stop treating `data.nutrition` as "has numbers" — rows 6–8. |
| 5 | Template `templateRow` `nutrition-import.ts:385` | `has_nutrition: i.nutrition ? "yes"` | already correct once row 3 returns null: basis `1` / reporting unit, nutrients blank, `has_nutrition: no`, status blank. Exports as an empty row, as item 1 asks. `source_url` — see E. |
| 6 | Dialog `toForm` `nutrition-section.tsx:89` | `String(d.nutrition.basisAmount)` | with a null basis this prints `"null"` into the box. Must use `hasNutrition`. |
| 7 | Dialog `proofLocked` `nutrition-section.tsx:178` | `!n \|\| exempt` (F6) | **`exempt` only** — plus PREPARED, which already returns early at `:165`. The locked text "Save nutrition first…" (`:454`) goes. |
| 8 | Dialog read snapshot `nutrition-section.tsx:312` and `hasStored={Boolean(n)}` `:556` | builds `stored` from any record | must be `hasNutrition` → `null`. Otherwise `buildLabelReview` divides by a null `basisAmount` (`label-review.ts:390`). The result would be Infinity/NaN, not zero, so it is a wrong comparison column rather than a silent zero. Still a blocker-class bug. |
| 9 | Upload URL `label/upload-url/route.ts:28` | 409 "Save nutrition before adding a label document" | drop; **add** a PREPARED refusal (today only exempt is refused). |
| 10 | Register `label/route.ts:65-66` | 409 without a record; `update` | **upsert** a proof-only record (null basis, all nutrients null, ESTIMATED) when none exists; add PREPARED + exempt refusals (today the register route has **neither** — only the upload-URL leg checks exempt). |
| 11 | Read label `label/read/route.ts:46-47` | 409 "Save nutrition first…" | drop the `!n` → keep `!n.labelFileUrl` (a missing record means no document either). Update the N-1c header comment's F6 quote (code comment, not a prompt). |
| 12 | Verify `verifyRefusal` `nutrition-proof.ts:59` | `!r` → "Save nutrition before verifying it" | `!hasNutrition(r)` → same refusal. A proof-only record cannot be verified. |
| 13 | Dialog PUT `[id]/route.ts` | `nutrition: null` deletes the record | see **RULING NOW N1D-F1a** (clearing numbers) and **N1D-F1b** (saving a link with no numbers). |
| 14 | Import planner `nutrition-import.ts:239,254,283` | `ing.nutrition` = has a record | fed by row 3, so a proof-only record arrives as `nutrition: null` → a row with values is **NEW** (`:283`), as item 1 asks. Apply's `upsert` (`import/apply/route.ts:63`) **updates** the existing row in place, so the label document, link and status survive. Confirmed by reading: the `update: row` spread carries no label columns. |
| 15 | Menu page `nutrition/menu/page.tsx:41,56` | `withNutritionCount = food − missing` | correct via row 2 (proof-only ⇒ missing). No direct edit. |
| 16 | Recipe API `api/nutrition/recipes/[id]/route.ts` | via `loadNutritionGraph` | correct via row 2. No direct edit. |

**Silent-zero check (the prompt's blocker test).** Nothing treats a missing
nutrient as zero. The engine starts totals at 0 but nulls them on the first
unknown (`recipe-nutrition.ts:251`). With a null basis, the dangerous sites
are arithmetic on `basisAmount`:

- `recipe-nutrition.ts:229` — `inBasis / basisAmount`
- `label-review.ts:390` — `… / stored.basisAmount`

Both are avoided by rows 2 and 8. The schema change itself is the backstop:
making the columns nullable turns every unguarded `n.basisAmount` /
`n.basisUnit` read into a **type error at `next build`**. So the build lists
any consumer this table missed, rather than a grep that cannot see what isn't
there (CLAUDE.md § Verifying a guard covers every path). **No blocker found.**

### A.4 Count

There are 16 consumers in the table. 12 need an edit (rows 1–4 and 6–14 minus
the already-correct 5). Rows 5, 15 and 16 are correct via the chokepoints. The
build's type errors are the completeness check, and I will report how many it
raised.

### A.5 A latent crash the change creates

The dialog PUT does `storedNutritionInput(existing)!` when `existing.status ===
"VERIFIED"` (`[id]/route.ts:127`). It is safe only while a VERIFIED record
always has a basis. Rows 12 and F2 (a document is required) keep that true. The
build should still replace the `!` with a guard so a future path can't crash it.

---

## B. Verified rule

### B.1 Where N-1b F2 is enforced

- **Rule:** `verifyRefusal` / `hasProof`, `src/lib/nutrition-proof.ts:48-62`.
  `hasProof` = link OR document.
- **Verify route:** `api/nutrition/ingredients/[id]/verify/route.ts:30`, the
  one place VERIFIED is set.
- **Document removal:** `label/route.ts:145-150`. VERIFIED + no link → resets
  unasked. VERIFIED + link → asks "Still verified?".
- **Dialog PUT:** `[id]/route.ts:123-141`. Removing the **link** with no
  document → `proof-removed` reset. A link change is a proof change → asks
  (F3).
- **Import:** `nutrition-import.ts:264-268`. A `source_url` change on a
  VERIFIED record sets `resetStatus`.
- **N-1c Apply & mark verified:** `nutrition-section.tsx:328-363` runs PUT
  (with `keepVerified: false`), then POST verify. A read always comes from a
  stored document, so it satisfies the new rule. If the document were removed
  between the read and Apply, the verify leg's refusal catches it, and the
  client already says "marking it verified failed — use Mark verified"
  (`:358`).
- **Dialog UI:** `savedHasProof` (`:179`) gates Mark verified. The hint text
  at `:539` and the removal warning at `:614` both say "label document or a
  source link".
- **Fixtures pinning the old rule:** `scripts/verify-n1b-proof.ts` 1a (message
  text), **1b ("a source link alone is enough")**, 1d (message), 1g, and **4e
  (link change ⇒ resetStatus)** if N1D-F2a rules that a link no longer counts.
  `scripts/verify-n1c-label.ts` **3f** pins `"<5mg"` → null (section C).

### B.2 Change

`verifyRefusal` requires `labelFileUrl` (and `hasNutrition`, A.3 row 12). The
link stays optional reference. Document removal on a VERIFIED record **always**
resets, unasked: one document per record, so removing it removes the last
proof. Replacing a document on a VERIFIED record still asks (F3, unchanged).

### B.3 Backfill

The statement goes in the migration (Phase 2), and Prisma generates nothing
for it, so it is hand-appended:

```sql
UPDATE "IngredientNutrition"
SET "status" = 'ESTIMATED', "verifiedAt" = NULL, "verifiedByUserId" = NULL
WHERE "status" = 'VERIFIED' AND "labelFileUrl" IS NULL;
```

It writes no AuditLog row, because a migration has no actor. Gary already
ruled that the reset itself is recorded ("an audit-log entry for every …
verify"). → **RULING NOW N1D-F2b**.

**Expected counts per branch.** I did not query any branch: the prompt
forbids staging/production, and I did not run dev either. The prompt expects
production = 0. For Gary to run in the Neon console on each branch, **before**
deploying (R4 — the branch comes from the server, never a literal):

```sql
SELECT current_setting('neon.branch_id', true) AS branch_id,
       count(*) FILTER (WHERE "status" = 'VERIFIED' AND "labelFileUrl" IS NULL) AS to_reset,
       count(*) FILTER (WHERE "status" = 'VERIFIED') AS verified_total
FROM "IngredientNutrition";
```

---

## C. Printed bounds

### C.1 Where N-1c F7 is implemented

`parsePrintedValue`, `src/lib/label-review.ts:215-245`. A `<` / "less than"
value is handled at `:236-240`: exactly `1` with unit `g` → `0.5` flagged
`LESS_THAN_1G`, and **any other bound → null flagged `LESS_THAN_OTHER`**
("Label gives only an upper limit — enter a value"). The flag text is in
`FLAG_TEXT` `:197`. The review screen renders the flag per row
(`label-read-review.tsx`). That rule applies to **every g-unit nutrient**,
fats included.

### C.2 The FDA source — read, and it disagrees with item 3 on fats

I read **21 CFR 101.9(c)** at `https://www.law.cornell.edu/cfr/text/21/101.9`
(Cornell LII), 2026-11-02, by delegated fetch. eCFR redirected to a different
host (`unblock.federalregister.gov`), which was not followed. No "current as
of" date is shown on the LII page.

- **(c)(6), (c)(6)(i)–(iii), (c)(7) — total carbohydrate, dietary fiber, total
  sugars, added sugars, protein:** declared to the nearest gram; under 1 g,
  "Contains less than 1 gram" or "less than 1 gram" may be used; under 0.5 g,
  it may be expressed as zero. So **"<1 g" = 0.5 to under 1 g**, and 0.5 is the
  low end. Matches item 3.
- **(c)(3) — cholesterol:** "If the food contains 2 to 5 milligrams of
  cholesterol per serving, the content may be stated as 'less than 5
  milligrams.'" Under 2 mg it is not required, or is stated as zero. So **"<5
  mg" = 2 to 5 mg**, and 2 is the low end. Matches item 3.
- **(c)(2), (c)(2)(i), (c)(2)(ii) — total, saturated, trans fat:** below 5 g
  to the nearest 0.5 g; **under 0.5 g "shall be expressed as zero."** The
  regulation has **no "less than 1 gram" statement for fats.** A fat printed
  "<1 g" is therefore **not** an FDA rounding band. There is no regulatory low
  end to cite: a compliant label would print 0, 0.5 or 1 g. **Item 3 lists
  total/saturated/trans fat under "<1 g → 0.5"; the source does not support
  that.** → **RULING NOW N1D-F3a**.
- **(c)(4) — sodium:** under 5 mg is expressed as zero; there is no "less
  than" form. **(c)(1) — calories:** under 5 kcal may be zero; there is no
  "less than" form. Both stay blank + flagged under item 3's "any other bound".

### C.3 How to extend

This is a small table-driven change in `parsePrintedValue`: a map of
`(nutrient key, printed bound, unit)` → `(low-end value, flag)`, keyed on the
number **as printed**, before unit conversion. Example: `"<5mg"` on
cholesterol → 2, new flag `LESS_THAN_5MG` with text "Label says <5 mg —
filled as 2 mg". The `<1 g` entries apply to the (c)(6)/(c)(7) keys, plus fats
per F3a. Everything else stays `LESS_THAN_OTHER`, blank. Today `"<5mg"` reads
as `LESS_THAN_OTHER` (fixture `verify-n1c-label.ts` 3f), so that check
changes. The `LESS_THAN_1G` label text still fits.

Per-nutrient keying also tightens an existing looseness. Today `"<1 g"` on
**any** g nutrient becomes 0.5, which includes fats (C.2).

---

## D. Ingredients table

- **Component:** `src/app/(app)/inventory/ingredients/ingredients-client.tsx`.
  - Header array `:475-485`: Ingredient · Category · GL Code · Pack · Vendor
    Price · Cost / Unit · [Par / Reorder · Usage / wk when a store is picked] ·
    Last Edited · `""`.
  - Cells `:491-600`, with Last Edited at `:564`. The actions cell (`:568`) is
    edit / archive / delete as three icon buttons; delete has an AlertDialog.
  - The actions cell **renders its buttons only when `canManage`**, but the
    column (empty header) is always there. The checkbox column is `canManage`
    only.
  - The table sits in `rounded-lg … overflow-hidden` → `overflow-x-auto` →
    `<table className="w-full">` (`:453-455`).
- **Container:** every `(app)` page is wrapped by
  `src/components/layout/app-shell.tsx:12`, `max-w-6xl mx-auto px-8 py-8`
  (1152 px, minus 64 px padding). The sidebar is 190 px (60 px collapsed).
- **Existing wide-page pattern: none.** I searched `(app)` for other
  max-width/breakout classes (`max-w-7xl`, `max-w-screen*`, `max-w-none`,
  `w-screen`, `100vw`, negative margins). Every hit was a dialog, form or card,
  not a page container. The shell is a client component with no per-route
  variant. → **RULING NOW N1D-F4a** (how to widen one page).
- **Arithmetic for "laptop width":** on a 1440 px screen with the sidebar
  open, the viewport left for content is 1440 − 190 − 64 ≈ 1186 px. That
  barely exceeds today's 1088 px. On a 1280–1440 laptop, a wider container
  buys at most ~100 px. **Sticky actions will very likely still be needed
  there**, and on wide monitors the wider container alone fixes it.
- **Sticky in a middle column works.** `position: sticky; right: 0` on the
  actions `th`/`td` (with an opaque background and a left border) pins them to
  the right edge of the `overflow-x-auto` scroller. Last Edited scrolls
  underneath it. When scrolled fully right, the actions return to their place
  before Last Edited. No change to what the actions do.

---

## E. Template / import round-trip with proof-only records

**Holds, with one trap that must be designed out.**

With A.3 row 3, a proof-only record exports as an empty row (basis `1` /
reporting unit, nutrients blank, `has_nutrition: no`, status blank). It plans
as a no-record row: rule A ("every nutrient blank on an ingredient with no
record does nothing"), so it is UNCHANGED. ✓

**The trap is `source_url`.** A proof-only record may hold a link (N1D-F1b).
Two ways it can go wrong:

- **Export it blank** (what `templateRow` does today when `n` is null,
  `:396`). The unedited round-trip still holds, because `recordAfter` is false
  so no link write is planned. But **the first time Gary fills that row's
  numbers**, the blank `source_url` plans as `{ url: null }` against the
  stored link (`:256`), and **the import silently deletes the link** on a NEW
  row.
- **Export it filled.** The current F6 rule (`:255`, "Add nutrient values
  before a source link") then **rejects the unedited row as INVALID**, which
  breaks "unedited template → zero changes".

**Fix (lean):** export the stored link on proof-only rows. Then change the F6
rejection to fire only when the row's link **differs from what is stored** on
an ingredient with no numbers. The import still never *creates* a proof-only
record. Unedited → UNCHANGED, and filling numbers → NEW with the link kept.
Fixture: one proof-only-with-link ingredient, unedited (0 changes) and with
values filled (NEW, link not written). This also depends on N1D-F2a: if a link
change no longer resets, `resetStatus` simplifies.

---

## Forks and RULING NOW (for Gary, in his words)

**N1D-F1 Unlock.** Chat's lean: as item 1 — label document (and link) and
Read label on any non-PREPARED, non-exempt ingredient. A record with proof and
no basis is "No nutrition" everywhere. Schema: `basisAmount` / `basisUnit`
nullable. *Audit: feasible; one chokepoint helper; no blocker; the build's type
errors are the completeness check.*

- **N1D-F1a — RULING NOW. Clearing the numbers on a record that has a
  document.** Today (N-1b F7) a confirmed clear deletes the record, the link
  and the file. With proof-only records legal, the alternative is to clear the
  numbers, keep the document and link, and reset to Estimated. **Lean: keep F7
  as it is** (smallest change; N-1d is not about clearing). Say if you want
  "keep the label" instead.
- **N1D-F1b — RULING NOW. Saving a link with no numbers.** Item 1 says "a
  label document (and source link)". A document creates the proof-only record
  on upload (A.3 row 10). A link has no route of its own: it travels inside the
  nutrition PUT. **Lean: allow it** — the PUT accepts a proof-only save (basis
  null, all nutrients null, link set) instead of treating a blank form as
  "delete". Alternative: links only once a document or numbers exist.
- **N1D-F1c — RULING NOW. DB CHECK that basis amount and unit are null
  together.** **Lean: add it** in the migration (cheap; Prisma ignores it; code
  enforces the stronger "null basis ⇒ all nutrients null" rule).

**N1D-F2 Verified needs a document.** Chat's lean: as item 2 — VERIFIED
requires a label document; the link is optional reference. Removing the
document resets to Estimated, unasked. Backfill VERIFIED-without-document →
ESTIMATED. *Audit: six enforcement sites (B.1), fixture checks n1b 1a/1b/1d/1g
change, and Gary runs the count query per branch (B.3).*

- **N1D-F2a — RULING NOW. Does editing the link still ask "Still verified?" /
  reset on import?** Today a link change on a VERIFIED record is a proof change
  (F3). If the link is reference only, **lean: no** — a link edit no longer
  asks in the dialog and no longer resets on import (fixture n1b 4e changes).
  Alternative: keep F3 as is for the link.
- **N1D-F2b — RULING NOW. Backfill audit trail.** The migration resets rows
  with no actor and writes no AuditLog row. **Lean: accept that**, with the
  per-branch counts recorded in MIGRATIONS.md and DEPLOY_LOG. Alternative: a
  one-off script writing `nutrition.status.reset` rows with `via: "N-1d
  backfill"` — more moving parts for an expected count of 0 on production.

**N1D-F3 Bounds.** Chat's lean: as item 3 — cholesterol "<5 mg" → 2 and "<1 g"
→ 0.5, flagged; any other bound blank + flagged. *Audit: source read (C.2);
cholesterol and carb/fiber/sugars/added sugars/protein are exactly the FDA low
ends.*

- **N1D-F3a — RULING NOW. Fats.** 21 CFR 101.9(c)(2) has **no "<1 g" form for
  total, saturated or trans fat** (under 0.5 g is declared 0). So "<1 g → 0.5"
  for fats is **not** the low end of an FDA band. The current code already
  does it for fats, by accident of keying on the unit. **Lean: keep fats at
  0.5 flagged, but with a fat-specific flag text** ("Label says <1 g — not an
  FDA fat format; filled as 0.5 g, check it"), so it is visibly different from
  a sourced band. Alternatives: fats "<1 g" → blank + flagged (strictly per
  source); or as item 3 says, with no distinction.

**N1D-F4 Table.** Chat's lean: as item 4 — wider container on wide screens;
the new column order with actions before Last Edited; sticky actions only if
still needed. *Audit: on a 1280–1440 laptop the wider container gains ≤ ~100
px, so sticky is very likely needed; sticky in a middle column works.*

- **N1D-F4a — RULING NOW. How to widen one page, given no pattern exists.**
  **Lean:** a `WIDE_ROUTES` prefix list in `app-shell.tsx` (`usePathname`,
  one entry `/inventory/ingredients`, exact sub-route excluded), giving
  `max-w-screen-2xl` (1536 px) instead of `max-w-6xl`. One shared file, no
  other page changes. Alternative: the page breaks out of the shell with
  negative margins — no shell edit, but fragile against the sidebar's
  collapsed/expanded widths.
- **N1D-F4b — scope note, not a ruling.** The prompt says "don't change other
  pages". `/inventory/ingredients/deleted` and `/duplicates` share the route
  prefix; the lean matches the page exactly so they are unchanged.

---

## Items not yet done (Phases 2–3, after rulings)

- Migration: nullable basis + (F1c) CHECK + (F2) backfill.
- Build items 1–4.
- Fixture `scripts/verify-n1d.ts`.
- N-1/N-1a/N-1b/N-1c fixture re-runs, with the changed pins named: n1b 1a, 1b,
  1d, 1g, 4e (F2a), 4j (E); n1c 3f.
- Docs: rename the planned N-1d row to this scope (preserve-and-mark: its
  "link + batch" scope moves to a new N-1e); the `560f350` stamp.
