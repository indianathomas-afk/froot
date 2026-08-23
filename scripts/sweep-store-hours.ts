/**
 * Read-only sweep — run validateStoreHours over EVERY existing StoreHours row.
 *
 *   npx tsx scripts/sweep-store-hours.ts            # whatever DATABASE_URL points at
 *   npx tsx scripts/sweep-store-hours.ts rows.json  # a Neon-console export
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
 * The export shape is one row per store/day:
 *   [{ "store": "...", "dayOfWeek": 0, "openingTime": "08:00",
 *      "closingTime": "20:00", "isClosed": false }, ...]
 */
import "dotenv/config"
import { readFileSync } from "node:fs"
import { validateStoreHours, type StoreHoursDay } from "../src/lib/store-hours-validate"

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

type Row = StoreHoursDay & { store: string }

async function fromDatabase(): Promise<{ rows: Row[]; source: string; storeCount: number }> {
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
  return { rows, source: `live database @ ${host}`, storeCount: stores.length }
}

function fromFile(path: string): { rows: Row[]; source: string; storeCount: number } {
  const rows = JSON.parse(readFileSync(path, "utf8")) as Row[]
  return { rows, source: `export file ${path}`, storeCount: new Set(rows.map((r) => r.store)).size }
}

async function main() {
  const arg = process.argv[2]
  const { rows, source, storeCount } = arg ? fromFile(arg) : await fromDatabase()

  const byStore = new Map<string, Row[]>()
  for (const r of rows) {
    const list = byStore.get(r.store) ?? []
    list.push(r)
    byStore.set(r.store, list)
  }

  let blockingTotal = 0
  let warningTotal = 0
  let unparseable = 0
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
      if (b.length === 0 && w.length === 0) continue
      lines.push(
        [
          store.padEnd(26).slice(0, 26),
          DAY[d.dayOfWeek] ?? `d${d.dayOfWeek}`,
          (d.openingTime ?? "—").padStart(5),
          (d.closingTime ?? "—").padStart(5),
          d.isClosed ? "CLOSED" : "open  ",
          (b.length ? `BLOCK ${b.join(",")}` : "").padEnd(12),
          w.length ? `warn ${w.join(",")}` : "",
        ].join("  ")
      )
    }
  }

  console.log(`source            : ${source}`)
  console.log(`stores with hours : ${byStore.size} / ${storeCount}`)
  console.log(`StoreHours rows   : ${rows.length}`)
  console.log(`blocking          : ${blockingTotal}`)
  console.log(`warnings          : ${warningTotal}`)
  console.log(`unparseable times : ${unparseable}`)
  console.log("")
  if (lines.length === 0) {
    console.log(rows.length === 0 ? "(no StoreHours rows exist on this branch)" : "(every row is clean)")
    return
  }
  console.log("store                       day   open  close  state   issues")
  for (const l of lines) console.log(l)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
