# TIER 3 — SQ-VER-1: Bump SQUARE_VERSION to 2026-01-22 (three edit sites) + first labor read

**Session type: STRUCTURAL — plan-first with a HARD STOP.** This session
changes the API version header on every outbound Square call, including the
live order sync feeding nine production stores. Phase A audits and plans, then
STOPS for Gary's explicit go. Phase B builds only after he says proceed.

---

## Context (self-contained — do not rely on chat history)

Repo: `~/Claude_Projects/Froot/froot` (lowercase `froot` is the git root; the
capital-F parent is a known trap — verify with `git rev-parse --show-toplevel`).

Read first, in this order:
1. `docs/DECISIONS.md` top entries — the 2026-08-18 read-only ruling and the
   L-2 deferral lift.
2. `docs/prompts/LABOR-0B_RESULTS.md` — Task 4 is this session's plan input:
   the changelog delta from 2024-01-17 → 2026-01-22, which found NOTHING
   breaking for Froot-called APIs across all eleven dated versions. Re-read
   it; do not re-derive it.
3. `docs/ROADMAP.yaml` L-2 row — gates and blockers.

Established facts this session inherits (verify each at source before
relying on it):
- The pin is `src/lib/square.ts:4` → `SQUARE_VERSION = "2024-01-17"`.
- TWO MORE hardcoded `"2024-01-17"` literals exist outside the constant:
  `src/app/api/square/callback/route.ts:43` and
  `src/app/api/square/locations/route.ts:44`. The bump is a THREE-SITE edit.
  Editing only the constant would run one OAuth flow at two API versions.
- Post-SQ-WB-1 count: SEVEN version-bearing header sites total, FIVE reaching
  the version through the constant (LABOR-0B counted eight/six before the
  write-back helper was deleted). Re-grep and confirm the seven, listing
  file:line.
- Scopes: staging's OAuth grant was re-consented 2026-08-18 and should carry
  six read permissions (`MERCHANT_PROFILE_READ ITEMS_READ ORDERS_READ
  EMPLOYEES_READ TIMECARDS_READ TIMECARDS_SETTINGS_READ`). The grant was NOT
  directly observable in Square's merchant dashboard — Task B4's first labor
  read is the designed verification. A 403 there means re-consent, not code
  failure.
- TWO SEPARATE SQUARE APPS exist: "Froot Staging" and "Froot" (production),
  both authorized against the live Keva Square account (observed by Gary in
  Square's My Applications, 2026-08-18). Staging reads REAL data. The
  read-only ruling is what makes this safe.
- The webhook subscription's API version is A SEPARATE DIAL (set in Square's
  dashboard per-app, currently believed 2024-01-18 for production). This
  session must NOT change it. Two dials, one at a time.

## Hard rules

1. No `&&` command chains. One command per paste.
2. Additive-only schema — this session should touch NO schema at all.
3. Do NOT touch the webhook subscription or anything in Square's dashboard.
4. Do NOT touch the OAuth scope string EXCEPT the one authorized comment
   addition in Task B2.
5. `npm run build` green before each commit. No push — Gary pushes.
6. Phase B does not begin until Gary explicitly says proceed, in this
   session, after reading the Phase A report.

## PHASE A — Audit and plan (read-only)

A1. Re-verify the three edit sites by reading each line; quote all three
    verbatim. Grep the whole of `src/` for `2024-01-17` to prove there is no
    fourth site. Grep for `Square-Version` and list all seven header sites
    with file:line.

A2. Read LABOR-0B Task 4's delta table. For each Froot-called API (Orders,
    Catalog, Locations, Team, Merchants, OAuth), state in one line why the
    bump is safe or what to watch. If the table marked anything "unclear",
    surface it here as a question for Gary.

A3. Write the verification plan Phase B will execute (B3–B4 below), naming
    the exact staging surfaces and what "pass" means for each.

A4. STOP. Present the Phase A report to Gary: the three quoted lines, the
    seven-site list, the per-API safety notes, and the verification plan.
    Wait for his explicit proceed.

## PHASE B — The bump (after Gary's go)

B1. Edit all three sites to `2026-01-22` in ONE commit:
    - `src/lib/square.ts:4` — the constant.
    - `callback/route.ts:43` and `locations/route.ts:44` — replace the
      hardcoded literals with an import of the constant, NOT a new literal,
      so a fourth drift site can never appear. If importing creates a cycle,
      fall back to the literal and record why.

B2. Authorized comment addition (same commit): extend the comment above the
    scope string in `src/app/api/square/auth/route.ts` with two lines
    documenting TIMECARDS_READ (timecards + scheduled-shift reads) and
    TIMECARDS_SETTINGS_READ (break types + workweek config), citing the
    2026-08-18 ruling.

B3. Minimal labor verification route (same commit; the deferral is lifted, so
    this is legitimate first L-2 code): `GET /api/square/labor/verify` —
    ADMIN-only via the same gate pattern as `square/locations`, calls Square
    `SearchTimecards` with `limit: 1` for the org, returns JSON
    `{ ok, httpStatus, hasData }` and NOTHING else — no timecard fields, no
    names, no wages (DEBT-10 territory; this route must never grow a body).
    Comment it as the version+scope+grant verification probe.

B4. `npm run build`. Work commit. Then recorder commit: ROADMAP L-2 blockers
    updated (version bump staged; gate status now: everything cleared pending
    Gary's staging pass + production consent at promotion), preserve-and-mark.

## After this session (Gary's steps — record verbatim in the output)

1. Push. Wait for the staging deploy to go green in Vercel.
2. Staging pass, in order:
   a. Dashboard — sales numbers populate (order sync healthy on new version).
   b. Stores → Edit Store — the Square location picker loads (locations
      healthy — this route had a hardcoded literal).
   c. Staff → Import from Square — the member list loads (team reads healthy).
   d. Visit `/api/square/labor/verify` signed in as ADMIN. `{"ok":true...}`
      proves version, scope, AND grant in one shot. A 403-shaped failure
      means the 2026-08-18 re-consent didn't carry the new scopes: re-run the
      consent URL and retry — that is the fix, not a code bug.
3. Report all four results back to the planning chat.
4. Production gets this at the next promotion, followed by the production
   consent click and the same four checks there.

## Decisions that are NOT this session's to make

- Webhook subscription version (its own future decision, per-app).
- Any labor feature beyond the verify probe.
- `SQUARE_ACCESS_TOKEN` cleanup.
- Promotion timing.
