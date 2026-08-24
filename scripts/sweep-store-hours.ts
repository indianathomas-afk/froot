/**
 * Read-only sweep — run validateStoreHours over EVERY existing StoreHours row.
 *
 *   npx tsx scripts/sweep-store-hours.ts            # whatever DATABASE_URL points at
 *   npx tsx scripts/sweep-store-hours.ts rows.json  # a Neon-console export
 *   npx tsx scripts/sweep-store-hours.ts rows.json census.json   # + Query 2
 *
 * READ-ONLY. It opens no transaction and writes nothing. It REPORTS; correcting
 * a wrong row is the operator's job in the UI, which is also the first live test
 * of the editor's new behaviour.
 *
 * THE SECOND MODE EXISTS BECAUSE OF THE CREDENTIAL RULE. Deployed branches are
 * read through the Neon console, never by pulling a deployed credential to disk,
 * so a staging or production sweep arrives here as a pasted JSON export instead
 * of a connection. BOTH MODES CALL THE SAME validateStoreHours the dialog and
 * the write route call — the point of the module is that there is only one
 * implementation of the rule set, and a sweep that reimplemented it in SQL would
 * be the very drift BUG-11/BUG-12 record.
 *
 * TWO VERDICTS PER ROW, AND THE SECOND ONE IS THE POINT (BUG-14). The
 * validator's verdict says whether the EDITOR would accept the row. The ENGINE
 * verdict says whether the Weekly Labor Model will READ it, which is a
 * different and stricter predicate — `e > s` through labor-plan's own parsers,
 * reached here through store-hours-window.ts so this script cannot drift from
 * the engine any more than the store card can. A row can be perfectly clean by
 * the first and DISCARDED by the second; an overnight window is exactly that,
 * and a store carrying one is running on sales inference with nothing on any
 * screen saying so. Those rows are reported even when the validator is silent.
 *
 * The export shape is one row per store/day:
 *   [{ "store": "...", "dayOfWeek": 0, "openingTime": "08:00",
 *      "closingTime": "20:00", "isClosed": false }, ...]
 */
import "dotenv/config"
import { readFileSync } from "node:fs"
import { validateStoreHours, type StoreHoursDay } from "../src/lib/store-hours-validate"
import { engineHoursUse, engineOpenWindow } from "../src/lib/store-hours-window"

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

type Row = StoreHoursDay & { store: string }

async function fromDatabase(): Promise<{ rows: Row[]; source: string; storeCount: number; census: CensusRow[] | null }> {
  const { prisma } = await import("../src/lib/prisma")
  const stores = await prisma.store.findMany({
    select: { name: true, hours: { orderBy: { dayOfWeek: "asc" } } },
    orderBy: { name: "asc" },
  })
  const rows: Row[] = stores.flatMap((s) =>
    s.hours.map((h) => ({
      store: s.name,
      dayOfWeek: h.dayOfWeek,
      openingTime: h.openingTime,
      closingTime: h.closingTime,
      isClosed: h.isClosed,
    }))
  )
  // Host only — the credential never reaches stdout.
  const host = (process.env.DATABASE_URL ?? "").match(/@([^/]+)\//)?.[1] ?? "unknown host"
  await prisma.$disconnect()
  // The live path never needed a census — it selects every Store directly, so
  // a store with no hours is already in `stores` with an empty `hours` array.
  return {
    rows,
    source: `live database @ ${host}`,
    storeCount: stores.length,
    census: stores.map((st) => ({ store: st.name, hours_rows: st.hours.length })),
  }
}

/// A STORE WITH NO StoreHours ROWS IS INVISIBLE IN THE EXPORT, AND THAT IS THE
/// ONE THING THE EXPORT CANNOT TELL YOU. Query 1 inner-joins Store to
/// StoreHours, so a store that has never had hours entered contributes no rows
/// and cannot be counted from the file — `3 / 3` would read as full coverage on
/// an estate where nine of twelve stores have nothing. That store is not clean;
/// it is running on sales inference, which is the pre-BUG-14 state for the whole
/// estate and is exactly what this sweep exists to make visible.
///
/// So the OPTIONAL SECOND ARGUMENT is Query 2's output — the per-store row
/// census, `[{ "store": "...", "hours_rows": 0 }, ...]` — and it is the only
/// thing that can name the zero-row stores. Without it the sweep says so rather
/// than quietly reporting coverage it cannot see.
type CensusRow = { store: string; hours_rows: number }

function fromFile(path: string, censusPath?: string): {
  rows: Row[]
  source: string
  storeCount: number
  census: CensusRow[] | null
} {
  const rows = JSON.parse(readFileSync(path, "utf8")) as Row[]
  const census = censusPath ? (JSON.parse(readFileSync(censusPath, "utf8")) as CensusRow[]) : null
  return {
    rows,
    source: `export file ${path}${censusPath ? ` + census ${censusPath}` : ""}`,
    storeCount: census ? census.length : new Set(rows.map((r) => r.store)).size,
    census,
  }
}

async function main() {
  const arg = process.argv[2]
  const censusArg = process.argv[3]
  const { rows, source, storeCount, census } = arg ? fromFile(arg, censusArg) : await fromDatabase()

  const byStore = new Map<string, Row[]>()
  for (const r of rows) {
    const list = byStore.get(r.store) ?? []
    list.push(r)
    byStore.set(r.store, list)
  }

  let blockingTotal = 0
  let warningTotal = 0
  let unparseable = 0
  const engineTally = { used: 0, discarded: 0, closed: 0, undecided: 0 }
  const discardedStores = new Set<string>()
  const lines: string[] = []

  for (const [store, days] of [...byStore.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const { blocking, warnings } = validateStoreHours(days)
    blockingTotal += blocking.length
    warningTotal += warnings.length
    for (const d of days) {
      for (const t of [d.openingTime, d.closingTime]) {
        if (t != null && t !== "" && !TIME_RE.test(t)) unparseable++
      }
    }
    for (const d of [...days].sort((a, b) => a.dayOfWeek - b.dayOfWeek)) {
      const b = blocking.filter((i) => i.dayOfWeek === d.dayOfWeek).map((i) => i.code)
      const w = warnings.filter((i) => i.dayOfWeek === d.dayOfWeek).map((i) => `${i.code}:${i.field}`)

      // THE ENGINE'S OWN ANSWER, through the engine's own parsers. `used` shows
      // the window the model will actually plan on, because "admitted" alone
      // hides the 08:30 -> 8 rounding and a reader should see the real hours.
      const use = engineHoursUse(d)
      engineTally[use]++
      if (use === "discarded") discardedStores.add(store)
      const wnd = engineOpenWindow(d)
      const engine =
        use === "used" ? `uses ${wnd!.startHour}-${wnd!.endHour}`
        : use === "discarded" ? "DISCARDED -> sales inference"
        : use === "closed" ? "closed (no window, correct)"
        : "undecided -> sales inference"

      // A row is reported when EITHER predicate has something to say. The
      // engine half is why a validator-clean overnight row still appears —
      // silence there was the defect, not the absence of one.
      if (b.length === 0 && w.length === 0 && use !== "discarded") continue
      lines.push(
        [
          store.padEnd(26).slice(0, 26),
          DAY[d.dayOfWeek] ?? `d${d.dayOfWeek}`,
          (d.openingTime ?? "—").padStart(5),
          (d.closingTime ?? "—").padStart(5),
          d.isClosed ? "CLOSED" : "open  ",
          (b.length ? `BLOCK ${b.join(",")}` : w.length ? `warn ${w.join(",")}` : "clean").padEnd(22),
          engine,
        ].join("  ")
      )
    }
  }

  console.log(`source            : ${source}`)
  console.log(`stores with hours : ${byStore.size} / ${storeCount}${census ? "" : "  (of the stores PRESENT IN THE EXPORT — no census given, see below)"}`)
  console.log(`StoreHours rows   : ${rows.length}`)
  console.log(`blocking          : ${blockingTotal}`)
  console.log(`warnings          : ${warningTotal}`)
  console.log(`unparseable times : ${unparseable}`)
  console.log(`engine uses       : ${engineTally.used}`)
  console.log(`engine DISCARDS   : ${engineTally.discarded}  (across ${discardedStores.size} store(s)${discardedStores.size ? `: ${[...discardedStores].sort().join(", ")}` : ""})`)
  console.log(`engine closed/undecided : ${engineTally.closed} / ${engineTally.undecided}`)
  console.log("")
  if (lines.length === 0) {
    console.log(
      rows.length === 0
        ? "(no StoreHours rows exist on this branch)"
        : "(every row is clean AND every row is read by the engine)"
    )
    reportStoresWithNoHours(census, byStore)
    return
  }
  console.log("store                       day   open  close  state   validator               ENGINE")
  for (const l of lines) console.log(l)
  reportStoresWithNoHours(census, byStore)
}

/// THE STORES THAT ARE NOT IN THE TABLE ABOVE, AND WHY THEY MATTER. A store with
/// no rows raises no blocking issue, no warning and no engine discard — it is
/// silent on every axis this sweep measures, and silence here means "the labor
/// model has never had hours for this store", not "this store is fine".
function reportStoresWithNoHours(census: CensusRow[] | null, byStore: Map<string, Row[]>) {
  console.log("")
  if (!census) {
    console.log("stores with NO StoreHours rows: UNKNOWN — run Query 2 and pass it as the second")
    console.log("  argument. The export alone cannot name them; an inner join drops them.")
    return
  }
  const empty = census.filter((c) => Number(c.hours_rows) === 0).map((c) => c.store).sort()
  if (empty.length === 0) {
    console.log("every store in the census carries at least one StoreHours row")
    return
  }
  console.log(`stores with NO StoreHours rows : ${empty.length} / ${census.length}`)
  console.log("  These are NOT clean — the labor model infers their open window from past sales.")
  console.log("  That is the pre-BUG-14 state for the estate, not a defect introduced by anything.")
  for (const name of empty) console.log(`    · ${name}`)
  const missing = [...byStore.keys()].filter((s) => !census.some((c) => c.store === s)).sort()
  if (missing.length) {
    console.log(`  *** CENSUS MISMATCH: ${missing.length} store(s) have rows but are absent from the census: ${missing.join(", ")} ***`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
