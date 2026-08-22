# Decision Log

Plain record of who decided what, so "yours vs mine" is never fuzzy. **Gary** =
operator decision; **Claude** = implementation choice made without an explicit
instruction. Newest scoping at top. (Started as the Labor log; now records HR
decisions too.)


## Forecast participation is a property of the person, not of an hours value — 2026-08-21 (Gary)

Gary's ruling, in his words:

- Forecast participation is a property of the person, not of an hours
  value. An explicit `forecastExempt` flag on `StaffMember` means this
  person's hours never reach any labor forecast, at any store,
  regardless of what number is set. It covers anyone who doesn't
  financially impact hourly operations: managers, owners, owners'
  family, volunteers, corporate staff. Blank hours still means inherit
  Square's figure; a number still means that many hours; exempt
  overrides both for forecasting purposes. (Gary)

RATIFIED HERE AHEAD OF ANY BUILD, and deliberately ahead of the audit
that was commissioned in the same breath. The ruling is Gary's and stands
on its own; whether the codebase currently has anywhere for it to bite is
a separate question, and the answer to that question does not amend the
ruling. See the audit artifact for what the trace found, and read the two
documents in that order.

THE THREE STATES THE RULING CREATES, written out because two of them
already exist and the third is new, and because collapsing any pair of
them is the failure mode this entry exists to prevent:

- blank WK HRS   → NO OVERRIDE. Square's own `weekly_hours` stands.
- a number       → that many hours.
- `forecastExempt` → the hours are still whatever the two lines above
  say they are, and they DO NOT REACH A FORECAST. The flag does not
  blank the number, does not change what Square carries, and is not a
  fourth value of the hours field. It is a property of the PERSON.

Note the direction of that last clause, which is the whole of Gary's
framing: exempt is not "zero hours". Zero hours is a statement about a
week; exempt is a statement about a human being's relationship to the
hourly operation. A GM who genuinely works 45 hours is exempt AND works
45 hours, and both facts stay true and stay visible.

## Scheduling hours count the whole crew, GM included — 2026-08-21 (Gary)

- For the purposes of scheduling, forecasted and suggested hours
  include EVERYTHING required to run the business, including the
  salaried GM. One number, one crew. (Gary)
- The GM-excluded view exists only as an ADMIN-only toggle that
  strips the GM and shows hourly team members alone. It is never the
  default and is not visible to MANAGER or STORE. (Gary)

WHY, in Gary's words and from his own measurement: /labor currently
shows an unlabelled day-card hours figure beside a Suggested figure,
and they count different crews. Arithmetic from two staging
screenshots (UNR, week of Aug 17): day hrs 19.0 + 21.0 + 19.0 + 13.0
+ 17.0 + 12.0 + 7.0 = 108.0; header Schedulable 148.0; Labor Budget
salaried fixed 40 hrs; 148.0 − 40 = 108.0 exact. Earlier the same day,
108.5 against 148.5 − 40 = 108.5, exact again. So the day card is the
HOURLY POOL ONLY while Suggested INCLUDES the GM. Observed gaps
Mon–Thu of 7, 7, 7, 8 are the GM's 7a–3p window. **Rather than label
the discrepancy, I am removing it.** (Gary)

- The audit answering this ruling — including the confirmation that
  the identity is exact BY CONSTRUCTION rather than by coincidence,
  and the three surfaces that must change together — is filed at
  docs/prompts/Labor_S5_Q1_GM_HOURS_AUDIT.md. Implementation is NOT
  ruled here: the audit returns options and the build waits on a
  second ruling. (Claude)

## Labor Day Inspector, S5 scope — 2026-08-21 (Gary)

- A troubleshooting page exists for labor data: pick a store and a
  day, see every person's timecards on a timeline with scheduled
  shifts ghosted behind, and variance flags computed. Its purpose is
  diagnosing Square-vs-Froot labor variances without database access. (Gary)
- Manager/admin surface only — gated like /settings/labor
  (labor.manage), NOT STORE-visible. It shows names and times;
  wages, rates, tips, and pay data NEVER appear. notes never
  selected. (Gary)
- Read-only in every direction: the page fixes nothing, edits
  nothing, and never writes to Square (standing law). Corrections
  happen in Square; the page tells you where to look. (Gary)
- Break intervals are not rendered — Froot stores summed break
  minutes only (S1-measured). Timeline bars are clock-in to
  clock-out; no break segmentation is implied. (Gary)
- The page carries sync-freshness stamps for both timecard and
  schedule sync (computeHealth, 26h), so lag is never mistaken for
  truth. (Gary)

Implementation limitation, recorded as S5 shipped — 2026-08-21 (Claude,
at Gary's instruction S5-A8). The bullets above are Gary's rulings and
are unchanged; this paragraph qualifies them and rules nothing.

- DOUBLE detection is WITHIN-STORE BY CONSTRUCTION. The inspector is a
  one-store, one-day surface and its timecard read is storeId-scoped,
  so DOUBLE compares a person's cards pairwise within that one store.
  A person double-punched across TWO stores on one day is NOT detected:
  neither store's view holds both rows, so neither can see the overlap.
  Nothing is wrong on either page — the pair is simply never assembled.
  This is written down rather than left to be discovered because a flag
  that silently does not cover a case is worse than no flag: a clean
  DOUBLE column reads as "no double punches", and here it means "no
  double punches at this store". The cross-store case is DEBT-79 and
  was deliberately NOT built in S5. (Claude)

## CRON-1 activation, phantom opens — 2026-08-20 (Gary)

- CRON-1 is activated: the parked timecard reconcile cron
  (/api/cron/labor-timecards, RECONCILE_DAYS=3) is registered in
  vercel.json. The BUG-10 mechanism is the case: clock-outs after the
  day's final dashboard-triggered sync are otherwise never seen — a
  26-minute gap that never closes, measured live 2026-08-20. (Gary)
- The schedule cron stays parked: the schedule trigger's window is
  already −3/+28, so prior-day schedule drift self-heals on every
  dashboard load. Timecards were the gap. (Gary)
- The clocked-in 24h lookback window STAYS on both reads (curve and
  roster) — an open card from yesterday genuinely still on the floor
  must render, and the cron now closes the genuinely-closed ones.
  Both-reads-or-neither; neither changes. (Gary)
- Popup entries whose card started before the store-local today carry
  a date qualifier (e.g. "in 2:55p yesterday" / "since Aug 19") so a
  stale open is self-evident at a glance. Display only; neither query
  changes. (Gary)

## Overlay polish rulings, S4 — 2026-08-20 (Gary)

- I am deliberately narrowing the S1b person-data principle for one
  case: the Clocked-in view gains an on-demand roster popup listing
  WHO is clocked in — name, position title, clock-in time (store-
  local). This puts three structured person-level fields on a STORE-
  visible surface, and that is intended: who is on the floor right
  now is the same information as looking around the room. The notes
  ruling stands untouched — free text never ships. (Gary)
- The popup rides labor.schedule.view exactly as the overlay does;
  the /users override removes both together. NEVER wages, rates,
  tips, or any pay data in the popup or its payload. (Gary)
- Names load ON CLICK ONLY via a separate endpoint — never in the
  default card payload. The popup shows NOW only; no historical
  rosters. (Gary)
- Legend chips on the Labor Coverage card become click-to-toggle:
  any series can be hidden/shown to cut visual noise. Client-side
  display state only, resetting on day navigation; no data or
  computation change. (Gary)

## Schedule overlay, S1b rulings — 2026-08-20 (Gary)

- "Scheduled" means the EFFECTIVE shift: published where it exists,
  else draft. During the Square Scheduling migration, draft-only stores
  show the manager's actual plan instead of a blank. Owned trade-off:
  the card may show shifts not yet announced to staff. (Gary)
- Position colors live in a new SquareJobColor table keyed
  (organizationId, squareJobId) — auto-discovered from synced shifts,
  deterministic default color, editable by managers/admins in settings.
  No color column on LaborPosition; no Square-job-to-LaborPosition
  mapping layer. (Gary)
- Shift notes are synced as part of the record and NEVER selected into
  any overlay payload — enforced by not fetching, not by filtering.
  Observed live notes already carry a person's name, and the overlay is
  STORE-visible. (Gary)
- The schedule sync's fetch protocol is law, from the S1b measurement:
  one location_id per request; windows sized to never paginate (weekly
  default, narrow if a response ever carries a cursor); the cursor is
  NEVER followed as a completeness strategy; limit cap is 50. The
  timecard sync's cursor loop must not be cloned. (Gary)
- Deleted shifts: Square tombstones via is_deleted. Sync the flag,
  filter on read. No reconciliation pass. (Gary)

## Staging probe exception, schedule payload discovery — 2026-08-20 (Gary)

- One-time, narrow exception to the Neon-console-only rule for the S1b
  ScheduledShift probe: a local session may pull staging env vars and
  perform ONE read-only SELECT against the staging database — the
  organization's id and squareAccessToken only — solely to make read-only
  Square API calls with the org token. (Gary)
- Everything else stays forbidden: no other staging DB reads, no staging
  DB writes of any kind, no calls to getSquareClient or any token-refresh
  path (they write tokens back), no production contact. (Gary)
- The Square calls themselves are reads by construction — the grant holds
  six read scopes and no write scope (SQ-WB-1). (Gary)
- Pulled env files and every scratch artifact are deleted before the
  session ends; the token never appears in any output, report, or commit.
  (Gary)
- This exception covers this probe only. Any future need is its own
  ruling. (Gary)

## Schedule/actual overlay, scope rulings — 2026-08-20 (Gary)

- Schedule ingest uses the sync-and-cache pattern cloned from timecards
  (dashboard-triggered, claimed cooldown, own sync-state) — never
  fetch-on-view. Square ScheduledShift reads only; read-only,
  org-token-only, shared SQUARE_VERSION constant, rides TIMECARDS_READ
  per LABOR-0B. (Gary)
- Position colors are assigned automatically (deterministic default per
  position), and managers or admins can change a position's color in
  settings (stored override on top of the default). (Gary)
- The overlay is visible to STORE — it shows counts by position, never
  wages — with a capability override in /users (PERM-5 machinery) to
  turn the feature off, following the labor.actuals.view pattern. (Gary)
- Scheduled and actual curves are display overlays on the coverage
  output only — they never enter the demand shape, budget, or
  recommendation path (seam b). Sync failure renders last-synced,
  labeled stale — never a blank pretending no schedule exists (seam c).
  Stores without schedules written show forecasted only. (Gary)
- Scout first: a read-only discovery session probes the ScheduledShift
  API against real orgs and audits the seams before any build. Session
  split ratified: S1 discovery → S2 ingest+table → S3 card overlay →
  S4 /labor comparison. One phase per session. (Gary)

## Same-day coverage shape, addenda — 2026-08-19 (Gary)

- The 4-week same-weekday window is the last 4 COMPLETED same-weekdays —
  today is never in its own average. This corrects future days sharing
  today's weekday as well (they previously averaged in today's partial
  cache); that output change is intended. (Gary — ratifying the 7f1fb3b
  deviation)
- The last-year same-weekday fallback for thin demand-shape history
  (original Advanced Labor decision #7) remains binding but is not built —
  getDemandShape returns empty and the card shows "No sales shape to
  project." Tracked as a DEBT row, not fixed inline. (Gary)
- Shape-source labeling (marking today's curve as projected shape) is
  deferred into the schedule/actual overlay scope; the overlay legend must
  distinguish projected shape from actual-day shape. (Gary)

## Same-day coverage shape — ruled 2026-08-19 (Gary)

- The current day's demand shape uses the future-day template (4-week
  same-weekday average, last-year fallback) — never its own partial-day
  SalesHourlyCache. (Gary)
- Past days use their own complete cache. When today becomes yesterday, the
  card flips to actuals — that flip is intended. (Gary)
- The hours/budget/split path is unchanged — this ruling is shape-source only. (Gary)
- Hybrid intraday shapes (actuals-to-date + template remainder) are rejected. (Gary)
- "Today" is classified on the store-local day, not UTC. (Gary)

## Per-person pay is MANAGE-gated by ABSENCE, not by hiding — 2026-08-19 (Gary)

The governing ruling for AL-3, and the one the rest of the phase is arranged
around. Phase 3 is the first time names sit beside wages on a Froot page, so
DEBT-10 outranked feature completeness for the whole session.

**The rule: the payload for a non-MANAGE viewer must never contain wage fields —
not hidden in the UI, ABSENT from the response.** Every surface honours it by not
assembling the data rather than by filtering it afterwards: `/staff` does not
build the id list, the Positions card does not mount the roster component, and
`/api/dashboard/rollup` adds no `tips` key. A wage that is never selected cannot
leak through a payload, a props tree, an RSC flight payload, or a future JSON
route that forgets to re-check.

**STORE accounts are the motivating case and they were already structurally
safe.** They are shared iPad logins, and a roster of names-with-wages on one is
DEBT-10's exposure repeated on purpose. As it happens `/staff` has redirected
anyone without `staff.view` since PERM-5C, and `/settings/labor` has redirected
anyone without `labor.manage` — so both wage surfaces were unreachable to STORE
before this phase and remain so. The new capability governs the residual case: a
MANAGE viewer who should not see pay.

**`labor.costs.view` — MANAGE, in `ENFORCED_CAPABILITIES`, grid row "See pay
rates and tips".** The capability AL-1 deferred and PERM-4 (c) promised, arriving
with the first surfaces that need it. No prior call sites, so **no role's
baseline moved**. It is deliberately not `labor.manage`, which matched on tier
but is held out of the override grid by PERM-5C and would have taken the Labor
config page with it.

**A missing rate reads "Not set in Square", never $0** — the same law AL-1 wrote
into `wageMissingCount`. Three ways a pay figure can be absent (no Square link,
no wage configured, no tip-eligible hours) are three different sentences, and a
single $0.00 would say all three at once while saying the one thing that is never
true.

## The Positions roster does NOT replace the rate legend — 2026-08-19 (Gary)

Vision item 10 says the Square roster "replaces the predefined rate legend".
**Literal replacement is rejected**, and the reason is a measurement rather than a
preference.

`LaborPosition` is not a legend. It is the weekly budget engine's rate table:
`labor-plan.ts:165` feeds active positions into `computeWeeklyLaborBudget`, where
the blended hourly rate is **the unweighted mean of active hourly rates**
(`labor-budget.ts:88-91`). The legend holds 4 archetype hourly rows averaging
**$14.50**; the real Square roster holds 94 people averaging **$12.36**. Swapping
one for the other drops the blended rate ~15% and inflates schedulable hours ~17%
at the same budget — and does it by feeding a Square-sourced input into a core
engine, which L-2 seam (b) forbids outright.

**The ruling is a segmented control.** The Square roster is the default view when
Advanced Labor is on; the legend sits one click away, labelled "Rate legend —
drives the budget". Item 10's intent — open the card, see your actual team — is
served, and the engine's input is untouched. The label carries the ruling so the
next person reads it on the control instead of discovering it by editing the wrong
table.

**WK HRS and SUP are built and inert, and the card says so.** They are
Froot-owned columns the roster sync deliberately never overwrites (the
`fullNameLocked` discipline). Nothing reads them yet; they are the storage a later
salaried-allocation phase needs. Labelling the inertness is what stops an operator
concluding their edits did nothing — or worse, that they did something.

**SUP is not derivable from Square and the data is why:** "Manager" is 7 people of
whom 3 are salaried, "Administrator" 4 of whom 2 are, and "Owner" is HOURLY.
Square's 7 job titles do not map onto Froot's 5 archetypes at all. Any title-based
guess is wrong for someone.

## The Tips column carries card tips, because Froot already has them — 2026-08-19 (Gary)

**The expected answer was reversed by measurement, which is the part worth
keeping.** The AL-3 prompt anticipated that card tips would be expensive —
"card/electronic tips ride payments, NOT timecards" — and pre-authorised shipping
a declared-cash-only column with a follow-up row for the rest.

`SalesPeriodCache.tipTotal` has been populated from `order.total_tip_money` on
every sales sync since F-4 (`sales-sync.ts:346`), on the same store-local business
day the labor % already uses. Measured across the nine-store estate: **2.4%–7.1%
of net sales, with 573 days of history on the oldest four stores** ($80,378 at
South Reno alone). A declared-cash-only column would have reported a fraction of
the real payout and would have been wrong in the reassuring direction.

**Ruled: sum both halves**, labelled "Square-recorded tips + declared cash", over
tip-eligible paid hours. **No card-tips ingest row is filed — there is nothing to
build.**

**The residual double-count is named, not assumed away.** A cash tip rung into the
POS lands in `total_tip_money` and can also be declared on a timecard; the two
cannot be separated from data Froot holds, so the cell carries an asterisk and
says the rate is an upper bound. Sizing it needs the declared-cash total from
staging, which the dev grant could not produce — `SearchTimecards` returns
`INSUFFICIENT_SCOPES` there because that grant predates SQ-SCOPE-1. The Tips
tooltip prints the declared-cash half for exactly this reason.

**Null tip-eligibility counts as ELIGIBLE**, with the hours reported in the
footnote. Excluding maybe-eligible staff would overstate the per-hour payout, and
overstating what a job pays is the worse error. An explicit `false` is excluded
from the denominator, but that person's declared cash still counts in the
numerator — a declared dollar was received. **Tips still never enter `laborCost`**
(AL-1 Q6, untouched).

**The column follows the date picker**, header naming the range, rather than being
month-anchored as vision item 5 says. It sits directly beside `Labor % · <range>`
in the ranking table, and two adjacent columns silently meaning different windows
would be a worse defect than a column whose header names its own.

## Labor budgets are NET-sales-based, and the comparison is like-for-like — 2026-08-19 (Gary)

Recorded because AL-1 Q4 left it owed. The labor % from `labor-actuals.ts` uses
**net sales** as its denominator (ruled 2026-08-18); Gary confirmed his budget
targets are set against net sales too, so actual-vs-budget compares two things
that are the same thing. `LaborSettings.laborTargetPct` is therefore a net-sales
rate, and nothing stored anywhere is gross-derived — no conversion exists, and
none should be invented later.

**What this does NOT settle.** `SalesForecast.projectedStoreSales` is still a
hand-entered figure whose gross/net meaning is defined nowhere; AL-1 flagged it
and it is still open. Phase 2 does not trip over it, because none of the five
features divides labor cost by a forecast figure — the one place it touches is
the All Locations month-end projection, whose denominator is the goal-weighted
sales projection the card already prints, and that mix is labelled on the card
rather than hidden (see R4 below).

## Labor % is operational, deniable per user, and dollars are not — 2026-08-19 (Gary)

**THE Q-V RULING**, and the anchor for who sees the Advanced Labor overlay.
Actual labor % on the dashboard is visible to **ADMIN, MANAGER and STORE alike**
— the same tier that already sees the weekly labor BUDGET in dollars on the same
page, which is what made "MANAGER and up" incoherent: a store lead could see what
they were allowed to spend but not what they were spending.

**But visibility is a per-user deniable capability**, appearing in the /users
Capability overrides grid, so one shared iPad can be dialled down without
touching another. That is PERM-5's restrict-only override doing exactly the job
PERM-7 device accounts were the motivating case for.

**Dollars stay MANAGE-gated. No wages and no per-person data anywhere** — which
Phase 1 already answered structurally by never assembling any.

**The capability could not be `labor.view`, and the substitute is recorded rather
than assumed.** Gary's ruling said to use `labor.view` *if it supports per-user
overrides*, and to present the smallest alternative otherwise. It does not: an
override is only expressible for a capability in `ENFORCED_CAPABILITIES`, and
`labor.view` gates the Labor nav, the `/labor` page and every `/api/labor` route
— denying it to hide a percentage would remove the module. The build introduced
`labor.actuals.view` (OPERATIONAL) with a grid row, a capability with no prior
call sites so **no role's baseline moved**. Gary's staging pass confirms or
reverses it.

## Meeting labor budget is GREEN — the amber band moves above target — 2026-08-19 (Gary)

Supersedes R3 below, same day, once the consequence was visible. R3 said to reuse
`zone()`'s scale for actual labor % so one dashboard judged planned and actual
alike. `zone()` puts amber one point **below** target, which meant an operator who
came in at 19.5% against a 20% target — under budget — was shown a warning
colour, and so was one who landed at exactly 20.0%. That is a warning for
succeeding. The scale for ACTUALS is now:

- `pct <= target` → **green**
- `target < pct <= target + 1` → **amber**, over budget but inside a grace band
- `pct > target + 1` → **red**

**Amber moved sides; it did not disappear.** A store a tenth of a point over is
not in the same condition as one three points over, and collapsing both to red
would discard the only signal between them.

**The Labor Budget card is deliberately NOT changed, so the two now differ.** A
PLAN that lands a hair under target is worth a nudge; an ACTUAL that lands under
target is a win. The visible result is that a store at 19.5% shows amber on the
Labor Budget card and green on every labor % readout, on the same page. That
asymmetry is the decision, not drift, and a fixture check names it so a later
"harmonisation" fails loudly.

## The six AL-2 design rulings — 2026-08-19 (Gary)

Ruled at the AL-2 Phase A hard stop and enforced at their sites in `8a28f61`.
Kept together because each one is small and none is self-evident later.

- **R1 — a Square disconnect degrades the overlay, it never removes it.** The
  AL-2 prompt's hard rule 3 said a disconnect should render "exactly as today";
  that contradicted the standing 2026-08-05 ruling and seam (c). **The
  2026-08-05 ruling wins**: the card renders stale with a last-synced stamp.
  "Renders exactly as today" binds the **toggle and the env gates only**.
- **R2 — judge against `laborTargetPct` as the operator set it**, never against
  `computeWeeklyLaborBudget`'s `projectedLaborPctAtForecast`. That figure is
  lower because the sales basis is floored to the rounding tier, and the flooring
  is scheduling conservatism, not a judgment threshold. Judging actuals against
  it would mark a store "over" at 19% when the target is 20%.
- **R3 — reuse the existing three-zone scale** (`zone()` in
  `labor-budget-card.tsx`: red over target, amber within one point below, green
  under that) so the planned % and the actual % are judged by one rule.
  **SUPERSEDED THE SAME DAY — see the entry above this one.** Reusing `zone()`
  verbatim meant a warning colour at 19.5% and at exactly 20.0% against a 20%
  target, and Gary flipped the boundary once he saw it. The reasoning is kept
  because it explains why the two cards still differ.
- **R4 — the month-end labor projection divides by the month-end sales figure
  the card already prints** (the goal-weighted `projectMonthEnd`), not by a
  second, differently-derived sales projection. Two different month-end sales
  numbers on one card is a worse defect than one mixed basis, and the mixed basis
  is labelled. Its numerator is a run-rate over the days that carry timecards —
  never over days elapsed, which would understate.
- **R5 — no recolouring of the sales graph.** Vision item 1 asks for a "green bar
  in the sales graph"; the graph is a cumulative line chart with no bars, and
  recolouring the sales line would make the sales colour mean labor. A slim
  labor meter sits in the metric row beside the number it describes.
- **R6 — the All Locations date picker drives the ranking table**; [Today · All
  Locations], [to Date] and [Projected Month End] stay month-anchored, because
  re-pointing them at "last week" would leave three cards whose titles no longer
  described their contents.

## The L-2 deferral is lifted — Advanced Labor is the build — 2026-08-18 (Gary)

The 2026-08-05 deferral did its job: the seam got designed, the survey ran,
the scopes were batched and consented, and the app went read-only before any
merchant was promised that. I'm lifting the deferral. The Advanced Labor
Forecasting vision is what L-2 builds. Gates still stand: version bump first,
production consent at promotion, then build sessions one phase at a time.
## Froot is read-only toward Square; the name write-back dies — 2026-08-18 (Gary)

Square owns its own data. Froot reads it, never writes it. No write permission
will ever be requested from a merchant. The only exception is the OAuth
connect/disconnect plumbing. The team-member name write-back found by LABOR-0B
is removed — it wrote to Square using my personal token, outside what any
merchant agreed to. If we ever want to write schedules someday, that gets its
own ruling, its own consent event, and a real feature behind it.

## Evidence is pinned to a commit, not to a path — 2026-08-18 (Gary's call; Claude's corollary)

The decision is small; the reasoning is the part worth keeping.

`docs/test_docs/*.pdf` is untracked as of this commit — five ~15 MB fixtures
(`V1`, `V2`, `V3`, `V4`, `V6` `_Test_Employee_Handbook.pdf`), 74 MB, roughly 92%
of every byte in the repo. They were already deleted in the working tree; this
only stages what had been sitting unstaged.

The trigger was external to the repo. Claude project knowledge syncs from `main`
against a fixed budget of about 6.1 MB of source bytes, and `docs/test_docs`
alone scores **1,229%** of it. The sync had been silently failing — "some of your
content could not be loaded" — because the filter admitted a folder an order of
magnitude past the ceiling.

**The corollary, which is the actual content of this entry: the fixtures are
cited, and the citations survive deletion, because they name commits rather than
paths.** `docs/ROADMAP.yaml:5202` and `:6055` cite the BUG-7 reproduction
fixtures at `72e4adc` and `eab6254`; `:5396` names
`docs/test_docs/V1_Test_Employee_Handbook.pdf` at `72e4adc`;
`docs/prompts/BUG-7_CLOSURE_ADDENDUM_A.md:99` refers to the same set. Every one
of those retrievals still works after the file leaves `HEAD` —
`git show 72e4adc:docs/test_docs/V1_Test_Employee_Handbook.pdf` is unaffected by
what `main` currently contains. Deleting a file does not delete the evidence. It
only removes it from the working tree.

**No history rewrite. This is the ruling, not a preference.** `git filter-repo`
would reclaim the 74 MB from `.git` and would also rewrite every SHA in the
repository — invalidating `72e4adc`, `eab6254`, `f7723fe`, `e18dd54`, `22b8f26`
and every other commit reference recorded across `DECISIONS.md`,
`DEPLOY_LOG.md`, and `ROADMAP.yaml`. The documentation discipline that makes
this repo auditable is the same thing a rewrite would destroy. Disk we are not
paying for is not worth a citation graph. If the `.git` weight ever becomes a
real constraint, the answer is a fresh repo with the old one archived intact —
never a rewrite in place.

Scope note on the ignore rule: `.gitignore` takes `docs/test_docs/*.pdf`, not
the directory. A future small repro fixture can still be committed there. Only
the 15 MB handbooks are blocked, and blocked loudly rather than silently.

Two things this entry deliberately does **not** settle:

- **It does not fix the project-knowledge overflow.** `test_docs` was already
  excluded from the sync filter, so untracking it changes the sync by exactly
  zero. The remaining overage is ordinary repo content that has no business in a
  knowledge base — `public/logo.png` (4.3%), `src/app/icon.png` (4.3%),
  `src/app/favicon.ico` (1.5%), `package-lock.json` (6.8%) — about 17%, which is
  the difference between failing at 102% and sitting at 85% with headroom. That
  is a separate change to the sync filter, not to the repo.
- **The version chain skips V5.** The fixtures run V1, V2, V3, V4, V6. Whether
  that gap is deliberate — a deletion case for the HR-11k version-verification
  work — or an artifact of how they were produced is unresolved and belongs to
  whoever next touches stamping verification.

## A gate written in a document the procedure never opens is not a gate — 2026-08-16 (Gary's framing; Claude's corollary)

Recorded as a **mechanism**, not a mea culpa. Nothing here reverses a decision;
the point is that no decision was involved.

Gary's framing, and the spine of the entry:

> A promotion procedure that never reads the roadmap cannot enforce a gate the
> roadmap records. `00881dc` shipped while its own row said `in_progress` and
> the file said the gate required a staging verification that had not happened.
> Nothing was ignored — nothing ever looked.

The specifics, so the abstraction has something under it. `docs/ROADMAP.yaml`
carried an explicit ordering constraint on the BUG-7 row: *verify BUG-6 on
staging → verify BUG-7 on staging → register the Square subscriptions → verify
F-4*. BUG-6 was verified on staging and the commit says so. BUG-7 was not.
`00881dc` was promoted to production on 2026-08-14 and the Square subscriptions
had been registered on 2026-08-13, about two hours after BUG-6 closed. Promotion
is `git merge staging` plus a push. Neither command has ever opened
`docs/ROADMAP.yaml`, so the gate could not have fired, and no one declined to
honour it.

**The failure mode is the one this repo keeps rediscovering in new clothing: a
check that cannot produce a false pass versus one that produces no signal at
all.** A gate in a document is the second kind. It reads as protection when you
are writing it, and it is inert at the only moment it matters. The backlog
counterpart is `DEBT-72`; the remedy is deliberately not drafted there, because
Gary reserved the WORKFLOW.md promotion gate as his own ruling to write and
ratify — a recommendation is not a ruling until he has written it.

The same shape, one document over: five consecutive promotions skipped
WORKFLOW.md §2 entirely, leaving no `docs/DEPLOY_LOG.md` entry and no merge
commit, in violation of the `--no-ff` rule that §2 itself added. That is
DEBT-38's second genuine recurrence. Two documents, one seam, and the seam is
that promotion is a pair of git commands with no reading step in it.

### The corollary that matters for future evidence work

**The direct proof of a concurrency guard is a SUCCESS log, not an error log.**

BUG-7's guard was hunted for three days in the wrong place. `P2002` is what the
defect used to emit, so `P2002` is what got searched for — and the fix works by
making `P2002` **structurally impossible**, since `ON CONFLICT` cannot raise it.
The search could only ever return zero. Zero was then available to be read as
"the guard is working", which would have been the right conclusion drawn from
evidence incapable of supporting it.

What actually proved the guard was `[sales-sync] ... discarded N superseded by a
newer fetch` — a line the new code emits when it **succeeds** at the thing it
was built to do. ~55 of them across nine production stores on 2026-08-16,
including collisions 70 ms and 270 ms apart.

Two rules fall out of this, both cheap:

1. **When a fix removes an error, stop searching for the error.** Ask what the
   fixed code emits when it works, and search for that. If it emits nothing when
   it works, that is a finding about the fix's observability, not about its
   correctness.
2. **A log filter that selects failures cannot measure a rate.** The BUG-7
   discard line is wrapped in `if (discarded.length > 0)`, so successful writes
   emit nothing and the filter returns losers only. The ~55 is a count, never a
   percentage; the denominator is invisible by construction. This is written on
   the BUG-7 and DEBT-69 rows as well, because a reader who finds that filter
   later and computes a 100% discard rate will have a coherent, urgent and
   entirely wrong finding — the failure mode CLAUDE.md § Database Evidence
   describes three times over.

## A Square disconnect does NOT disable the labor toggle — it degrades the overlay — 2026-08-05 (Gary)

Closes the third of L-2's three open questions, the only one that could be
settled without kickoff. `squareLaborEnabled` **stays on** when Square
disconnects. The org keeps the feature; the comparison overlay drops to the
**ON BUT UNHEALTHY** state of L-2 seam (c) and shows its last-synced stamp.
**Reconnecting restores the feature with no second admin action** — an admin
who reconnects never has to remember a toggle they did not turn off.

This is seam (c) applied to disconnect rather than a new posture, and it runs
the same direction as L-2's DON'T 4: `/api/square/disconnect` nulls the three
token columns and touches nothing else, so the mirrored rows and the toggle
both survive it and read as stale. **Staleness is a badge, not a delete** — and
by this ruling, not an auto-off either.

The other two open questions (ingest shape; whether owner/admin accounts who
never clock in appear in labor surfaces) remain deferred to kickoff.

## Square labor integration is STRICTLY OPTIONAL; core labor stays forecast-driven — 2026-08-05 (Gary)

THE RULING, and the anchor for everything on L-2. Keva Juice is migrating to
Square Scheduling, with all stores switched by **September 2026**. That makes a
Square labor integration — schedules, timecards, actuals — worth building. It
does **not** make it a dependency.

**Froot serves businesses that do and do not use Square.** So the integration is
a feature boost, not a floor:

- **Per-org toggleable, OFF BY DEFAULT.** An org that never touches Square sees
  no trace of it.
- **Core labor never depends on it.** Budgeting, coverage and targets are
  forecast-driven and must keep working with the integration off, disconnected,
  mid-outage, or returning garbage.
- **A broken integration can never break core labor.** Not a crashed page, not a
  masked auth error, not a zero rendered as a measurement.

**BUILD IS DEFERRED.** This session designed the seam only, so a future build
slots in without tearing anything down. The seam lives in L-2's notes; the
DON'Ts for intervening sessions live there too, with a pointer line in
CLAUDE.md § Square Integration.

**THIS REVERSES ONE THING — read it before scoping L-2.** The 2026-08-02 draft
(`docs/prompts/LABOR-1_row_draft.md`, phase c) proposed that coverage-from-
actuals would **supersede** the L-3 decision to keep coverage sales-inferred
(§ L-3 (a) below), retiring the proxy. Under this ruling it does not. Real
staffing data is an **optional overlay on top of** forecast-derived coverage,
never a replacement for it — because the replacement path is exactly the one
that stops working when Square is off. **The L-3 (a) decision stands.**
`StoreHours` remains the upgrade path for coverage, not Square.

Two facts recorded with the ruling, both measured 2026-08-05 and neither
resolved here:

1. Froot's Square OAuth requests `MERCHANT_PROFILE_READ ITEMS_READ ORDERS_READ
   EMPLOYEES_READ` and nothing else. Every Labor API scope is missing, and
   adding one sends **every existing merchant connection back through a consent
   screen**. That is a merchant-facing re-auth rollout, not a deploy, and it is
   the long pole on this thread.
2. The Square client pins `Square-Version` `2024-01-17`, below the `2025-05-21`
   floor the Labor/Timecard endpoints require.

## DEBT-50 mechanism ruled; production sign-up closed (F3) — 2026-08-04 (Gary)

THE MECHANISM RULING. Production Clerk holds NO duplicate identities:
kevajuice14@icloud.com and gary@kevajuice.com each return exactly one
identity on the production instance (verified in the dashboard 2026-08-04).
The two "duplicates" measured in the production database (branch
br-sparkling-block-a620qvg4, queries a-d, all with branch id on output) are
fossils, not live twins:
- gary@kevajuice.com's second row belongs to the DEV instance's Keva Juice
  org (org_3FhMmIWVjja5HYpsou8n6rVtZn2) — cross-instance contamination from
  a period when dev-configured code wrote into this database. Production
  Clerk can never authenticate that identity; the row is a permanent
  fossil.
- kevajuice14@icloud.com's second row (user_3Fq6iuvkhK4TSsmdaJ8yMMcT4rf,
  STAFF, created 2026-07-03) points at a Clerk identity that NO LONGER
  EXISTS — a deleted account whose row survived because there is no
  user.deleted handler. This is DEBT-47's consequence measured in the wild.
The LIVE duplicate pair (two gary@kevajuice.com identities) exists only on
the dev instance, where the enabling conditions were: public sign-up, no
account linking, password + Apple + Google all enabled, AND the
accept-invite sign-up default (H2 — fixed by F4/3784c34). No single
hypothesis "won"; H2 was a real armed mechanism and is closed, H1's OAuth
door was never open on production (Apple/Google still "Setup required"),
and H3 (open org creation) is how the vanity orgs appeared.

THE F3 RULING (Gary). Production Clerk restricted mode: ON, effective
2026-08-04. Public sign-up had already produced one uninvited account
(blankettegirl@gmail.com, signed up ~2026-07-27, created "My Organization",
saw only its own empty org — tenant isolation held, no Keva data exposed).
Account and org deleted 2026-08-04; "Keva Smoothie Company" (Gary's 7-03
testing artifact, sole member gary@keva.com) also deleted. Froot is
invite-only by design; nothing legitimate arrives via public sign-up. The
dev instance deliberately stays open for testing.
INSTANCE DIVERGENCE recorded while ruling: dev REQUIRES a username as an
identifier, production has username OFF; dev has live shared-credential
Apple/Google, production has neither configured. The two instances are
independently configured — never assume a Clerk behavior transfers between
them.

### Process notes from the same session — recorded, not ruled

Placed here by Gary's ruling 2026-08-04 rather than in CLAUDE.md: none of
the three is a rule anyone must follow today, and each is a thread the next
person in this area should be able to pick up.

- Dev-instance webhooks/config once wrote into the production database
  (the gary@ dev-org row proves it). Worth one grep someday for how, so it
  cannot recur — likely historical env mix, possibly pre-dating the
  three-branch Neon setup.
- Clerk dev instance has Test mode ON (+clerk_test emails, code 424242) —
  another way dev accumulates odd accounts; fine, just known.
- The /users invite-dialog copy actively teaches plus-addressing as the
  workaround for "email already has a login" — accurate, but it multiplies
  accounts per human; revisit the copy when the invite guard question is
  next opened.

## PERM-7 Task 7 — the derived device name OVERRIDES the sign-up form, it does not fill a blank — 2026-07-28 (Gary ruled, confirming Claude's implementation)

Recorded because the override is the entire point and a later session will
otherwise read it as overreach and "fix" it into a fallback.

A device login provisioned from `/stores` gets its `User.name` derived from its
store in the Clerk webhook's user upsert. The narrow question was whether that
derived name should *replace* whatever the invitee typed at sign-up, or only
apply when they typed nothing.

**The ruling (Gary): it overrides. The premise is not trusting the sign-up
form.** A fill-the-blank version would be defeated by the exact behaviour the
convention exists to prevent — a person at the counter typing their own name
into the iPad's account. The convention has to be produced as a side effect of
the flow, not requested from whoever happens to be standing there. `STORE is a
device, not a person` (2026-07-27) is only enforceable if the flow enforces it.

**The guards that make an override safe**, and which must survive any future
edit:

- **Create-only.** It sits in the `create` branch of `prisma.user.upsert` and is
  deliberately ABSENT from `update`. Every later Clerk event for that user hits
  the update branch, so deriving there would silently reset a name an admin had
  since corrected — forever, and with no way to make it stick.
- **Narrow conditions.** `pending.role === "STORE"` **and** exactly one
  `storeId`. A multi-store or higher-role invite is a person and keeps the name
  they typed.

So the name is asserted exactly once, at the only moment both the invite and its
store are in hand, and is freely correctable forever after. An admin who renames
the account wins permanently; the sign-up form does not.

### The reopening condition — and it fires in the Clerk dashboard, not in this repo

Relocated here 2026-08-02 from DEBT-39, which keeps the mirror-NAME task. It
belongs in this section because **the trigger is a settings change made by a
person standing in the Clerk dashboard, and nobody standing there reads
`ROADMAP.yaml`.** This is the note that has to reach them.

**The trigger: making `first_name`/`last_name` REQUIRED at sign-up, or adding
any sign-up path that collects a name.** Today neither configured Clerk instance
collects one — the flow renders only REQUIRED fields, first/last are merely
enabled, and three staging runs on 2026-08-01 including one through Google OAuth
presented username and password only.

**Check it as ONE trigger, not two.** That single change unmasks both of these at
once:

1. **Task 7's override becomes reachable-and-untested.** Everything above is
   correct in design and correct in code, and it has never once run against a
   name a human actually typed — because no path supplies one.
2. **A second writer starts putting a person's name on a device account.** Two
   writers create the `User` row for an accepted invite and only the webhook
   derives the device name; `src/app/(app)/users/page.tsx` writes
   `[firstName, lastName].join(" ") || null` with no derivation at all. Whichever
   runs first wins, and because the webhook's update branch deliberately never
   writes `name` (the create-only guard above), a page win means Task 7 **never**
   runs for that account — not late, never. Nothing logs it and nothing retries.
   Today the page can only write `null`, so the damage is a blank name. After the
   trigger it is *Tommy Thomas* on the iPad at the counter, which is the exact
   hazard `STORE is a device, not a person` exists to prevent.

The guards above are what make the override safe; this is what makes it
**incomplete**. DEBT-17 was the same race on the same two writers for ROLE, and
its fix (84437e5) mirrored ROLE between them and left NAME unmirrored — one field
of a two-field race closed, the other not noticed. The fix direction is to mirror
NAME the same way, so either winner produces the same row.

Anyone changing that Clerk setting should read DEBT-39 and DEBT-40 before, not
after.

## Production database reads go through the Neon console, not a local credential pull — 2026-07-28 (Gary, after the PERM-7 audit did it the other way)

PERM-7's pre-flight audit needed production data — it is what established that
the phase's founding example was wrong on every count and that
`Store.contactEmail` was null on 10 of 10 stores. The findings were sound and the
access was strictly read-only, but the method was not the one this repo has
already ruled on.

**What happened:** `npx vercel env pull --environment=production` wrote a
production connection string to a scratchpad file on disk, which a local script
then connected to. The file was deleted afterwards.

**The ruling (Gary): don't repeat it. Production reads go through the Neon
console.** `DEBT-4` already says to keep production credentials out of the
working tree; this extends the same reasoning to anywhere on disk. The audit
value did not depend on the method — the same queries in the Neon console would
have produced the same answers with nothing written down. `DEBT-9` was found
that way, in the console, which is the precedent.

**One finding from this worth keeping, because it bears directly on DEBT-4's
open question** — whether "no tooling still reaches production by another path":

> `DATABASE_URL` is marked **Sensitive** in Vercel and pulls as `[SENSITIVE]`,
> but `DATABASE_URL_UNPOOLED` is **not**, and pulls as a live production
> connection string. So the Sensitive marking on `DATABASE_URL` is not the
> boundary it appears to be — anyone who can run `vercel env pull` against the
> Production scope has a working production credential via the sibling variable.

That is a gap in the guard, not a gap in the policy.

**Follow-up, 2026-07-28 — the obvious fix is unavailable, so the rule is the
mitigation.** Marking `DATABASE_URL_UNPOOLED` Sensitive would close it, but
Vercel will not allow it: the variable is **integration-managed by the Neon
integration**, not a hand-created project var, and Vercel **rejects the type
change**. There is no platform setting that closes this.

So the control is procedural and lives in `CLAUDE.md` § Environment Variables:
**never run `vercel env pull` in this repo; production reads go through the Neon
console; no production credential is written to disk, including a scratchpad
file intended to be deleted.** Recorded against `DEBT-4`, which this does not
close — it converts one of that row's open questions into a known, documented
gap that configuration cannot fix. Because the control is a convention rather
than an enforced boundary, it is worth re-stating at review time rather than
assumed to hold.

## Plus-addressing is the collision answer, and it rests on a Clerk dashboard setting nothing in the repo pins — 2026-07-28 (verified by Claude; handling ruled by Gary)

PERM-7 left two unknowns open rather than designing around them. Both are now
resolved with evidence. This entry exists so neither is re-researched, and so
the one standing dependency is re-checkable in a single call.

**Clerk does not normalise email subaddresses. It optionally BLOCKS them.**
There is no canonicalisation step that would collapse `kevajuice+0014@icloud.com`
into `kevajuice@icloud.com` — Clerk's only subaddress behaviour is an instance
restriction, `block_email_subaddresses` (Dashboard → Restrictions → "Block email
subaddresses"), which rejects addresses containing `+`, `=` or `#` outright.

**Verified 2026-07-28: that flag is `false` on both instances.**

- `clerk.usefroot.com` — production
- `verified-snapper-7.clerk.accounts.dev` — development, which also serves staging

Read from Clerk's **public, unauthenticated Frontend API**: `GET
/v1/environment` → `user_settings.restrictions.block_email_subaddresses`. Note
for whoever re-checks: the Backend API's `GET /instance/restrictions` returns
**405** (it is PATCH-only), so `/v1/environment` is the read path, and it needs
no secret key — which matters because production's `CLERK_SECRET_KEY` is marked
Sensitive in Vercel and pulls as `[SENSITIVE]`.

**This is the dependency worth writing down.** So plus-addressing works — one
real mailbox, N distinct device identities — but it works *because of a
dashboard toggle that lives outside this repository*. Nothing in the codebase
pins it, no test would catch it being flipped, and flipping it would break
device-login provisioning for every operator relying on a shared address, at
sign-up rather than at invite. If PERM-7's collision path ever starts failing,
re-read that flag first.

**The collision handling (Gary's ruling).** Where N Square locations share a
`business_email`, the flow **prefills the plus-addressed variant as an editable
suggestion** rather than demanding a distinct address. Requiring the operator to
invent one is easy to write and may be impossible for them to satisfy — a
single-mailbox operator has nowhere to go. The suggestion is editable because
the guess can be wrong.

**Confirmed live, not hypothetical:** the production Square account returns 19
locations, with `corporate@keva.com` on four (Cafe De Keva Cart, Cart 2, Keva
Juice, Keva Kiosk) and `gary@kevajuice.com` on two. All nine currently-imported
stores hold distinct addresses, so the collision is latent today and fires on
the next import.

**Detection must be by error code, not message text.** `createOrganizationInvitation`
returns HTTP 400 with `already_a_member_in_organization` or
`organization_invitation_not_unique`. `POST /api/users` previously collapsed every
Clerk failure to `err.message` with a blanket 400, which is precisely what made the
collision fail opaquely.

> **CORRECTION 2026-07-28 — this was recorded as VERIFIED and it was not. The
> test was invalid, and the invalidity is the lesson.**
>
> The original verification called Clerk's REST API directly with `fetch` and
> asserted on the **HTTP response** — status 400, body code
> `already_a_member_in_organization`. That is a true fact about Clerk, and it is
> not the thing the handler depends on. The handler branches on an **error
> object thrown by the SDK**, and the `fetch` test never constructed one. It
> proved the half that was never in doubt and skipped the half that broke.
>
> The staging pass failed: the admin saw a raw `Bad Request`. That string is
> `ClerkAPIResponseError.message` verbatim, and the only branch in
> `src/app/api/users/route.ts` that emits it is the generic
> `err instanceof Error ? err.message` fallback — so `isClerkAPIResponseError(err)`
> returned FALSE in the deployed runtime, and the 409 never ran.
>
> **Second correction, same day — the cause stated above was ALSO wrong.** It
> read: "the built server output carries five separate definitions of
> `ClerkAPIResponseError` … the error is thrown by one chunk's copy while the
> route checks another's." Withdrawn. See `DEBT-15`, demoted to an unverified
> hazard.
>
> **The actual cause: the 409 handler was never deployed.** Staging was running
> a build that predates every PERM-7 commit, so the `catch` in force was the old
> `err instanceof Error ? err.message` with a blanket 400 — and
> `ClerkAPIResponseError.message` is verbatim `"Bad Request"`. No bundler
> behaviour was involved.
>
> **The disconfirming evidence was already in hand.** The SDK reproduction run
> while diagnosing this returned `isClerkAPIResponseError(err) === true` and
> produced the intended 409. That result was observed and reasoned past because
> the five-definition count made a better story.
>
> **Two rules, and the second is the one that was actually missing:**
> 1. A verification must exercise the same *shape* the code consumes, not merely
>    the same underlying truth. The original `fetch` test asserted on an HTTP
>    response; the handler branches on a thrown object.
> 2. **A measurement that contradicts the theory outranks a suggestive
>    artifact.** Both wrong diagnoses were plausible chains built past a
>    contrary observation.

## The PERM-7 staging pass tested a build that predated the feature — and every turn had said so — 2026-07-28

Recorded as a process failure, not a code one, because nothing in the codebase
caused it and nothing in the codebase would have caught it.

A full staging verification of PERM-7 was run and produced two failures and
several passes. All of them were artifacts. The deployment aliased to
`froot-git-staging` was created at **11:59:10**; the earliest PERM-7 commit is
**12:31:21** and the feature commit is **12:40:55**. Staging was running
pre-PERM-7 code — confirmed against `git show 6530d8b~1`, where
`stores/page.tsx:112` still reads `"Has Account"` and `users/route.ts` still has
the blanket catch.

**The information was never missing.** Every one of six consecutive turns ended
with an explicit "unpushed commits: six" line — a convention adopted after the
F-4 incident precisely so unpushed work could not sit unnoticed. It worked: the
work was reported, every time. What was absent was any step that *consumed* that
report before testing. Neither party connected a correct status line to the test
plan.

**The lesson is about the shape of the control, not the diligence of the
reader.** A report line is passive; it informs. What was needed was a gate: a
precondition that fails closed. That now lives in `CLAUDE.md` § Staging
Verification — confirm the deployed SHA matches `HEAD` before verifying
anything, and treat a mismatch as voiding the entire pass, passes included. The
corollary is that since Claude never pushes, the default assumption for any
Claude-run phase must be that staging does *not* yet have the work.

**A cascade worth noticing:** the false results were then diagnosed at length,
producing confident and wrong causal theories. Bad inputs did not announce
themselves as bad; they produced *plausible* findings, which is more expensive
than an obvious failure.

**The second unlabelled input, found the same evening.** Three Neon branches
(`production`, `preview/main`, `preview/staging`) were queried and the results
reported without naming the branch beside any of them. A `role=ADMIN, stores=0`
row from **production** was read as though it came from **staging**. Because a
real staging device account also existed, the mismatch looked like a defect
rather than a mix-up, and produced: a privilege-escalation investigation; an
invented mechanism for how the row was "inherited when the staging branch was
cut" (no inheritance ever happened); a claim that the Clerk webhook had not
processed the event (it had, correctly); and the retraction of a *correct*
PERM-6 coverage finding. The true `preview/staging` row was `role=STORE,
stores=1` — **the feature had worked the whole time.** That rule now lives in
`CLAUDE.md` § Database Evidence.

**Five causal chains were wrong in one session**, every one of them internally
coherent: (1) `User.name` display-layer theory; (2) the `DEBT-15` bundler
theory; (3) production-fossil-inherited-into-staging; (4) webhook-never-ran, and
the PERM-6 retraction that followed from it; (5) `DEBT-18`, filed to explain a
contradiction that did not exist.

**What connects them is not carelessness with evidence — it is what happens
after a contradiction appears.** In each case a measurement was available that
did not fit, and the response was to build a mechanism that reconciled it rather
than to distrust the input. A mislabelled or stale input is indistinguishable
from a real defect precisely *because* the resulting story hangs together. The
operative discipline: when an observation requires a novel mechanism to explain,
suspect the observation's provenance before inventing the mechanism. Both
preconditions in `CLAUDE.md` — deployed SHA, named branch — exist to make
provenance checkable instead of assumed.

**Also settled, on the second unknown:** the per-location mailboxes are
reachable. `kevajuice14@icloud.com` and `kevajuice06@icloud.com` are already
live production Clerk identities with `User` rows and store assignments, so
those addresses have completed a sign-up. Not distinguishable from a
Clerk-dashboard add without the production secret key.

**One incidental finding that shapes staging passes:** the development instance
has `username` as a **required** identity attribute; production does not. A
staging sign-up therefore takes a different shape than a production one — and it
is exactly the BUG-2 hazard (Clerk's `identifier` being the username rather than
the email) that `getClerkPrimaryEmail` already guards against.

## PERM-6 Task 2 — validate invite `storeIds` at BOTH the invite and the webhook — 2026-07-27 (Gary ruled, on Claude's recommendation)

`POST /api/users` wrote `storeIds` into `PendingInvite.storeIds` with no
org-ownership check, and the Clerk webhook later materialised them into real
`StoreUserAssignment` rows with no re-check. Three options were on the table:
validate at the invite, at the webhook, or both.

**The ruling (Gary): both.**

- **The invite is where the error is legible.** It is the point of admin intent,
  and the only place a human sees a response. Webhook-only validation means the
  admin gets a 201, the invite goes out, and the assignment silently
  half-applies days later on acceptance — a failure with no audience.
- **The webhook is the last writer before real rows exist.** A `PendingInvite`
  can sit for days; a store can be deleted or moved between orgs in that window;
  and a future writer of `PendingInvite` (PERM-7 provisioning, a bulk import)
  may not pass through that route at all. "Both" is the only option where a
  stale row cannot materialise a bad assignment.
- Cost is one indexed query on a path that already runs several.

**Implementation note that follows from the ruling:** the webhook **filters,
never throws**. It materialises the valid subset and `console.warn`s the
dropped ids. A 500 there is retried by Clerk and would block the entire
acceptance — user upsert, staff binding, invite cleanup — over one stale store
id. Failing the whole acceptance is strictly worse than dropping the assignment
an admin can re-add. If a future session is tempted to make the webhook strict,
that is the reason not to.

## Role choice at provisioning is unrestricted; capability overrides stay restrict-only — 2026-07-27 (Gary ruled; Claude's initial objection was wrong)

The scenario: a family-owned single-location business wants the in-store device
to just work, without administering access. Gary asked for the ability to
provision a store device account at any role, up to ADMIN, with a warning.

**Claude's initial position was that this breaks PERM-5's invariant. That was
wrong, and the error is worth recording because it is an easy one to repeat.**
It conflated two different things:

- **A per-store override that elevates a user above their role ceiling** — this
  genuinely does break the rule at `ROADMAP.yaml` PERM-5, that a stored
  permission set *"RESTRICTS BELOW the Clerk role ceiling and never elevates
  above it."*
- **Choosing a higher role for a device account at creation time** — this breaks
  nothing. If the account is provisioned as ADMIN, the Clerk role *is* ADMIN and
  the ceiling *is* ADMIN. Nothing is elevated past anything. It is the ordinary
  invite flow, which has always offered Admin/Manager/Store, reached from a
  different page.

**The ruling (Gary).** Role is freely choosable at provisioning. The restrict-only
rule is untouched, because it governs *overrides*, not *role choice*. The two
are not the same mechanism and should never again be argued as if they were.

**Why the product should allow it (Gary).** Forcing a two-person juice shop to
maintain separate owner and device logins imposes ceremony on someone who gets
nothing from it — the owner *is* the manager *is* the person at the counter. The
job is to make the tradeoff legible, not to prevent a customer from accepting a
risk on their own business.

**The safeguards, in place of a prohibition:**

a. **A count-aware warning, not a generic one (Claude, Gary agreed).** The store
   picker is hidden for ADMIN (`user-actions.tsx:104,230` — "Admins have access
   to all locations automatically"), so an ADMIN device account sees *every*
   store. For a one-location shop that is the business the owner already owns.
   For a twelve-location operator it means the counter iPad at Carson can read
   all twelve stores' financials. The warning states the real blast radius —
   *"this gives the shared device at Carson access to all 12 of your
   locations"* — so it is unalarming in the first case and stopping in the
   second, without the product judging who is sophisticated.
b. **Name concrete consequences, not "elevated access."** Square disconnect is
   ADMIN-gated by SEC-1 and drops the live org-wide token — a shared iPad with a
   button that breaks sales sync for the whole business is the sharpest one.
   Dashboard goal PUT is ADMIN-only per PERM-2. And F-5's goal-edit audit log
   will faithfully record the *device address*, not a person: you learn the
   building, not who.
c. **Ambient, not a moment (Claude).** A one-time modal is forgotten in a week.
   A persistent badge on `/stores` and `/users` for any device login above STORE
   is what the next admin — or Gary in six months — actually needs.
d. **MANAGER marked recommended.** It keeps store scoping (the picker stays
   visible for non-ADMIN roles), so the device stays pinned to its own location
   while still granting broad operational reach. Most "keep it simple" operators
   want *no friction*, not *no boundaries*; they have just never been offered the
   middle option in terms they care about.

Also recorded: making `Store` itself a permission-holding principal was
considered and **rejected**. Clerk authenticates an identity, not a database row,
and there is no direct user-creation path in the codebase (provisioning is
invite-only) — so "assign a Store as a User" necessarily mints a normal `User`
with role STORE plus one `StoreUserAssignment`. A second principal type would
fork the capability layer PERM-1 deliberately unified, forcing every `can()` call
site to ask "User or Store?" forever. PERM-7 is a **provisioning shortcut, not a
second model.**

## Device login email is SEEDED from Square once, never live-synced — 2026-07-27 (Gary proposed Square as source of truth; scoped to a seed)

Gary's position: Las Brisas is linked to Square, Square holds
`kevajuice14@icloud.com` for that location, so the location's email should be the
source of truth and the login for that store. The underlying complaint — that the
current state is confusing — is correct and is now `DEBT-8`: one store's email has
three uncoordinated answers (Square says `kevajuice14@icloud.com`, `/stores`
shows nothing, `/users` says `corporate@keva.com`).

**Agreed without reservation:** populate `Store.contactEmail` from Square's
`business_email` at import, display it on the store card, and pre-fill the device
login's email from it at provisioning. The field already exists
(`schema.prisma:118`), the value already reaches the client (the locations route
spreads `...loc`), and the import simply drops it — see `DEBT-8`.

**Scoped down for the credential specifically: a seed, not a binding.** Three
reasons, each independently sufficient:

a. **Uniqueness is not guaranteed.** `business_email` is free text per location,
   and many operators put one address on every location. Clerk requires a unique
   email per user, so N locations sharing an address means exactly one device
   login can be provisioned and the rest hard-fail. Keva's per-location
   convention is good practice, not a Square guarantee.
b. **Live sync would be a lockout mechanism.** If Square were authoritative,
   editing the location email in Square would rewrite the Clerk credential and
   silently lock the iPad out of its own account — through an action nobody would
   connect to logins.
c. **They are different concepts.** `contactEmail` answers "who do we contact
   about this store" — plausibly a district manager. A login is an auth
   credential. Bind them and editing a contact address changes who can sign in.

**So:** one-way seed at provisioning, after which Clerk owns the credential, plus
a **visible drift indicator** on `/stores` when Square's email later differs from
the device login. Surfaced rather than silently reconciled or silently ignored —
the same principle as (a) above. Existing accounts are **not** retro-repointed;
the live Las Brisas account stays on `corporate@keva.com` and the drift indicator
shows it.

Two unknowns deliberately left open on `PERM-7` rather than designed around:
whether those per-location mailboxes are reachable at all (the Clerk invite must
be *accepted*), and whether plus-addressing (`kevajuice+0014@icloud.com`)
survives Clerk's email normalisation — if it does, it answers the collision case
in (a) with one real mailbox and N distinct identities.

## A user may set their own default store — 2026-07-29 (Gary, policy ruling; build deferred to UX-2)

Extends "Default store lives on `User`" (2026-07-27) with the question that
entry left open: whether setting the default is an admin-only act.

**Ruling: allowed.** A user changing which location they land on is a
preference on their own row, not a permission decision. It cannot widen access:
`validateDefaultStore` restricts the value to stores that principal already
sees, and read-time revalidation (`resolveDefaultStore`) drops a default the
moment they stop seeing it.

**Where it is built is a separate question, and the answer is UX-2, not
BUILD-2.** BUILD-2 shipped the column, its validation, and the admin-set paths.
The self-service control is *consumption*, which is UX-2's fence. Shipping an
authenticated write path with no caller — in a repo with no tests — is how an
unexercised endpoint sits in production until it surprises someone.

**Endpoint shape, decided now so UX-2 does not re-litigate it:** a new
`PATCH /api/users/me` accepting `defaultStoreId` and nothing else, no `id`
param, validating against the caller's *current* assignments. Explicitly NOT
`PATCH /api/users/[id]`: that route is `requireAdmin()` and additionally blocks
self-edits outright (`users/[id]/route.ts:51-53`), which is the lockout guard.
Weakening a guard that exists to prevent self-modification, in order to pass a
preference field through it, is the wrong trade.

## Default store lives on `User`, not on the assignment row — 2026-07-27 (Claude finding; corrects BUILD-2's specced shape)

`BUILD-2` said to mirror `StoreStaffAssignment.isPrimary` by adding an `isPrimary`
flag to `StoreUserAssignment`. **That design cannot work**, and the reason is
structural rather than cosmetic: admins have *no* `StoreUserAssignment` rows.
Every page scopes with `...(isAdmin ? {} : { id: { in: storeIds } })` and the UI
hides the store picker for ADMIN entirely. There would be no row to carry the
flag.

That is disqualifying rather than merely inconvenient, because the ADMIN device
account this session just designed (see the provisioning ruling above) is exactly
the case that most needs a default store.

**Ruling: a nullable `defaultStoreId` FK on `User`** (`onDelete: SetNull`), which
works for every role. One additive column. For a PERM-7 device account it
defaults to that account's own store.

Recorded alongside it, a **refuted theory**: the "which store loads by default"
problem was assumed to come from nondeterministic ordering (`DEBT-5`,
`StoreUserAssignment` having no ordering column). An audit refuted that — every
page selects `orderBy: { name: "asc" }` and takes `stores[0]`, so the default is
deterministic, just arbitrary. `dbUser.storeAssignments` genuinely has no
`orderBy`, but it is only ever used as a `WHERE id: { in: ... }` filter and never
indexed into. The real causes are in `UX-2`: fourteen uncoordinated store
selectors, and `localStorage` that outlives logout. Written down so the ordering
theory is not rediscovered and re-fixed.

## STORE is a device, not a person — 2026-07-27 (Gary, design confirmation)

Governing principle for all future role tiering, recorded because it has been
implicit in every PERM ruling so far and was never written down.

The **STORE account is a shared login on an in-store iPad or computer** — not an
individual. It is sourced from the Square location email (e.g.
`kevajuice14@icloud.com`) or created directly on `/users`. Individual **STAFF
logins exist separately**, and are the identity that documents, messages and
training attach to.

The rule that follows: **STORE gets operational breadth and zero confidential or
personal data.** Breadth because the device has to run the store — open
checklists, take counts, complete the day. Zero confidential data because
anything it can see is visible to whoever is standing at the counter, and
nothing it does can be attributed to a person.

**Tier inversion, noted deliberately.** PERM-2's OPERATIONAL tier is
Admin/Manager/Store and **excludes STAFF**. So the unattributable shared device
currently sits one tier ABOVE the identified individual employee. That is
correct for the operational surfaces it was drawn for — the device runs the
checklist, the employee does not — but it is an inversion, and it should be an
explicit ruling rather than an accident of tier naming. Anyone widening a tier
should check which of the two they are actually widening to. HR-9 (EMPLOYEE role
split) is where this gets tested, and the 2026-07-27 verification pass did not
exercise STAFF at all.

**Addendum, same day — the convention must be enforced by the provisioning flow,
not by whoever fills in the form.** An audit of the live data found the existing
Las Brisas device account is named **"Tommy Thomas"** on **`corporate@keva.com`**
— a person's name and a corporate address on what is functionally a shared
device login. That data predates this ruling and directly contradicts it, which
is the whole argument for enforcement: a convention that lives only in this file
gets violated by the next person who uses the invite form.

So `PERM-7` defaults the account name to **the store** and the email to **the
location's own address**, producing the convention as a side effect of the flow.
Existing accounts are not retro-repointed — the drift is surfaced instead (see
the email-seeding ruling above).

Related: the `/stores` "Has Account" badge is `store.userAssignments.length > 0`
— a **count, not a concept**. A MANAGER assigned to three stores lights it up on
all three, so the badge cannot currently distinguish a device login from manager
access. `PERM-7(e)` makes it role-aware. This matters more than it sounds: it is
why the question "does this store have a login, and whose is it?" could not be
answered from the page where it was asked.

## CSV export removal is exfiltration friction, not a confidentiality boundary — 2026-07-27 (Claude finding, recorded before PERM-4 builds on it)

Recorded so a later session does not build PERM-4(b) on a false premise.

PERM-3 masks a MANAGER's out-of-window `goal` values. But it returns `basis`
**unmasked for every month**, and `/api/forecasting/plan` GET returns
`plan.increasePct` (currently 3) to MANAGER by the Q2 ruling above. Every masked
goal is therefore recoverable as `basis × 1.03`.

**Confirmed against live staging data 2026-07-27**, not merely reasoned about:
July's basis 2256.01 × 1.03 = 2323.69, matching the displayed July goal exactly;
September's masked goal is derivable the same way as 1767.23.

So removing the CSV export raises the **cost** of bulk extraction — it turns one
click into a per-month arithmetic exercise — but it withholds no information
from anyone willing to do the arithmetic. A real confidentiality boundary would
require masking `basis` too, and that would cost managers the trend baseline the
whole window ruling exists to preserve. Gary has not been asked to make that
trade and it is not obviously worth making.

This is consistent with the "accepted basis-reconstruction property" already
noted in the PERM-3 entry below; it is promoted to its own decision because
PERM-4(b) is scoped to remove the export, and that phase should be described as
friction, not as closing a leak.

## labor.view widening is being reversed for cost data — 2026-07-27 (Gary)

A deliberate reversal, recorded as such so it does not read as a bug later.

PERM-2 resolved the PERMISSIONS_INVENTORY §3 #8 contradiction in the
**permissive** direction: the Weekly Plan nav was widened to match an API that
already served any org member, rather than the API being narrowed to match the
nav. That was the right call for the contradiction as stated — the data was
already reachable, so hiding the link was security theater.

Gary is now reversing that **for cost data specifically**, as PERM-4(c): a new
`labor.costs.view` capability at the MANAGE tier, mirroring
`inventory.costs.view`. The `labor.view` tier itself is untouched and stays
wide — it governs only the sidebar link, and the 2026-07-27 verification pass
confirmed STORE sees Weekly Plan in the nav as intended.

Not a contradiction of PERM-2 and not a bug in it. PERM-2 resolved a
tier-vs-tier inconsistency; this splits the payload by data sensitivity, which
is the same move PERM-2 itself made for inventory. The reversal is of the
*conclusion for costs*, not of the method.

## The recorded fix for the preview-database exposure was partial — 2026-07-27 (correction)

Correcting the record, and correcting a correction: the fix has been described
as **"scope `DATABASE_URL` to Production-only."** What actually shipped on Jul 2
was a **staging-branch override** — a branch-scoped Preview row for `staging`
layered over a single Production+Preview row.

Those are not the same fix. The override closes the **specific** hole (staging
previews now reach the staging database) and leaves the **general** one open:
any preview deploy from a branch other than `staging` still resolves to the
production database, and with no generic-Preview `DATABASE_URL_UNPOOLED`,
`prisma.config.ts` falls back to the **pooled** production URL — so a PR preview
build runs `migrate deploy` against production through pgbouncer, which is also
the BUG-3 P1002 advisory-lock condition.

Verified in the Vercel console 2026-07-27: `DATABASE_URL` is ONE row tagged
Production **and** Preview (Sensitive, added Jun 26) with a `staging`-only
branch override; `DATABASE_URL_UNPOOLED` has Production, Development and
Preview→staging rows but no generic Preview row.

Latent only because Gary pushes `staging` and `main` and nothing else. It
detonates on the first feature branch — which is precisely what the deferred
second-developer plan requires, making this a scheduled failure rather than a
hypothetical one. The full fix is two ordered steps, tracked on **BUILD-1**:
scope the Jun 26 row to Production-only so preview fails **closed**, then add
Preview-scoped `DATABASE_URL` and `DATABASE_URL_UNPOOLED` pointing at a
throwaway Neon branch.

*Housekeeping note from the 2026-07-27 reconcile:* the "Production-only" claim
being corrected here was **not found anywhere in this file** — the nearest entry
is BUG-3(c) below, which says something narrower and accurate. The claim appears
to have lived only in session memory. That is the more useful finding: the Jul 2
fix was never written down at all, which is how a partial fix came to be
remembered as a complete one.

## PERM-3 forecast read window — 2026-07-26 (Gary ruled on Q1–Q4 + two additions)

The ruling: ADMIN unrestricted. MANAGER sees forward forecast for the **current
and next month only**, but **full history** of actual sales. STORE and STAFF get
no forecasting surface at all (which the server already enforced — for them this
phase only removed two links that dead-ended in a redirect).

a. **Q1 — per-field nulling, not range clamping (Gary).** `/calendar` and
   `/export` return goals and actuals in the same rows. Clamping or rejecting the
   requested *range* would withhold the historical actuals the ruling grants, so
   the window nulls the `goal` field and leaves `basis` and `actual` intact.
   `export`'s `variance` is nulled with the goal, since `actual − variance`
   returns the goal by subtraction (Claude — a derived-field leak Gary's ruling
   implied but did not enumerate).
b. **Q2 — annual aggregates stay visible to MANAGER (Gary).** `plan` GET's
   `goalTotal`, `basisTotal` and `increasePct` are context for the manager's
   monthly number, not a planning surface.
c. **Q3 — `/audit` filtered to the window for MANAGER (Gary).** The `before` /
   `after` goal dollars in audit metadata were otherwise a back-door read of
   exactly the values `/calendar` masks. Filtered in the query so `limit` still
   returns a full page. Plan-level (bare-year) entries are kept for the window's
   years, since (b) makes those aggregates visible anyway.
d. **Q4 — the year selector's forward edge derives from the window, never the
   calendar year (Gary).** In December the window is December of year N plus
   January of N+1, so the selector must offer **both** years — a manager
   budgeting for January in December is the primary use case for the phase.
   Backward, `windowStartYear − 1` stays selectable because historical actuals
   are not restricted (Claude's inference from the ruling table; the selector is
   convenience only, and `export` / `day-report` remain unbounded backward).
e. **Addition 1 — manager store scoping, in scope (Gary).**
   `requireForecastStore` checked `organizationId` only, so a MANAGER assigned to
   Las Brisas could read South Reno's forecast by passing its `storeId`. Now
   mirrors `requireLaborStore`. §2 item 18.
f. **Addition 2 — the public Blob budget file is SEC-3, recorded not fixed
   (Gary).** Needs its own session and a Blob access-model change. §2 item 19.

### The window is a display restriction, not a confidentiality one

**Accepted by Gary, 2026-07-26.** Out-of-window goals remain *approximately
derivable* by a manager: for any day that is not a manual override,
`goal ≈ basis × (1 + increasePct/100)`, and (a) keeps `basis` while (b) keeps
`increasePct`. The annual `goalTotal` is visible outright.

This is acceptable because **the purpose is to avoid presenting tentative
forward numbers as authoritative, not to keep them secret.** A manager who
reconstructs an estimate from the basis has done arithmetic on a projection, not
defeated an access control.

Recorded explicitly so nobody reading the roadmap later believes this phase
makes those values unavailable. If real confidentiality is ever required, hiding
`basis` and `increasePct` would be the change — and it would cost managers the
historical-actuals visibility this ruling deliberately protects.

## PERM-2 `POST /api/checklists` — audit finding + scope exception — 2026-07-26 (Gary ruled on all three)

PERM-2's Task 1 required auditing the endpoint before applying any permission
to it, because the proposed ADMIN-only lock would have been an operational
outage rather than a security fix.

a. **The audit answer: (A), instantiation.** `POST` never creates a checklist
   *definition* — `prisma.template` is only read, and the only two
   `prisma.checklist.create` call sites in the codebase are both in this route.
   Mode 1 (`{templateId, storeId}`) creates today's instance for one store,
   idempotent per the store's local business day. Mode 2 (empty body) fans out
   across every active store × applicable template. No cron generates
   instances (`vercel.json` runs only `sales-reconcile` and `pace-alerts`), so
   this endpoint is the ONLY way a checklist instance comes into existence.
   The sole caller is `startChecklist()` in `store-view-client.tsx` — the
   floor's "Start checklist" tap. **ADMIN-only would have stopped Las Brisas
   from opening.**
b. **Mode 1 → `checklists.create` at ADMIN/MANAGER/STORE, store-scoped
   (Gary).** The capability moves from `ALL` to `OPERATIONAL`, and the call
   site additionally requires `body.storeId` to be in
   `getUserStoreScope().storeIds`, ADMIN unrestricted. Closes §2 gap #4: any
   member, including STAFF, could previously instantiate at any store in the
   org by passing its id.
c. **Mode 2 → new capability `checklists.create.bulk`, ADMIN only (Gary).**
   It is org-wide by construction — there is no store to scope it to — so it
   gets its own capability rather than a scope variant of (b). **Code kept,
   not deleted** (Gary), even though nothing calls it.
d. **SCOPE EXCEPTION — cross-tenant template reference fixed here (Gary).**
   Found during the audit, outside the ruling set: Mode 1 validated that
   `storeId` belonged to the caller's org but performed **no equivalent check
   on `templateId`**. A member of org A passing a template id owned by org B
   created a checklist in org A whose `template` relation crossed the tenant
   boundary; `GET` then rendered org B's template name and task list.
   PERM-2's standing rule is *record out-of-scope findings, do not fix them* —
   Gary made this a deliberate exception on two grounds: it is **inside the
   function already being changed**, and it is **tenant isolation, not a role
   gap**, so it does not belong in a permissions phase's backlog. The fix is
   one org-scoped `template.findFirst` returning 404. **Containment (Gary):
   this one lookup only — the same pattern found anywhere else gets written
   up, not fixed.** Recorded here so the deviation is on the record rather
   than inferred later from the diff.

## BUG-3 migrations bypass the Neon pooler — 2026-07-25 (Gary approved plan + fallback ruling)

Fixes the intermittent P1002 deploy failure: Prisma's migration advisory lock
(`pg_advisory_lock(72707369)`) leaked onto recycled pgbouncer backends on
Neon's pooled endpoint (hit `ecee728` on 7-25, a commit with no migration —
`migrate deploy` takes the lock even just to check for pending migrations).

a. **Mechanism — `prisma.config.ts`, not schema `directUrl` (finding, Gary
   approved).** Prisma 7 removed `directUrl` from schema files entirely (the
   installed 7.8.0 parser errors: "no longer supported in schema files. Move
   connection URLs to `prisma.config.ts`"; `@prisma/config`'s `Datasource`
   type is `{ url?, shadowDatabaseUrl? }`). The config's `datasource.url` is
   the **sole** URL source for CLI commands — schema.prisma holds no URLs and
   is untouched. Runtime is fully decoupled: `src/lib/prisma.ts` builds the
   Neon adapter from pooled `DATABASE_URL` directly.
b. **Fallback, not strict — with a loud warning (Gary).** `datasource.url` is
   `DATABASE_URL_UNPOOLED ?? DATABASE_URL`. Strict would turn a missing env
   var into a production build failure (`Error: The datasource.url property is
   required...` — reproduced) right before the queued HR promotion; fallback
   degrades to current pooled behavior instead. The config `console.warn`s
   when falling back, naming the var — so a silent regression to the pooler
   can't resurface as an unexplained P1002 years later. Detection either way:
   the build log's `Datasource "db"` host line (must not end `-pooler`).
c. **Env var — reuse `DATABASE_URL_UNPOOLED`, no new Vercel vars (finding,
   Gary verified).** The Neon integration already set it in Preview (staging),
   Production, and Development. Staging's value verified by pull: pooled host
   minus `-pooler`, otherwise identical. Production's is Sensitive/unreadable
   from this machine — Gary eyeballed the dashboard and confirmed both
   Preview and Production match their `DATABASE_URL` hosts minus `-pooler`,
   same endpoint id and branch. Local `.env` gets the var manually (Gary).
d. **No migration, no schema change, no new deps.** One line of connection
   routing in `prisma.config.ts` plus docs. Rollback = revert that file; the
   env vars predate this change and can safely stay.

Closes PERMISSIONS_INVENTORY.md §2 items 2–3 (found by the PERM-1 audit).

a. **Part B fork — Option 1, double-submit httpOnly cookie; no schema (Gary).**
   `state` is a 32-byte crypto-random base64url nonce; `/api/square/auth` sets
   it in an `httpOnly Secure SameSite=Lax` cookie (Max-Age 600, path-scoped to
   `/api/square/callback`); the callback requires the query param to exactly
   match the cookie and clears the cookie on EVERY hit, success or failure.
   **Rationale (Gary):** Square invalidates the authorization code on
   exchange, so the replay window a DB-table nonce would additionally close is
   already covered upstream — not worth an additive migration riding the
   P1002 advisory-lock path for it. The table option (true server-side
   single-use + audit trail) is the documented upgrade if a second flow ever
   needs shared state.
b. **Part A goes beyond the spec — session org is the write target (Claude
   proposed, Gary explicitly kept).** The spec (and Instagram, the reference)
   validate `state === session org` and still write by state. SEC-1's callback
   instead resolves the org **from the session** and never uses `state` as an
   address — a forged or mangled state can misdirect nothing because it
   addresses nothing; combined with (a), `state` carries zero authority and is
   purely a CSRF nonce. Recorded so the reasoning survives: if a future
   refactor "simplifies" the callback back to writing by state, that is a
   regression, not a cleanup.
c. **Part C — the session's one deliberate behavior change (Gary).**
   `/api/square/auth` and `POST /api/square/disconnect` are now ADMIN
   (`requireAdmin`), matching Instagram's tier. Previously any org member
   could connect or wipe Square tokens by URL. The only in-app callers live on
   `/settings` (already ADMIN-gated), so no legitimate flow is lost.
d. **Instagram deliberately untouched; gap logged as SEC-2 (Gary).**
   Instagram's org-equality check blocks cross-org planting but is not CSRF
   protection (state is still the predictable orgId). With Square hardened,
   Instagram is now the weaker flow — ROADMAP `SEC-2`, INVENTORY §2 item 17.
e. **Existing connections unaffected.** No token columns, refresh logic, or
   `squareBaseUrl()` touched — connected orgs keep working, no reconnect.
f. (Claude) Cookie name + attributes live in `src/lib/square.ts`
   (`SQUARE_OAUTH_STATE_COOKIE`/`_OPTIONS`) so auth and callback can't drift;
   env finding: `NEXT_PUBLIC_SQUARE_APP_ID` (authorize URL) and
   `SQUARE_APPLICATION_ID` (token exchange) are both Sensitive in Vercel and
   unreadable from this machine — their match is **inferred** from the working
   staging connect (a mismatch would 400 at token exchange), not verified;
   Gary eyeballs the dashboard.

## PERM-3 design constraint — Clerk webhook resets User-row storage on membership churn — 2026-07-25 (Gary)

Recorded from the PERM-1 webhook finding (docs/PERMISSIONS_INVENTORY.md §4) as
a **constraint, not a bug**: the Clerk `organizationMembership.created` handler
re-creates the `User` row from defaults (PendingInvite role → role map → STAFF)
when a member is removed and re-added, so anything stored on `User` resets on
that churn — the same behavior UM-1 documented for `role`. Any permission
column added in PERM-3 must be designed with that reset in mind: either
permission assignment lives where membership churn can't reach it (keyed to
something more durable than the `User` row), or the webhook's create path is
explicitly taught to restore it. Deciding which is PERM-3 scope.

## HR-11c ceremony fixes — anchor dedup, affordance placement, inline identity — 2026-07-24 (Gary approved case + dedup rule)

Three ceremony-UI defects from the mobile `/my` signing pass; the completed PDF
already stamped correctly, so these align the ceremony with the output. No
schema change; HR-11c per-signature checkpoints (`01c5ed9`) untouched.

a. **Anchor dedup at the source (Item 3).** `detectAnchors` had no within-pass
   dedup, so a caption drawn as two coincident runs (faux-bold/shadow/overlap)
   minted two `SignatureStamp` anchors → two checkpoints/affordances/stamps/cert
   rows. `dedupeAnchors` collapses anchors sharing `page` + normalized
   `anchorText` + `markType` when **both** `|Δx| ≤ 3` and `|Δy| ≤ 3` PDF units.
   **Deterministic survivor:** sort by `(page, normText, markType, x↑, y↑,
   width↓, text)` keep-first — re-detecting a future version yields the same
   survivor. **Preserved, not merged:** the same caption far apart in y (two real
   signature lines) or x (side-by-side fields) — a difference >3 pt on either
   axis is a distinct field. Result: one anchor → one checkpoint → one affordance
   → one stamp → one certificate row. G1: existing v5 confirmed anchors are not
   touched; verify on a fresh version/signer.

b. **Affordances at the line (Item 2).** "Sign here" and the initials button now
   render at their anchor via a new `PdfViewer` `PageGeom.toCss` (pdf.js
   `convertToViewportPoint` — the same rotation-aware transform the canvas render
   uses), lifted above the caption/rule, with a collision offset (never stack)
   and a corner-dock fallback for legacy/no-anchor docs and pre-render frames.

c. **Identity visible before signing (Item 1).** Read-only name/date/store chips
   render at the `PrintedName` / `DateStamp` / `Store` anchors during review —
   printed name = record (Fork 3), date = today read-only, store = the live
   selected store. Display only; editing/write-back stays the escalation path
   already shipped (`232d568`).

## Signing ceremony — identity transparency before executing — 2026-07-24 (Gary approved case + 3 fork rulings)

The identity values stamped on a signed document (name, store, date) must be
**visible and, where appropriate, correctable BEFORE signing** — a wrong name or
store can render the executed artifact worthless. This **revises the earlier
"PrintedName / Store / Date are stamp-only derived values, no signer
interaction" ruling**: Name and Store gain signer-facing treatment, Date stays
derived. No schema change (the ack already stores `staffName` + `typedName` +
`storeName`; the store's *source* just moves from silent-primary to
signer-selected).

- **Name — do NOT pre-fill the signature field (Gary).** Pre-filling makes
  signing a tap, not an act, and hides typos. Instead the consent gate shows the
  legal **name on file as prominent read-only context** ("Signing as: … — name
  on file") and the signature stays a **deliberate type-in**. "This isn't my
  name" pauses signing and **escalates** to an admin (the name is only corrected
  at the source — the StaffMember record edited by someone with authority).
- **Fork 3 — write-back is NEVER automatic from the ceremony (Gary reversed the
  lean).** Under F2 (typed-only) the typed name *is* the signature; a difference
  between record name and typed name isn't necessarily a correction — it may be a
  phone typo. Auto write-back would let a mistyped signature silently rewrite the
  staff roster **and** lock the field against Square sync — a data-integrity
  hazard. So the divergence is **surfaced** (a flag on the staff record + the
  certificate's dual-name row) and an ADMIN/MANAGER decides whether the roster
  was wrong or the signature mistyped. "Correction at the source" stands — the
  source is the record, not the signing field.
- **Fork 2 — certificate ALWAYS shows both names (Gary).** `Name on record`
  (the legal name snapshot) and `Name as executed` (what the signer typed),
  every time — not only on mismatch. A row that appears only on a discrepancy
  can't tell a reader "they matched" from "this system doesn't track that"; two
  always-present rows make the certificate self-documenting.
- **Fork 1 — no assigned store: don't block (Gary).** A missing store doesn't
  invalidate the document the way a wrong legal name does, so blocking is
  disproportionate — but a storeless staffer is an anomaly (it caused the blank
  STAFF-1 dashboard cards) and shouldn't pass silently. The ceremony shows "no
  store on file," stamps blank, and it's **flagged on the staff record** for an
  admin.
- **Store selector — as specced.** Pre-selected to the primary, **select from
  assigned stores only, never free text**, visible before executing; captured as
  the ack `storeName` (replacing the silent primary derivation). Manager-attested
  capture keeps the automatic primary (no selector).
- **Date — unchanged, display-only.** Framed as "this is what will be stamped";
  never editable (an editable date is a backdating vector on the one artifact
  whose value is that its timestamps are real).

## Staff Display Name vs Full Name — role split & enforcement — 2026-07-24 (Gary approved audit + plan)

Not a consolidation — the two columns do different jobs and the app now says so
and enforces it. **Display Name = operational identity** (rosters, checklists,
messages; nicknames fine, freely editable, low stakes). **Full Name = legal
identity** — the only name that lands on signed documents and the Certificate of
Acknowledgment.

a. **Defect fixed.** Legal surfaces used `fullName ?? displayName`, silently
   leaking the casual Display Name onto signed documents when Full Name was
   empty (it's nullable). Signature/printed-name/certificate capture
   (`acknowledgments`, form `submissions`) now use **Full Name only**.
b. **Block-and-escalate.** A team member with no Full Name **cannot sign** —
   the signing routes 422 and the signing pages render a "Legal name required"
   screen (admins get a link to set it; staff get "ask your admin"). Full Name
   is set by ADMIN/MANAGER, so this escalates to them.
c. **Square override (Full Name only).** `fullNameLocked` marks a
   Froot-confirmed legal name that a Square **resync must not overwrite**;
   `squareFullName` tracks the last given+family seen from Square to surface a
   lock/Square **divergence** on the staff profile (never shown as the legal
   name). **Editing Full Name in Froot auto-locks it**; a manual add locks it; a
   Square import seeds it unlocked. "Use Square's name" adopts `squareFullName`
   and unlocks. **Write-back** (`POST …/square-writeback`) pushes the confirmed
   Full Name to Square (given/family split — naive, multi-part surnames land in
   family) and locks.
d. **Display Name is Froot-native/operational.** Resync **no longer overwrites**
   Display Name at all (Square seeds it once at import; edits/nicknames survive).
   Display Name gets none of the lock/write-back/escalate machinery.
e. **No backfill.** Existing staff with a null Full Name stay blocked until an
   admin sets a real legal name — Full Name is **never** auto-filled from Display
   Name (that would recreate the leak). Directory shows a "No legal name" marker.
f. **Schema: additive only.** `StaffMember.fullNameLocked Boolean @default(false)`
   + `squareFullName String?` (migration `…_staff_legal_name_lock`). Neither
   column dropped; signed records keep referencing their frozen name snapshots.
   Training certificates (`ensureTrainingCertPdf`) still use `fullName ??
   displayName` — a manager-attested certification, not a self-signature; left as
   the scope boundary, tighten later if wanted.

## HR-11b field anchoring & inline stamping — 2026-07-23 (Gary approved plan + rulings 1–7)

a. **Version-binding — Option A.** `DocumentAnchor` binds to
   `hrDocumentVersionId` (coordinates are per-file). Checkpoints stay
   document-level and keep carrying forward across versions. Each new version
   upload re-detects and re-confirms; an in-flight signer finishes against the
   version's own anchors; signed records stay bound to the version signed
   (existing rule, reaffirmed).

b. **Schema — additive.** `DocumentAnchor` (page, x, y, width, pageRotation,
   anchorText, markType, placement, confirmed, generatedCheckpointId
   soft-pointer) with `@@index([hrDocumentVersionId])` and **no float
   `@@unique`** (ruling 2 — float equality is unreliable); re-detection
   idempotency is application-level (replace the version's **unconfirmed** set,
   never confirmed). `onDelete: Cascade` on the version relation (anchors are
   metadata, not records). `Organization.hrDateStampFormat` (**B1**, default
   `"dateOnly"`) governs inline `Date:` fills only; validation stamps and the
   Certificate of Acknowledgment always render full date+time (reaffirms F5b,
   court-defensibility).

c. **Anchor vocabulary + longest-match-wins.** 8 tokens (`Initial:`, `Name:`,
   `Date:`, `Store:`, `Employee Name (Print):`, `Employee Name`,
   `Employee Signature:`, `Employee's Signature`), matched case-insensitively,
   longest first with a claimed-span mask so `Employee Name (Print):` never
   also registers as `Name:` / `Employee Name`.

d. **Detection server-side at upload.** pdfjs legacy build, headless in the
   Next 16 Node runtime (D1 spike = GO; no drop-in substitute exists, so a
   no-go would have been a re-plan, not a workaround). **D2 (ruling 7): page
   `/Rotate` and non-zero MediaBox origin handled explicitly** in both detection
   and stamping — pdf-lib and pdfjs share absolute content space (shifted-
   MediaBox spike confirmed no offset needed); placement offsets rotate out of
   the reader frame and glyphs counter-rotate. Unit-tested for all four
   rotations.

e. **Admin confirmation REQUIRED.** Detected anchors are proposals; the upload
   flow is scan → grouped-by-page review → confirm/adjust → generate. **U1:**
   confirm may change mark type, coarse placement side (Right/Above/Below), and
   keep/discard — **no free-drag repositioning** (that is manual placement,
   deferred).

f. **What anchoring adds, and link-first generation.** Document creation
   ALREADY auto-generates the checkpoint backbone — one `Initial` checkpoint per
   page plus a final `Acknowledgment` (the handbook's 29 were hand-refinements
   on top of that, not built from zero). Anchoring does NOT replace that
   backbone; it adds two things the checkpoints never had: (1) the page
   COORDINATES to stamp at (`pageRef` was page-number only), and (2) coverage of
   the printed-name / date / signature-line fields the per-page Initial defaults
   never captured. Generation is **link-first**: a confirmed `Initial` anchor
   links to the page's existing Initial checkpoint (creating one only if a
   page's default was deleted); `SignatureStamp` links to the final
   Acknowledgment checkpoint (where the typed legal name is already captured, so
   no new ceremony step is added); `PrintedName` / `Store` / `DateStamp` are
   stamp-only (derived values, no checkpoint). Existing manual checkpoints and
   documents keep working untouched (additive, not a migration).

g. **G1 — hard integrity rule (ruling 5).** A checkpoint that has
   acknowledgment rows is **never deleted or modified by re-confirmation**, full
   stop. Re-confirmation may add/link checkpoints. **Chosen posture (Gary):**
   re-confirm does **not** auto-delete even zero-ack generated checkpoints —
   manual delete (already ack-count-guarded in the UI) stays the only deletion
   path. This is a system integrity rule, not a session preference.

h. **Image-only fallback.** No text layer → zero anchors → automatic
   certificate-only mode (today's behavior) with a clear admin explanation.
   Manual click-to-place tooling explicitly deferred.

i. **Rescan.** `POST /api/hr/documents/[id]/anchors/rescan` re-detects the
   current version's already-uploaded file (no re-upload) — for documents that
   predate anchoring and for re-running when detection improves. Replaces the
   unconfirmed set, preserves confirmed. ADMIN-only, like every other document-
   configuration route (the confirm route and the `/hr/documents/[id]` manager
   surface are ADMIN-only too; MANAGER-in-scope is for signing/attesting, not
   document config).

j. **Completed-vs-Signed fork (STAFF-1) — (c) cross-link only, no merge.** The
   flagged overlap lives inside `staff-documents.tsx`: a document row shows both
   a completion-state badge and a "Signed record" link, already referencing the
   same record — no structural change needed. No second overlap found
   (`/hr/signed-records` vs `/hr/compliance` were confirmed to have distinct
   jobs — executed-artifact list vs who-hasn't-signed rollup).

k. **Staging fix pass (7-23, Gary): silent-collapse was the real defect.** The
   first staging scan of the handbook returned zero fields with no error.
   Root-cause discipline (Gary): scan/rescan must **report distinctly** — (a)
   error with the real message surfaced in the UI + logged server-side, (b) no
   text layer found (image-only), (c) text layer found, N pages scanned, M
   labels matched — never one bare "0 fields" standing in for all three.
   `detectAndStoreVersionAnchors` now returns a discriminated result and logs a
   summary; rescan surfaces errors (500) and outcomes. **Ruled out explicitly:**
   routes run on the Node runtime (never Edge; Prisma/crypto would fail on Edge
   anyway — now pinned with `export const runtime = "nodejs"`); no `maxDuration`
   was set (a timeout would 504, not return 0) — set to 60s on the scan/upload
   routes; the blob fetch succeeds (byte length logged before pdfjs). **The
   actual fix (found via the new diagnostics):** the first staging scan then
   reported `ReferenceError: DOMMatrix is not defined` — the direct
   `pdfjs-dist` legacy build references browser-DOM globals (DOMMatrix, Path2D,
   ImageData, …) that Vercel's Node runtime lacks (it worked locally only
   because the tiny test PDFs never hit those paths; the real handbook does).
   Server detection switched from `pdfjs-dist` to **`unpdf`** — a serverless
   build of pdf.js with no DOM dependencies — via `getDocumentProxy` (same
   `getTextContent`/transform API, so no detection-logic change). `unpdf` is in
   `serverExternalPackages`; `pdfjs-dist` stays a dependency for the browser-side
   HR-11 viewer (untouched). Proof: the fixture runs in plain Node where
   `DOMMatrix` is undefined and passes 28/28 — a real DOM-free reproduction.

l. **Vocabulary refinements (7-23, from the real handbook).** (1) Text is
   punctuation-normalized before matching, so `Employee's Signature` with a
   typographic apostrophe (U+2019) on pages 22/24 matches. (2) Bare `Date` (no
   colon) joins the vocabulary but is **fill-gated** — accepted only when an
   underscore run sits to its right or on the line just above it — so prose
   "Date" is ignored. (3) **Placement is auto-derived**: a trailing underscore
   run ⇒ Right (fill line to the right); an underscore run on the line just
   above, roughly over the label ⇒ Above (under-line caption block); default
   Right. Admin can still override the coarse side (U1). Limitation: fill
   detection keys on underscore runs, so signature lines drawn as graphics
   (not underscores) won't gate a bare field — logged for a future pass.

m. **(Claude) Delivery.** New dep `unpdf` (serverless pdf.js for detection;
   package-lock committed); `pdf-lib` and `pdfjs-dist` already present.
   Migration `20260723220118_hr11b_document_anchors` additive-only
   (applied to dev; Vercel `migrate deploy` applies to staging/prod). Fixture
   `scripts/verify-hr-anchors.ts` → 28/28 (detection, longest-match, split-label
   reassembly, D2 geometry across four rotations, diagnostics, curly-apostrophe /
   bare-Date / under-line placement, image-only). `next build` green each step.
   HR remains dark in production (`HR_MODULE_AVAILABLE` unset) — unchanged.

n. **End-to-end stamping verified (7-23).** A throwaway run of the real
   `ensureSignedRecord` path (dev DB + dev blob store, a 28-page handbook-shaped
   PDF with signature blocks on pages 11/22/24/28) confirmed 14/14: SignatureStamp
   anchors detected on those pages, confirmed, and linked to the final
   Acknowledgment checkpoint; the output PDF carries the signature stamp (name +
   "Signed electronically" + timestamp) on 11/22/24/28, the printed name on 11,
   the store on page 1, `TPT` initials on footers, and the certificate still
   appended. **No separate signature UI is by design (F2 typed-only + the
   link-to-Acknowledgment choice): one typed signature at the formal block,
   stamped at every SignatureStamp anchor — not a per-field prompt.**

o. **HR-11b test-data purge (staging, 7-23, Gary-approved).** Deliberate, scoped
   deletion of Tommy Thomas's (`corporate@keva.com`) `HrDocumentAcknowledgment` +
   `HrSignedRecord` rows on **staging only** — his records were polluted by a
   second tester entering `TIKTOK` as initials across pre-HR-11/HR-11/HR-11b runs.
   Scope: those two tables, that one staff member, all versions/cycles; his
   `StaffMember` row, checkpoints, documents, versions, and every other staff
   member untouched. Signed-PDF blobs are left orphaned in the private store
   (harmless on staging). An explicit, one-time exception to the append-only /
   G1 "never touch acked records" posture, for unreliable staging test data —
   **not precedent** for deleting real or production records.

p. **Signatures become their own checkpoints (Gary, 7-24 — revises f).** Each
   `SignatureStamp` anchor now generates its OWN `Signature` checkpoint the
   signer acts on **inline during the ceremony** (per page, like initials), each
   carrying its own per-interaction `signedAt` — replacing the earlier "link
   SignatureStamp to the final Acknowledgment" choice, which collapsed all
   signatures onto one timestamp. The handbook's four signatures (EEO/conduct,
   confidentiality, Rules & Policies, whole handbook) are distinct attestations,
   not repeats of one. `PrintedName` / `Date` / `Store` stay stamp-only derived
   (no checkpoints, no signer act — only signatures and initials require an
   explicit act). **Sequencing:** captured inline in the review phase, gated on
   the page being viewed; `canFinalize` now also requires all signatures done.
   **Legal name:** captured once at the consent gate and reused as each
   signature's `typedName` — the distinct attestation is the explicit
   per-checkpoint act + timestamp, not re-typing four times. **No schema change:**
   `HrCheckpointType.Signature` + `method="Signature"` already exist; each
   signature checkpoint gets its own `HrDocumentAcknowledgment`; stamping reads
   each anchor's checkpoint ack for its `typedName` + `signedAt` (fallback to the
   completion time only for legacy/attested records). This also flips prior
   completions of a version to needs-re-sign once re-confirmed (4 new required
   checkpoints) — intended; Tommy's data was purged, so nothing real is
   disrupted. Verified E2E (dev DB + blob): 4 Signature checkpoints generated,
   4 distinct stamped timestamps.

## STAFF-1 staff experience + HR-11 inline signing — 2026-07-23 (Gary approved plan + forks F1–F8)

a. **Timestamp audit finding (Defect 1 root cause).** Per-interaction times
   never existed: the HR-5-era client batched every checkpoint into ONE POST
   and the server stamped a single `new Date()` across all rows. The fix is
   new capture, not preservation — **progressive save**: each interaction
   (page initialed, acknowledgment ticked, signature) POSTs immediately
   through the EXISTING acknowledgments API, so each append-only row carries
   its own server-clock `signedAt` + IP/UA. No schema change; the certificate
   generator was already per-row and is untouched.
b. **Timestamp policy (F5, amends the earlier org-setting ruling: deferred,
   not dropped).** Date+time is always captured and stored (server clock,
   UTC). Fixed rendering policy for now: validation stamps and certificates
   always show full date+time; inline date fills may render date-prominent.
   The org-level display toggle is a FUTURE ADDITIVE schema item (no settings
   storage exists on Organization today). Court-defensibility wins ties.
c. **Consent language (F1): `esign-2026-07` kept verbatim** — one consent
   version across all records. HR-11 changes its presentation only: shown
   ceremonially at the consent gate and restated at the signature block.
d. **Signature capture (F2): typed-only.** Drawn signatures deferred — if
   ever wanted they ride with HR-11b's schema case (image storage).
e. **Signing ceremony (approved design).** Four phases: consent gate (name +
   initials up front) → inline pdf.js review, pages lazy-rendered, sequential
   per-page initialing ("Initial All" removed from self-serve; a page's
   control arms only when viewed and prior pages are initialed) → fields +
   per-tick acknowledgments → formal execution block (doc/version/hash,
   signer, consent restated, signature-rendered typed name). Manager-attested
   capture deliberately keeps the quick form — it records, it doesn't sign.
   Non-renderable files fall back to open-externally + sequential initial
   list. Resume is the existing per-cycle state. Prior records untouchable by
   construction (append-only + skipDuplicates unchanged).
f. **Rule-5 amendment (F4, Gary).** Active linked staff may VIEW their own
   signed records inline: `/my/documents/records/[id]` canvas render fed by
   `/api/my/signed-records/[id]` (own-records-only, same-origin byte proxy,
   signed blob URL never reaches the client, no download affordance).
   Download remains ADMIN/MANAGER-only; access ends at termination via the
   ACTIVE gate + Clerk revocation. **Honest caveat, recorded:** viewing
   requires serving bytes — a determined user can capture them via devtools;
   the guarantee is "no download affordance", not "bytes can't be saved".
g. **Nav visibility matrix (STAFF only changes; ADMIN/MANAGER/STORE
   byte-identical).** App-shell STAFF keeps Dashboard, Messages, Instagram
   (F6); loses Store View + every Inventory item; Checklists only when the F3
   store-proxy fires (an open checklist exists at an assigned store — there
   is NO per-person checklist assignment in the schema; the staff-facing
   execution surface inside /my is deferred until an org actually has
   staff-visible checklists); HR entry renamed "My Documents" → /my/documents
   (unlinked staff land on the existing no-profile explainer). Linked STAFF
   stay redirected to /my; its tab bar is Home · Messages · Instagram ·
   Documents — Training folded into the Home compliance card (F7, routes
   live); /my/messages is the full MessagesClient, compose included (F8).
h. **BUG-1 completed (step 4).** Stale request-path Square sync now runs
   AFTER the response (`next/server after()`): cached numbers serve
   immediately, refresh lands post-response; a store-day with no cache at all
   still syncs inline; webhooks + reconcile cron remain primary freshness.
   Staging duration logs could not be pulled retroactively (`vercel logs` is
   live-tail only, no log drain configured) — noted; the change is safe
   regardless of what they would have shown.
i. **Mandatory pre-prod-promotion verification (Defect 3):** the Certificate
   of Acknowledgment must render the REAL org name (staging once produced
   "Generated by Froot for Microsoft" from the stale Clerk org name; believed
   fixed by the Clerk rename — verify on a fresh certificate before HR goes
   live in production).
j. (Claude) Delivery details: new dep `pdfjs-dist` (lazy-loaded on document
   routes only; package-lock committed); `?stream=1` inline byte delivery
   added to the documents download route so the viewer never depends on
   cross-origin blob fetch behavior; /my home data is server-fetched
   (messages/compliance) with the Instagram strip client-fetched under the
   BUG-1 timeout/hide discipline. Tagged for HR-14: the /my home surfaces
   nothing for a staff login whose store assignments were dropped by
   termination-then-manual-relink edge paths (existing hardening territory).

## HR-15b re-sign on rehire (Fork 2 REVERSED: Policy A → Policy B) — 2026-07-23 (Gary)

a. **Gary reversed Fork 2 during the staging pass:** rehired employees MUST
   re-sign required acknowledgment documents ("in case things have changed"),
   and the re-read-and-sign flow doubles as the get-back-up-to-speed
   acknowledgment he asked for. Old signed PDFs stay manager/admin-side
   (HR-7 rule 5 unchanged — staff still don't download records).
b. **Mechanism: signing cycles.** The HR-4 engine's uniqueness (one ack per
   checkpoint/version/person, one record per version/person) made same-version
   re-signing impossible, so each tenure is now a cycle: migration
   `20260723180000_hr15b_signing_cycles` adds `StaffMember.signingCycle`
   (default 1) + `rehiredAt`, and `signingCycle` (default 1) on
   HrDocumentAcknowledgment + HrSignedRecord with both unique keys widened to
   include it. Additive columns + index swaps only; no rows touched — all
   existing signatures are cycle 1.
c. **Semantics.** Reactivation increments the member's cycle and stamps
   `rehiredAt`. Signatures count only under the member's current cycle; a
   prior-cycle signature on the current version reads **needs re-sign** (same
   loudness as a version bump, distinct from not-started). Capture stamps the
   current cycle; completion and `ensureSignedRecord` are judged per cycle
   (the cycle is derived server-side from the staff row — a prior cycle can
   never be retro-completed); the signing screens' resume state is per cycle,
   so rehires start the document fresh. A rehire's completed re-sign mints a
   SECOND HrSignedRecord for the same version under the new cycle — the
   cycle-1 record is untouched, hash-intact, still downloadable.
d. **Training deliberately NOT reset** — Gary's decision covered documents;
   a training reset on rehire would be its own decision.
e. (Claude) Reactivate dialog copy now discloses the re-sign requirement;
   `/staff/[id]` header shows "Rehired {date} — required documents need
   re-signing" while `rehiredAt` is set. Verified via fixture script vs dev
   DB + live private store: 11/11 (cycle-1 sign → complete; bump →
   needs-resign pinned to current version; no retro-completion; same-cycle
   dupes still skip; cycle-2 re-sign → new record, old record byte-intact).
f. **Timing note:** Tommy was reactivated BEFORE this shipped, so he remains
   cycle 1 (his old signatures count). Terminate + reactivate him once more
   on staging to exercise the rehire re-sign end-to-end.

## HR-15 rehire / reactivate terminated staff — 2026-07-22 (Gary approved plan + both forks)

a. **Reactivate action.** `POST /api/staff/[id]/reactivate` + Reactivate button
   on `/staff/[id]` for terminated members. Same tier as terminate (ADMIN
   org-wide, MANAGER in-scope). Flips status → ACTIVE, clears `terminatedAt`.
   Never creates a duplicate row, never touches HrSignedRecord /
   FormSubmission / training rows — terminated-not-deleted stays inviolate in
   both directions. The dialog offers "send a login invite" in the same motion
   (chains the existing staff-directory invite flow, so PendingInvite carries
   role STAFF + store assignments and the webhook links on acceptance);
   rehire and invite stay separable — after a plain reactivation the normal
   Invite to self-service button reappears.
b. **Stale-userId hygiene at the source (audit finding → fix).**
   `terminateStaffMember` relied on the `organizationMembership.deleted`
   webhook alone to unlink `StaffMember.userId` — and staging proof showed
   that path is not reliable: Tommy Thomas sat TERMINATED with a live stale
   link (and his User row's store assignments intact), which dead-ends rehire
   (invite 409s "already has a login"). Fix: terminate now unlinks inline
   (userId → null + StoreUserAssignment cleanup) right after Clerk
   revocation; the webhook handler stays as backup for dashboard-initiated
   removals. Reactivate ALSO clears any stale userId defensively, for rows
   terminated before this fix. Old logins stay dead; rehire always re-links
   fresh via the invite flow.
c. **Fork 1 — Square re-termination race (Gary): dialog warning, option (c).**
   The sync reconcile stays absolute-state (Square INACTIVE → terminated);
   the reactivate dialog preflights Square live (`GET .../reactivate` →
   `fetchSquareTeamMember`) and warns "inactive in Square — mark them active
   there too or the next sync will terminate them again." Rationale: sync is
   a deliberate admin click, real rehires must be rehired in Square anyway
   (timeclock/payroll), and both timestamp options (`squareStatus` baseline
   for transition-only, or `manuallyReactivatedAt`) need schema additions.
   Transition-based reconcile is the documented follow-up if Square/Froot
   divergence ever becomes a real operational problem. Note: Square rehire
   (INACTIVE→ACTIVE) does NOT flow into Froot — the sync ACTIVE branch never
   touches status; reactivation is always a Froot-side action.
d. **Fork 2 — compliance on rehire (Gary): Policy A, old signatures stand.**
   Deliberate choice, not an oversight: a rehired member re-enters the
   rollup denominators with prior records counting (signed record on the
   CURRENT doc version = compliant, per HR-8). The document-version bump
   stays the compliance-refresh lever — re-upload flips everyone, rehires
   included, to needs-re-sign. **Documented upgrade path if customer
   compliance policy ever demands rehire-forces-re-sign: Policy B — additive
   `rehiredAt DateTime?` on StaffMember + compliance derivation treating doc
   records completed before it as needs-re-sign** (training reset would need
   its own call). Not implemented.
e. (Claude) Directory findability: "Terminated" badge on `/staff` rows (the
   directory previously showed terminated members indistinguishable from
   active). This ships the badge half of HR-14(b) early; the hide-by-default
   "Show terminated" toggle remains HR-14.
f. **Noted, no action (Gary):** the stray Clerk test account
   (corporate@keva.com / tommythomas) holds an org:admin membership in
   unrelated org "Keva Smoothie Company" — Gary cleans up in the dashboard.
   *(Done during the staging pass — org deleted; its webhook-created fossil
   Organization row joins the HR-14 cleanup list.)*
g. **Invite links route by account status (staging-pass finding, Gary).**
   Both invite routes pointed `redirectUrl` at `/sign-up`, dead-ending any
   invitee whose email already has a Clerk account — exactly the rehire case
   ("email already exists" / "sign up forbidden"; employees have ONE email).
   Fix: new public `/accept-invite` route-handler; Clerk appends
   `__clerk_ticket` + `__clerk_status` to the redirect, and it forwards —
   `sign_in` → `/sign-in` (ticket sign-in accepts the invitation), `sign_up`
   → `/sign-up`, `complete` → `/dashboard`, no ticket → `/sign-in`. Prebuilt
   SignIn/SignUp consume the forwarded ticket automatically. Remaining
   polish is Gary's, in the Clerk dashboard: the invitation email template
   wording ("if you already have a Froot login, you'll just sign in").
   Bulk-sync wart: a TERMINATED member who is Square-ACTIVE still gets store
   assignments rewritten by the bulk sync (the "profile freezes" comment only
   holds for Square-INACTIVE members) — text-only finding, HR-14 territory.

## UM-1 user-management fixes (/users) — 2026-07-22 (Gary approved plan)

a. **Role-mapping truth table.** Clerk memberships only distinguish
   `org:admin` / `org:member`; the finer Froot roles live in the Froot DB
   only. No custom `org:manager` role exists in the Clerk instance (Gary
   confirmed) — the webhook's `org:manager` map entry is dead code, left
   untouched.

   | Froot role | Clerk membership role | Distinction lives |
   |---|---|---|
   | ADMIN | `org:admin` | both |
   | MANAGER | `org:member` | Froot DB only |
   | STORE | `org:member` | Froot DB only |
   | STAFF | `org:member` | Froot DB only |

b. **What the webhook actually overwrites (audit finding).** Narrower than
   assumed going in: `organizationMembership.created` sets `User.role` only
   when CREATING a row (PendingInvite role → role map → STAFF); the upsert's
   update branch self-heals email only. There is no
   `organizationMembership.updated` handler, so no webhook event rewrites an
   existing row's role. Divergence bites on row re-creation (member removed
   and re-added, or a deleted row as in the BUG-2 repair), where the role is
   re-derived from the Clerk membership — plus the Clerk dashboard lies in
   the meantime. Clerk sync on role edits is therefore still mandatory.
c. **Role edits sync Clerk first.** PATCH `/api/users/[id]` updates the Clerk
   org membership role before the Froot row; Clerk failure = no DB write. The
   call is skipped when the mapped role is unchanged (all transitions within
   MANAGER/STORE/STAFF are `org:member` → `org:member`) — Gary approved.
d. **Guards, all server-side:** self-role-change blocked; last-admin blocked
   for both demotion and removal; self-removal blocked; store IDs validated
   as org-owned; demotion to STAFF requires a linked (or
   linkable-by-normalized-email, then auto-linked with the HR-7 `userId:
   null` guard) ACTIVE StaffMember, else 409 pointing at the Staff directory
   invite flow.
e. **Names on /users:** staff-profile name (userId link, else normalized-email
   match not owned by another login) → Clerk first/last from data already
   fetched → email only. One org-scoped StaffMember query; no per-member
   Clerk API calls. Display email prefers self-healed `User.email` over
   `identifier` (BUG-2 rule); identifier is last-resort display fallback.
f. **STAFF appears in the Edit dialog only** — the generic Invite dialog
   deliberately omits it (an invite-created STAFF user would be unlinked, a
   broken state; the Staff directory invite flow is the STAFF entry point).
   Auto-sync + display role defaults aligned to the webhook's STAFF.
g. **Noted, not fixed (follow-up, HR-14 territory):** DELETE `/api/users/[id]`
   still calls `clerk.users.deleteUser`, deleting the Clerk account GLOBALLY
   rather than just the org membership; guards were added around it this
   session but the membership-only removal fix is deferred.

## BUG-2 staff-profile linking — 2026-07-22 (Gary approved fix + repair)

Caught by the HR-8 staging pass: an invited staff member's `/hr/acknowledge`
page showed "no staff profile matching your email (tommythomas)".

a. **Root cause.** The Clerk webhook persisted
   `public_user_data.identifier` as `User.email` and keyed the
   `PendingInvite` lookup on it — but on username-enabled accounts the
   identifier is the USERNAME, not an email. Both linking mechanisms
   (`StaffMember.userId` via PendingInvite, and the email fallback) failed
   for the same reason. Blast radius was wider than HR: role + store
   assignments from PendingInvite were dropped for any affected invitee.
b. **Fix.** Shared helper `src/lib/clerk.ts`
   (`getClerkPrimaryEmail` — Backend API resolution; `normalizeEmail` —
   trim + lowercase). Webhook resolves the real primary email on
   `organizationMembership.created` (500 on API failure so Svix retries),
   PendingInvite lookup is case-insensitive, User upserts self-heal the
   email, new `user.updated` handler tracks primary-email changes (endpoint
   subscription verified by Gary). Users-page auto-sync uses the helper;
   invite routes normalize at write time; signed-record route unified onto
   `findStaffMemberForUser`; staff email writes trimmed.
c. **Data repair (staging).** Deleted the single orphaned
   `email = 'tommythomas'` User row (the Clerk account behind it had been
   deleted during dashboard investigation; the ADMIN role on it was a
   manual test edit — both Gary). PendingInvite kept for re-invite
   verification; StaffMember untouched.
d. **Noted, not fixed:** no `organization.deleted` / `user.deleted`
   handlers (5 fossil Organization rows on staging; future
   webhook-hardening session). Clerk org display name "Microsoft" drives
   invite-email branding — rename is backlog. Display-only `identifier`
   reads on the users surfaces left as-is (cosmetic).

## HR-8 compliance rollup — 2026-07-22 (Gary)

**AMENDED 2026-08-15 (R2 / HR-11k Phase A, Gary). Item (a) below is superseded
in part; the 2026-07-22 text is preserved beneath, unedited.** This is the
second amendment to item (a) in two days — R1 took its middle sentence on
2026-08-15, R2 takes its last one the same day. Read the amendments before the
item.

**R2 — A PRIOR VERSION'S SIGNATURE SATISFIES THE CURRENT ONE.** Item (a)'s last
sentence ("a record signed against an older version is its own *needs re-sign*
status: non-compliant") is overturned. A new FILE is a new document and everyone
in the audience signs it; a new VERSION is the same document, and existing
signers keep their record and are not re-prompted. **The version a person
originally signed is the master document for that person.** R2 supersedes HR-11f
(2026-08-14), which required universal re-acknowledgment on every version bump.
Churn is handled where it always was — by a disclaimer typed into the document
itself, "terms and conditions may change, check back regularly for any updates".

**It counts toward the percentage, and it shows no warning.** Someone signed at
v4 is in the numerator. No new status, no new enum member, no amber, no flag —
compliance reads *signed, with the version noted* (R3, same day): "Signed v4 ·
current is v6", green. They signed what was in force when they signed it. Amber
stays reserved for what genuinely owes a signature: a rehire today, and Case A /
Case B re-verification if those are ever built.

**WHAT DECIDES COMPLIANCE IS THE SIGNING CYCLE, NOT THE VERSION NUMBER.** The
rehire lever (HR-15 Policy B) is untouched and is now the *only* route to
"needs re-sign": a record from a PREVIOUS tenure does not satisfy this one,
whatever version carried it. The two used to be a single any-cycle lookup, and
splitting them is the whole correctness risk of the phase — resolved against an
any-cycle map, a rehire's previous-tenure signature reads compliant and Policy B
is destroyed with nothing failing.

**TWO PRECEDENCE ORDERINGS, RULED IN OPPOSITE DIRECTIONS.** Both are needed
because a signer can hold a record on an old version *and* acknowledgment rows
on the new one at the same time:

- **A FULL current-version acknowledgment set BEATS the prior-version record.**
  Someone who has acknowledged every required checkpoint of the current version
  is bound to the CURRENT version — they did the newer work, honour it. The fix
  for their missing record is to mint it, not to fall back on an older
  signature. (This is R1's `recordMissing` state, unchanged.)
- **The prior-version record BEATS a PARTIAL acknowledgment set.** Someone who
  signed v4, then opened v6 and initialled two pages, reads signed at v4. Their
  partial v6 rows are preserved untouched: they are evidence, they are harmless,
  and if re-verification is ever demanded on that version the ceremony resumes
  from them.

**THE RULE LIVES IN EXACTLY ONE PLACE — `documentCompletion` in
`src/lib/hr-completion.ts`.** R1 collapsed six hand-written derivations of "this
document is signed" into that one pure predicate the day before, and Phase A
deliberately did not recreate them: the precedence table changed once, in the
predicate, and the three call sites (`lib/hr-compliance.ts`,
`staff/[id]/page.tsx`, `my/documents/data.ts`) changed only in which facts they
gather and how they label the result. R1's shape is load-bearing, not
stylistic — and the dividend is that the rehire regression is one test against
one predicate rather than three tests that must agree by discipline.

**Phase A carries no schema change.** Read-side only: nothing is written to
`HrSignedRecord` or `HrDocumentAcknowledgment`, no column is added, no migration
ships. The re-verification toggle (Case A — an additive `requiresReacknowledgment`
Boolean on `HrDocumentVersion` that re-imposes re-signing for one version) waits
for Phase B. Per-person re-verification (Case B) is parked, blocked on whether
the Key Agreement is a `FillableForm` or an `Acknowledgment`.

The 2026-07-22 text, preserved:

a. **Acknowledgment docs: current version only.** Compliant = every required
   checkpoint acknowledged on the CURRENT document version. A completed set of
   acknowledgments whose signed PDF hasn't been generated yet ("pending-record")
   still counts as compliant — generation is mechanical and idempotent. A
   record signed against an older version is its own **"needs re-sign"**
   status: non-compliant, but distinct from "not started".
b. **Agreement forms stay OUT of the compliance % (v1).** Nothing in the data
   says who is *supposed* to hold a given form (no assignment mechanism, no
   signing-cycle definition), so forms can't be a denominator. They surface in
   a separate Agreements panel on `/hr/compliance`, with submissions stuck in
   `PendingSupervisor` surfaced prominently as the actionable gap. The
   follow-up ("required forms" flag + defined signing cycle, additive schema)
   is logged in `ROADMAP.md` as HR-10.
c. **Training: Completed = compliant.** Certification is a separate, stricter
   badge — never required for the %. An assignment past its `dueDate` and not
   Completed is **"Overdue"**, the loudest gap state on every surface.
   **Amended 7-22 (Gary, HR-8 staging pass):** not-yet-due assignments are
   EXCLUDED from the % denominator — an assignment only counts against
   compliance once its dueDate passes (completing early counts immediately).
   The % means "is anyone behind", not "is everything assigned done".
   Implementation lands with HR-13 (as-built code still counts from
   assignment until then).
d. **Only ACTIVE staff count in rollups.** Terminated staff are excluded from
   every percentage and every rollup denominator; their records remain fully
   auditable (the profile Compliance tab renders them behind an exclusion
   banner, signed PDFs stay downloadable).
e. (Claude) Rollup is computed live from existing records — no stored
   snapshots, no new schema, no migration; per-store grouping uses the
   member's primary store (the `/staff` directory convention) so nobody is
   double-counted. Flagged: if reminders or trend history land later, those
   become stored per-environment data (regenerate per Neon branch).

## L-3 promotion to production — 2026-07-21 (Gary)

a. **Coverage stays sales-inferred for v1.** Populating `StoreHours` (real
   open/close hours) is deferred as a future *additive* upgrade — Square always
   provides selling hours, so there is no empty-data failure mode. Not a blocker
   for promotion.
b. **L-3 promoted to production** on 2026-07-21 (merge commit `9743899`). First
   `staging → main` promotion in a while.
c. **Prod forecast plan was STALE — and it was NOT caused by the promotion.**
   dev / staging / production are separate Neon branches, and forecast goals are
   *stored* data (`GoalPlan` / `dailyGoals`), not recomputed from code. A plan
   regenerated on staging (Jul 20, +3%) was **never** regenerated on prod, so
   prod carried the old ~$802k plan (spiky per-day goals) while staging showed
   the smoothed ~$753k plan. Fixed by running **Refresh from Square + regenerate
   +3%** on prod. **LESSON:** forecast/plan data is per-environment stored data —
   promoting *code* never migrates it; each Neon branch must be regenerated
   independently. (Code was confirmed identical: `goal-engine.ts` unchanged since
   F-1; the only forecasting file in the promoted diff was a new labor helper.)
d. **STRUCTURAL — keep `main` close to staging.** `main` had drifted **53
   commits behind** staging, so "promote L-3" became "promote the whole backlog"
   (L-3 + all of HR-0…HR-7.6 + the Labor foundation, 11 migrations). Going
   forward, promote more often so each `staging → main` diff stays small and
   readable.

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
