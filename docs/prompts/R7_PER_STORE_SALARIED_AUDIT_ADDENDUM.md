# R7 — per-store salaried archetypes · AUDIT ADDENDUM (pre-state capture)

**Session:** TIER 3, 2026-08-22, continued. **Audit only. NOTHING WAS BUILT** —
no file outside `docs/` was touched, and **no capture script was written** (see
§6 for why, and for its spec).
**This is a SEPARATE FILE, not an edit.** `R7_PER_STORE_SALARIED_AUDIT.md` is a
claim wholesale and is never edited afterwards (CLAUDE.md § Where documents
live). Everything here amends the plan; nothing here revises that document.
**Occasioned by:** Gary's addendum and the pre-state capture committed in
`f071158`.
**Code read at:** `staging` `f071158`, working tree clean.
**Deviations:** S5-D24 onward, continuing S5-D18..D23.

---

## 1 · The capture VERIFIES — 50 assertions, zero mismatches

`docs/prompts/r7_budget_BEFORE_staging_2026-08-22.jsonl` was re-derived from the
pure engine rather than taken on trust. Every budgeted line was recomputed by
`computeWeeklyLaborBudget` from **the seeded legend alone**
(`src/lib/labor-positions.ts:9-13`) and **the schema-default settings**
(`laborTargetPct 20`, `roundingIncrement 1000`, `plannedBlendedRate null`), then
compared field by field:

```
staging (br-square-feather, week 2026-08-10, capture taken at tip 7ab8525)
  ✓  Carson                 all 10 fields recompute exactly   (salaried 800/40 = 28.6% of budget)
  ✓  Las Brisas             all 10 fields recompute exactly   (salaried 800/40 = 22.2% of budget)
  ✓  Meadowood Mall         all 10 fields recompute exactly   (salaried 800/40 = 28.6% of budget)
  ✓  South Reno             all 10 fields recompute exactly   (salaried 800/40 = 25.0% of budget)
  ✓  UNR                    all 10 fields recompute exactly   (salaried 800/40 = 80.0% of budget)
  ·  seven stores           hasForecast:false  budget:null
  lines=12  budgeted=5  null=7  mismatches=0
  blendedHourlyRate distinct: [14.5]   salariedCost distinct: [800]   salariedHours distinct: [40]
  legend mean (18+15+13+12)/4 = 14.5
```

Fields checked per store: `conservativeSales`, `totalLaborBudget`,
`salariedCost`, `salariedHours`, `hourlyDollars`, `blendedHourlyRate`,
`hourlyHours`, `totalSchedulableHours`, `projectedLaborPctAtForecast`,
`floorExceedsBudget`. Verified with a temporary `npx tsx` script against the
committed JSONL; the script was deleted, the tree is clean, and **no database
was queried** — the capture is the data.

**What that buys, beyond confidence in the file.** It independently confirms, on
**staging** and not merely on dev, that:

- the rate legend is the **untouched factory seed** — `blendedHourlyRate 14.5` is
  exactly `(18+15+13+12)/4`, reproduced from `labor-positions.ts` with no fitting;
- there is exactly **one SALARIED archetype at 40 hours and $20**, since
  `salariedCost 800` and `salariedHours 40` fall out of the same seed;
- `laborTargetPct` is **20** and `roundingIncrement` is **1000** at all five
  budgeted stores, since the schema defaults reproduce every `conservativeSales`
  and `totalLaborBudget` exactly — i.e. staging's `LaborSettings` is empty or
  equivalent to empty, matching dev's measured zero rows.

**One thing it cannot settle, stated rather than glossed:** a
`plannedBlendedRate` set to exactly `14.50` would be indistinguishable from the
computed mean in this payload. Nothing suggests one exists, and the coincidence
required is exact, but the capture does not rule it out. It does not matter for
the invariant — either way the rate must not move.

---

## 2 · Nine stores or twelve — reconciled, and the audit's §4 stands

The main audit reports **nine** stores; the capture has **twelve**. Both are
right and the difference is not drift:

| | dev (`ep-late-water-a6k53nv2`) | staging (`br-square-feather`) |
|---|---|---|
| Real Keva stores | 9 | **the same 9, by name** |
| Test fixtures | 0 | 3 — `Default Test Account`, `Tahoe Lemonade`, `The Palomino Club` |
| Total | 9 | 12 |

Carson, Las Brisas, Meadowood Mall, South Reno, Southgate, Spanish Springs,
Sparks, UNR and University Village appear on both, by name, in both reads. **The
estate is nine.** §4's `9 x 40 = 360` hours and `9 x $800 = $7,200/wk` are
therefore about the right denominator, and §4 named its branch on every line as
required. Nothing in the main audit needs correcting; this paragraph exists so a
later reader comparing the two numbers does not have to re-derive the answer.

Two observations recorded, neither verified, neither in scope:

- **The store row IDs differ entirely between branches** (dev `cmqvyg…`, staging
  `cmrd1a…`). Same names, different rows. Consistent with the two branches having
  been re-imported at different times; not investigated.
- **`Southgate` and `University Village` carry `America/Denver`** on staging while
  the other seven Keva stores carry `America/Los_Angeles`. These are Reno-area
  names. It does not affect any field in this capture — the budget path takes
  `weekStart` as a parameter — but timezone **does** drive `today`, which bounds
  open-window inference and the demand shape (`labor-plan.ts:62`, `:309`). Worth
  one query before anyone reads a coverage curve for those two stores. **Flagged
  as a question, not asserted as a defect.**

---

## 3 · UNR — what the 80% actually costs, and what a declaration buys

Gary is right that this is the motivating case, and it is sharper than 80%.

**Today, inherited (`totalLaborBudget 1000`, `salariedCost 800`):**

```
  declared |  salariedCost | salariedHrs | hourlyDollars | hourlyHrs | totalSched | GM % of budget
       40  |          800  |         40  |          200  |     13.5  |      53.5  |   80.0%   ← today
       30  |          600  |         30  |          400  |     27.5  |      57.5  |   60.0%
       20  |          400  |         20  |          600  |     41.0  |      61.0  |   40.0%
       10  |          200  |         10  |          800  |     55.0  |      65.0  |   20.0%
        0  |            0  |          0  |         1000  |     68.5  |      68.5  |    0.0%
```

**13.5 hourly hours across a seven-day week is under two hours a day** for
everyone who is not the GM. Declaring `20` — Kristie Connolly's share, on the
shape §8 of the main audit describes — takes UNR from 13.5 hourly hours to
**41.0**, a **3.0x** change, from one number typed on one screen. That is the
size of what this build is for, and it is why the §2 finding matters: the change
is a **redistribution of dollars**, not a subtraction of hours.

### 3.1 The cliff, and it is close

At the inherited 40, as UNR's forecast falls through rounding tiers:

```
  conservative | totalBudget | hourlyDollars | hourlyHrs | floorExceedsBudget
          6000 |        1200 |           400 |      27.5 | false
          5000 |        1000 |           200 |      13.5 | false      ← where UNR is now
          4000 |         800 |             0 |       0.0 | false      ← ZERO HOURLY HOURS, NO FLAG
          3000 |         600 |             0 |       0.0 | true
```

**UNR is one rounding tier — a 10.2% sales drop, from $5,566.49 to under
$5,000 — from a week with ZERO hourly hours**, caused entirely by an org-wide row
nobody typed. That is not a hypothetical about a short-hours store; it is the
live state of a real store in the capture.

### 3.2 An adjacent finding, in passing and not in scope

**At exactly `salariedCost == totalLaborBudget` the store gets zero hourly hours
and `floorExceedsBudget` stays `false`.** The flag is `>` and not `>=`
(`labor-budget.ts:115`), while `hourlyDollars` is `max(0, budget − salaried)`
(`:81`), so the equality case produces the flag's exact symptom without raising
it. UNR reaches that case at conservative `$4,000`. **Not fixed here, not filed
as work** — it is a one-character question about whether meeting the floor
exactly is "exceeding" it, which is a ruling. Recorded so it is not rediscovered
as new.

---

## 4 · The two pinned assertions, made explicit

Gary's addendum names them; this section makes them fixture text rather than
prose, per his instruction that they be explicit and not implied.

**Assertion 1 — the rate must not move.**

```
FOR EVERY store in the AFTER capture that has a budget:
    blendedHourlyRate == 14.5        exactly, no tolerance
```

**Why it is the sharpest assertion available.** `blendedHourlyRate` is the ONLY
captured field that reports the org-wide legend's *set* directly. If
`LaborPositionStoreHours` ever leaks into rate math — through a resolution rule
that unions or replaces rows (main audit §5.2 (b1)), or through a rate column
someone adds later — **this is the field that moves first and it moves at every
store at once.** A per-store salaried change cannot touch it. See **S5-D24**.

**Assertion 2 — zero declarations means the inherited figures, exactly.**

```
WITH the LaborPositionStoreHours table EMPTY, for every budgeted store:
    salariedCost  == 800             exactly
    salariedHours == 40              exactly
```

These two are the invariant of main-audit §6 stated against real staging data
rather than against a fixture's own constants. Empty table -> `resolveSalariedHours`
returns `position.impliedWeeklyHours` -> `labor-budget.ts:74-77` evaluates the
same expression it evaluates today.

**And the assertion that catches what those two miss.** Neither field moves if a
regression lands purely in the split or the ceiling, so the diff must be over
**every field of every line**, not over the three named ones:

```
diff BEFORE.jsonl AFTER.jsonl   -->   MUST BE EMPTY
```

That is the real gate; assertions 1 and 2 are the two places to look **first**
when it is not empty, because each names a different cause.

---

## 5 · The seven null stores are part of the gate

`Default Test Account`, `Southgate`, `Spanish Springs`, `Sparks`,
`Tahoe Lemonade`, `The Palomino Club` and `University Village` carry
`hasForecast:false` and `budget:null`. Gary is right that this is staging's
incomplete test data and not a defect — **and they must stay in the diff anyway.**

The tempting move is to filter the comparison to stores that produce budgets,
since the other seven "have nothing to compare". That filter is exactly how a
store that *gains* a budget, or one that *loses* one, goes unnoticed: seven of
twelve lines would be outside the gate, and `hasForecast:false -> budget:null` is
itself an assertion about `getWeeklyForecast` and about `plan.budget` being null
(`labor-plan.ts:172`, `budget/route.ts:34-35`). **Twelve lines in, twelve lines
out, diff over all of them.** See **S5-D26**.

---

## 6 · The capture script — specified, NOT written

**I did not write it.** The governing instruction is BUILD NOTHING / STOP after
the plan, Gary's addendum is conditional about the script ("*if* you write a
capture script"), and a session may never move down a tier or re-declare its way
out of a rule it has just hit (CLAUDE.md § Escalation is one-way). **The BEFORE
capture was therefore NOT regenerated and NOT overwritten** — `f071158`'s file is
untouched, byte for byte.

The formatting trap Gary names is real and the spec below answers it. It is one
file whenever he wants it.

```
scripts/capture-labor-budget.ts        (proposed; does not exist)

  npx tsx scripts/capture-labor-budget.ts --week 2026-08-10 --out <path>

  · Reads every store in the org, sorted by name — NOT only budgeted ones (§5).
  · Emits ONE JSON OBJECT PER LINE, keys in a FIXED literal order matching the
    committed BEFORE file exactly, numbers unrounded and unformatted.
  · Emits the same three-line `#` header: file purpose, branch, tip SHA, week.
  · Writes to --out; NEVER to a default path, so it cannot overwrite a BEFORE.
```

**THE RULE THAT MAKES IT USABLE, and it is Gary's:** the script must be able to
regenerate **BOTH** sides in the same format. **A diff between a hand-built file
and a script-built file shows formatting noise that looks like real change** —
key order, float rendering, trailing whitespace — and the failure direction is
the bad one: a diff full of noise is read as "lots changed", which either causes
a false alarm or, worse, trains the reader to skim past a real line.

So the sequence, when the script lands, is:

1. Run the script against staging **before** the build, to `..._BEFORE_script.jsonl`.
2. `diff` it against the hand-built `..._BEFORE_staging_2026-08-22.jsonl`. **This
   diff is the script's own acceptance test** — it must be empty, or the
   difference must be explained and the explanation must be formatting.
3. Only then is the script trusted to produce the AFTER.
4. **Keep the hand-built original alongside, never overwrite it** — it is the
   independently-produced witness, and its value is precisely that a script did
   not make it.

See **S5-D25**.

---

## 7 · Deviations proposed

Continuing S5-D18..D23 from the main audit. **All are proposals. Nothing is
built or approved.**

- **S5-D24** — **`blendedHourlyRate == 14.5` and `salariedCost == 800` /
  `salariedHours == 40` are EXPLICIT named assertions**, in the fixture and in
  the diff procedure, not implied by a whole-file diff. Each names a distinct
  cause: the rate assertion catches `LaborPositionStoreHours` leaking into rate
  math; the salaried pair catches the empty-table invariant failing. Exact
  equality, no tolerance.
- **S5-D25** — **The capture script regenerates BOTH sides in the same format**,
  and its acceptance test is an empty diff against the hand-built BEFORE. A
  hand-built file is never diffed against a script-built one. **If the BEFORE is
  ever regenerated, the original is kept alongside it and never overwritten.**
  The script takes a mandatory `--out` so it cannot default onto a BEFORE.
- **S5-D26** — **All twelve lines are in the gate, including the seven
  `hasForecast:false` stores.** Filtering the diff to budgeted stores puts seven
  of twelve lines outside it and hides a store gaining or losing a budget.
- **S5-D27** — **The UI shows the GM's share of each store's labor budget beside
  its declaration**, not the declared hours alone. UNR reads `40 hrs · 80% of
  this store's labor budget`; Las Brisas reads `40 hrs · 22%`. The hours figure
  is identical at both stores and the situations are not remotely alike — the
  percentage is what makes an inherited 40 visibly wrong at UNR and visibly fine
  at Las Brisas. Design proposal only; **copy is Gary's call**, and the figure is
  already on the payload (`totalLaborBudget`, `salariedCost`).

---

## 8 · What this addendum does NOT establish

- **Nothing was built.** No file outside `docs/` was touched. No capture script,
  no fixture, no schema, no migration. §6's script block is a specification.
- **The BEFORE capture was not regenerated and not modified.** `f071158`'s file
  is byte-identical to what Gary committed.
- **No database was queried in this addendum.** §1's verification recomputes the
  committed JSONL against a pure function; §3's tables are the same pure function
  over hypothetical declarations. The only measured data is Gary's capture and
  the dev-branch read already recorded in the main audit's §4.
- **§3's declaration scenarios are arithmetic, not observations.** Nobody has
  declared anything at UNR; `20` is used because §8 of the main audit describes
  Kristie Connolly's split that way, and the figure is Gary's to set.
- **The two timezone rows and the differing store IDs (§2) are unverified
  observations**, not findings. Each needs one query, and neither is in scope.
- **§3.2's `floorExceedsBudget` equality gap is recorded, not ruled and not
  fixed.**
