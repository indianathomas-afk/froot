// ─── DEBT-70b: ONE PLACE THAT TURNS A STORED DateTime INTO A DISPLAYED DATE ──
//
// Ruled by Gary 2026-08-16. Every DateTime column is TIMESTAMP(3) with no zone,
// so Prisma returns UTC, and `format()` from date-fns renders in the zone of
// whatever executes it. A client component renders the viewer's local day; a
// server component renders VERCEL'S UTC day. Same stored value, two answers —
// Gdogg's signature is 2026-08-16 04:06 UTC = 2026-08-15 21:06 PDT, and the
// staff profile's Documents tab (client) read Aug 15 while its Compliance tab
// (server) read Aug 16, one scroll apart.
//
// THE CLIENT WAS RIGHT. The signature happened at 9:06 PM on August 15. The
// server printed a day nobody lived. So the 22 server sites render the
// STORE-LOCAL day, resolved through `displayTimeZone` in lib/hr.ts.
//
// ── THIS IS NOT A SECOND MECHANISM ───────────────────────────────────────────
//
// It is `Intl.DateTimeFormat` with an explicit `timeZone`, which is exactly what
// the app's existing timezone primitives already are:
//
//   localDateStr(instant, tz)      lib/reports.ts:51
//   businessDayWindow(instant, tz) lib/reports.ts:71
//   formatWindowTime(at, tz)       lib/checklist-status-display.ts:141
//
// Those three are trusted by checklists, forecasting, labor and the operations
// report, and reports.ts:66 already records the reason in almost these words:
// "Never derive a checklist's 'today' from server time — Vercel runs UTC."
// This module gives that same primitive a shared home so twenty-two call sites
// do not each hand-roll `Intl` options, which is how a convention turns back
// into twenty-two judgement calls.
//
// STYLES ARE NAMED, NOT PASSED AS FORMAT STRINGS, and each name reproduces
// BYTE-FOR-BYTE the date-fns pattern it replaced — asserted by a fixture, not
// by eye. That property is what makes the diff reviewable: with the zone forced
// to UTC every one of these returns exactly what the old call returned, so the
// only behavioural change in the whole phase is which zone is asked for.
//
// ── THE TRAP THIS MODULE EXISTS TO KEEP VISIBLE ──────────────────────────────
//
// THERE ARE TWO KINDS OF DateTime IN THIS SCHEMA AND THEY PULL IN OPPOSITE
// DIRECTIONS:
//
//   INSTANT      a real moment — completedAt, createdAt, signedAt, dueDate.
//                Rendering it in UTC is WRONG. Use `formatInstant`.
//
//   CIVIL DATE   a store-local DAY already stored in a UTC-midnight container,
//                written through `dbDate()` — Checklist.date is the only one on
//                any of these surfaces. Rendering it in UTC is CORRECT, and
//                converting it to Pacific moves it A DAY BACKWARD.
//                Use `formatCivilDate`.
//
// Measured, on the two real values in play:
//
//   Checklist.date  2026-08-15T00:00:00.000Z
//      UTC     -> Aug 15   correct        America/Los_Angeles -> Aug 14   WRONG
//   completedAt     2026-08-16T04:06:00.000Z
//      UTC     -> Aug 16   WRONG          America/Los_Angeles -> Aug 15   correct
//
// A civil date converted by mistake fails SILENTLY: no screen shows it, the day
// is simply wrong by one. Hence two functions with two names rather than one
// function with a zone argument — the caller has to say which kind of value it
// is holding, and cannot get it right by accident.

/** Styles in use across the server surfaces, named for what they show. */
export type DateStyle =
  | "long" //        August 15, 2026        (was "MMMM d, yyyy")
  | "medium" //      Aug 15, 2026           (was "MMM d, yyyy")
  | "numeric" //     8/15/2026              (was "M/d/yyyy")
  | "monthDay" //    Aug 15                 (was "MMM d")
  | "weekdayMonthDay" // Sat, Aug 15        (was "EEE, MMM d")
  | "longDot" //     August 15, 2026 · 9:06 PM   (was "MMMM d, yyyy · h:mm a")
  | "mediumDot" //   Aug 15, 2026 · 9:06 PM      (was "MMM d, yyyy · h:mm a")
  | "mediumTime" //  Aug 15, 2026 9:06 PM        (was "MMM d, yyyy h:mm a")
  | "monthDayTime" //Aug 15, 9:06 PM             (was "MMM d, h:mm a")

type Parts = Record<string, string>

function partsIn(at: Date, timeZone: string, opts: Intl.DateTimeFormatOptions): Parts {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, ...opts })
      .formatToParts(at)
      .map((p) => [p.type, p.value])
  )
}

// Composed from parts rather than from `dateStyle`/`timeStyle` presets: the
// presets cannot produce the " · " separator two of these surfaces use, and a
// locale update could move a comma under us. Parts are stable.
function render(at: Date, timeZone: string, style: DateStyle): string {
  const date = (month: "long" | "short" | "numeric", weekday?: "short") =>
    partsIn(at, timeZone, { year: "numeric", month, day: "numeric", ...(weekday ? { weekday } : {}) })
  const time = () => partsIn(at, timeZone, { hour: "numeric", minute: "2-digit", hour12: true })
  const t = () => {
    const p = time()
    return `${p.hour}:${p.minute} ${p.dayPeriod}`
  }
  switch (style) {
    case "long": {
      const p = date("long")
      return `${p.month} ${p.day}, ${p.year}`
    }
    case "medium": {
      const p = date("short")
      return `${p.month} ${p.day}, ${p.year}`
    }
    case "numeric": {
      const p = date("numeric")
      return `${p.month}/${p.day}/${p.year}`
    }
    case "monthDay": {
      const p = date("short")
      return `${p.month} ${p.day}`
    }
    case "weekdayMonthDay": {
      const p = date("short", "short")
      return `${p.weekday}, ${p.month} ${p.day}`
    }
    case "longDot": {
      const p = date("long")
      return `${p.month} ${p.day}, ${p.year} · ${t()}`
    }
    case "mediumDot": {
      const p = date("short")
      return `${p.month} ${p.day}, ${p.year} · ${t()}`
    }
    case "mediumTime": {
      const p = date("short")
      return `${p.month} ${p.day}, ${p.year} ${t()}`
    }
    case "monthDayTime": {
      const p = date("short")
      return `${p.month} ${p.day}, ${t()}`
    }
  }
}

/**
 * An INSTANT — a real moment — rendered in the zone the reader lived it in.
 *
 * `timeZone` comes from `displayTimeZone` (lib/hr.ts): the subject's primary
 * store, then `Organization.timezone`, then the default `Store.timezone`
 * carries. There is deliberately NO default parameter here: a site that cannot
 * reach a store or an org must say so, not quietly fall back to UTC, because a
 * silent UTC fallback is indistinguishable from the bug this replaces.
 */
export function formatInstant(at: Date | string, timeZone: string, style: DateStyle): string {
  return render(at instanceof Date ? at : new Date(at), timeZone, style)
}

/**
 * A CIVIL DATE — a store-local day already stored at UTC midnight through
 * `dbDate()`. Rendered in UTC, which is what reads the stored day back.
 *
 * Takes no zone, ON PURPOSE. The whole failure this guards against is somebody
 * helpfully passing the store's zone here, which would move every such date one
 * day backward with nothing on screen to show it. `Checklist.date` is the only
 * value on these surfaces that belongs here.
 */
export function formatCivilDate(at: Date | string, style: DateStyle): string {
  return render(at instanceof Date ? at : new Date(at), "UTC", style)
}
