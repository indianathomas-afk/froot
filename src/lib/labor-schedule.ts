import { randomUUID } from "crypto"
import { Prisma } from "@prisma/client"
import type { Organization, Store } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { getSquareClient } from "@/lib/square"
import { dbDate } from "@/lib/reports"
import { BADGE_PRESET_KEYS, type BadgePresetKey } from "@/lib/badge-presets"

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
// Local copies, kept private so this module imports nothing from a core labor
// engine — the same argument labor-actuals.ts makes for its own localMidnightUtc,
// and the precedent this file follows.

/// The UTC instant of store-local midnight on a yyyy-mm-dd.
function localMidnightUtc(dateStr: string, timeZone: string): Date {
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
function localHourOf(instant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-CA", { timeZone, hour: "2-digit", hourCycle: "h23" })
  const p = Object.fromEntries(dtf.formatToParts(instant).map((x) => [x.type, x.value]))
  return Number(p.hour)
}

/// Calendar arithmetic on UTC midnights, safe because both ends are date
/// STRINGS, not instants.
function addDaysStr(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function daysInclusive(startDate: string, endDate: string): number {
  const ms = Date.parse(`${endDate}T00:00:00.000Z`) - Date.parse(`${startDate}T00:00:00.000Z`)
  return Math.max(1, Math.round(ms / 86400000) + 1)
}
