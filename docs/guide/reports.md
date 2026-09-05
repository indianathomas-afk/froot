---
id: reports
title: Accountability & Compliance
entry: /reports
routes:
  - /reports
summary: >
  See how many checklists were completed, started, missed or submitted with
  critical tasks outstanding, broken down by store and by period.
roles: [ADMIN, MANAGER]
capability: reports.view
module: null
order: 130
keywords: [reports, compliance, accountability, missed, non-compliant, store performance]
---

Accountability & Compliance answers one question: for a chosen period and a
chosen store, did the checklists actually get done?

The page opens on the past week, across every store you have access to. Two
dropdowns at the top change that — one for the store, one for the period.

## The six tiles

Across the top are six counts for the period you have selected.

- **Total** — every checklist in the period, whatever its state. This is the
  denominator for the tiles beside it.
- **Completed** — submitted with all critical tasks done.
- **In Progress** — someone started it and has not submitted it.
- **Pending** — not started.
- **Non-Compliant** — submitted, but with critical tasks still incomplete. This
  is the one worth reading first: the checklist came back, so it looks handled
  in a list, and it is not.
- **Missed** — the day closed without the checklist being completed. Missed is
  written by the overnight close, not by a person, so it appears the morning
  after rather than at the moment the day ends.

Non-Compliant and Missed are different failures. Non-Compliant means someone
was there and skipped something critical. Missed means nobody submitted it at
all.

## Store Performance

Below the tiles, the same period is broken out per store, so a single store
dragging the org average is visible without changing the filter six times.

If you only have access to some stores, both the tiles and this table are
already limited to those — the numbers you see are yours, not the org's.
