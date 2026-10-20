// BUG-15 fixture — /dashboard header date must not hydration-mismatch (#418).
// Pure: no DB, no network. Run from the repo root:
//   npx tsx --tsconfig tsconfig.json scripts/bug15-dashboard-header-date-fixture.tsx
//
// F1  dashboardHeaderDate at pinned instants, process-TZ independent.
// F2  dashboardAnchorTimeZone picks the first store's zone, else the default.
// F3  renderToString(DashboardClient) in three child processes under
//     TZ=UTC / America/Los_Angeles / America/Denver must produce byte-identical
//     HTML, with the store-local date in the header <p>.

import { spawnSync } from "node:child_process"
import { renderToString } from "react-dom/server"
import { DashboardClient } from "../src/app/(app)/dashboard/dashboard-client"
import { dashboardAnchorTimeZone, dashboardHeaderDate } from "../src/lib/reports"
import { DEFAULT_TIME_ZONE } from "../src/lib/hr"

const CHILD = process.env.BUG15_CHILD === "1"
const AT_0330 = new Date("2026-10-16T03:30:00Z") // 20:30 PDT · 21:30 MDT
const AT_0630 = new Date("2026-10-16T06:30:00Z") // 23:30 PDT · 00:30 MDT next day

// Sorted by name, as both /dashboard and /api/dashboard/rollup order them:
// the Denver store is stores[0].
const STORES = [
  { id: "s-den", name: "BUG-15 Colorado Springs", location: "Colorado Springs, CO", timezone: "America/Denver" },
  { id: "s-pac", name: "BUG-15 Reno", location: "Reno, NV", timezone: "America/Los_Angeles" },
]

function render(instant: Date): string {
  return renderToString(
    <DashboardClient
      stores={STORES.map(({ timezone, ...s }) => ({ ...s, headerDate: dashboardHeaderDate(instant, timezone) }))}
      rollupHeaderDate={dashboardHeaderDate(instant, dashboardAnchorTimeZone(STORES))}
      countRecency={[]}
    />
  )
}

if (CHILD) {
  // Child: emit the two renders as JSON on stdout and nothing else.
  process.stdout.write(JSON.stringify({ at0330: render(AT_0330), at0630: render(AT_0630) }))
  process.exit(0)
}

let failures = 0
function check(label: string, actual: string, expected: string) {
  const ok = actual === expected
  if (!ok) failures++
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n        expected: ${JSON.stringify(expected)}\n        actual:   ${JSON.stringify(actual)}`}`)
}

console.log(`BUG-15 fixture · process TZ=${process.env.TZ ?? "(unset)"} · ${Intl.DateTimeFormat().resolvedOptions().timeZone}\n`)

console.log("F1 — dashboardHeaderDate, pinned instants")
check("03:30Z America/Los_Angeles", dashboardHeaderDate(AT_0330, "America/Los_Angeles"), "Thursday, October 15")
check("03:30Z America/Denver     ", dashboardHeaderDate(AT_0330, "America/Denver"), "Thursday, October 15")
check("03:30Z UTC                ", dashboardHeaderDate(AT_0330, "UTC"), "Friday, October 16")
check("06:30Z America/Denver      (Denver past midnight)", dashboardHeaderDate(AT_0630, "America/Denver"), "Friday, October 16")
check("06:30Z America/Los_Angeles (Pacific not yet)     ", dashboardHeaderDate(AT_0630, "America/Los_Angeles"), "Thursday, October 15")

console.log("\nF2 — dashboardAnchorTimeZone")
check("[Denver store, Pacific store] → America/Denver", dashboardAnchorTimeZone(STORES), "America/Denver")
check(`[] → DEFAULT_TIME_ZONE (${DEFAULT_TIME_ZONE})`, dashboardAnchorTimeZone([]), DEFAULT_TIME_ZONE)

console.log("\nF3 — server render identical under three process zones")
const ZONES = ["UTC", "America/Los_Angeles", "America/Denver"]
const renders: Record<string, { at0330: string; at0630: string }> = {}
for (const tz of ZONES) {
  const r = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    env: { ...process.env, TZ: tz, BUG15_CHILD: "1" },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
  if (r.status !== 0) {
    failures++
    console.log(`FAIL  child TZ=${tz} exited ${r.status}\n${r.stderr}`)
    continue
  }
  renders[tz] = JSON.parse(r.stdout)
}

function headerP(html: string): string {
  const m = html.match(/<p class="text-sm[^"]*mt-1">([\s\S]*?)<\/p>/)
  return m ? m[1] : "(header <p> not found)"
}

if (Object.keys(renders).length === ZONES.length) {
  for (const key of ["at0330", "at0630"] as const) {
    const base = renders.UTC[key]
    for (const tz of ZONES.slice(1)) {
      const same = renders[tz][key] === base
      if (!same) failures++
      console.log(`${same ? "PASS" : "FAIL"}  ${key} TZ=UTC vs TZ=${tz}: HTML ${same ? "byte-identical" : "DIFFERS"} (${base.length} bytes)`)
      if (!same) {
        console.log(`        UTC: ${headerP(base)}\n        ${tz}: ${headerP(renders[tz][key])}`)
      }
    }
  }
  // stores[0] (Denver) is the server-snapshot default, so its date is the header.
  check("at0330 header <p> (Colorado Springs, store-local)", headerP(renders.UTC.at0330), "Thursday, October 15<!-- --> · BUG-15 Colorado Springs — Colorado Springs, CO")
  check("at0630 header <p> (Colorado Springs, store-local)", headerP(renders.UTC.at0630), "Friday, October 16<!-- --> · BUG-15 Colorado Springs — Colorado Springs, CO")
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`)
process.exit(failures === 0 ? 0 : 1)
