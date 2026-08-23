# R7-D — the GM must not satisfy the floor of one body

TIER 2 — contained. One file, two gates, no schema, no threading.
Branch: staging. Commit only. NEVER push.
SUPERSEDES the scope in docs/prompts/R7D_GM_BAND_COVERAGE.md (1588d31),
which proposed threading an allocation signal. That is WITHDRAWN — the
measurement showed the weekly-cap gap dominates the allocation gap, so
the fix does not need a fraction. That prompt is preserved and marked,
not deleted. Its Phase 1 findings stand and are used below.

## MEASURED, NOT ASSUMED — established before this session

From labor-plan.ts / labor-coverage.ts at c91af6c, and Neon reads:
- labor-plan.ts:297-298 — the floor-credit ceiling IS the store's own
  salariedHours. Hours are NOT double-credited. Money is settled.
- Exactly TWO stores carry an allocation: Las Brisas and UNR, Kristie
  Connolly at 50% each. NO store in the estate is at 100%.
- NEITHER of those stores has gmOnFloorStartMinutes/EndMinutes set. The
  org default (storeId null) is NULL too. Their band is the hardcoded
  fallback at labor-plan.ts:283-284: open.startHour -> 14.
- The ONLY configured window in the estate is Southgate's (465->900),
  and Southgate has NO allocation, so hasGm is false and it drives
  nothing. Nobody has ever chosen the band width at a store that draws
  one.
- Net: the drawn band is roughly 49h/week at each GM store against a
  credited ceiling of 20 and an actual presence of ~20.
- Finding A (prior session, by call-site exhaustion): labor-coverage
  output is DISPLAY-ONLY. It reaches no budget, no persisted hours
  figure, and no dollar. Re-verify cheaply; do not re-derive.

## THE DEFECT

labor-coverage.ts treats the GM as an uncapped whole body via
gmAt(h) at :67. Two of its four uses are SAFETY DECISIONS:

  :86-89  the floor-of-1 bump. total = hourly + (gmAt ? 1 : 0), and the
          bump only fires if total < 1. So during the band, hourly heads
          may be ZERO and the floor is considered satisfied.
  :107    supervisorGap is suppressed across the whole band.

Froot does not know which hours Kristie is at which store. Counting her
present at both is wrong in the direction that leaves a store empty.

## SCOPE — exactly this, nothing adjacent

Gate :87 and :107 so the GM does NOT satisfy the floor of one body and
does NOT suppress supervisorGap. The band still DRAWS: points[].gm at
:98 is untouched in this session.

EXPLICITLY OUT OF SCOPE, and each is parked for a stated reason:
- :98 headcount and :102 peak. Changing these moves suggestedHours,
  which implements Gary's 2026-08-20 whole-crew ruling. Since both GM
  stores are under 100%, gating :98 would leave that ruling with zero
  live cases. THAT IS A RULING, NOT A REFACTOR. Do not touch it.
- The band's WIDTH or day-shape. L-4's job. Rejected already.
- Any allocation fraction / bps threading. Withdrawn, see header.
- labor-plan.ts. ZERO DIFF, byte for byte. If you find yourself needing
  to edit it, STOP and report — that means the scope was wrong.

## HOW

1. FIXTURE FIRST. Extend scripts/verify-labor-coverage.ts with a case:
   open window with a GM band, hourly budget low enough that demand
   places zero heads inside the band. Assert every open hour has at
   least one HOURLY head, and that supervisorGap fires when the only
   supervisory cover is the GM. SHOW IT FAILING before the change.
2. Make the change in labor-coverage.ts only.
3. Show the fixture passing. Run scripts/verify-labor-budget.ts and
   confirm it is UNCHANGED — that is the proof nothing crossed into
   the plan's arithmetic.
4. Report the BEFORE/AFTER delta on suggestedHours at Las Brisas and
   UNR. EXPECTED: ZERO, because :98 is untouched. A non-zero delta
   means the change leaked and is a STOP.

## WHAT THIS COSTS, said plainly so it is not discovered later

Recommended headcount goes UP at Las Brisas and UNR during the band,
and understaffedBudget will fire more often there. That is the fix
working: the hours were always needed, and the GM was papering over
them. No dollars move. The hourly pool does not change.

## ALSO IN THIS SESSION — two records, no behaviour

- ROW, next free DEBT id taken from ROADMAP.yaml (S5-D56 — do not
  allocate it from this prompt): the GM on-floor window is a per-store
  setting whose real default is a hardcoded literal at
  labor-plan.ts:284 (gmEnd falls back to 14 while gmStart falls back
  to open.startHour — asymmetric). Unset at eleven of twelve stores
  including BOTH that draw a band; set only at Southgate, where it is
  inert. TRIGGER: anyone who sets a GM window expecting it to mean
  something.
- COMMENT at labor-plan.ts:297: resolveGmCeilingHours(0, 40) returns
  40. Inert only because hasGm is false and gmHoursByDay is all zeros.
  Name the dependency at the site.

## HOUSE RULES
Additive only. No schema, no migration, no drops. Preserve-and-mark.
Two-commit pattern: work commit, then docs/roadmap recorder with SHA.
Gate per commit: scoped npx eslint on touched files, then bare
npm run build. No bare npm run lint (DEBT-33). No && chains in
anything you hand Gary. Never push.

Triage everything found and not fixed: FIX NOW / RULING NOW / COMMENT /
ROW. Default to the first three. Report the count in each bucket.
