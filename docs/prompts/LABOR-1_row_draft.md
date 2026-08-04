# LABOR-1 — roadmap row draft

**Written:** 2026-08-02. Not committed. Reference text for pasting into
`docs/ROADMAP.yaml` when the labor thread is picked up.

**This file is NOT a session prompt.** Do not paste it into a Claude Code
session — it is roadmap text, and a session that reads it will treat the
contents as instructions. The companion audit prompt is
`LABOR-0_shift_surface_grep.md`.

**Ordering:** run the LABOR-0 grep **before** committing either row. Both rows
below contain the strings `labor/shifts` and `labor.shift.created`. Once they
are in a tracked file, those become grep hits — the same contamination shape
as DEBT-43. The audit prompt already excludes `docs/`, so this is belt and
braces, but the cheaper order is: grep first, then write the rows with the
real findings substituted in.

**Schema note:** adjust keys to match the live `ROADMAP.yaml` phase-row shape.
The structure below is illustrative, not authoritative.

---

## LABOR-1 (the phase)

```yaml
- id: LABOR-1
  title: Square Labor ingest — real hours, then real labor cost
  size: M–L (staged; see phases)
  status: ⬜ Not started
  notes: |
    Froot reads timecards from Square and stops inferring labor. Scoped
    2026-08-02, not started, deliberately parked until the labor thread is
    ready.

    SOURCE CORRECTION — read this before scoping. The trigger for this row was
    Keva moving to Square Payroll (target September 2026), but Square Payroll
    is NOT the data source and this phase does not depend on it. Square's
    Payroll API is not automatically available to developer accounts — access
    is requested from Square sales/developer support — and it does not expose
    gross-to-net, deductions, taxes, or pay stubs. Treat payroll dollars as
    permanently unavailable.

    The actual source is the LABOR API, available today under OAuth. A Timecard
    records start/end, break durations, job title, hourly pay rate, and
    declared cash tips, with a `labor.timecard.created` webhook when a timecard
    opens. Scopes: TIMECARDS_READ + EMPLOYEES_READ (+ MERCHANT_PROFILE_READ for
    locations).

    THEREFORE THE REAL DEPENDENCY IS TIME-CLOCK ADOPTION, NOT THE PAYROLL
    SWITCH. Any store already clocking in on Square POS produces timecards
    Froot can read now. September raises volume and coverage; it does not
    unlock the API. If a subset of Keva stores already clock in, phase (a) can
    be built and verified against live data ahead of the switch.

    PHASES — ship in this order. Hours are not sensitive; dollars are.
      (a) Read-only ingest. Timecards → Froot. Per-store actual hours worked,
          by team member, by day. NO wage data, NO dollars. Ships without any
          wage-hygiene prerequisite and without DEBT-10.
      (b) Labor cost. Adds wage/rate to (a). GATED on DEBT-10 (Square
          team-member PII already exposed in production — wage rates widen
          that materially) and on wage-settings hygiene below.
      (c) Coverage from actuals. Supersedes the L-3 decision to keep coverage
          sales-inferred (DECISIONS.md, L-3 §a) — real staffing replaces the
          proxy. StoreHours becomes optional rather than the upgrade path.
      (d) Schedule write-back → LABOR-2, NOT this row. The Labor API's
          scheduling half is write-capable (draft/published scheduled shifts,
          publish endpoints that notify affected team members). That turns
          Froot's scheduler from a parallel system into the system of record.
          Real product value, real scope trap. Named here so it is not
          rediscovered; sized separately.

    PREREQUISITES — confirm each before starting, none are code in this repo:
      1. Square-Version ≥ 2025-05-21 on the Square client. Timecard endpoints
         require it. See LABOR-0 for the current pin.
      2. TIMECARDS_READ in the OAuth scope set. If it is not already
         requested, ADDING IT REQUIRES EVERY EXISTING SQUARE CONNECTION TO
         RE-CONSENT. That is a merchant-facing rollout step, not a deploy.
         Establish this early — it is the long pole, not the code.
      3. Team-member wage settings configured in the Square Dashboard or via
         Team API. Timecard.wage carries job title and rate ONLY when they
         are set. Anyone missing them produces a timecard with no cost.
         Keva-side data hygiene, ahead of phase (b). Froot should warn on the
         gap — reuse the affordance from staff/[id] ("No store assigned —
         signed documents stamp a blank store").

    DOES NOT INTERACT WITH DEBT-9. Timecards carry their own location, so
    per-store labor is attributed from Square's data, not from
    StaffMember.primaryStore. Primary store stays a payroll/legal label and a
    compliance-rollup bucket. Confirmed 2026-08-02; do not re-derive.

    OPEN QUESTIONS, deferred to kickoff:
      - Ingest shape: webhook-driven, polled via SearchTimecards, or both.
        Timecards are edited after the fact (manager corrections), so
        `labor.timecard.created` alone is insufficient — an update path is
        required regardless.
      - Storage: mirrored into Neon or read-through. Mirroring makes labor
        stored per-environment data that does not migrate between branches.
      - Whether owner/admin accounts who never clock in should appear in
        labor surfaces at all.
```

---

## LABOR-0 (conditional — write only if the grep returns hits)

If the audit answers **NO** to "does this repo call any deprecated Shift
endpoint", do not create this row. Record the finding as a COMMENT in the
session and note in LABOR-1 prerequisite 1 that the surface was clean as of
the audit date.

If it answers **YES**, substitute the real `file:line` list and the real
version pin:

```yaml
- id: LABOR-0
  title: Square Shift endpoints retire — migrate to Timecards
  size: S
  status: ⬜ Not started
  cost_of_doing_nothing: |
    LATENT — with an external clock Gary does not control. Square API version
    2025-05-21 replaced every /v2/labor/shifts/... endpoint with a
    /v2/labor/timecards/... equivalent and deprecated all Shift data types and
    webhook events. At retirement, Shift endpoints return 410 GONE regardless
    of the Square-Version header sent. Pinning an old version does not buy
    time.
  notes: |
    Sites (from LABOR-0 grep session, YYYY-MM-DD): <paste file:line list>
    Current Square-Version pin: <value>
    Shift and Timecard endpoints operate on the same underlying resources —
    SearchShifts and SearchTimecards return the same set, shaped differently —
    so migration is a rename plus a response-shape change, not a data change.
    Blocks LABOR-1 phase (a) only if the same client code is reused.
```

---

## Sourcing

Square API facts above are from Square's developer documentation as of
2026-08-02 (Labor API overview, time-tracking and scheduling guides, OAuth
permissions reference), plus Square's published position on Payroll API
access. Re-verify the retirement date and the `2025-05-21` version floor at
kickoff — deprecation timelines move, and this row may sit for months.
