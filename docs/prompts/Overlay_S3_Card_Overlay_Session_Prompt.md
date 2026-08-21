# Schedule/Actual Overlay — S3 Card Overlay Build · Session Prompt

**Module:** Advanced Labor / schedule overlay track (UI phase)
**TIER:** 3 — full ceremony: AUDIT → PLAN → GARY'S APPROVAL → BUILD.
No file is touched before the plan is approved in this session.
**Builds on:** S2 ingest verified on staging 2026-08-20 (OVL-S2: twelve
stores synced, nine with shifts, three honest zeros, no errors).
**Session type:** One session, one phase: the Coverage card overlay + its
settings + its capability. The /labor comparison page is S4, NOT this.

---

## 0 · Preconditions (verify, quote, STOP if any fails)

1. docs/DECISIONS.md contains the three 2026-08-20 overlay entries
   (scope rulings · S1b rulings · staging probe exception).
2. Branch staging, clean tree. (Local may be ahead of origin — that is
   the steady state under the pushes-are-Gary's rule; ahead-only is not
   a failure.)
3. npm run build green + ALL verify scripts green before any edit.
4. docs/prompts/Overlay_S1b_Probe_RESULTS.md exists (payload truth).

## 1 · Binding rulings and inherited requirements

- Seam (b): scheduled/actual curves are DISPLAY OVERLAYS. They never
  enter getDemandShape, the budget, or the recommendation. No core
  engine (labor-plan/coverage/budget/forecast/daily/week) imports
  anything schedule-side. The suggested curve's computation is
  byte-identical before and after this session.
- Seam (c): sync failure renders last-synced data labeled stale, never
  a blank pretending "no schedule". A store whose sync-state row shows
  lastSyncOkAt + zero shifts renders forecasted-only, gracefully — no
  empty overlay pretending schedules exist. Distinguish the three
  states: never-synced · synced-empty · synced-with-data.
- Same-day toggle: "scheduled staffing" vs "actual staffing" overlaid
  on the suggested curve. Other days (< > navigation): scheduled only.
- Actual staffing = clocked-in counts by hour from synced timecards.
  Label it "clocked in" — breaks are ignored by ruling (2026-08-20
  addenda context; option (a) from S1). Reuse paidMinutesOf's
  open-timecard rule by EXPORTING it from labor-actuals.ts (S1 COMMENT:
  export, don't copy — its own docstring's drift argument). An open
  card occupies hours up to the current hour, never beyond.
- Position colors: deterministicJobColor default + SquareJobColor
  override. Settings editor (managers/admins per PERM-5 capability
  model) lists discovered jobs with title + color picker from the
  badge-preset palette. Auto-discovery: jobs appear from synced shifts;
  titles resolved from roster/timecard wage data (shifts carry id only
  — S1b measured).
- Color rendering: extend BADGE_PRESETS entries with an explicit hex
  field so ONE key drives both the Recharts stroke (inline SVG attr)
  and the Tailwind legend chip (S1 COMMENT 8; Tailwind 4 CSS-first —
  never interpolate class strings).
- Capability: labor.schedule.view, tier OPERATIONAL, area "Labor",
  added in all three permissions.ts locations (union type, GRANTS,
  /users grid row) + it is deniable (ENFORCED_CAPABILITIES), following
  labor.actuals.view exactly. STORE sees the overlay by default;
  the override in /users turns it off per user (Gary's ruling).
  Wages/pay NEVER appear in any overlay payload (counts only —
  structurally true already; keep it that way).
- Card visibility gate: requireLaborView + the capability. Do NOT hang
  the card element itself on requireSquareLabor; the sync trigger
  already rides laborOverlayOn (S2 decision, approved D6).
- Legend must distinguish the curves, including the inherited label
  ruling: today's suggested curve is a PROJECTED shape — the legend
  says so ("projected from recent <weekday>s" precedent already exists
  on the Weekly Plan surface; reuse its language/mechanism if present).
- The hour >= 6 chart filter must be applied identically to overlay
  series (S1 COMMENT 7) — same x-domain, same closed-hour null
  convention (connectNulls false).
- notes columns: never selected into any card payload (already
  enforced in getScheduledCoverage — do not regress it).
- No schema changes expected. If the audit finds one is genuinely
  needed, STOP and say so in the plan — do not improvise migrations.

## 2 · AUDIT (read-only; quote file:line; then STOP and present plan)

1. The card at HEAD: labor-coverage-card.tsx — chart structure, the
   rows useMemo, the hour filter, CoverageResponse type, and the
   coverage route. Confirm the S1 attach-point map still holds.
2. getScheduledCoverage's output shape (labor-schedule.ts) — what the
   card needs vs what it returns; note any gap (e.g. effectiveSource
   for a draft marker is NOT required this session — effective only).
3. Timecard actuals path: fields available, paidMinutesOf location and
   docstring, where the clocked-in-by-hour pure function should live
   (labor-schedule.ts or labor-actuals.ts — propose, with the import
   wall in view).
4. PERM-5 anatomy at HEAD (permissions.ts three places + DENIABLE +
   users grid) — confirm the AL-2 pattern is still the pattern.
5. BADGE_PRESETS shape and every existing consumer — adding hex must
   not disturb TemplateType/IngredientCategory/LossReason rendering.
6. Settings surface: where the color editor page/section lands
   (settings information architecture at HEAD), and its route guard.
7. Sync-state read path: how the card learns never-synced vs
   synced-empty vs synced-with-data vs stale (age threshold — propose
   one, e.g. lastSyncOkAt older than 24h renders a stale label).
8. Present THE PLAN: files, component/type changes, endpoint changes,
   the legend design in words, fixture list, and any deviations —
   THEN STOP AND WAIT FOR GARY'S EXPLICIT APPROVAL.

## 3 · BUILD (only after approval)

1. Coverage endpoint: overlay data added BESIDE coverage in the
   response (spread pattern from S1 map) — scheduled counts by hour
   (from getScheduledCoverage), actual clocked-in counts by hour (new
   pure function), job color map, sync-state summary. Capability
   check server-side: no capability → no overlay key in the payload
   at all (absence, not empty).
2. Card UI: toggle (same-day only: scheduled | actual; other days:
   scheduled shown when present), overlay <Line> series per the S1
   attach map, per-position coloring, legend with the projected-shape
   label + curve identification + stale marker when applicable,
   graceful forecasted-only rendering for schedule-less stores.
3. Settings color editor: discovered-jobs list (from SquareJobColor +
   auto-discovery on render of jobs present in synced shifts), title
   resolution, palette picker writing colorKey. Manager/admin gated.
4. permissions.ts: labor.schedule.view in all three places + DENIABLE
   wiring + /users grid row with a removes-sentence.
5. BADGE_PRESETS: hex field added to every entry; existing consumers
   unaffected (verify by grep + build).
6. Export paidMinutesOf from labor-actuals.ts (no copy).
7. Fixtures (extend verify-labor-schedule.ts or sibling):
   clocked-in-by-hour derivation incl. open-card current-hour ceiling
   and cross-day open card; scheduled-counts bucketing across DST-safe
   store-local hours; color resolution (override beats default;
   unknown job → deterministic default); capability-absent payload
   has no overlay key; hour>=6 parity between overlay and suggested
   series shapes.
8. npm run build + all verify scripts green; grep proof the import
   wall holds (no core engine imports labor-schedule).

## 4 · Definition of done

- Plan approved in-session before any edit.
- Suggested-curve computation provably untouched (no diffs in
  labor-plan.ts / labor-coverage.ts beyond none).
- Build + all verify scripts green.
- Two commits (work; then docs: OVL-S3 ROADMAP row per board
  vocabulary). NOT pushed.
- Out-of-scope findings triaged FIX NOW / RULING NOW / COMMENT / ROW.

## 5 · Out of scope

- /labor forecasted-vs-scheduled page — S4.
- Draft markers on the card (effective only this session).
- Cron registration; any sync-logic changes (S2 is shipped machinery);
  any OAuth/scope/version work.
- Any change to budget, demand shape, or recommendation math.
- Weekly Plan surface changes beyond what the shared card component
  inherits automatically — flag in the plan if inheritance occurs.
