# Manager on the floor — the band stops feeding the numbers

TIER 2 — contained. Display-side only. One engine file, one route, copy
across several surfaces. No schema, no migration.
Branch: staging. Commit only. NEVER push — Gary pushes.

## PRECONDITIONS — check both and STOP if either fails

1. R7-D (`1e7286b`, `6911469`) is promoted and pushed, and staging is
   level with main. This change sits on top of R7-D's floor gate and
   its own blast radius must not ride R7-D's DEPLOY_LOG entry.
2. The ruling is in `docs/DECISIONS.md` IN GARY'S OWN WORDS. Draft at
   `docs/prompts/RULING_manager_on_floor_DRAFT.md`. A draft in Claude's
   voice is not a ruling. If the entry is not there, STOP and say so —
   this session builds to a ruling, it does not create one.

## THE RULING THIS BUILDS — option (b), chosen by Gary 2026-08-23

Froot knows the manager is worth 20 hours a week at each of Las Brisas
and UNR. It does NOT know which 20 — which days, which hours. That is
L-4 and it is not solved here.

So: the drawn band STAYS at its window and is DEMOTED to an
expectation. Every NUMBER reads the credited hours instead.

  KEEP    the band drawn — points[].gm per hour, unchanged shape
  CHANGE  the copy, so it reads as expectation, not coverage
  CHANGE  headcount / suggestedHours to read CREDITED hours
  RENAME  "GM on-floor window" -> "manager on the floor" everywhere

Rejected, recorded so it is not rediscovered: narrowing the band to
credited hours per day. Twenty hours over seven days renders as ~2.9
hours a day — a shape the manager never works, since she is there ~8
hours on ~2.5 days. That invents a second fiction to replace the first.

## WHY — the arithmetic, so the change is not mistaken for cosmetics

Kristie works 6:30am–3:30pm less an hour's lunch: ~8 floor hours, 5
days, split 50/50, so ~2.5 days and ~20 hours at each store.

`gmCreditHours` already says 20 at each store — derived from her
allocation, capped by `capGmFloorCredits`, within an hour of her real
coverable presence.

The DRAWN band says far more: the hardcoded fallback
`open.startHour -> 14:00` (DEBT-83) across SEVEN days at BOTH stores.
Fourteen store-days drawn for a person who works five.

Both numbers exist today. The right one drives the money and the floor
math. The wrong one drives the chart and Suggested. This closes that.

THIS DOES NOT WITHDRAW THE 2026-08-20 WHOLE-CREW RULING. Scheduling
hours still count the whole crew, manager included. The instrument
changes, not the policy. Gating the manager out of headcount was the
alternative and was REJECTED — it would have left that ruling with zero
live cases, since both manager stores are under 100%.

## SCOPE

### 1 · The numbers

`labor-coverage.ts` — `headcount` (post-R7-D ~:103, verify at HEAD; the
row cites the pre-fix :98) currently returns `hourly + (gm ? 1 : 0)`.
The manager stops being a per-hour whole body in it.

`weekly-plan/route.ts` — `suggestedHours` (~:163) is
`Σ points[open].headcount`. It must become that sum PLUS the day's
`gmCreditHours`, which already exists on `DayPlan`
(`labor-plan.ts:121, 219, 269` per the Q1 audit — verify at HEAD).

Net effect: Suggested counts the whole crew, with the manager
contributing her CREDITED hours for the day rather than one body per
band hour.

`peakHeadcount` / `peakHours` follow automatically once the manager
leaves `headcount`. THIS IS INTENDED AND MUST BE STATED: peak becomes
the hourly peak. Do not add a compensating term.

`points[].gm` is UNTOUCHED. The band still draws.

DO NOT TOUCH: the floor-of-1 bump or `supervisorGap` — R7-D settled
both and this ruling does not reopen them. `usedHourlyHours`,
`understaffedBudget`, and every `labor-plan.ts` figure are unchanged.
`labor-plan.ts` arithmetic carries a ZERO DIFF; if you need to edit it
beyond reading `gmCreditHours` through, STOP and report.

### 2 · The rename and the copy

"GM on-floor window" -> "manager on the floor", every label, helper
string and legend. Grep for `gmOnFloor`, `GM on`, `General Manager` in
`src/app` and report every hit before changing any, so Gary sees the
list. COLUMN AND FIELD NAMES DO NOT CHANGE — `gmOnFloorStartMinutes`,
`gmCreditHours`, `hasGm` stay as they are. Additive-only does not
rename schema, and a display rename must not become a migration.

The band's legend and the settings helper must say the band is where
the manager is EXPECTED, not what she covers. Exact wording is Gary's
call — propose it, do not ship copy he has not seen.

### 3 · Two records

- DEBT-83 gains the note that CONFIGURING the window makes the band
  WIDER, not narrower: entering 6:30–3:30 sends `labor-plan.ts:284`
  through `Math.ceil(930/60) = 16`, so a 7am store's band goes from 7
  hours a day to 9. The hardcoded default stays. Closing condition
  becomes L-4.
- Southgate's configured window (465->900) is inert — no allocation, so
  `hasGm` is false and it drives nothing. Record it at the site or on
  the DEBT-83 row, whichever the house pattern prefers. Not a new row.

## MEASURE BEFORE AND AFTER — this one moves a visible number DOWN

Suggested WILL DROP at Las Brisas and UNR, and the drop will be large —
the band contributes roughly six hours a day across seven days today
and will contribute 20 for the week. **Predict the per-store weekly
delta BEFORE the capture, then verify against it.** A number that moves
onto a written prediction is a fix; a number that moves without one
reads as a regression.

Prefer the pure engine over any deployed read. The credential rule
stands: `vercel env pull` is banned for every environment and read-only
is not an exception. If a deployed figure is needed, hand Gary the SQL
for the Neon console. Name the branch in the same output as any figure.

State the provenance of every number, including which week and whether
the sales shapes are dev's.

## FIXTURE FIRST

Extend `scripts/verify-labor-coverage.ts` and add coverage for the
route-level sum if a pure seam exists:

- a day with a band: `headcount` no longer includes the manager
- `points[].gm` still true across the band — the band still draws
- `suggestedHours` for a week == Σ hourly heads + Σ `gmCreditHours`,
  and that second term == the store's `salariedHours` in the over-cap
  case (both GM stores are over-cap today)
- a store with NO band: byte-for-byte no-op. Ten of twelve stores.
- peak is the hourly peak, asserted explicitly so the change is pinned
  rather than discovered

Show it failing before the change.

Then run `scripts/verify-labor-budget.ts` and confirm its output is
BYTE-IDENTICAL. That is the proof nothing crossed into the plan's
arithmetic.

## OUT OF SCOPE — do not get pulled in
Merging the manager window into Shift blocks (ruled: revisit at L-4 —
shift blocks drive only the supervisor rule today). The days axis.
L-4. DEBT-83's default itself. Store hours data. Timezones. The
`StoreHours` validation work, which is its own session.

## HOUSE RULES
Additive only. No schema, no migration, no drops. Preserve-and-mark.
Two-commit pattern: work commit, then the docs/roadmap recorder with
the SHA. Gate per commit: scoped `npx eslint` on touched files, then
bare `npm run build`. No bare `npm run lint` (DEBT-33). No `&&` chains
in anything handed to Gary; fixed sequences go in ONE parenthesised
subshell with `|| echo "*** NO MATCH ***"` guards. Row ids come from
`ROADMAP.yaml`'s next free — S5-D numbers are DEVIATIONS, not row ids.

Triage everything found and not fixed: FIX NOW / RULING NOW / COMMENT /
ROW. Default to the first three. Report the count in each bucket.

---

# ADDENDUM — 2026-08-23, appended by the three-phase session

APPENDED, NOT EDITED. Everything above is the prompt as written and is
the provenance record. This section corrects one factual claim in it and
changes no scope.

## The gmCreditHours direction is backwards above

The WHY section says `gmCreditHours` is "derived from her allocation,
capped by `capGmFloorCredits`". It is the other way round:

  DERIVED FROM THE BAND, CAPPED TO A CEILING THAT COMES FROM THE
  ALLOCATION.

`labor-plan.ts:307-308`:

    const gmCeilingHours = resolveGmCeilingHours(budget.salariedHours, 40)
    const gmCreditByDay  = capGmFloorCredits(gmHoursByDay, gmCeilingHours)

`capGmFloorCredits` (`labor-daily.ts:51-57`) takes the DRAWN band's hours
per day and multiplies each by `weeklyCap / total`. The allocation sets
the ceiling; the band supplies the shape and the raw magnitude.

**The shipped number is 20 either way and NO SCOPE MOVES.** The two
call sites in §1, the `points[].gm` untouched rule, and the DO NOT TOUCH
list are all unaffected.

## Why it matters anyway — the written prediction

The prompt requires the per-store weekly Suggested delta to be PREDICTED
IN WRITING before it is captured. That prediction has to be reasoned
from the BAND's hours — 7 days times the unset default's width at each
store, scaled to the 20h ceiling — not from the allocation. Reasoning
from the allocation reaches the same 20 by a route that is not the one
the code takes, which makes the prediction right by luck and proves
nothing. A prediction that cannot be wrong for the right reason is not
a prediction.

## The unscaled-band case is NOT new, and its home is S5-D10

`capGmFloorCredits` returns the band UNSCALED when it totals less than
the ceiling — `if (total <= weeklyCap || total <= 0) return nonNeg`,
`labor-daily.ts:54`. So a narrow enough band, or a store open few enough
days, feeds the credited number directly.

**This is S5-D10's SECOND DIVERGENCE CASE — the short-hours store — and
it is already filed, already ruled open, and already pinned.** It sits on
R7-C's first blocker in `ROADMAP.yaml`, it was left open by Gary's D19
ruling rather than by oversight, and
`scripts/verify-labor-position-hours.ts:146` asserts it explicitly
("short-hours store: credits stay 15, NOT scaled up to 40 (D10 case 2
OPEN)"). Do not open a row for it and do not file it against L-4.

What this ruling adds is only that the same guard now has a DISPLAY-SIDE
face: after this build, a short-hours store is one where the band the
chart draws is also the number Suggested reads. Same guard, same ruling,
one more surface — recorded on S5-D10, not here.
