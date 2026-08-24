// STORE HOURS → THE LABOR ENGINE'S OPEN WINDOW. ONE IMPLEMENTATION OF THE
// ADMISSION RULE, BECAUSE THERE ARE NOW THREE READERS OF IT.
//
// labor-plan.ts has always decided whether a StoreHours row becomes the day's
// open window, and it decided it INLINE: `s != null && e != null && e > s`,
// with the parsers defined in the same file. That was fine while the engine was
// the only thing that cared. It is not fine now — BUG-14's surfacing has to
// tell an operator that a row they can see on screen is not the row the model
// is using, and the ONLY honest way to say that is to ask the engine's own
// question. A component that re-derived `e > s` would be BUG-11/BUG-12 again:
// two spellings of one rule, drifting the moment either side is edited.
//
// So the rule and its parsers live here, labor-plan.ts imports them and
// re-exports the parsers unchanged, and the store card asks this module. Change
// the predicate and every reader moves together, which is the whole point.
//
// DEPENDENCY-FREE ON PURPOSE — the same contract as store-hours-validate.ts and
// labor-roster-hours.ts. This is imported into a client bundle, so it may never
// reach for prisma, the Square client, or anything else server-only. It is also
// the reason the predicate could not simply be exported from labor-plan.ts,
// which imports prisma on its first line.
//
// IT IS NOT A SECOND VALIDATOR. store-hours-validate.ts answers "will the
// editor accept this row?" and this module answers "will the engine READ it?".
// THOSE ARE DIFFERENT PREDICATES AND THE GAP BETWEEN THEM IS THE DEFECT — an
// overnight window is clean by the first and discarded by the second. Do not
// merge them and do not make either one warn on the other's behalf; the ruling
// of 2026-08-23 is that the validator must NOT start warning on overnight,
// because that contradicts the dialog's own promise while leaving the engine
// still ignoring the row.

export type StoreHoursWindowDay = {
  openingTime: string | null
  closingTime: string | null
  isClosed: boolean
}

export type EngineOpenWindow = { startHour: number; endHour: number }

/// THE ENGINE'S OWN PARSERS, MOVED HERE VERBATIM FROM labor-plan.ts. Hour
/// resolution, not minutes: the labor model plans in whole hours and always has.
export function parseHourStart(t: string | null): number | null {
  const m = t?.match(/^(\d{1,2}):(\d{2})/)
  return m ? Math.floor(Number(m[1]) + Number(m[2]) / 60) : null
}

export function parseHourEnd(t: string | null): number | null {
  const m = t?.match(/^(\d{1,2}):(\d{2})/)
  if (!m) return null
  // A MIDNIGHT CLOSE IS 24:00, NOT HOUR ZERO — Gary, 2026-08-23. "18:00 to 00:00
  // is a normal day that ends at 24:00." Without this, Math.ceil gives 0, the
  // admission rule below (`e > s`) rejects the row, and the store silently runs
  // on sales inference while the dialog displays the hours as accepted.
  // A midnight close is ordinary data and was never an overnight case.
  //
  // EXACTLY "00:00" AND NOTHING ELSE. "00:30" still yields 1 and is still
  // discarded — that IS an overnight close, and overnight needs the per-store
  // business day cutoff, which is ruled and deferred to CUTOFF-1. Widening this
  // to any small hour would be building that cutoff by accident, in the one
  // place nobody would look for it.
  if (Number(m[1]) === 0 && Number(m[2]) === 0) return 24
  return Math.ceil(Number(m[1]) + Number(m[2]) / 60)
}

/// THE ADMISSION RULE ITSELF. Returns the window the labor engine will use for
/// this day, or null when it will discard the row and fall back to sales
/// inference. `isClosed` is NOT this function's business — a closed day is
/// genuinely shut and gets no window and no inference, which the caller handles.
export function engineOpenWindow(day: StoreHoursWindowDay): EngineOpenWindow | null {
  const s = parseHourStart(day.openingTime)
  const e = parseHourEnd(day.closingTime)
  return s != null && e != null && e > s ? { startHour: s, endHour: e } : null
}

/// What the labor engine actually does with one StoreHours row, in the three
/// shapes worth telling an operator apart:
///
///   "closed"        — marked Closed. No window, no inference. Correct.
///   "undecided"     — nothing typed. Inference, but nothing on screen claims
///                     otherwise, so this is not a disagreement.
///   "used"          — admitted; the model plans on exactly these hours.
///   "discarded"     — TIMES ARE ON SCREEN AND THE ENGINE IS NOT READING THEM.
///                     Coverage for this day comes from sales inference instead.
///                     THIS IS THE ONE THAT HAS TO BE VISIBLE.
export type EngineHoursUse = "closed" | "undecided" | "used" | "discarded"

export function engineHoursUse(day: StoreHoursWindowDay): EngineHoursUse {
  if (day.isClosed) return "closed"
  const anyTyped = Boolean(day.openingTime) || Boolean(day.closingTime)
  if (!anyTyped) return "undecided"
  return engineOpenWindow(day) ? "used" : "discarded"
}

/// The store-level question the card asks: which days show times that the
/// engine will not read? Returns JS day-of-week numbers (0 Sun .. 6 Sat) in the
/// order given, empty when every visible row is honest.
export function discardedByEngine<T extends StoreHoursWindowDay & { dayOfWeek: number }>(
  days: T[]
): number[] {
  return days.filter((d) => engineHoursUse(d) === "discarded").map((d) => d.dayOfWeek)
}

/// ── THE SURFACING'S WORDS ────────────────────────────────────────────────────
///
/// PROPOSED, NOT RULED. BUG-14 requires that a store whose rows the engine will
/// not read SAYS SO PLAINLY; the exact wording is Gary's and these are the words
/// offered, not the words agreed. They sit here, in one object, so that settling
/// them is a single edit and the card and the dialog can never drift into saying
/// two different things about the same fact.
///
/// WHAT THEY MAY NOT DO is imply the hours are WRONG. They are not wrong — an
/// overnight window is legitimate data the dialog explicitly invites, and the
/// engine's refusal to read it is the engine's limitation (CUTOFF-1), not the
/// operator's mistake. "Unused", never "questionable". Telling someone their
/// hours look doubtful when the real fact is that nothing is reading them is the
/// worse state the 2026-08-23 ruling turned down.
export const ENGINE_DISCARDED_COPY = {
  /// The store card, when no day's hours are read at all.
  all: "The Weekly Labor Model is not using these hours — coverage is inferred from past sales instead.",
  /// The store card, when some are. `days` arrives rendered, e.g. "Wed, Fri".
  some: (days: string) =>
    `The Weekly Labor Model is not using these hours on ${days} — coverage on those days is inferred from past sales instead.`,
  /// The editor, against the one row that caused it.
  day: "Saved, but the Weekly Labor Model will not use this day — coverage is inferred from past sales instead.",
} as const
