TIER 3 session. Read /Users/garythomas/Claude_Projects/Froot/froot/docs/prompts/L-4d_band_reads_square_schedule.md and execute it. Repo gate first, one command at a time. Stop where it says stop.

# L-4d — Manager band reads the Square schedule — TIER 3

## What this is (plain English)

Today a store's labor charts show "Manager expected 07:00–14:00" every day
whenever any salaried person is allocated to that store, even at 10%. So
Kristie, who floats between stores, shows up at Las Brisas and UNR every day,
including days she isn't there.

After L-4d, the band shows a salaried manager at a store only on the days
Square's schedule has her there. If Square has no schedule for her that week,
the chart behaves exactly as it does today.

It's display only. No planned hours, floor credit or GM cap change. That is
L-5, which needs its own boundary ruling first.

This is the last build step of L-4.

## Rulings this session builds against (read them; don't re-decide)

`docs/DECISIONS.md`: the L-4-1 entry (2026-10-30) first, then whatever of
L-4-0 it says still stands. L-4-1 supersedes L-4-0 where they conflict. The
`docs/LABOR.md` § L-4 pivot block has the A1 findings and the L-4d definition.
Quote the L-4d definition verbatim in Phase A, and build to it exactly.

Expected from L-4-1, to be verified, not assumed:
- **Square is the schedule source.** Froot only reads it. No new Square scope.
  No write.
- **Cost vs. presence.** Salaried allocation decides cost only. Presence on a
  day comes from the schedule.
- **Display only.** Nothing new reaches `gmHoursByDay`, the floor credit, the
  GM cap, or any core engine (the L-2 boundary).
- **The R7-C rule stands:** DO NOT SOLVE IT BY WIDENING THE LABEL.

## OUT

- No schema change, no migration. If you conclude one is needed: STOP,
  RULING NOW.
- No change to any number. If your design changes any existing labor figure:
  STOP. That's L-5.
- No new Square API call or scope. Use what the existing
  `labor-scheduled-shifts` sync already stores. If it doesn't store something
  you need: STOP, RULING NOW.
- No `LaborAssignment` reads or writes (it stays unused; L-4-1).
- No breaks, no scheduler UI, no time-off display.

## Repo gate (one command at a time, paste results)

```
pwd
```
→ must end in `Froot/froot`. If it ends in capital-F `Froot`, run
`cd /Users/garythomas/Claude_Projects/Froot/froot` and run `pwd` again.
Anything else: STOP.

```
git status
```
→ on `staging`, tree clean except this prompt file (untracked is expected).

```
git log --oneline -1
```
→ expect `6ae5fac`. If different, say so before continuing.

## Phase A — read (read-only, report with file:line)

The file wins over this prompt. Say so where they disagree.

A1. **The rulings.** Quote, verbatim:
    - the L-4-1 rulings that bind L-4d;
    - the L-4d definition from LABOR.md;
    - the L-4 row's current notes on L-4d.
A2. **Where the band is decided and drawn today.** These are L-4-0's cites;
    re-verify, don't trust:
    - `labor-plan.ts:262` (`hasGm`) and `:296-300`;
    - `labor-coverage.ts:105-111`;
    - `labor-coverage-card.tsx:450`;
    - `weekly-plan-client.tsx:717`.
    Report the exact path from "salaried person allocated" to "band drawn on
    this chart, this day". Also report which values on that path also feed
    numbers. Those must not change.
A3. **The Square schedule data Froot already stores.**
    - `SquareScheduledShift` fields;
    - draft vs. published;
    - how a Square location maps to a Froot store;
    - how far ahead the sync runs;
    - how a salaried person joins to their shifts (`squareTeamMemberId`).
    Then find where Square-scheduled shifts are already read for display
    (`labor-schedule.ts`, `EffectiveShift`, labor-actuals). L-4d should reuse
    that read path, not build a parallel one.
A4. **Toggles and fallback.** What happens when:
    - `squareLaborEnabled` is off;
    - Square isn't connected;
    - the sync has never run;
    - the person has no `squareTeamMemberId`?
    Each must fall back to today's behavior.
A5. **Test data.** Does dev `br-broad-wave` have `SquareScheduledShift` rows
    for a salaried person? Report the count with the branch column per
    CLAUDE.md, no names. Does staging likely have them? Say how Gary could
    see real data on staging after the push: which store, which week.
A6. **The fixture pattern.** Is the band decision a pure function you can test
    without a database (like `verify-labor-actuals.ts`)? If so, that's the
    fixture shape.

## Phase B — plan (then HARD STOP)

B1. **Design.** Where the "is she scheduled here today?" decision runs, and how
    it reaches the two charts, without passing through any core engine's
    inputs. Show the data path in one short diagram or list. If the band
    decision is currently inside `labor-plan.ts`'s loop, say how you separate
    "draw the band" (display) from "credit the hours" (numbers, unchanged).
B2. **Band times.** Does the band keep the store's gmOnFloor window, or show
    the Square shift's actual times? Quote what the L-4-1 rulings say. If they
    don't settle it, it's a RULING NOW item. My lean: show her actual
    scheduled times. That's where she is, and the label text stays the same
    shape (no widening).
B3. **Edge cases**, each with a proposed behavior:
    - two shifts in one day at two stores;
    - a draft (unpublished) Square shift;
    - a shift that starts before the store opens or ends after close;
    - her week has Square shifts at some stores but none at this one;
    - a salaried person with no Square data at all;
    - more than one salaried person at a store.
B4. **Fixture** `scripts/verify-l4d-band.ts`. It must at minimum prove:
    - the band draws only on scheduled days;
    - no Square data → today's behavior, exactly;
    - toggle off → today's behavior;
    - each B3 case;
    - **the boundary test:** for a fixed test week, every existing labor
      number (floor credit, `gmHoursByDay`, GM cap, coverage headcount,
      budget) is byte-identical with and without Square schedule data present.
    Pure function if A6 allows. If not, dev-only with the SELF-1 refusal guard,
    and no rows left behind.
B5. **RULING NOW items**, one sentence each, with your lean and a draft wording.
    Expect at least B2 and the draft-shift question.
B6. Classify every out-of-scope finding FIX NOW / RULING NOW / COMMENT / ROW.

### ═══ HARD STOP 1 ═══
Print B1–B6. For each ruling: "Ratify as written, or give me your wording."
Write nothing until Gary replies. Record his reply verbatim.

## Phase C — build

C1. Build the approved design.
C2. Run the fixture. Paste the full pass/fail list. Any failure: STOP, report,
    and don't fix without Gary's go.
C3. Boundary greps. Paste each command and its result.
    - `SquareScheduledShift` / `squareScheduledShift` over the core engine
      files (labor-plan, -coverage, -budget, -daily, -week, -forecast): expect
      no NEW hits versus HEAD. Show the before and after counts.
    - `LaborAssignment` over `src/`: still zero.
C4. Run `npm run build`. It must pass with no error line above the summary.
C5. Stage only the files you touched (no `git add -A`). Work commit:
    `feat(L-4d): manager band draws from the Square schedule (display only)`

## Phase D — docs commit (cites the work SHA)

D1. `docs/ROADMAP.yaml`, L-4 row:
    - Prepend an L-4d block to notes: what shipped, the work SHA, rulings by
      heading, the fixture line, and "closes the R7-C residue on staging."
    - Add the SHA to `commits`.
    - Status: `in_progress` (committed, not pushed).
    - The "NOT SHIPPED UNTIL L-4d SHIPS" guard stays. L-4 becomes shippable
      when L-4d reaches production. Say so in the block.
    - No sub-rows. No `meta.updated` key.
D2. `docs/DECISIONS.md`: Gary's B5 rulings verbatim, as one dated entry at the
    top.
D3. `docs/LABOR.md` § L-4: how the band decides, with file:line, and a pointer
    to the fixture.
D4. Placeholder count before and after. It must not rise:
    `grep -c '__' docs/ROADMAP.yaml`
D5. Run `npm run build`. Stage only the docs you touched plus this prompt.
    Docs commit:
    `docs(L-4d): row in_progress, rulings, LABOR.md, prompt`
D6. `git status` shows a clean tree.

## Report and stop

Report:
- both SHAs and the files changed;
- the fixture result line;
- rulings ratified vs. open;
- every Prisma command run, exactly as typed.

Also give a short staging check for Gary, in plain English: which store, which
week, what the chart should show on a day Kristie is scheduled there vs. a day
she isn't. Use `indianathomas` (ADMIN). Name the org ID and the Clerk instance
the check runs under.

Do NOT push. Next is Gary's PRE-PUSH-CHECK.
