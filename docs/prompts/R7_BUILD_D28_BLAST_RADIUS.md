# D28 — `floorExceedsBudget` on `>=` · BLAST RADIUS

**Session:** TIER 3, R7 option B build, 2026-08-22.
**Ruling:** `docs/DECISIONS.md` § "R7 option B — the build rulings" (`37d5ded`),
D28, in Gary's words: *"floorExceedsBudget fires on `>=`, not `>`
(labor-budget.ts:115). When salaried cost exactly equals the whole labor budget,
hourly hours are zero for the entire week and the alert currently stays silent —
the flag's exact symptom without the flag. Meeting the floor exactly counts as
exceeding it."*

**This document exists because Gary asked for D28's blast radius to be stated
SEPARATELY from the additive work. It is the only change in the R7 build that
alters existing production behaviour rather than adding capability.** Everything
else in the build is inert until an operator writes a declaration row.

---

## 1 · The change

```diff
- floorExceedsBudget: salariedCostCents > totalLaborBudgetCents,
+ floorExceedsBudget: salariedCostCents >= totalLaborBudgetCents,
```

`src/lib/labor-budget.ts:115`. One character.

---

## 2 · Exactly which weeks change, and which do not

| Relationship | Before | After | hourlyHours |
|---|---|---|---|
| `salariedCost < totalLaborBudget` | `false` | `false` — **unchanged** | > 0 |
| **`salariedCost == totalLaborBudget`** | **`false`** | **`true` — THE CHANGE** | **0** |
| `salariedCost > totalLaborBudget` | `true` | `true` — **unchanged** | 0 |

**Exactly one relationship changes, and it is the one where the alert was
already wrong.** At equality, `hourlyDollarsCents = max(0, budget − salaried)` is
`0` (`labor-budget.ts:81`), so `hourlyHours` is `0` (`:97`): the store has **no
hourly hours for the entire week** and the banner stayed silent. The flag's exact
symptom without the flag.

Asserted in `scripts/verify-labor-position-hours.ts` §7 — all three rows above,
including both no-change cases, so a future edit cannot widen or narrow the
condition unnoticed.

---

## 3 · Every surface that changes

Three, and all three are the same boolean rendered:

| # | Surface | What appears |
|---|---|---|
| 1 | `src/app/(app)/dashboard/labor-budget-card.tsx:210` | red banner — *"Salaried pay alone exceeds this week's budget — no hours left for hourly staff. Raise the forecast or the target %."* |
| 2 | `src/app/(app)/labor/weekly-plan-client.tsx:284` | red banner — *"Salaried pay alone exceeds this week's budget — no hours left for hourly staff."* |
| 3 | `src/app/api/labor/weekly-plan/route.ts:135` | the field on the payload |

**No fourth.** `floorExceedsBudget` is read nowhere else in `src/`.

**WHO SEES IT.** Surface 1 is the Dashboard Labor Budget card, which is
**STORE-visible** — this is not an admin-only change. Surface 2 is `/labor`.
**No number moves on either.** The banner is a pure additional render; hours,
dollars and percentages are byte-identical, because `floorExceedsBudget` feeds no
arithmetic — it is a leaf.

---

## 4 · How often it will actually fire

**Requires `salariedCost` to land on `totalLaborBudget` EXACTLY, in integer
cents.** `totalLaborBudget` is `conservativeSales × target%` where
`conservativeSales` is floored to the rounding tier (default $1,000), so it moves
in $200 steps at a 20% target. `salariedCost` is `Σ rate × hours` — with the
seeded legend, exactly `$800`. Equality therefore needs `conservativeSales` to be
exactly `$4,000`.

**NOT HYPOTHETICAL, AND THIS IS WHY THE RULING WAS MADE.** From the pre-state
capture (`docs/prompts/r7_budget_BEFORE_staging_2026-08-22.jsonl`), staging's
**UNR** sits at `totalLaborBudget 1000` against `salariedCost 800` — **one
rounding tier above equality.** A 10.2% fall in its forecast (from $5,566.49 to
under $5,000) drops it to the $4,000 tier and lands it exactly on the boundary:
zero hourly hours for the week, and under the old `>` the manager would have been
told nothing.

**Estimated frequency: rare, and clustered at exactly the store that most needs
it.** Every other budgeted staging store sits at 22–29% salaried share and is
many tiers away.

---

## 5 · The failure direction, and the copy

**The change makes the alert fire MORE often, never less.** A false positive here
is a red banner on a week that genuinely has zero hourly hours — which is not a
false positive at all. There is no input for which the flag now goes `true → false`.

**The copy says "exceeds" and at equality the cost does not exceed, it equals.**
Gary's ruling addresses this head-on — *"meeting the floor exactly counts as
exceeding it"* — so the banner is consistent with the ruling as it stands, and the
second half of both strings (*"no hours left for hourly staff"*) is precisely and
literally true in the equality case. **The copy is NOT changed in this build.**

If Gary wants the wording tightened, the smallest true alternative is *"Salaried
pay alone takes this week's whole budget — no hours left for hourly staff."*
**Flagged, not applied. Copy is Gary's call.**

---

## 6 · Rollback

Independent of the rest of the build: revert the one character. The additive work
(the table, the resolution helper, the ceiling substitution, the UI) does not
depend on it, and it does not depend on them. **D22's "one revertable merge"
holds at finer grain than the merge** — this line can go back on its own.
