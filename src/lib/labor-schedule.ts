import { randomUUID } from "crypto"
import { Prisma } from "@prisma/client"
import type { Organization, Store } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { getSquareClient } from "@/lib/square"
import { dbDate, localDateStr } from "@/lib/reports"
import { BADGE_PRESETS, BADGE_PRESET_KEYS, isBadgePresetKey, type BadgePresetKey } from "@/lib/badge-presets"
// OVL-S3 — the open-card ceiling and the does-this-row-count test, IMPORTED
// RATHER THAN COPIED (Gary, D3/D4). The direction is what keeps seam (b) intact:
// labor-actuals never imports schedule-side, and it is not one of the six core
// engines the wall names (labor-plan/coverage/budget/forecast/daily/week).
import { clockedEndMs, computeHealth, paidMinutesOf } from "@/lib/labor-actuals"

// OVL-S2 — SCHEDULE INGEST. The schedule/actual overlay's plan half.
//
// Design record: docs/prompts/Overlay_S2_Ingest_Build_Session_Prompt.md.
// Measurements: docs/prompts/Overlay_S1b_Probe_RESULTS.md (n = 462 real shifts,
// 2026-08-20). Rulings: docs/DECISIONS.md §§ "Schedule/actual overlay, scope
// rulings" and "Schedule overlay, S1b rulings", both 2026-08-20.
//
// THIS MODULE SITS ON THE labor-actuals SIDE OF THE IMPORT WALL — L-2 seam (b).
// labor-plan.ts, labor-coverage.ts, labor-budget.ts and labor-forecast.ts never
// import it and never gain a Square-sourced input. THE BOUNDARY TEST: drop the
// three OVL-S2 tables and every existing labor surface must render
// BYTE-IDENTICALLY.
//
// READ-ONLY TOWARD SQUARE, ABSOLUTELY. Every call goes through
// getSquareClient(org) on the merchant's OAuth token — never the static
// SQUARE_ACCESS_TOKEN — and scheduled-shift reads ride the TIMECARDS_READ scope
// the timecard sync already holds (CLAUDE.md § Square scopes). No _WRITE scope
// exists or ever will.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE FETCH PROTOCOL IS LAW, AND IT IS THE OPPOSITE OF THE TIMECARD SYNC'S.
//
// syncTimecardsForStore follows Square's cursor in a do…while loop. DOING THAT
// HERE LOSES MOST OF THE DATA. S1b measured it against ground truth (976 shifts,
// one request per location per day, each verified single-page):
//
//   all 18 locations batched, follow cursor →  224 retrieved, 752 missing (77%)
//   per-location, follow cursor            →  751 retrieved, 225 missing (23%)
//   per-location + weekly window           →  976 retrieved,   0 missing  SAFE
//
// The mechanism: page 1 of a sweep spans the whole window while holding 50 of
// ~976 rows — an interleaved merge across locations, not a time-ordered slice.
// The cursor base64-decodes to a (start_at, shift_id) pair and resumes 18 days
// in, so every earlier shift not on page 1 is skipped PERMANENTLY and Square
// then reports the cursor exhausted. The same defect duplicates: one location
// returned 114 rows across 3 pages, 76 unique.
//
// So: ONE location_id per request; a window small enough that no cursor comes
// back; limit 50 (the cap is exactly 50 — 51 and 200 both 400). A RETURNED
// CURSOR MEANS THE WINDOW WAS TOO BIG — split it and re-query. The cursor is
// never followed as a completeness strategy, and a window that cannot be split
// any further THROWS rather than silently truncating.
// ─────────────────────────────────────────────────────────────────────────────

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

/// Square's hard cap, measured: limit 51 and limit 200 both return 400
/// VALUE_TOO_HIGH. The timecard endpoint's documented 200 does not transfer.
const SQUARE_SCHEDULE_PAGE_LIMIT = 50

/// The card horizon. Three days back so a just-corrected past shift is picked
/// up; four weeks forward because that is as far as the overlay looks.
export const SCHEDULE_WINDOW_DAYS_BACK = 3
export const SCHEDULE_WINDOW_DAYS_FORWARD = 28

/// The default chunk. S1b: weekly per-store windows were single-page — and so
/// lossless — across all ten scheduled locations. Daily is the escalation, and
/// splitWindow() is how we get there.
const SCHEDULE_CHUNK_DAYS = 7

// ─── SHAPES ───────────────────────────────────────────────────────────────────

/// The half of Square's payload that repeats under `draft_shift_details` and
/// `published_shift_details`. Optionality here is OBSERVED, not assumed:
/// team_member_id 450/462 on draft, notes 24/462 (S1b § 3).
type ShiftDetails = {
  location_id: string
  job_id: string
  start_at: string
  end_at: string
  timezone: string
  is_deleted: boolean
  team_member_id?: string | null
  notes?: string | null
}

type ScheduledShiftPayload = {
  id: string
  /// ALWAYS PRESENT — 462/462. Its absence would be a Square-side novelty.
  draft_shift_details: ShiftDetails
  /// ABSENT until published — not null, not empty, ABSENT. 399/462 carry it.
  published_shift_details?: ShiftDetails | null
  version?: number
  created_at?: string
  updated_at?: string
}

export type ScheduleSyncResult = {
  shifts: number
  written: number
  /// Requests actually issued. One per (location, window) — and it grows when a
  /// window had to be split, which is the number worth watching.
  requests: number
  /// Windows that came back with a cursor and were therefore re-queried smaller.
  splits: number
}

/// A store-local date range, both ends inclusive, both yyyy-mm-dd.
export type ScheduleWindow = { startDate: string; endDate: string }

// ─── PURE: WINDOW PLANNING ────────────────────────────────────────────────────

/// Chops a store-local date range into weekly chunks. Pure and exported so the
/// fixture can exercise the protocol without a network.
export function planScheduleWindows(
  startDate: string,
  endDate: string,
  chunkDays = SCHEDULE_CHUNK_DAYS
): ScheduleWindow[] {
  const out: ScheduleWindow[] = []
  let cursor = startDate
  while (cursor <= endDate) {
    const last = addDaysStr(cursor, chunkDays - 1)
    const chunkEnd = last > endDate ? endDate : last
    out.push({ startDate: cursor, endDate: chunkEnd })
    cursor = addDaysStr(chunkEnd, 1)
  }
  return out
}

/// Halves a window. Returns null when it is already ONE DAY and cannot be made
/// smaller — the caller turns that into a loud failure rather than a quiet
/// partial result, because a silently truncated schedule reads on the card as
/// "nobody is scheduled", which is the exact sentence seam (c) forbids.
export function splitWindow(w: ScheduleWindow): [ScheduleWindow, ScheduleWindow] | null {
  const span = daysInclusive(w.startDate, w.endDate)
  if (span <= 1) return null
  const half = Math.floor(span / 2)
  const mid = addDaysStr(w.startDate, half - 1)
  return [
    { startDate: w.startDate, endDate: mid },
    { startDate: addDaysStr(mid, 1), endDate: w.endDate },
  ]
}

// ─── PURE: THE EFFECTIVE SHIFT ────────────────────────────────────────────────

export type EffectiveShift = ShiftDetails & { source: "published" | "draft" }

/// published ?? draft (Gary, 2026-08-20). During Square's Scheduling rollout a
/// draft-only store shows the manager's real plan instead of a blank; the owned
/// trade-off is that the card may show shifts not yet announced to staff, which
/// is why `source` is stored and the S3 legend has to say which it is.
///
/// ABSENCE IS THE TEST, NOT FALSINESS. published_shift_details is absent until
/// published, so `?? ` on the OBJECT is right and a per-field coalesce would be
/// wrong — a published shift that genuinely dropped its team member would
/// otherwise inherit the draft's.
export function effectiveShiftOf(p: ScheduledShiftPayload): EffectiveShift {
  const published = p.published_shift_details
  if (published) return { ...published, source: "published" }
  return { ...p.draft_shift_details, source: "draft" }
}

// ─── PURE: POSITION COLOUR ────────────────────────────────────────────────────

/// The palette the default draws from: every badge preset EXCEPT `gray`.
///
/// Grey is excluded because badgePreset() already returns it for an unknown key
/// — it is the "I don't recognise this" colour. A job legitimately assigned grey
/// would be indistinguishable from a job whose stored colour is broken.
const JOB_COLOR_KEYS: BadgePresetKey[] = BADGE_PRESET_KEYS.filter((k) => k !== "gray")

/// A stable colour for a Square job id, with no table lookup and no mapping
/// layer. Same id ⇒ same colour, in every environment, forever — which is what
/// lets S2 ship a fully-coloured overlay while the settings editor that writes
/// overrides waits for S3.
///
/// FNV-1a over the id's bytes. Any stable hash would do; this one is three lines
/// and has no dependency. The only property that matters is that it never
/// changes: a colour that moved between deploys would look like a data change to
/// a manager reading the card.
export function deterministicJobColor(squareJobId: string): BadgePresetKey {
  let hash = 0x811c9dc5
  for (let i = 0; i < squareJobId.length; i++) {
    hash ^= squareJobId.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return JOB_COLOR_KEYS[hash % JOB_COLOR_KEYS.length]
}

// ─── THE SYNC ─────────────────────────────────────────────────────────────────

/// Mirrors one store's scheduled shifts for a store-local date range.
///
/// NEVER THROWS INTO A LABOR SURFACE, the same contract syncTimecardsForStore
/// has: every failure is recorded on SquareScheduleSyncState.lastError and
/// re-thrown to the CALLER, which is a route that owns its own response. The
/// rows already stored are untouched and read as stale. That is seam (c)'s ON
/// BUT UNHEALTHY — an integration error is never dressed as a 401 (DON'T #5).
export async function syncScheduledShiftsForStore(
  org: Organization,
  store: Store,
  startDate: string,
  endDate: string
): Promise<ScheduleSyncResult> {
  if (!store.squareLocationId) throw new Error("STORE_NOT_LINKED")
  const locationId = store.squareLocationId

  const startedAt = new Date()
  await recordSyncStarted(org.id, store.id, startedAt, startDate, endDate)

  try {
    const client = await getSquareClient(org)
    const { shifts: collected, requests, splits } = await collectScheduledShifts(
      (window) => fetchScheduledShiftPage(client, locationId, store.timezone, window),
      { startDate, endDate, locationId, timeZone: store.timezone }
    )

    const written = await writeScheduledShifts(org, store, collected, new Date())
    const unique = new Set(collected.map((p) => p.id)).size
    await recordSyncOk(store.id, new Date(), unique)
    console.log(
      `[labor-schedule] org=${org.id} store=${store.id} ${startDate}..${endDate}: ` +
        `${unique} shifts, ${written} written, ${requests} request(s), ${splits} split(s)`
    )
    return { shifts: unique, written, requests, splits }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "sync failed"
    // The REAL cause, logged before anything upstream can mask it — BUG-1.
    console.error(`[labor-schedule] org=${org.id} store=${store.id}: ${msg}`)
    await recordSyncError(store.id, msg)
    throw e
  }
}

/// THE PROTOCOL ITSELF, WITH THE NETWORK LIFTED OUT.
///
/// Takes a page-fetcher rather than calling Square, so the law this function
/// encodes — a cursor means SPLIT, never FOLLOW — is exercised by
/// scripts/verify-labor-schedule.ts against a mock with no network and no DB.
/// The law is worth more than the plumbing around it and deserves to be the
/// thing under test.
///
/// A STACK RATHER THAN RECURSION, so the split budget is one visible number and
/// a pathological window cannot blow the call stack before it hits the floor.
export async function collectScheduledShifts(
  fetchPage: (window: ScheduleWindow) => Promise<{ shifts: ScheduledShiftPayload[]; cursor?: string }>,
  opts: { startDate: string; endDate: string; locationId: string; timeZone: string }
): Promise<{ shifts: ScheduledShiftPayload[]; requests: number; splits: number }> {
  const shifts: ScheduledShiftPayload[] = []
  let requests = 0
  let splits = 0

  const pending = planScheduleWindows(opts.startDate, opts.endDate).reverse()
  while (pending.length > 0) {
    const window = pending.pop()!
    const page = await fetchPage(window)
    requests++

    if (page.cursor) {
      // THE WINDOW WAS TOO BIG. Note what is NOT here: the cursor is read and
      // then DISCARDED. It is never passed to the next request, and the page
      // that came back with it is DROPPED rather than kept — those 50 rows are
      // an interleaved sample of the whole window, not its first 50, so keeping
      // them alongside the re-queried halves would duplicate some and still miss
      // others. Both halves are re-fetched from scratch.
      const halves = splitWindow(window)
      if (!halves) {
        throw new Error(
          `SQUARE_SCHEDULE_WINDOW_UNSPLITTABLE: ${window.startDate} returned a cursor at ` +
            `one-day granularity for location ${opts.locationId}; ` +
            `>${SQUARE_SCHEDULE_PAGE_LIMIT} shifts in a single store-day cannot be read losslessly`
        )
      }
      splits++
      // Pushed in reverse so the stack pops them in calendar order — the logs
      // read chronologically when a window has to be chased down.
      pending.push(halves[1], halves[0])
      continue
    }

    assertFilterApplied(page.shifts, opts.locationId, opts.timeZone, window)
    shifts.push(...page.shifts)
  }

  return { shifts, requests, splits }
}

/// ONE request, ONE location, ONE window.
///
/// THE FILTER OBJECT IS BUILT FROM TYPED CONSTANTS AND NEVER FROM SPREAD CALLER
/// INPUT. S1b § 4 measured the trap that makes this non-negotiable: an UNKNOWN
/// filter field returns 200 with the FULL result rather than an error, so a
/// typo does not fail — it silently widens the window and hands back data for
/// the wrong dates. Request construction has to be exact, and
/// assertFilterApplied() below is the runtime proof that it was.
async function fetchScheduledShiftPage(
  client: { baseUrl: string; headers: Record<string, string> },
  locationId: string,
  timeZone: string,
  window: ScheduleWindow
): Promise<{ shifts: ScheduledShiftPayload[]; cursor?: string }> {
  const res = await fetch(`${client.baseUrl}/v2/labor/scheduled-shifts/search`, {
    method: "POST",
    headers: client.headers,
    body: JSON.stringify({
      query: {
        filter: {
          // EXACTLY ONE. The batched multi-location call is the 77% loss.
          location_ids: [locationId],
          start: {
            start_at: localMidnightUtc(window.startDate, timeZone).toISOString(),
            // Exclusive upper bound: local midnight opening the day AFTER the
            // window's last day. Both ends of a ScheduleWindow are inclusive.
            end_at: localMidnightUtc(addDaysStr(window.endDate, 1), timeZone).toISOString(),
          },
        },
      },
      limit: SQUARE_SCHEDULE_PAGE_LIMIT,
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => "")
    // The status rides in the message on purpose: a 403 means the merchant's
    // grant is missing TIMECARDS_READ and the fix is re-running the consent URL,
    // not a code change (labor/verify/route.ts).
    throw new Error(`SQUARE_SCHEDULE_${res.status}: ${body.slice(0, 300)}`)
  }

  // "No schedules" and "nonexistent location" are BOTH `200 {}` — even the array
  // key is absent (S1b § 4). Eight of eighteen active locations answer exactly
  // that today. That is why the empty case is normal here and why
  // SquareScheduleSyncState, not this response, is what tells them apart.
  const data = (await res.json()) as { scheduled_shifts?: ScheduledShiftPayload[]; cursor?: string }
  return { shifts: data.scheduled_shifts ?? [], cursor: data.cursor }
}

/// THE TRIPWIRE FOR THE 200-WITH-WRONG-DATA TRAP.
///
/// S1b proved Square accepts an unknown filter field and returns the unfiltered
/// result. A silently-ignored filter therefore looks exactly like a successful
/// sync, and the damage lands in the database rather than in a log. So every
/// page is checked against what was ASKED FOR, and a mismatch throws.
///
/// The location check is exact — S1b: "the location filter is not the defect".
/// The date check carries ONE DAY of slack in each direction, deliberately: a
/// shift whose draft and published halves straddle a boundary is a real thing
/// (22 of 399 differ), whereas an ignored filter returns the whole 30-day estate
/// and misses by weeks. The slack keeps the tripwire pointed at the failure it
/// was built for.
function assertFilterApplied(
  shifts: ScheduledShiftPayload[],
  locationId: string,
  timeZone: string,
  window: ScheduleWindow
): void {
  const lower = localMidnightUtc(addDaysStr(window.startDate, -1), timeZone).getTime()
  const upper = localMidnightUtc(addDaysStr(window.endDate, 2), timeZone).getTime()

  for (const p of shifts) {
    const sides = [p.draft_shift_details, p.published_shift_details].filter(Boolean) as ShiftDetails[]
    if (!sides.some((d) => d.location_id === locationId)) {
      throw new Error(
        `SQUARE_SCHEDULE_FILTER_IGNORED: shift ${p.id} is at ${sides[0]?.location_id ?? "unknown"}, ` +
          `not the requested ${locationId} — the location filter was not applied`
      )
    }
    if (!sides.some((d) => { const t = new Date(d.start_at).getTime(); return t >= lower && t < upper })) {
      throw new Error(
        `SQUARE_SCHEDULE_FILTER_IGNORED: shift ${p.id} starts ${sides[0]?.start_at ?? "unknown"}, ` +
          `outside the requested ${window.startDate}..${window.endDate} — the date filter was not applied`
      )
    }
  }
}

/// THE GUARDED UPSERT — writeTimecards' shape, unchanged in every respect that
/// matters, because the argument for it is the same one.
///
/// One INSERT ... ON CONFLICT ... DO UPDATE ... WHERE, never check-then-act:
/// ON CONFLICT takes the row lock, so a second writer blocks and re-evaluates
/// against the COMMITTED value. P2002 becomes structurally impossible.
///
/// THE GUARD IS SQUARE'S `version`. Observed 462/462, monotonic, 1…17 in the
/// sample. `<=` rather than `<` so an equal version refreshes syncedAt instead
/// of leaving a row looking older than the sync that just confirmed it.
///
/// RE-RUNNING A WINDOW IS SAFE BY CONSTRUCTION — the window is a filter, not a
/// delete. And unlike the timecard mirror there is NO stale-row problem here:
/// Square tombstones scheduled shifts via is_deleted rather than removing them,
/// so a deleted shift arrives as a row with the flag set and is filtered on read.
async function writeScheduledShifts(
  org: Organization,
  store: Store,
  payloads: ScheduledShiftPayload[],
  syncedAt: Date
): Promise<number> {
  if (payloads.length === 0) return 0

  // De-duplicated because ON CONFLICT rejects a batch touching one row twice,
  // and sorted so every writer takes its row locks in the same order. BOTH
  // MATTER MORE HERE THAN THEY DID FOR TIMECARDS: S1b measured Square returning
  // the same shift on two pages of one sweep, so duplicates are observed, not
  // hypothetical.
  const byId = new Map<string, ScheduledShiftPayload>()
  for (const p of payloads) byId.set(p.id, p)
  const ordered = [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  const values = ordered.map((p) => {
    const d = p.draft_shift_details
    const pub = p.published_shift_details ?? null
    const eff = effectiveShiftOf(p)
    const fallback = new Date(d.start_at)
    return Prisma.sql`(${randomUUID()}, ${org.id}, ${store.id}, ${p.id}, ${p.version ?? 0},
      ${p.created_at ? new Date(p.created_at) : fallback},
      ${p.updated_at ? new Date(p.updated_at) : fallback},
      ${d.location_id}, ${d.job_id}, ${new Date(d.start_at)}, ${new Date(d.end_at)},
      ${d.timezone}, ${d.is_deleted}, ${d.team_member_id ?? null}, ${d.notes ?? null},
      ${pub?.location_id ?? null}, ${pub?.job_id ?? null},
      ${pub ? new Date(pub.start_at) : null}, ${pub ? new Date(pub.end_at) : null},
      ${pub?.timezone ?? null}, ${pub ? pub.is_deleted : null},
      ${pub?.team_member_id ?? null}, ${pub?.notes ?? null},
      ${eff.location_id}, ${eff.job_id}, ${new Date(eff.start_at)}, ${new Date(eff.end_at)},
      ${eff.timezone}, ${eff.is_deleted}, ${eff.team_member_id ?? null}, ${eff.source},
      ${syncedAt}, ${syncedAt})`
  })

  // `new Date(rfc3339WithOffset)` is the whole UTC story. Square sends start_at
  // and end_at ALREADY SHIFTED TO THE LOCATION'S OFFSET ("…T14:00:00-07:00",
  // never Z); Date parses the offset and yields the correct UTC instant, which
  // is what TIMESTAMP(3) stores. created_at/updated_at ARE Z. Both conventions
  // are S1b-measured and both are handled the same way. See CLAUDE.md § "A
  // DATABASE TIMESTAMP IS UTC".
  const won = await prisma.$queryRaw<{ id: string }[]>`
    INSERT INTO "SquareScheduledShift" (
      "id", "organizationId", "storeId", "squareScheduledShiftId", "squareVersion",
      "squareCreatedAt", "squareUpdatedAt",
      "draftLocationId", "draftJobId", "draftStartAt", "draftEndAt",
      "draftTimezone", "draftIsDeleted", "draftTeamMemberId", "draftNotes",
      "publishedLocationId", "publishedJobId", "publishedStartAt", "publishedEndAt",
      "publishedTimezone", "publishedIsDeleted", "publishedTeamMemberId", "publishedNotes",
      "effectiveLocationId", "effectiveJobId", "effectiveStartAt", "effectiveEndAt",
      "effectiveTimezone", "effectiveIsDeleted", "effectiveTeamMemberId", "effectiveSource",
      "syncedAt", "updatedAt"
    )
    VALUES ${Prisma.join(values)}
    ON CONFLICT ("organizationId", "squareScheduledShiftId") DO UPDATE SET
      "storeId"               = EXCLUDED."storeId",
      "squareVersion"         = EXCLUDED."squareVersion",
      "squareCreatedAt"       = EXCLUDED."squareCreatedAt",
      "squareUpdatedAt"       = EXCLUDED."squareUpdatedAt",
      "draftLocationId"       = EXCLUDED."draftLocationId",
      "draftJobId"            = EXCLUDED."draftJobId",
      "draftStartAt"          = EXCLUDED."draftStartAt",
      "draftEndAt"            = EXCLUDED."draftEndAt",
      "draftTimezone"         = EXCLUDED."draftTimezone",
      "draftIsDeleted"        = EXCLUDED."draftIsDeleted",
      "draftTeamMemberId"     = EXCLUDED."draftTeamMemberId",
      "draftNotes"            = EXCLUDED."draftNotes",
      "publishedLocationId"   = EXCLUDED."publishedLocationId",
      "publishedJobId"        = EXCLUDED."publishedJobId",
      "publishedStartAt"      = EXCLUDED."publishedStartAt",
      "publishedEndAt"        = EXCLUDED."publishedEndAt",
      "publishedTimezone"     = EXCLUDED."publishedTimezone",
      "publishedIsDeleted"    = EXCLUDED."publishedIsDeleted",
      "publishedTeamMemberId" = EXCLUDED."publishedTeamMemberId",
      "publishedNotes"        = EXCLUDED."publishedNotes",
      "effectiveLocationId"   = EXCLUDED."effectiveLocationId",
      "effectiveJobId"        = EXCLUDED."effectiveJobId",
      "effectiveStartAt"      = EXCLUDED."effectiveStartAt",
      "effectiveEndAt"        = EXCLUDED."effectiveEndAt",
      "effectiveTimezone"     = EXCLUDED."effectiveTimezone",
      "effectiveIsDeleted"    = EXCLUDED."effectiveIsDeleted",
      "effectiveTeamMemberId" = EXCLUDED."effectiveTeamMemberId",
      "effectiveSource"       = EXCLUDED."effectiveSource",
      "syncedAt"              = EXCLUDED."syncedAt",
      "updatedAt"             = EXCLUDED."updatedAt"
    WHERE "SquareScheduledShift"."squareVersion" <= EXCLUDED."squareVersion"
    RETURNING "id"
  `

  const discarded = ordered.length - won.length
  if (discarded > 0) {
    // The SUCCESS log, not an error log — BUG-7's corollary: the direct proof of
    // a guard is the line it emits when it WORKS. A count, never a rate; winners
    // emit nothing, so the denominator is invisible by construction.
    console.log(
      `[labor-schedule] store=${store.id} discarded ${discarded} superseded by a newer Square version`
    )
  }
  return won.length
}

// ─── SYNC STATE ───────────────────────────────────────────────────────────────
// Cloned from labor-actuals' three writers with the semantics preserved exactly.
// The clone is deliberate: the two syncs fail independently and one lastError
// column cannot hold two sentences.

async function recordSyncStarted(
  organizationId: string,
  storeId: string,
  at: Date,
  startDate: string,
  endDate: string
) {
  await prisma.squareScheduleSyncState.upsert({
    where: { storeId },
    create: {
      organizationId,
      storeId,
      lastSyncStartedAt: at,
      lastWindowStart: dbDate(startDate),
      lastWindowEnd: dbDate(endDate),
    },
    update: {
      lastSyncStartedAt: at,
      lastWindowStart: dbDate(startDate),
      lastWindowEnd: dbDate(endDate),
    },
  })
}

/// Clears lastError on success — a store that failed yesterday and succeeded
/// today is healthy.
///
/// A ZERO shiftCount HERE IS A REAL ANSWER, not a missing one: lastSyncOkAt set
/// with zero shifts is "we asked, and Square said nothing", which is the only
/// way that state is distinguishable from "never synced" (S1b § 4).
async function recordSyncOk(storeId: string, at: Date, shiftCount: number) {
  await prisma.squareScheduleSyncState.update({
    where: { storeId },
    data: { lastSyncOkAt: at, lastShiftCount: shiftCount, lastError: null },
  })
}

/// lastSyncOkAt is deliberately NOT touched. A failure makes the data OLDER, not
/// absent, and seam (c)'s badge wants to say when it was last true.
async function recordSyncError(storeId: string, message: string) {
  await prisma.squareScheduleSyncState
    .update({ where: { storeId }, data: { lastError: message.slice(0, 500) } })
    .catch(() => {
      console.error(`[labor-schedule] store=${storeId}: could not record sync error`)
    })
}

// ─── THE READ FOR S3 ──────────────────────────────────────────────────────────

/// One hour of the store-local day. COUNTS, NEVER PEOPLE AND NEVER MONEY — the
/// overlay is STORE-visible.
export type ScheduledCoveragePoint = {
  hour: number
  /// Shifts on the floor this hour, ALL jobs. Counts SHIFTS, not distinct team
  /// members: 12 of 462 observed shifts are unassigned open shifts, and a member
  /// -based count would erase them from the plan they are part of.
  scheduled: number
  /// The same count split by Square job id, so S3 can stack the curve by
  /// position. Only jobs with a shift this hour appear.
  byJobId: Record<string, number>
}

export type ScheduledCoverageResult = {
  date: string
  /// Always 24 entries, hour 0…23 — the shape computeDailyCoverage already
  /// produces, so S3 can lay one over the other without re-bucketing.
  points: ScheduledCoveragePoint[]
  /// Every job id appearing on the day, for the legend. Titles are NOT here:
  /// the shift payload has no title (S1b § 3) and the mapping is S3's problem.
  jobIds: string[]
  shiftCount: number
  /// How many of the day's shifts came from a DRAFT rather than a published
  /// shift. The legend has to be able to say "this is the manager's draft".
  draftSourcedCount: number
}

/// The row shape the calculation needs. NOTE WHAT IS ABSENT: no notes, and no
/// column that could carry one. The ruling is enforced by not selecting them.
export type ScheduledCoverageRow = {
  effectiveJobId: string
  effectiveStartAt: Date
  effectiveEndAt: Date
  effectiveSource: string
}

/// PURE — no DB, no network, injected timezone. Buckets shifts into the 24 hours
/// of ONE store-local day.
///
/// A shift occupies every hour it OVERLAPS, clamped to the day, so an overnight
/// shift contributes its evening hours to one date and its morning hours to the
/// next rather than being attributed whole to either. Store-local throughout,
/// because the denominator it will be laid over — SalesHourlyCache — is
/// store-local, and dividing two different notions of "an hour" by each other is
/// the trap this repo keeps filing.
export function computeScheduledCoverage({
  rows,
  date,
  timeZone,
}: {
  rows: ScheduledCoverageRow[]
  date: string
  timeZone: string
}): ScheduledCoverageResult {
  const dayStart = localMidnightUtc(date, timeZone).getTime()
  const dayEnd = localMidnightUtc(addDaysStr(date, 1), timeZone).getTime()

  const points: ScheduledCoveragePoint[] = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    scheduled: 0,
    byJobId: {},
  }))
  const jobIds = new Set<string>()
  let shiftCount = 0
  let draftSourcedCount = 0

  for (const r of rows) {
    const start = r.effectiveStartAt.getTime()
    const end = r.effectiveEndAt.getTime()
    if (!(start < dayEnd && end > dayStart)) continue

    // Clamp to the day, then walk the hours the clamped span touches. The end is
    // EXCLUSIVE: a shift ending at 15:00 is not on the floor during hour 15.
    const from = Math.max(start, dayStart)
    const to = Math.min(end, dayEnd)
    const firstHour = localHourOf(new Date(from), timeZone)
    // `to - 1` so an end landing exactly on an hour boundary belongs to the hour
    // before it. A zero-length shift is skipped by the overlap test above.
    const lastHour = localHourOf(new Date(to - 1), timeZone)

    shiftCount++
    if (r.effectiveSource === "draft") draftSourcedCount++
    jobIds.add(r.effectiveJobId)

    for (let h = firstHour; h <= lastHour; h++) {
      const p = points[h]
      p.scheduled++
      p.byJobId[r.effectiveJobId] = (p.byJobId[r.effectiveJobId] ?? 0) + 1
    }
  }

  return { date, points, jobIds: [...jobIds].sort(), shiftCount, draftSourcedCount }
}

/// The overlay's read path for S3. NO SQUARE CALL — pure calculation over rows
/// the sync already mirrored, so a card render never waits on an integration.
///
/// TOMBSTONES ARE FILTERED HERE (Gary, 2026-08-20): Square deletes by setting
/// is_deleted, the flag is synced, and the read is where it stops mattering.
///
/// THE `select` IS THE NOTES RULING. draftNotes and publishedNotes exist on the
/// table and are deliberately absent from this list. Not filtered afterwards —
/// NOT FETCHED, so no payload, props tree or future JSON route can carry them by
/// forgetting to re-check. Observed live notes already contain a person's name
/// and this data reaches a STORE-visible surface.
export async function getScheduledCoverage(
  storeId: string,
  dateStr: string
): Promise<ScheduledCoverageResult | null> {
  const store = await prisma.store.findUnique({ where: { id: storeId }, select: { timezone: true } })
  if (!store) return null

  const dayStart = localMidnightUtc(dateStr, store.timezone)
  const dayEnd = localMidnightUtc(addDaysStr(dateStr, 1), store.timezone)

  const rows = await prisma.squareScheduledShift.findMany({
    where: {
      storeId,
      effectiveIsDeleted: false,
      effectiveStartAt: { lt: dayEnd },
      effectiveEndAt: { gt: dayStart },
    },
    select: {
      effectiveJobId: true,
      effectiveStartAt: true,
      effectiveEndAt: true,
      effectiveSource: true,
    },
  })

  return computeScheduledCoverage({ rows, date: dateStr, timeZone: store.timezone })
}

// ─── DATE HELPERS ─────────────────────────────────────────────────────────────
// Local copies, so this module imports nothing from a core labor engine — the
// same argument labor-actuals.ts makes for its own localMidnightUtc, and the
// precedent this file follows.
//
// EXPORTED SINCE OVL-S5, AND THE SENTENCE ABOVE IS WHY THAT IS NOT A REVERSAL.
// The reason for the copy is the IMPORT DIRECTION — never reaching into
// labor-plan/coverage/budget/forecast/daily/week — not secrecy. labor-inspector.ts
// is already on this side of the wall and already imports this module, so a
// THIRD private copy would have added a drift risk to buy nothing: three
// definitions of store-local midnight, any one of which could be "simplified"
// without the other two noticing. Exporting keeps the count at two (here and
// labor-actuals.ts) and the wall exactly where it was.

/// The UTC instant of store-local midnight on a yyyy-mm-dd.
export function localMidnightUtc(dateStr: string, timeZone: string): Date {
  const guess = new Date(`${dateStr}T00:00:00.000Z`)
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
  const p = Object.fromEntries(dtf.formatToParts(guess).map((x) => [x.type, x.value]))
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour) % 24,
    Number(p.minute),
    Number(p.second)
  )
  return new Date(guess.getTime() - (asUtc - guess.getTime()))
}

/// Wall-clock hour of a UTC instant in a target zone. sales-sync.ts's private
/// localParts, narrowed to the half this module needs — a private copy per the
/// labor-actuals precedent rather than an export that would put a core module on
/// the wrong side of the import wall.
export function localHourOf(instant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-CA", { timeZone, hour: "2-digit", hourCycle: "h23" })
  const p = Object.fromEntries(dtf.formatToParts(instant).map((x) => [x.type, x.value]))
  return Number(p.hour)
}

/// Calendar arithmetic on UTC midnights, safe because both ends are date
/// STRINGS, not instants.
export function addDaysStr(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function daysInclusive(startDate: string, endDate: string): number {
  const ms = Date.parse(`${endDate}T00:00:00.000Z`) - Date.parse(`${startDate}T00:00:00.000Z`)
  return Math.max(1, Math.round(ms / 86400000) + 1)
}

// ─── OVL-S3: THE CLOCKED-IN CURVE ─────────────────────────────────────────────
//
// The overlay's ACTUAL half. Scheduled staffing is the plan; this is what
// happened, derived from the timecards the AL-1 sync already mirrors.
//
// WHY IT LIVES HERE AND NOT IN labor-actuals.ts (Gary, D4, 2026-08-20). It is
// overlay code — the only caller is the overlay endpoint, its output shape
// mirrors ScheduledCoveragePoint exactly so the card can draw both with one
// component, and keeping the pair together is what stops the two curves being
// bucketed by two different notions of an hour. The cost is the import below,
// and that import's DIRECTION is what makes it safe: labor-actuals never
// imports schedule-side, so no cycle exists and the seam-(b) wall — which names
// labor-plan/coverage/budget/forecast/daily/week, not labor-actuals — is
// untouched.
//
// "CLOCKED IN", NOT "WORKED", AND THE LABEL IS THE RULING (Gary, 2026-08-20).
// Breaks are IGNORED here: a person on an unpaid break is still on the clock in
// Square's data and this curve counts heads on the premises, not compensable
// minutes. paidMinutesOf's break subtraction is deliberately NOT applied — it
// answers the cost question, which is a different question. What IS reused is
// its open-card ceiling (clockedEndMs) and its does-this-row-count test, so the
// two calculations cannot disagree about which rows are real.

/// One hour of the store-local day. COUNTS, NEVER PEOPLE AND NEVER MONEY — the
/// same contract ScheduledCoveragePoint carries, and for the same reason: this
/// reaches a STORE-visible surface.
export type ClockedInCoveragePoint = {
  hour: number
  /// Timecards open on the floor this hour, all jobs. Counts TIMECARDS, not
  /// distinct people — the same choice computeScheduledCoverage makes for
  /// shifts, so the two curves are commensurable. A person clocked in twice in
  /// one hour is a data question, not a reason for the two halves of one chart
  /// to count differently.
  clockedIn: number
  /// Split by Square job id, so the overlay colours the actual curve with the
  /// same palette as the scheduled one. Timecards whose wageJobId is null land
  /// under UNKNOWN_JOB_ID.
  byJobId: Record<string, number>
}

export type ClockedInCoverageResult = {
  date: string
  /// Always 24 entries, hour 0…23 — ScheduledCoverageResult's shape exactly.
  points: ClockedInCoveragePoint[]
  jobIds: string[]
  timecardCount: number
  /// Cards still open at the ceiling. The legend says so: an open card's hours
  /// are real up to now and unknown after, and a curve that ends at the current
  /// hour should not read as "everybody went home".
  openCount: number
}

/// The bucket a timecard with no wageJobId falls into. Square carries a rate
/// without a job on some team members, and dropping those rows would understate
/// the floor — the person was there. A SENTINEL rather than null so the colour
/// map, the legend and the byJobId record all have one key to agree on.
export const UNKNOWN_JOB_ID = "__unknown__"

/// The row shape the calculation needs. NOTE WHAT IS ABSENT, exactly as in
/// ScheduledCoverageRow: no wage, no rate, no team-member id. The ruling is
/// enforced by not selecting them (see getClockedInCoverage).
export type ClockedInCoverageRow = {
  startAt: Date
  endAt: Date | null
  breakUnpaidMinutes: number
  wageJobId: string | null
}

/// PURE — no DB, no network, injected timezone and injected clock. Buckets
/// timecards into the 24 hours of ONE store-local day.
///
/// THE CEILING IS THE WHOLE POINT. An OPEN timecard occupies hours up to the
/// current hour and NEVER BEYOND: `ceilingMs` is the earlier of `now` and the
/// day's end, so today's curve stops where the day has actually got to and a
/// card left open on a PAST day is clamped to that day rather than running to
/// now. Without it an open card would paint a full floor through midnight and
/// the actual curve would claim staffing that has not happened.
///
/// Hour occupancy follows computeScheduledCoverage's convention exactly — the
/// end is EXCLUSIVE, so a card ending at 15:00 is not on the floor during hour
/// 15 — because two curves on one axis that disagreed about the boundary would
/// be a difference the reader would attribute to the store.
export function computeClockedInCoverage({
  rows,
  date,
  timeZone,
  now,
}: {
  rows: ClockedInCoverageRow[]
  date: string
  timeZone: string
  now: Date
}): ClockedInCoverageResult {
  const dayStart = localMidnightUtc(date, timeZone).getTime()
  const dayEnd = localMidnightUtc(addDaysStr(date, 1), timeZone).getTime()
  const ceilingMs = Math.min(now.getTime(), dayEnd)

  const points: ClockedInCoveragePoint[] = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    clockedIn: 0,
    byJobId: {},
  }))
  const jobIds = new Set<string>()
  let timecardCount = 0
  let openCount = 0

  for (const r of rows) {
    // The SAME does-this-row-count test the cost calculation uses. A clock-skewed
    // or zero-length row is dropped by both or by neither.
    if (paidMinutesOf(r, ceilingMs) === null) continue

    const start = r.startAt.getTime()
    const end = clockedEndMs(r, ceilingMs)
    if (!(start < dayEnd && end > dayStart)) continue

    const from = Math.max(start, dayStart)
    const to = Math.min(end, dayEnd)
    // A row clamped to nothing (an open card on a day that has not started here)
    // contributes no hour at all.
    if (to <= from) continue

    const firstHour = localHourOf(new Date(from), timeZone)
    // `to - 1` so an end landing exactly on an hour boundary belongs to the hour
    // before it — computeScheduledCoverage's rule, restated so the two agree.
    const lastHour = localHourOf(new Date(to - 1), timeZone)

    const jobId = r.wageJobId ?? UNKNOWN_JOB_ID
    timecardCount++
    if (r.endAt === null) openCount++
    jobIds.add(jobId)

    for (let h = firstHour; h <= lastHour; h++) {
      const p = points[h]
      p.clockedIn++
      p.byJobId[jobId] = (p.byJobId[jobId] ?? 0) + 1
    }
  }

  return { date, points, jobIds: [...jobIds].sort(), timecardCount, openCount }
}

/// The clocked-in read path. NO SQUARE CALL — pure calculation over timecards
/// the AL-1 sync already mirrored.
///
/// THE `select` IS THE COUNTS-ONLY RULING, the same way getScheduledCoverage's
/// select is the notes ruling. wageHourlyRate, declaredCashTips and
/// squareTeamMemberId all exist on this table and are deliberately absent: the
/// overlay is STORE-visible, STORE accounts are shared iPad logins, and a payload
/// that never carries a wage cannot leak one by a later caller forgetting to
/// re-check. NOT FILTERED AFTERWARDS — NOT FETCHED.
export async function getClockedInCoverage(
  storeId: string,
  dateStr: string,
  now = new Date()
): Promise<ClockedInCoverageResult | null> {
  const store = await prisma.store.findUnique({ where: { id: storeId }, select: { timezone: true } })
  if (!store) return null

  const dayStart = localMidnightUtc(dateStr, store.timezone)
  const dayEnd = localMidnightUtc(addDaysStr(dateStr, 1), store.timezone)

  // An OPEN card starting before this day is still on the floor during it, so the
  // window cannot be `startAt >= dayStart`. Bounding the lookback at one day keeps
  // the query indexed; a card open longer than 24h is a data problem, not a shift.
  const rows = await prisma.squareTimecard.findMany({
    where: {
      storeId,
      startAt: { gte: new Date(dayStart.getTime() - 24 * 60 * 60 * 1000), lt: dayEnd },
      OR: [{ endAt: null }, { endAt: { gt: dayStart } }],
    },
    select: { startAt: true, endAt: true, breakUnpaidMinutes: true, wageJobId: true },
  })

  return computeClockedInCoverage({ rows, date: dateStr, timeZone: store.timezone, now })
}

// ─── OVL-S3: SYNC STATE, JOB TITLES AND COLOURS ───────────────────────────────

/// Seam (c)'s threshold, and it MATCHES ITS SIBLING ON PURPOSE (Gary, D5,
/// 2026-08-20). labor-actuals uses 26h for the timecard sync; two labor syncs
/// that went stale at different ages would put two differently-worded staleness
/// warnings on one card for the same outage.
export const SCHEDULE_STALE_AFTER_MINUTES = 26 * 60

/// The four states the card must tell apart, plus the one seam (c) invented.
///
///   never         — no successful sync has ever run. Render NOTHING: no overlay,
///                   no toggle, no empty chart pretending the schedule is blank.
///   synced-empty  — we asked and Square said nothing. HONEST ZERO, and it is the
///                   state eight of eighteen live locations are in mid-rollout.
///                   Also renders forecasted-only, but it is a different fact and
///                   the card says so.
///   fresh / stale / error — we have data. Stale and error still RENDER IT, with
///                   a last-synced stamp. Seam (c): last-synced data labelled
///                   stale, never a blank pretending "no schedule".
export type ScheduleSyncHealth = "never" | "synced-empty" | "fresh" | "stale" | "error"

export type ScheduleSyncSummary = {
  health: ScheduleSyncHealth
  lastSyncOkAt: string | null
  /// Shifts the last successful sync wrote across its whole window — NOT the
  /// count for the viewed day. It is what distinguishes synced-empty from
  /// synced-with-data, and a day with no shifts inside a healthy window is a
  /// quiet day rather than a broken integration.
  lastShiftCount: number
}

/// Reads SquareScheduleSyncState and reduces it to what the legend needs.
///
/// HEALTH IS ABOUT THE ATTEMPT, NOT THE ROWS — computeHealth's argument, reused
/// rather than restated. The one state it cannot express is synced-empty, because
/// that is a fact about the ROW COUNT and computeHealth deliberately never looks
/// at rows; so it is layered on top, after a healthy verdict, exactly where the
/// schema comment says the distinction lives.
export async function getScheduleSyncSummary(
  storeId: string,
  now = new Date()
): Promise<ScheduleSyncSummary> {
  const state = await prisma.squareScheduleSyncState.findUnique({
    where: { storeId },
    select: { lastSyncOkAt: true, lastError: true, lastShiftCount: true },
  })

  const health = computeHealth(state, now, SCHEDULE_STALE_AFTER_MINUTES)
  if (health === "never") {
    return { health: "never", lastSyncOkAt: null, lastShiftCount: 0 }
  }
  return {
    health: health === "fresh" && (state?.lastShiftCount ?? 0) === 0 ? "synced-empty" : health,
    lastSyncOkAt: state?.lastSyncOkAt?.toISOString() ?? null,
    lastShiftCount: state?.lastShiftCount ?? 0,
  }
}

export type OverlayJob = {
  jobId: string
  /// Null renders as "Unnamed position" (Gary, D6). Square exposes no job
  /// catalogue — GET /v2/labor/jobs 404s and the shift payload carries no title
  /// (S1b § 3) — so a job that is SCHEDULED but never WORKED has no timecard to
  /// borrow a title from and cannot be given one. It keeps its colour and stays
  /// editable in settings; only the name is missing.
  title: string | null
  colorKey: BadgePresetKey
  /// Resolved here rather than in the card so the stroke and the legend chip
  /// cannot be chosen from two different keys.
  hex: string
}

/// Titles for a set of Square job ids, from the timecards standing beside them.
///
/// THE SOURCE IS SquareTimecard.wageTitle (schema.prisma, SquareJobColor's own
/// doc-comment). It is the only place in the estate where a job id sits next to a
/// human-readable name. SELECTS TWO COLUMNS — the id and the title — because the
/// row it reads also carries wages, and this function's output reaches a
/// STORE-visible payload.
export async function resolveJobTitles(
  organizationId: string,
  jobIds: string[]
): Promise<Map<string, string>> {
  if (jobIds.length === 0) return new Map()
  const rows = await prisma.squareTimecard.findMany({
    where: { organizationId, wageJobId: { in: jobIds }, wageTitle: { not: null } },
    select: { wageJobId: true, wageTitle: true },
    distinct: ["wageJobId"],
    orderBy: { squareUpdatedAt: "desc" },
  })
  const out = new Map<string, string>()
  for (const r of rows) if (r.wageJobId && r.wageTitle) out.set(r.wageJobId, r.wageTitle)
  return out
}

/// The legend's jobs: colour (override, else deterministic default) plus title.
///
/// A ROW IN SquareJobColor IS AN OVERRIDE AND ITS ABSENCE IS NOT MISSING DATA —
/// deterministicJobColor gives every id a stable colour, so the overlay is fully
/// coloured with the table empty. badgePreset() degrades an unrecognised stored
/// key to neutral rather than throwing, which is what makes a hand-edited row
/// survivable.
export async function getOverlayJobs(
  organizationId: string,
  jobIds: string[]
): Promise<OverlayJob[]> {
  if (jobIds.length === 0) return []

  const [overrides, titles] = await Promise.all([
    prisma.squareJobColor.findMany({
      where: { organizationId, squareJobId: { in: jobIds } },
      select: { squareJobId: true, colorKey: true },
    }),
    resolveJobTitles(organizationId, jobIds.filter((id) => id !== UNKNOWN_JOB_ID)),
  ])
  const overrideOf = new Map(overrides.map((o) => [o.squareJobId, o.colorKey]))

  return jobIds.map((jobId) => {
    const stored = overrideOf.get(jobId)
    const colorKey: BadgePresetKey = isBadgePresetKey(stored) ? stored : deterministicJobColor(jobId)
    return {
      jobId,
      title: jobId === UNKNOWN_JOB_ID ? null : titles.get(jobId) ?? null,
      colorKey,
      hex: BADGE_PRESETS[colorKey].hex,
    }
  })
}

// ─── OVL-S4: THE CLOCKED-IN ROSTER ────────────────────────────────────────────
//
// WHO IS ON THE FLOOR RIGHT NOW — three structured person-level fields on a
// STORE-visible surface, and that is a DELIBERATE NARROWING of the S1b
// person-data principle rather than an oversight (Gary, 2026-08-20): who is
// standing in the room is the same information as looking around the room.
//
// WHAT THE NARROWING DOES NOT COVER, and every line below is written to keep it
// that way. NEVER wages, rates or tips — wageHourlyRate, wageTipEligible and
// declaredCashTips sit on the very row this reads and are not selected. NEVER
// notes; the S1b ruling is untouched and free text still never ships. NEVER the
// Square team-member id, which is read to JOIN and never emitted (its own
// schema doc-comment: "this column NEVER leaves the server"). And NOW ONLY —
// there is no date parameter, because a historical roster is a different
// feature with a different ruling.
//
// NAMES LOAD ON CLICK ONLY. Nothing here is reachable from /api/labor/coverage;
// it is a separate endpoint hit when the popup opens, so the card's default
// payload carries no name under any code path.

/// The row shape the assembly needs. `breakUnpaidMinutes` is here ONLY to feed
/// paidMinutesOf's does-this-row-count test — it is never emitted.
export type ClockedInRosterRow = {
  squareTeamMemberId: string
  startAt: Date
  wageTitle: string | null
  breakUnpaidMinutes: number
}

/// THE WHOLE PAYLOAD, AND IT IS THESE THREE FIELDS. Adding a fourth is a ruling,
/// not a refactor.
export type ClockedInRosterEntry = {
  /// Resolved SERVER-SIDE, so an unmatched member ships the word "Unnamed"
  /// rather than a null the client fills in — which is also what keeps the
  /// Square id off the wire entirely.
  name: string
  /// Square's wage.title for the timecard they are on. Null where Square never
  /// recorded one; the card renders that as "No position recorded", the same
  /// wording the legend already uses.
  title: string | null
  /// STORE-LOCAL WALL CLOCK, pre-formatted (Gary, ratified 2026-08-20). The
  /// timezone lives on the server and the conversion happens where the answer
  /// is known — a bare instant plus a timezone field would be one more chance
  /// for a surface to render a UTC hour and call it 9am.
  clockInAt: string
}

/// "9:42a" — the card's own hourLabel convention, carried down to the minute so
/// the popup reads like the axis above it rather than like a log line.
export function formatClockInLabel(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(instant)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ""
  return `${get("hour")}:${get("minute")}${get("dayPeriod").toLowerCase().startsWith("a") ? "a" : "p"}`
}

/// BUG-10 — THE DATE QUALIFIER. A card that started before the store-local
/// today reads "2:55p yesterday" instead of a bare "2:55p".
///
/// WHY THIS EXISTS: two Aug-19 cards at Las Brisas were left open, clocked out
/// in Square at ≈9:55p — AFTER that day's final sync at 9:29p — and so stayed
/// open in Froot forever, because the dashboard sync asks for TODAY only and
/// nothing revisited a prior day. The popup drew both as "on the floor now" with
/// time-only labels, indistinguishable from a card opened this morning. The
/// qualifier is what makes a stale open self-evident at a glance.
///
/// DISPLAY ONLY, AND IT CHANGES NEITHER QUERY (Gary, 2026-08-20). The 24h
/// lookback STAYS on both reads — an open card from yesterday that is genuinely
/// still on the floor must render, and CRON-1's reconcile is what now closes the
/// genuinely-closed ones. This function cannot tell those two apart and does not
/// try: it reports WHEN the card started and lets the reader judge.
///
/// THE QUALIFIER FOLDS INTO clockInAt RATHER THAN BECOMING A FOURTH FIELD. The
/// S4 person-data ruling fixes this payload at exactly three fields and a
/// fixture asserts the sorted key list; a `startedBefore` boolean would breach
/// both for a string the client would only concatenate anyway.
///
/// formatClockInLabel IS LEFT ALONE and wrapped rather than modified — it has
/// its own contract and its own fixture, and the qualifier is a different
/// question (WHICH DAY) from the one it answers (WHAT TIME).
///
/// The older-than-yesterday branch is unreachable through getClockedInRoster's
/// 24h window, where the earliest possible start is yesterday 00:00 store-local.
/// It is built anyway because this function is pure and takes whatever row it is
/// given: a widened window later must not silently start printing a bare "2:55p"
/// for a card three days old.
export function clockInLabelFor(startAt: Date, now: Date, timeZone: string): string {
  const time = formatClockInLabel(startAt, timeZone)
  const today = localDateStr(now, timeZone)
  const started = localDateStr(startAt, timeZone)

  if (started === today) return time
  if (started === addDaysStr(today, -1)) return `${time} yesterday`

  // "2:55p Aug 19" — ONE PREFIX, ONE SHAPE (ratified 2026-08-20). The client
  // renders a fixed " · in " before this string, so a "since Aug 19" form would
  // read "in since Aug 19".
  const [y, m, d] = started.split("-").map(Number)
  const month = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })
  return `${time} ${month} ${d}`
}

/// PURE — no DB, no network, injected timezone and injected clock.
///
/// THE DROP TEST IS paidMinutesOf's, NOT A NEW ONE. The button that opens this
/// popup says "N on floor", and N is openTimecardCount from
/// computeClockedInCoverage. A button reading 3 that opens a list of 2 is a
/// defect, so both sides discard a row on exactly the same condition — a
/// clock-skewed card that has not started yet is dropped by both or by neither.
export function assembleClockedInRoster({
  rows,
  namesBySquareId,
  timeZone,
  now,
}: {
  rows: ClockedInRosterRow[]
  namesBySquareId: Map<string, string>
  timeZone: string
  now: Date
}): ClockedInRosterEntry[] {
  const ceilingMs = now.getTime()

  const kept = rows.filter(
    (r) => paidMinutesOf({ startAt: r.startAt, endAt: null, breakUnpaidMinutes: r.breakUnpaidMinutes }, ceilingMs) !== null
  )

  // Longest on the floor first — the reader's question is usually "who is due a
  // break", and clock-in order answers it. Name breaks the tie so two people who
  // clocked in the same minute do not swap places between renders.
  kept.sort((a, b) => {
    const d = a.startAt.getTime() - b.startAt.getTime()
    if (d !== 0) return d
    return nameOf(a, namesBySquareId).localeCompare(nameOf(b, namesBySquareId))
  })

  return kept.map((r) => ({
    name: nameOf(r, namesBySquareId),
    title: r.wageTitle,
    clockInAt: clockInLabelFor(r.startAt, now, timeZone),
  }))
}

/// An unmatched — or blank-named — member is "Unnamed" (the D6 posture: a real
/// state, not a gap to be filled). A Square team member with no StaffMember row
/// is a normal mid-import condition, and erasing them from the roster would
/// understate the floor.
function nameOf(row: ClockedInRosterRow, namesBySquareId: Map<string, string>): string {
  const name = namesBySquareId.get(row.squareTeamMemberId)?.trim()
  return name ? name : "Unnamed"
}

/// The roster read path. NO SQUARE CALL — mirrored rows only, exactly like the
/// two coverage reads above it.
///
/// THE `select` IS THE RULING, the same way getClockedInCoverage's select is.
/// wageHourlyRate, wageTipEligible and declaredCashTips are on this row and are
/// deliberately absent. NOT FILTERED AFTERWARDS — NOT FETCHED.
export async function getClockedInRoster(
  organizationId: string,
  storeId: string,
  now = new Date()
): Promise<ClockedInRosterEntry[] | null> {
  const store = await prisma.store.findUnique({ where: { id: storeId }, select: { timezone: true } })
  if (!store) return null

  const dateStr = localDateStr(now, store.timezone)
  const dayStart = localMidnightUtc(dateStr, store.timezone)
  const dayEnd = localMidnightUtc(addDaysStr(dateStr, 1), store.timezone)

  // THE SAME WINDOW getClockedInCoverage USES, narrowed to open cards. An open
  // card starting before today is still on the floor during it, so the lookback
  // cannot be `startAt >= dayStart`; bounding it at one day keeps the query
  // indexed and matches the curve's row set row for row.
  const rows = await prisma.squareTimecard.findMany({
    where: {
      storeId,
      endAt: null,
      startAt: { gte: new Date(dayStart.getTime() - 24 * 60 * 60 * 1000), lt: dayEnd },
    },
    select: { squareTeamMemberId: true, startAt: true, wageTitle: true, breakUnpaidMinutes: true },
  })
  if (rows.length === 0) return []

  // The join of record, per labor-roster.ts: StaffMember.squareTeamMemberId is
  // org-unique and displayName is the OPERATIONAL identity — the name a roster
  // shows. fullName is the LEGAL identity and belongs on signed documents, not
  // on a card an iPad in the back of house is logged into.
  const staff = await prisma.staffMember.findMany({
    where: { organizationId, squareTeamMemberId: { in: rows.map((r) => r.squareTeamMemberId) } },
    select: { displayName: true, squareTeamMemberId: true },
  })
  const namesBySquareId = new Map(
    staff.filter((s) => s.squareTeamMemberId).map((s) => [s.squareTeamMemberId!, s.displayName])
  )

  return assembleClockedInRoster({ rows, namesBySquareId, timeZone: store.timezone, now })
}

// ─── OVL-S4: SCHEDULED HOURS PER DAY ──────────────────────────────────────────
//
// The /labor comparison's scheduled half. DURATIONS, NOT HOUR BUCKETS, and the
// difference is the point: computeScheduledCoverage answers "how many people are
// on the floor during hour 14" and necessarily counts a 4h30 shift as occupying
// five hour slots. A comparison against a budget in hours has to sum the actual
// minutes, or a week of half-hour shifts would read as materially more scheduled
// labour than was scheduled.

/// The row shape the calculation needs. NOTE WHAT IS ABSENT — no notes column,
/// and no column that could carry one. Same ruling, same enforcement.
export type ScheduledHoursRow = {
  effectiveStartAt: Date
  effectiveEndAt: Date
  effectiveIsDeleted: boolean
}

/// PURE — no DB, no network, injected timezone. Sums effective shift durations
/// into store-local days.
///
/// AN OVERNIGHT SHIFT SPLITS. Each row contributes only the part of itself that
/// falls inside each day, so a 22:00–06:00 shift puts two hours on one date and
/// six on the next rather than eight on either. The day boundaries are
/// store-local for the reason this repo keeps re-filing: the number it will sit
/// beside — the suggested curve — is store-local, and comparing two different
/// notions of a day is the trap.
///
/// TOMBSTONES ARE FILTERED HERE AS WELL AS IN THE QUERY, and the redundancy is
/// deliberate (ratified 2026-08-20). getScheduledCoverage filters deletions in
/// its `where` alone, which means the rule is only ever exercised against a
/// database. Taking the flag on the row makes "a deleted shift is not scheduled
/// labour" a property the fixture can prove without one.
export function computeScheduledHoursByDay({
  rows,
  dates,
  timeZone,
}: {
  rows: ScheduledHoursRow[]
  dates: string[]
  timeZone: string
}): Record<string, number> {
  const live = rows.filter((r) => !r.effectiveIsDeleted)
  const out: Record<string, number> = {}

  for (const date of dates) {
    const dayStart = localMidnightUtc(date, timeZone).getTime()
    const dayEnd = localMidnightUtc(addDaysStr(date, 1), timeZone).getTime()

    let ms = 0
    for (const r of live) {
      const overlap =
        Math.min(r.effectiveEndAt.getTime(), dayEnd) - Math.max(r.effectiveStartAt.getTime(), dayStart)
      // A zero-length or non-overlapping shift contributes nothing rather than a
      // negative, which would quietly subtract from a neighbouring day's total.
      if (overlap > 0) ms += overlap
    }
    // Two decimals internally so a week of half-hours does not accumulate float
    // noise into the total the page prints.
    out[date] = Math.round((ms / 3600000) * 100) / 100
  }

  return out
}

/// The read path. NO SQUARE CALL — mirrored rows only, and the same four-column
/// discipline every other overlay read follows.
export async function getScheduledHoursByDay(
  storeId: string,
  dates: string[]
): Promise<Record<string, number> | null> {
  if (dates.length === 0) return {}
  const store = await prisma.store.findUnique({ where: { id: storeId }, select: { timezone: true } })
  if (!store) return null

  const sorted = [...dates].sort()
  const rangeStart = localMidnightUtc(sorted[0], store.timezone)
  const rangeEnd = localMidnightUtc(addDaysStr(sorted[sorted.length - 1], 1), store.timezone)

  const rows = await prisma.squareScheduledShift.findMany({
    where: {
      storeId,
      effectiveIsDeleted: false,
      effectiveStartAt: { lt: rangeEnd },
      effectiveEndAt: { gt: rangeStart },
    },
    select: { effectiveStartAt: true, effectiveEndAt: true, effectiveIsDeleted: true },
  })

  return computeScheduledHoursByDay({ rows, dates, timeZone: store.timezone })
}
