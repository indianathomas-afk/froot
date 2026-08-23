// STORE HOURS VALIDATION — THE EDITOR IS THE ONLY DEFENCE.
//
// Nothing populated StoreHours until 2026-08-23; every open window in the labor
// model came from inferOpenWindowsByWeekday. Gary began entering real hours and
// the editor accepted two impossible sets without comment: Mon-Fri as
// 08:00 to 08:00, and a Sunday opening at 01:00 on a campus store. Both saved
// silently, and the second is not cosmetic — the GM on-floor band's real default
// is `open.startHour -> 14:00` (DEBT-83, a hardcoded literal at
// labor-plan.ts:284), so a 01:00 open turns a Sunday band into thirteen hours at
// a store someone is 50% allocated to. A wrong open time lands in the forecast.
// These are Froot's own rows and a Square resync never overwrites them, so there
// is no second line of defence behind this one.
//
// DEPENDENCY-FREE ON PURPOSE, the same contract as labor-roster-hours.ts: this
// is imported into a client bundle, so it may never reach for prisma, the Square
// client, or anything else server-only. ONE function produces both lists and
// BOTH call sites use it — the dialog and PUT /api/stores/[id]/hours. A
// form-only check is not a check; BUG-11/BUG-12 are the precedent for the editor
// and the write path disagreeing.
//
// IT REPORTS, IT NEVER REWRITES. R7-C's shape: assert, raise a visible flag,
// never normalise. Do not auto-correct a time, do not swap AM/PM, do not infer
// intent. Inventing a value nobody typed is the failure mode this house has
// ruled against twice — LaborDaySplit's read-normalisation is the anti-pattern.

export type StoreHoursDay = {
  dayOfWeek: number
  openingTime: string | null
  closingTime: string | null
  isClosed: boolean
}

/// B* block the save. W* are advisory and MUST NEVER BLOCK — see the seasonal
/// ruling below. Codes are stable identifiers; `reason` is copy and will change.
export type StoreHoursIssueCode = "B1" | "B2" | "W1" | "W2" | "W3" | "W4"

export type StoreHoursIssue = {
  dayOfWeek: number
  /// Which box to point at. "day" means the issue is about the pair, not one side.
  field: "open" | "close" | "day"
  code: StoreHoursIssueCode
  /// Plain English, for a human staring at one row of a form.
  reason: string
}

export type StoreHoursValidation = {
  blocking: StoreHoursIssue[]
  warnings: StoreHoursIssue[]
}

/// 24-hour "HH:MM" — what <input type="time"> emits, what the route's zod
/// admits, and what labor-plan.ts's parseHourStart/parseHourEnd already read.
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

const MINUTES_PER_DAY = 1440
/// W1/W2 duration bounds and W3's small-hours threshold, in minutes.
const MAX_REASONABLE_DURATION = 16 * 60
const MIN_REASONABLE_DURATION = 4 * 60
const EARLY_OPEN_THRESHOLD = 5 * 60
/// W4 fires past three hours from the median, and needs three other filled days
/// to have any shape to compare against at all.
const MEDIAN_TOLERANCE = 3 * 60
const MIN_SIBLINGS_FOR_MEDIAN = 3

/// PRESENT-BUT-UNPARSEABLE IS TREATED AS ABSENT, and that is a deliberate narrow
/// choice rather than an oversight. The route's zod is what guarantees the
/// format on write, so this case cannot arise from the dialog; it can only come
/// from a row that predates the constraint. Folding it into "absent" means such
/// a row trips B2 when its partner is filled, which is the visible outcome, and
/// reads as undecided when both are junk. The sweep reports unparseable values
/// separately rather than leaning on this.
function toMinutes(value: string | null): number | null {
  if (!value || !TIME_RE.test(value)) return null
  const [h, m] = value.split(":")
  return Number(h) * 60 + Number(m)
}

function fmt(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
}

/// CLOSE < OPEN IS LEGAL AND IS AN OVERNIGHT WINDOW, NOT AN ERROR. The dialog's
/// helper text promises it outright ("a store that closes after midnight is fine
/// — enter the real closing time, say 02:00, rather than 24:00") and the write
/// route declines to order-check for the same reason. Blocking it would make an
/// overnight store unrepresentable and break a promise the UI makes on screen.
function durationMinutes(open: number, close: number): number {
  return close > open ? close - open : close + MINUTES_PER_DAY - open
}

/// Plain median. Even counts average the two middle values, which for the real
/// case — a week of identical days — is just that value.
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
function dayName(dayOfWeek: number): string {
  return DAY_NAMES[dayOfWeek] ?? `Day ${dayOfWeek}`
}

/// THE MEDIAN IS TAKEN OVER RAW MINUTES FROM MIDNIGHT, NOT CIRCULARLY. An
/// all-overnight estate (every day opening at 22:00) still has a consistent
/// median and never fires W4, because every day sits at the same point. What a
/// linear median cannot do is compare a 23:00 open against a 01:00 one and see
/// two hours; it sees twenty-two. That is the direction that OVER-reports rather
/// than under-reports — it raises a flag on a strange-looking week instead of
/// swallowing one — and W3 catches the small-hours case independently. Worth a
/// circular statistic only if a real store ever straddles midnight day to day.
export function validateStoreHours(days: StoreHoursDay[]): StoreHoursValidation {
  const blocking: StoreHoursIssue[] = []
  const warnings: StoreHoursIssue[] = []

  // A CLOSED DAY IS NOT VALIDATED AT ALL. It keeps whatever times were typed —
  // the write route says so, and unchecking the box has to give them back — and
  // no reader looks at them while isClosed is true (labor-plan.ts:199). So a
  // closed day carrying 08:00-08:00 is clean, and becomes B1 the moment someone
  // unchecks the box, which is when it starts meaning something.
  const considered = days.filter((d) => !d.isClosed)

  const parsed = considered.map((d) => ({
    dayOfWeek: d.dayOfWeek,
    open: toMinutes(d.openingTime),
    close: toMinutes(d.closingTime),
  }))

  const blocked = new Set<number>()

  for (const d of parsed) {
    // B1 — open == close on a day not marked Closed. Zero-length or 24-hour;
    // neither is a store. THIS IS THE 08:00-08:00 ERROR.
    if (d.open != null && d.close != null && d.open === d.close) {
      blocked.add(d.dayOfWeek)
      blocking.push({
        dayOfWeek: d.dayOfWeek,
        field: "day",
        code: "B1",
        reason: `${dayName(d.dayOfWeek)} opens and closes at ${fmt(d.open)}. That is either a zero-length day or a 24-hour one — mark the day Closed, or give it a real closing time.`,
      })
      continue
    }
    // B2 — one time filled and the other blank. Blank means "not yet decided"
    // and the dialog says so, so a half-filled day is neither decided nor blank.
    if ((d.open == null) !== (d.close == null)) {
      blocked.add(d.dayOfWeek)
      const missing = d.open == null ? "opening" : "closing"
      blocking.push({
        dayOfWeek: d.dayOfWeek,
        field: d.open == null ? "open" : "close",
        code: "B2",
        reason: `${dayName(d.dayOfWeek)} has no ${missing} time. Fill both, clear both to leave the day undecided, or mark it Closed.`,
      })
    }
  }

  // The median pool: days that are decided, usable and not themselves blocking.
  // A blocked day's times are not a trustworthy shape to measure others against,
  // and its own warnings are moot until the block is cleared.
  const usable = parsed.filter(
    (d) => d.open != null && d.close != null && !blocked.has(d.dayOfWeek)
  ) as { dayOfWeek: number; open: number; close: number }[]

  for (const d of usable) {
    const duration = durationMinutes(d.open, d.close)

    // W1 — a very long day. Real, but worth a look.
    if (duration > MAX_REASONABLE_DURATION) {
      warnings.push({
        dayOfWeek: d.dayOfWeek,
        field: "day",
        code: "W1",
        reason: `${dayName(d.dayOfWeek)} is open ${(duration / 60).toFixed(1)} hours. Check the closing time if that isn't right.`,
      })
    }

    // W2 — a very short day. Rohan's Restaurant, Cafe De Keva Cart and Keva
    // Kiosk are seasonal and legitimately odd, so this warns and never blocks.
    if (duration < MIN_REASONABLE_DURATION) {
      warnings.push({
        dayOfWeek: d.dayOfWeek,
        field: "day",
        code: "W2",
        reason: `${dayName(d.dayOfWeek)} is open only ${(duration / 60).toFixed(1)} hours. Fine for a seasonal or reduced day — check it is deliberate.`,
      })
    }

    // W3 — an opening time in the small hours. THIS IS THE AM/PM SLIP that put
    // a 01:00 Sunday on a campus store.
    if (d.open < EARLY_OPEN_THRESHOLD) {
      warnings.push({
        dayOfWeek: d.dayOfWeek,
        field: "open",
        code: "W3",
        reason: `${dayName(d.dayOfWeek)} opens at ${fmt(d.open)}. If that should be ${fmt(d.open + 12 * 60)}, correct it — nothing here will change it for you.`,
      })
    }

    // W4 — this day's shape against the rest of the week's. Six days at 08:00
    // and one at 01:00 is the strongest available signal and it is nearly free.
    const others = usable.filter((o) => o.dayOfWeek !== d.dayOfWeek)
    if (others.length >= MIN_SIBLINGS_FOR_MEDIAN) {
      const medianOpen = median(others.map((o) => o.open))
      if (Math.abs(d.open - medianOpen) > MEDIAN_TOLERANCE) {
        warnings.push({
          dayOfWeek: d.dayOfWeek,
          field: "open",
          code: "W4",
          reason: `${dayName(d.dayOfWeek)} opens at ${fmt(d.open)}, but this store's other days open around ${fmt(medianOpen)}.`,
        })
      }
      const medianClose = median(others.map((o) => o.close))
      if (Math.abs(d.close - medianClose) > MEDIAN_TOLERANCE) {
        warnings.push({
          dayOfWeek: d.dayOfWeek,
          field: "close",
          code: "W4",
          reason: `${dayName(d.dayOfWeek)} closes at ${fmt(d.close)}, but this store's other days close around ${fmt(medianClose)}.`,
        })
      }
    }
  }

  return { blocking, warnings }
}
