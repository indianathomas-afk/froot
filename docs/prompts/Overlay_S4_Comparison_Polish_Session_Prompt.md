# Schedule/Actual Overlay — S4 Comparison + Polish · Session Prompt

**Module:** Advanced Labor / schedule overlay track (final build)
**TIER:** 2 — brief audit with file:line quotes, then present a short
plan and STOP for Gary's approval before editing (the roster popup
touches person-level data on a STORE-visible surface; that earns the
checkpoint even at TIER 2).
**Builds on:** S2 + S3 shipped and verified on staging (OVL-S2, OVL-S3
rows). Deploy verified at 70ba6cc.
**Session type:** One session, two parts, both overlay-track UI on
shipped machinery: (A) card polish, (B) /labor comparison. No new
tables, no new sync, no new capability.

---

## 0 · Preconditions (verify, quote, STOP if any fails)

1. docs/DECISIONS.md contains "Overlay polish rulings, S4 — 2026-08-20
   (Gary)" (roster popup + legend toggles). STOP if absent — Part A's
   popup is unruled without it.
2. Branch staging, tree clean (ahead-of-origin is steady state).
3. npm run build green; verify suite green except the two known reds
   (hr8-compliance = DEBT-76's nine exactly; goal-engine may flake per
   DEBT-77 — green on re-run acceptable). Same-nine condition applies
   post-build.

## 1 · Binding rulings

- Seam (b) unchanged: display only. No core engine imports anything
  schedule-side; suggested-curve computation byte-identical.
- Capability: everything here rides labor.schedule.view exactly as the
  overlay does — server-side, absence not emptiness.
- NEVER wages, rates, tips, or pay data in any payload this session
  creates. The roster popup carries name, position title, clock-in
  time — nothing else. notes never selected (do not regress).
- Names load ON CLICK ONLY — a separate endpoint hit when the popup
  opens; never in the default card payload.
- Legend toggles are client-side display state only.
- No schema changes. If one seems needed, STOP and say so.

## 2 · Part A — card polish (labor-coverage-card.tsx)

1. **Legend click-to-toggle.** Each legend chip (Suggested, Scheduled,
   Clocked in, and each per-position chip) toggles its series'
   visibility. Hidden = chip renders muted (e.g. reduced opacity),
   series omitted from the chart. Pure client state (useState), resets
   on day navigation. Keep the existing legend content/labels intact —
   including the projected-from-recent-weekdays text.
2. **Clocked-in roster popup.** When the Clocked-in view is active,
   clicking the chart (or a clearly-tappable "N on floor" affordance —
   audit the existing tooltip interaction and propose what coexists
   cleanly with it) opens a small popover listing who is clocked in
   NOW: name · position title · clock-in time (store-local). Data from
   a new endpoint (e.g. GET /api/labor/clocked-in-roster?storeId=):
   requireLaborView + labor.schedule.view, open timecards only, name
   resolved via the existing squareTeamMemberId → staff/roster mapping
   (audit where names live — propose the join; a member with no
   resolvable name renders "Unnamed"). Response fields: name, title,
   clockInAt. Nothing else — the fixture asserts the payload is
   structurally free of wage/rate/tip fields.

## 3 · Part B — /labor forecasted-vs-scheduled comparison

Audit the /labor page structure at HEAD first, then land a comparison
section that answers the manager question: "how does what we scheduled
stack against what Froot suggests?"

1. **Scope: the current week** (aligned to the page's existing week
   navigation if present — audit and match its conventions).
2. **Per-day comparison rows:** for each day, suggested hours (from the
   existing coverage/budget machinery, read-only) vs scheduled hours
   (sum of effective shift durations from synced schedules, tombstones
   filtered), with the delta. Visual treatment matching the page's
   existing design language — audit, propose in the plan.
3. **Day drill-in optional** — if the page structure makes one day's
   hour-curve comparison cheap (reusing the S3 chart component),
   propose it; if it drags scope, leave it out and say so.
4. **Sync honesty:** stores with no schedules (synced-empty) show
   suggested-only with the same graceful absence as the card — no
   fake zeros presented as scheduled decisions. Stale sync gets the
   same 26h stale label the card uses (reuse computeHealth).
5. Server-side capability gating identical to the card: without
   labor.schedule.view the comparison section is absent, the page
   otherwise unchanged.

## 4 · Audit checklist (brief; file:line; then plan + STOP)

1. Card legend + tooltip structure at HEAD — where toggle state hooks
   in; how popup coexists with the Recharts tooltip.
2. Where team-member names live (roster/staff tables) and the join
   from SquareTimecard.squareTeamMemberId — quote the columns.
3. /labor page structure: layout, week navigation, design language,
   where the comparison section lands.
4. Suggested-hours source for Part B (existing read path, no new
   computation of the recommendation).
5. Present the plan: files, endpoint shape, popup interaction design,
   comparison layout in words, fixture list, deviations. STOP for
   approval.

## 5 · Fixtures (extend verify-labor-schedule.ts or sibling)

- Roster payload structurally free of wage/rate/tip fields; only open
  timecards included; unresolvable name → "Unnamed".
- Scheduled-hours-per-day sum: tombstones excluded, effective columns
  used, store-local day boundaries.
- Capability-absent: comparison data and roster endpoint both deny.
- Legend toggle state: hidden series omitted, chip count unchanged.

## 6 · Definition of done

- Plan approved in-session before edits.
- Build green; suite green except exactly DEBT-76's nine (diffed) and
  the DEBT-77 flake rule.
- Import wall grep still clean.
- Two commits (work; docs: OVL-S4 row + file this prompt). NOT pushed.
- Findings triaged FIX NOW / RULING NOW / COMMENT / ROW.

## 7 · Out of scope

- Any sync/ingest change; cron; OAuth; schema; draft markers.
- Any change to budget, demand shape, or recommendation math.
- Weekly Plan surfaces.
- Historical clocked-in rosters (popup is NOW only).
