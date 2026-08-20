# Overlay S1b — ScheduledShift Probe · RESULTS

Filed 2026-08-20 from the planning-chat record. This is the S1b session's
report verbatim; the measurements below are the observed provenance the S2
schema doc-comments cite. All measurements from br-square-feather (staging)
→ the real Keva Square account, Square-Version: 2026-01-22. 19 locations,
18 ACTIVE. Window 2026-08-06 → 2026-09-17. n = 462 distinct shifts
(page-1-per-location, filter provably applied).

## 1 · The multi-location loss — mechanism, measured

The location filter is not the defect. Cursor pagination is.

Batched call over progressively wider windows, vs the sum of per-location
queries:

| Window | Batched | Cursor returned? | Σ per-location | Missing |
|---|---|---|---|---|
| 08-06 → 08-07 | 43 | no | 43 | 0 |
| 08-06 → 08-08 | 50 | yes | 64 | 14 |
| 08-06 → 08-09 | 50 | yes | 85 | 35 |
| 08-06 → 08-10 | 50 | yes | 135 | 85 |

When the result fits on one page, an 18-location filter is exactly correct.
Loss begins on the first request that returns a cursor, and only then.

The cursor base64-decodes to a (start_at, shift_id) pair. Page 1 of a
batched sweep spans the entire 30-day window while holding 50 of ~976 rows
— an interleaved merge across locations, not a time-ordered slice. Its
cursor resumes 18 days into the window; every shift starting before that
point not on page 1 is skipped permanently, and the endpoint reports its
cursor exhausted. The same defect produces duplicates (resume key is not
the page maximum): one location alone returned 114 rows across 3 pages, 76
unique, 38 duplicates.

Measured safe protocol (ground truth: one request per location per day,
each verified single-page — 976 shifts):

| Fetch protocol | Retrieved | Missing | Verdict |
|---|---|---|---|
| All 18 locations batched, follow cursor | 224 | 752 (77%) | unusable |
| Per-location, follow cursor | 751 | 225 (23%) | still lossy |
| Per-location + weekly window (single page) | 976 | 0 | SAFE |

Rule: one location_id per request; a window small enough that no cursor
comes back. If a response carries a cursor, the window was too large —
narrow it and re-query. NEVER follow the cursor as a completeness
strategy. Weekly per-store windows were lossless across all ten scheduled
locations; daily is the natural escalation. This inverts the timecard
sync's do…while(cursor) shape — the per-store scoping there is right; the
cursor loop must not be cloned.

## 2 · Complete raw payload objects (names masked as REDACTED_NAME)

A · draft only, never published:

```json
{
  "id": "MJ0JWXR12B8MB",
  "draft_shift_details": {
    "team_member_id": "TM3xMrcozhpb_gKJ",
    "location_id": "5T81ZVHA923D4",
    "job_id": "tVvhwvQ12FHG5RhzTpCvkWED",
    "start_at": "2026-08-10T14:00:00-07:00",
    "end_at": "2026-08-10T19:00:00-07:00",
    "is_deleted": false,
    "timezone": "America/Los_Angeles"
  },
  "version": 1,
  "created_at": "2026-08-13T15:23:26.176Z",
  "updated_at": "2026-08-13T15:23:26.176Z"
}
```

published_shift_details is absent — not null, not empty. Absent.

B · draft + published, no team_member_id (open/unassigned shift):

```json
{
  "id": "EMAJPVRW0137B",
  "draft_shift_details": {
    "location_id": "B95CJRCRDD91Y",
    "job_id": "tVvhwvQ12FHG5RhzTpCvkWED",
    "start_at": "2026-08-18T10:30:00-07:00",
    "end_at": "2026-08-18T16:00:00-07:00",
    "is_deleted": false,
    "timezone": "America/Los_Angeles"
  },
  "published_shift_details": {
    "location_id": "B95CJRCRDD91Y",
    "job_id": "tVvhwvQ12FHG5RhzTpCvkWED",
    "start_at": "2026-08-18T10:30:00-07:00",
    "end_at": "2026-08-18T16:00:00-07:00",
    "is_deleted": false,
    "timezone": "America/Los_Angeles"
  },
  "version": 17,
  "created_at": "2026-08-14T17:32:02.202Z",
  "updated_at": "2026-08-20T16:16:12.047Z"
}
```

C · carries notes, and the notes carry a person's name:

```json
{
  "id": "MJ10WSYTGW1YQ",
  "draft_shift_details": {
    "team_member_id": "TM-4U2_5VtWlYJRj",
    "location_id": "B95CJRCRDD91Y",
    "job_id": "EcwRoP64JFZxQDFmZBV8iMGK",
    "start_at": "2026-08-19T06:30:00-07:00",
    "end_at": "2026-08-19T15:00:00-07:00",
    "notes": "training REDACTED_NAME day 2",
    "is_deleted": false,
    "timezone": "America/Los_Angeles"
  },
  "published_shift_details": {
    "team_member_id": "TM-4U2_5VtWlYJRj",
    "location_id": "B95CJRCRDD91Y",
    "job_id": "EcwRoP64JFZxQDFmZBV8iMGK",
    "start_at": "2026-08-19T06:30:00-07:00",
    "end_at": "2026-08-19T15:00:00-07:00",
    "notes": "training REDACTED_NAME day 2",
    "is_deleted": false,
    "timezone": "America/Los_Angeles"
  },
  "version": 15,
  "created_at": "2026-08-14T17:10:28.299Z",
  "updated_at": "2026-08-17T18:03:51.116Z"
}
```

## 3 · Field inventory (n = 462)

| Field | Type | Presence |
|---|---|---|
| id | string | 462/462 always |
| version | number | 462/462 always — monotonic, observed 1…17 |
| created_at | string | always — UTC Z, milliseconds |
| updated_at | string | always — UTC Z, milliseconds |
| draft_shift_details | object | 462/462 ALWAYS |
| published_shift_details | object | 399/462 — sometimes absent |
| …details.location_id | string | always when parent present |
| …details.job_id | string | always when parent present |
| …details.start_at | string | always — location-local + offset |
| …details.end_at | string | always — location-local + offset |
| …details.timezone | string | always — IANA |
| …details.is_deleted | boolean | always |
| …details.team_member_id | string | draft 450/462, published 387/399 — OPTIONAL |
| …details.notes | string | draft 24/462, published 19/399 — OPTIONAL |

No wage, no money, no rate, no name, no email in the shift payload.

Team-member reference: team_member_id, same namespace as
SquareTimecard.squareTeamMemberId and SquareTeamMemberWage.
squareTeamMemberId. 12 of 462 are unassigned open shifts — a coverage
curve must count shifts, not distinct members.

Position/job reference: job_id is the SOLE position reference — no title
on the shift. GET /v2/labor/jobs → 404. 7 distinct job ids estate-wide,
all but one also present in SquareTimecard wage data (which carries the
title beside it):

| job_id | Title (from timecards.wage.title) |
|---|---|
| HuymfGPFwvtc2b74qqi1kyKr | Manager |
| tVvhwvQ12FHG5RhzTpCvkWED | Team Member |
| EcwRoP64JFZxQDFmZBV8iMGK | Lead Shift Supervisor |
| Vo8oh22QmQAr3y2s1bkjF8fu | Shift Supervisor |
| UmRDFo2fhjqRRmZ67AAZh9oY | Administrator |
| bdowcCHo6qxZ9Ui7G42TUC7R | Manager/Assistant Manager |
| J2B4akMW1pGzFVw8F98P49dJ | (not in the timecard sample) |

Only "Team Member" matches a LaborPosition name (1 of 7). No mapping
exists (grep squareJobId → no match) — which killed the
color-on-LaborPosition idea and produced the SquareJobColor ruling.

Timezones: start_at/end_at are location-local with a real offset (-07:00
/ -06:00), never Z. created_at/updated_at are always Z. Same convention
as timecards; existing store-local bucketing applies unchanged.

Draft vs published: draft-only 63/462 (14%); published-only 0/462; both
399/462, of which draft ≠ published in 22. is_deleted true on 21/462 —
Square TOMBSTONES rather than deletes. Sync the flag, filter on read.

Location reference: plain location_id → Store.squareLocationId.

Pagination: opaque root-level cursor decoding to (start_at, shift_id).
limit cap is EXACTLY 50 — limit 51 and 200 both 400 with VALUE_TOO_HIGH.
(Timecards' documented max of 200 does not transfer.)

## 4 · Empty vs error

| Case | Status | Body |
|---|---|---|
| Real location, zero schedules | 200 | {} |
| Bogus location id | 200 | {} |
| limit 51 / 200 | 400 | VALUE_TOO_HIGH on "limit" |
| Unknown filter field | 200 | full result — SILENTLY ACCEPTED |
| Invalid token | 401 | AUTHENTICATION_ERROR / UNAUTHORIZED |

"No schedules" and "nonexistent location" are byte-identical: 200 {} —
even the array key is absent. Eight of eighteen active locations return
exactly this today (Square Scheduling rollout in progress). Seam (c)
therefore CANNOT be served from the API response; the distinguishing fact
is Froot's own sync-state row (lastSyncOkAt set + zero count = "we asked,
Square said nothing"). Related trap: a misspelled filter field returns
200 with a wrong-window result — request construction must be exact.

## 5 · Timecards control

POST /v2/labor/timecards/search {"limit":1} → 200 with a real timecard
(wage.title + wage.job_id present — the source that resolves job_id →
title, since /v2/labor/jobs 404s). Token behaves as /api/square/labor/
verify proved 2026-08-18.

## 6 · Beta headers

None. square-version: 2026-01-22 echoed; no Warning, Deprecation,
Sunset, Beta marker, or rate-limit headers. No header exists to detect a
future breaking change from — the argument for pinning SQUARE_VERSION
and testing on version bumps.

## 7 · Notes for the S2 schema (observed → constraints)

- draft_shift_details always present ⇒ draft location/job/start/end/
  timezone/is_deleted columns are NON-NULL; only draftTeamMemberId and
  draftNotes are nullable.
- published_shift_details absent until published ⇒ published columns all
  nullable; absence is a state, not a falsy value.
- version is the idempotency guard (WHERE squareVersion <= EXCLUDED).
- effective = published ?? draft, denormalized at write time (ruled).
- notes synced, NEVER selected into overlay payloads (ruled).
