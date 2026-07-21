# Labor Model — Decision Log

Plain record of who decided what, so "yours vs mine" is never fuzzy. **Gary** =
operator decision; **Claude** = implementation choice made without an explicit
instruction. Newest scoping at top.

## Phase 3 — BUILT 7-20 (Gary decisions)

1. **Budget is the hard cap.** Conservative budget caps total scheduled hours;
   coverage never exceeds it. The floor-to-tier rounding ($15k→$14k, $14.5k→$14k)
   is the buffer. Small stores have physical limits — never schedule blindly to %.
2. **Demand-shaped headcount; drop fixed daypart minimums.** ✅ CONFIRMED. Heads
   follow the sales shape (1 at 2p, 3 at 3p), capped by budget, floored at **1
   opener + 1 closer**. Daypart headcount minimums are removed.
3. **Only the GM is salaried; GM counts on the floor.** ✅ Re-seed positions to
   **one salaried General Manager + everyone else hourly** (ASM/Lead/Supervisor/
   Team). The GM is a body on the floor and the supervisor. **On-floor rule =
   option (b): GM covers open→mid by default** (GMs typically work days/mids;
   Square integration will refine this automatically later).
4. **Future / 4-week forward scheduling.** ✅ Coverage must render future days and
   next weeks (4-week horizon) for writing schedules. Future-day demand shape =
   **average of the same weekday over the last 4 weeks** (fall back to last-year
   same-weekday, à la Forecasting, when recent data is thin).
5. **Per-store settings, rolling to the org.** ✅ Each store's budget maps to its
   own performance/budget; per-store `LaborSettings` override the org default;
   locations roll up to the org total.

## Locked decisions (already built)

- Money = dollars, `Decimal(10,2)`, integer-cents internally. (Gary/Claude)
- Rounding: sales floor-to-tier (no full-step-down); hours floor to 0.5. (Gary)
- Total sales only — delivery split removed; `denominator` /
  `projectedDelivery` deprecated. (**Gary** — 7-20 answer to the 3 questions.)
- Auto-forecast from Forecasting `DailyGoal` (TREND default, MANUAL override). (Gary)
- Adjustment scales hourly hours only; salaried fixed. (Gary)
- Salaried hours are a weekly constant, never split per day (option B). (Gary)
- Two-gate feature flag; RBAC read=any / write=ADMIN+MANAGER. (Claude, unchallenged)

## Claude implementation choices (autonomous — for the record)

- Daypart defaults 2/3/2, all requiring a supervisor. (superseded by open #2)
- Weather-adjustment control on the Coverage card; weekly hero shows adjusted
  total by splitting → adjusting → re-summing (the "adjusted from N" label also
  fires on pure rounding drift — **known wart to fix**).
- Day-split weights auto-derived from trailing 8 weeks of sales.
- Coverage today/past only. (superseded by open #4)
- Day-split editor on `/settings/labor` with a per-store dropdown.
- StoreHours window mapping (0=Sun, floor/ceil times, demand-inference fallback).
- "Revert to auto" delete for the manual override; cross-card refresh event.

## Process

- **Verify-gate:** no new phase starts until the prior one passes a staging pass.
- Heads-up on non-trivial autonomous calls before building; veto window.
- Smaller commits per sub-feature.
