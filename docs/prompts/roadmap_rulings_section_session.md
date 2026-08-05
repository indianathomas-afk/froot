RULINGS ON THE ROADMAP SITE — PENDING-DECISIONS SECTION (SMALL BUILD)

Repo: ~/Claude_Projects/Froot/froot — branch: staging
This session edits docs AND code (the roadmap generator + the
/internal/roadmap page). Audit first: read, plan, present, WAIT for
Gary's approval before touching any file. Never push.

FIRST, TWO PRE-APPROVED ITEMS BEFORE STEP 1 (commit them per house
pattern before the audit):
(1) Commit the untracked docs/prompts/Froot_pending_rulings_sheet.md —
    it is Step 1.1's input and must be in git.
(2) Record Gary's ruling closing L-2's open disconnect question: the
    Square-labor toggle STAYS ON when Square disconnects and shows
    unhealthy — reconnect restores the feature with no second admin
    action. Apply it to the L-2 row's open-question entry (and
    DECISIONS.md if the entry shape calls for it), per house
    conventions.
Then proceed to Step 1.

GOAL: Gary maintains a set of PENDING RULINGS — open decisions with
options and a recommendation, awaiting his call. Today they live in a
loose markdown sheet. He wants them on the /internal/roadmap page
(admin-gated) as their own section, so open decisions are visible in
the same place as phases, bugs, and debt — and so a ruling, once made,
is recorded rather than lost in chat.

STEP 1 — READ:
1. docs/prompts/Froot_pending_rulings_sheet.md — the sheet to import.
   NOTE: its R7 (the untracked promotion runbook) is STALE — that
   closed in commit 1218be3. Drop R7 from the import or mark it
   resolved; do not bring it back as a question.
2. docs/ROADMAP.yaml top-level structure and scripts/generate-roadmap.mjs
   (or wherever the generator lives) — how phases/bugs/debt become
   src/generated/roadmap.ts.
3. src/app/(app)/internal/roadmap/page.tsx and its components — how the
   existing sections render, the search/filter, the status badges.
4. The DEBT-43 record: src/generated/roadmap.ts is in Tailwind's content
   scan path — PROSE IN THE GENERATED FILE CAN CREATE FALSE CSS CLASS
   HITS. Whatever shape you add must not inflate that surface
   carelessly; note how the existing generator handles (or doesn't)
   this, and match or improve it.

STEP 2 — PLAN AND PRESENT (wait for approval):
- The YAML shape. Proposal to evaluate: a top-level `rulings:` list,
  one entry per decision: id (R1…), title, status (open | ruled |
  deferred), asked (date), question (folded prose), options (list),
  recommendation, ruling (empty until made), ruled (date, empty until
  made), links (related row ids like DEBT-55). Keep it minimal — this
  is a decision log, not a second debt table.
- The page section. Proposal: a "Pending rulings" section on
  /internal/roadmap — count badge, open items first, ruled items
  collapsed/badged, searchable with the existing filter if cheap.
  Reuse existing components and styles; no new design language. If the
  existing page structure makes a separate section expensive, say so
  and propose the cheapest honest alternative.
- Content import: translate the sheet's R1–R8 into entries (minus the
  stale R7 per Step 1.1's note). EDIT FOR THE RECORD as you do: strip
  conversational phrasing ("my recommendation, emphatically"), keep
  the substance — question, options, recommendation, links. R8
  (housekeeping) may not merit an entry; say whether to include or
  drop it. Statuses all `open`.
- Confirm the page stays admin-gated exactly as it is (it was migrated
  in the PERM-5C sweep — do not disturb the guard).
- State what the generator change touches and confirm next build
  regenerates cleanly.

STEP 3 — BUILD on approval. Suggested commits: (1) the two
pre-approved items if not already committed before Step 1; (2)
generator + YAML shape + imported rulings; (3) the page section. Gates
chained per house pattern (eslint on touched files && npm run build >
/tmp/build.log 2>&1 && git commit), no pipes. If schema-adjacent
anything appears needed, STOP — nothing here should touch the
database.

BEFORE YOU REPORT — triage what you found. For each thing found and
not fixed, tell me which it is:

FIX NOW — small, inside the code you already touched, and I can
approve it in this session. Propose it; do not apply it.

RULING NOW — needs a decision from me, not work. Ask the question in
one sentence. If I answer it here, it never becomes a row.

COMMENT, NOT A ROW — cost NONE with no named trigger. It goes as a
comment at the site. A row would only be read by someone already
reading the roadmap; a comment is read by whoever opens the file.

ROW — real deferred work, or a hazard with a named trigger.

Default to the first three. A row is the last resort, not the first.
Tell me the count in each bucket.

REPORT: the two pre-approved items' commit(s); the YAML shape as
landed; the section as rendered (describe; Gary verifies on staging
after push); the R-entries imported and any dropped; the Tailwind-
contamination handling; commit SHAs; explicit unpushed-commits line.

HOUSE RULES: everything in CLAUDE.md; never push; npm run lint is not
a gate (DEBT-33); folded YAML titles; no meta.updated; do not touch
../froot_docs/.
