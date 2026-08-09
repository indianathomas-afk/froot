# CHK-2 (S2) — DAY-CLOSE INPUTS: FOLD THE PHASE LISTS, GIVE StoreHours A WRITER

**Repo:** `~/Claude_Projects/Froot/froot` — branch: `staging`

## WHAT THIS SESSION IS

S2 of the approved CHK phase. The plan is **already approved in full** —
Gary's ruling 2026-08-09, `docs/prompts/CHK-1_PLAN.md` §0-RULING. This
session **executes S2 per the approved plan**; it does not redesign it.
Read the plan artifact and `docs/prompts/CHK-1_SESSION_SKELETONS.md` (S2
block) in full before touching anything. The CHK-2 row in
`docs/ROADMAP.yaml` carries the ships / proves / must-not-touch summary
and the DEBT-32 absorption note.

Two deliverables, in order:

1. **DEBT-32 fold, first** (the row's own sequencing): retire the I-14b
   legacy phase alias and fold the three operational-phase lists into
   one — `src/lib/phases.ts` (`OPERATIONAL_PHASES`) becomes the single
   home, including the ordering map; `messages.ts` and
   `handoff-notes.tsx` stop carrying hand-copied lists. The alias is
   behaviourally inert (`?? 1` fallback maps to the same value), so this
   is a readability change with **zero expected output change** — that
   claim is the regression target, not an assumption.
2. **StoreHours editor**: the table exists since init and has **no writer
   anywhere** (plan finding 2; the sole reader is
   `labor-plan.ts:170`, which states "never populated" at :172-174).
   Ship the editing surface so CHK-3's day-close has a clock. Per-store
   hours: open/close per weekday, `isClosed` per weekday, store
   timezone if the schema carries it there (verify — read the StoreHours
   and Store models before designing the form). Placement: the store's
   detail/edit surface under `/stores`, following the existing store
   editing pattern — read how store editing works today and match it.
   Role gate: the existing store-management capability per the PERM-5
   grid — **no new capability, no permissions.ts edits**.

Why S2 exists at all (context, binding): CHK-3's day-close is
StoreHours-driven; without a writer every store silently falls to the
midnight+buffer fallback and the ruled mechanism never gets exercised.
The two visible-fallback signals (a note on `/stores`, a column on the
report) are CHK-3/CHK-5 work — **not this session's**, but the editor
must leave hours legible enough that "no hours set" is a queryable,
displayable state (NULL rows, not fabricated defaults — DEBT-59's
principle: never write values nobody chose).

## KNOWN HAZARD, NAMED IN ADVANCE (from the plan and the CHK-2 row)

`handoff-notes.tsx:70` carries one of DEBT-33's ten baseline lint
errors ("Cannot call impure function during render"), predating this
work. The commit gate must scope eslint to exclude that file **and say
so in the commit message**, rather than appear to have fixed a DEBT-33
error it did not fix — or worse, be blocked by one it did not cause.

## STEP 0 — LOCATION AND ANCHOR

```
cd ~/Claude_Projects/Froot/froot
pwd                        # must end .../Froot/froot
git branch --show-current  # staging
git status --short         # clean
git fetch origin           # then confirm level with origin/staging
git rev-parse HEAD         # expected 7031155 or a descendant
```

STOP on any failure. Never push.

## STEP 1 — RE-VERIFY THE PLAN'S S2 ASSUMPTIONS AT HEAD

Re-measure, do not cite:

- The three phase lists and the two alias lines the DEBT-32 fold
  retires: `messages.ts` (list + `"During Hours": 1` alias),
  `handoff-notes.tsx` (hand-copied map + alias), `src/lib/phases.ts`
  (`OPERATIONAL_PHASES`). Confirm file:line at HEAD; DEBT-32's row cites
  `messages.ts:41` and `handoff-notes.tsx:24` from an older commit —
  expect drift.
- The `?? 1` fallback claim — confirm the alias is still behaviourally
  inert before deleting it.
- `StoreHours` model shape in `prisma/schema.prisma` (columns, per-store
  vs per-store-per-weekday rows, timezone location) and the confirmed
  absence of any writer (`prisma.storeHours` grep, excluding
  `src/generated/`).
- The store editing surface under `/stores` — what exists, what pattern
  to match, what capability gates it.
- Handoff-note date resolution path (`messages.ts:38-67` at plan time)
  — the regression surface for the fold.

If any assumption no longer holds, that is a finding: STOP and report
before editing. If all hold, proceed — the plan is the approval.

## STEP 2 — EXECUTE

**Part A — DEBT-32 fold:**
- Ordering map moves into `src/lib/phases.ts` (Prisma- and React-free,
  per that file's own design note), both consumers import it, both
  hand-copied lists and both alias lines deleted.
- Regression target: **zero output change.** Prove it by exercising the
  handoff-note date resolution and phase ordering before/after (the S2
  row's "handoff dates unchanged incl. legacy alias" line) — state in
  the report how it was proven (unit-level exercise of the resolution
  function is acceptable; a browser pass on handoff notes lands in
  Gary's checklist regardless).

**Part B — StoreHours editor:**
- API route(s) for reading and writing a store's hours, org- and
  store-scoped per the house pattern (read the closest existing
  per-store write route and mirror its scoping — the PERM-2/PERM-6
  lesson: org ownership first, then caller scope).
- Editor UI on the store surface: seven weekdays, open/close times,
  isClosed toggle. Blank/unset stays NULL — no invented defaults on
  save, no pre-filled 9-to-5 nobody chose. Copy states plainly what
  hours are used for now vs. later (they currently feed labor
  inference's explicit branch; day-close arrives in CHK-3 — do not
  promise CHK-3's behaviour in the copy, the DEBT-29 lesson).
- `labor-plan.ts`'s explicit-hours branch becomes reachable for the
  first time — do not modify it; it is the proves-it-worked surface.

**MUST NOT TOUCH** (from the CHK-2 row): checklist surfaces, offsets and
their copy, lifecycle/status anything, cron, schema (S2 ships **no
migration** — if Step 1 reveals the StoreHours model cannot support the
editor without schema change, STOP and report; that is a plan defect,
not a licence to migrate).

## STEP 3 — COMMITS AND GATES

Two-commit pattern:
- **Commit 1 — code.** Gate: scoped eslint (excluding
  `handoff-notes.tsx` per the hazard above, stated in the message) +
  `npm run build`.
- **Commit 2 — docs.** CHK-2 row → `in_progress` with commit 1's short
  SHA quoted (`["..."]`); DEBT-32 closure per house convention
  (`status: staging`, commit quoted, preserve-and-mark, the
  behaviourally-inert-so-zero-output-change claim restated with how it
  was proven). Gate: `npm run build`.

Committed, **NOT pushed**.

## STEP 4 — REPORT

1. SHAs; Step 1 findings vs. the plan (drift table, the S1 pattern).
2. How zero-output-change was proven for the fold.
3. Gary's staging checklist, org-ID-first (the S1 lesson — first
   action: `⌥⌘C`, `window.Clerk.organization.id`, write it down):
   - Set hours for one store — seven days, one marked closed. Save,
     reopen: everything round-trips, blanks stay blank.
   - Handoff notes: create/view one spanning the phase boundary the
     alias governed — dates and phase ordering identical to before.
   - Labor page for the store with hours set: it takes the
     explicit-hours branch (state what Gary should see differ, if
     anything is visible — if the difference is not visible, say so
     and name the query that proves it instead).
   - A store with NO hours set still renders everywhere it did
     before — nothing breaks on NULL.
4. Triage: FIX NOW / RULING NOW / COMMENT / ROW. **RULING NOW stops
   the session.** Report counts.

## HOUSE RULES

Everything in `CLAUDE.md`; never push; additive-only schema (none
expected this session); `npm run lint` is not a gate (DEBT-33); short
SHAs quoted in YAML; exclude `src/generated/` from greps and verify
hits by reading; do not touch `../froot_docs/`; audit-artifact rule
applies if this session ends audit-only; `preview/main` is a fossil —
never query it.
