/**
 * TAB-8 acceptance fixture — a read-only route for the tablet's Tasks refresh.
 *
 *   npx tsx scripts/verify-tab8.ts            (all sections; C needs dev)
 *   npx tsx scripts/verify-tab8.ts --no-db    (A and B only)
 *
 * Prompt of record: docs/prompts/TAB-8.md (leans 1–9).
 *
 *   A. Structure (source) — the route and everything it calls hold no write;
 *      it reads through loadTabletData → tasksForChecklist; the gate order;
 *      the tablet's refresh and date reload call the new route and nothing
 *      else does; no router.refresh() left in the tablet home; desktop's call
 *      site is unchanged since the TAB-8 base; `redirect: "manual"`. Every
 *      structural check has a negative control (NC).
 *   B. Pure — response classification (expired / failed / ok), readTabletTasks
 *      against a fake fetch, a failed or expired refresh keeps the previous
 *      list, the quiet line's 2-failure rule, the offline-miss rule.
 *   C. Database (dev branch) — the route's body (read.ts, the code GET runs)
 *      against real rows: its payload equals what /dashboard's render returns
 *      (loadTabletData as page.tsx calls it) field for field, for an OPEN
 *      checklist, a FRESH one and a PAST one; every gate's status; 403 for a
 *      store outside scope. Rows under "TAB-8 Fixture Org" (clerkOrgId
 *      `tab8-fixture-*`), deleted in `finally`.
 */
import "dotenv/config"
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import {
  SESSION_EXPIRED_MESSAGE,
  STALE_AFTER_FAILURES,
  applyItemsOutcome,
  classifyItemsResponse,
  initialItemsHealth,
  itemsNotice,
  mergeStoreSlice,
  nextItemsHealth,
  readTabletTasks,
  tabletTasksUrl,
  type ItemsHealth,
  type TabletServerData,
  type TabletSlice,
} from "../src/lib/tablet-tasks-refresh"
import { shouldRunCycle, skippedOnlyForOffline } from "../src/lib/tablet-refresh"
import { Prisma } from "@prisma/client"

let passes = 0
let failures = 0
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) passes++
  else failures++
  console.log(`${ok ? "  ok  " : "FAIL  "}${name}${ok ? "" : `\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`)
}

const src = (p: string) => readFileSync(p, "utf8")
/** Source with comments removed, so a word in a comment never passes or fails a check. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1")

const ROUTE = "src/app/api/stores/[id]/tablet-tasks/route.ts"
const READ = "src/app/api/stores/[id]/tablet-tasks/read.ts"
const DATA = "src/app/(app)/dashboard/tablet-data.ts"
const HOME = "src/app/(app)/dashboard/tablet-home.tsx"
const LIB = "src/lib/tablet-tasks-refresh.ts"
const PAGE = "src/app/(app)/dashboard/page.tsx"
/** The commit TAB-8 was built on (staging tip at the repo gate). */
const BASE = "29abe48"
/** TAB-8's work commit (BASE is its parent) — A5 compares the two (TAB-14 RN-7). */
const TAB8_WORK = "c18b0d7"

// ─── A. STRUCTURE ────────────────────────────────────────────────────────────

/** Every write shape the prompt names: create, update, upsert, delete,
 *  $executeRaw, AuditLog. */
const WRITE = /\.(create|createMany|createManyAndReturn|update|updateMany|upsert|delete|deleteMany)\s*\(|\$executeRaw|auditLog/i
const writeFree = (s: string) => !WRITE.test(code(s))

/** 401 → org 404 → store 404 → scope asked → 403 → the read, in source order. */
function gateOrder(s: string): boolean {
  const c = code(s)
  const at = [
    c.indexOf("status: 401"),
    c.indexOf('"Org not found"'),
    c.indexOf('"Store not found"'),
    c.indexOf("await scope()"),
    c.indexOf("status: 403"),
    c.indexOf("loadTabletData("),
  ]
  return at.every((i) => i >= 0) && at.every((i, k) => k === 0 || i > at[k - 1])
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) ? [p] : []
  })
}

function structure() {
  console.log("A. Structure (source)")
  const route = src(ROUTE)
  const read = src(READ)
  const data = src(DATA)
  const home = src(HOME)
  const lib = src(LIB)

  // A1 — zero writes in the route and everything it calls.
  const called = [ROUTE, READ, DATA, "src/lib/auth.ts", "src/lib/checklist-tasks.ts", "src/lib/sections.ts", "src/lib/reports.ts", "src/lib/prisma.ts"]
  for (const p of called) check(`A1. no write call in ${p}`, writeFree(src(p)), true)
  check("A1 NC. an update added to read.ts → caught", writeFree(read + '\nawait prisma.checklist.update({ where: { id }, data: {} })'), false)
  check("A1 NC. an AuditLog row added → caught", writeFree(read + "\nawait prisma.auditLog.create({ data })"), false)
  check("A1 NC. raw SQL write added → caught", writeFree(read + "\nawait prisma.$executeRaw`update x`"), false)
  check("A1 NC. a write named only in a comment is NOT a write", writeFree(read + "\n// prisma.checklist.update(...)"), true)

  // A2 — reads through tasksForChecklist (TPL-3 R1), by delegation.
  const reads = (r: string, d: string) => code(r).includes("loadTabletData(") && code(d).includes("tasksForChecklist(")
  check("A2. read.ts calls loadTabletData, which calls tasksForChecklist", reads(read, data), true)
  check("A2. route.ts delegates to read.ts and has no prisma of its own", [code(route).includes("readTabletTasksFor("), /prisma/.test(code(route))], [true, false])
  check("A2 NC. tablet-data without tasksForChecklist → caught", reads(read, data.replace(/tasksForChecklist\(/g, "tasksFor(")), false)
  check("A2. page.tsx's first load still renders loadTabletData (the shared reader)", code(src(PAGE)).includes("loadTabletData(data.orgId, stores)"), true)

  // A3 — gate order.
  check("A3. gates in task-log's order: 401, org 404, store 404, scope, 403, read", gateOrder(read), true)
  check(
    "A3 NC. scope asked before the store lookup → caught",
    gateOrder(read.replace("const { isAdmin, storeIds, role } = await scope()", "").replace("const org =", "const { isAdmin, storeIds, role } = await scope()\n  const org =")),
    false
  )
  check("A3 NC. 403 before the org lookup → caught", gateOrder('return { status: 403 }\n' + read.replace(/status: 403/, "status: 418")), false)
  check("A3. store lookup is scoped to the org and to active stores", /where:\s*\{\s*id: storeId, organizationId: org\.id, isActive: true\s*\}/.test(read), true)

  // A4 — the tablet's refresh and date reload call the new route; nothing else does.
  const homeCode = code(home)
  const refreshBody = homeCode.slice(homeCode.indexOf("const refreshServer = useCallback"), homeCode.indexOf("// Ruling 2: move to the server's day"))
  const cycleBody = homeCode.slice(homeCode.indexOf("const cycle = useCallback<RefreshCycle>"), homeCode.indexOf("cycleRef.current = cycle"))
  const wired = (rb: string, cb: string, hc: string) =>
    rb.includes("readTabletTasks(") && cb.includes("await refreshServer()") && cb.includes("acceptDay()") && !hc.includes("router.refresh(")
  check("A4. refreshServer reads the route; the cycle (60s + date reload) calls it, then acceptDay", wired(refreshBody, cycleBody, homeCode), true)
  check("A4. the cycle no longer gates the items read on the list answering", /if \(!answered/.test(cycleBody), false)
  check("A4. no router.refresh() left in the tablet home", homeCode.includes("router.refresh("), false)
  check("A4 NC. a router.refresh() put back → caught", wired(refreshBody, cycleBody, homeCode + "\nrouter.refresh()"), false)
  check("A4 NC. refreshServer not reading the route → caught", wired(refreshBody.replace("readTabletTasks(", "readOther("), cycleBody, homeCode), false)
  check("A4. readTabletTasks fetches tabletTasksUrl", /fetchImpl\(tabletTasksUrl\(storeId\)/.test(code(lib)), true)
  // Every source file that names the route or its reader, comments stripped.
  const users = (files: string[]) =>
    files.filter((p) => {
      const c = code(src(p))
      return /tablet-tasks["/`]/.test(c) || /\breadTabletTasks\b/.test(c) || /\btabletTasksUrl\b/.test(c)
    }).sort()
  // src/generated/ is the ROADMAP's typed copy (prebuild), prose not code.
  const all = walk("src").filter((p) => !p.startsWith(join("src", "generated")))
  // TAB-14 RN-7 (Gary, 2026-11-11): the tablet Checklists page re-reads
  // through this route on Home's refresh cycle (TAB-14 RN-6), so it joins the
  // list by ruling. Any OTHER caller still fails here.
  const expectedUsers = [HOME, LIB, "src/app/(app)/checklists/checklists-tablet.tsx"].map((p) => join(p)).sort()
  check("A4. nothing else in src/ calls the route or its reader (tablet Home, its lib, and the TAB-14 tablet Checklists page)", users(all), expectedUsers)
  check("A4 NC. a desktop file calling it → caught", users([...all, "scripts/verify-tab8.ts"]).length > expectedUsers.length, true)

  // A5 — desktop and every other caller unchanged since the TAB-8 base.
  const untouched = [
    PAGE,
    DATA,
    "src/app/(app)/store-view/checklist/[id]/page.tsx",
    "src/app/(app)/store-view/checklist/[id]/checklist-execution-client.tsx",
    "src/app/(app)/dashboard/dashboard-client.tsx",
    "src/app/api/stores/[id]/templates/route.ts",
    "src/app/api/checklists/[id]/task-log/route.ts",
    "src/app/api/checklists/[id]/submit/route.ts",
    "src/app/api/checklists/route.ts",
  ]
  // TAB-14 RN-7 (Gary, 2026-11-11), TAB-13 RN-7's pattern: this compared the
  // WORKING TREE with BASE, so it failed the moment any later phase edited one
  // of these files (TAB-14 was the first: one additive field on the templates
  // route). What it pins is TAB-8's OWN diff, so it now compares TAB-8's work
  // commit with BASE, its parent.
  let diff = "?"
  try {
    diff = execFileSync("git", ["diff", "--stat", BASE, TAB8_WORK, "--", ...untouched], { encoding: "utf8" }).trim()
  } catch (e) {
    diff = `git failed: ${(e as Error).message}`
  }
  check(`A5. TAB-8 (${TAB8_WORK}) left the desktop page, execution page, tablet-data and every write route unchanged`, diff, "")
  check(
    "A5 NC. the diff check sees a file TAB-8 did change",
    execFileSync("git", ["diff", "--stat", BASE, TAB8_WORK, "--", HOME], { encoding: "utf8" }).trim() !== "",
    true
  )

  // A6 — redirect: "manual" plus expired-session detection.
  const manual = (s: string) => /redirect:\s*"manual"/.test(code(s)) && /opaqueredirect/.test(code(s)) && /status === 0/.test(code(s))
  check('A6. readTabletTasks sets redirect: "manual" and tests opaqueredirect / status 0', manual(lib), true)
  check('A6 NC. redirect: "follow" → caught', manual(lib.replace(/redirect: "manual"/g, 'redirect: "follow"')), false)
  const pinOptions = src("src/lib/tablet-pin-options.ts")
  check("A6. the expired message is TAB-4's, word for word", pinOptions.includes(`"${SESSION_EXPIRED_MESSAGE}"`), true)

  // A7 — TAB-8 fix (Gary, 2026-11-11): pinRequired and stripTiles ride on the
  // route's answer, computed exactly as page.tsx computes them.
  const computes = (r: string) =>
    code(r).includes("pinRequired: pinGateApplies(org, role)") && code(r).includes("stripTiles: stripTileKeys(org.tabletLayout)")
  check("A7. read.ts answers pinRequired and stripTiles with page.tsx's own functions", computes(read), true)
  check(
    "A7. page.tsx computes them with the same calls",
    [code(src(PAGE)).includes("pinGateApplies(org, role)"), code(src(PAGE)).includes("stripTileKeys(data.tabletLayout)")],
    [true, true]
  )
  check("A7 NC. a hard-coded pinRequired → caught", computes(read.replace("pinRequired: pinGateApplies(org, role)", "pinRequired: false")), false)
  // The tablet renders from the merged state, never from the first-load props.
  const usesLive = (hc: string) =>
    hc.includes("const pinRequired = live.pinRequired") &&
    hc.includes("const stripTiles = live.stripTiles") &&
    hc.includes("pinRequired: propPinRequired") &&
    hc.includes("stripTiles: propStripTiles")
  check("A7. TabletHome renders pinRequired and stripTiles from the live state, not the props", usesLive(homeCode), true)
  check(
    "A7 NC. pinRequired read straight from the props → caught",
    usesLive(homeCode.replace("const pinRequired = live.pinRequired", "const pinRequired = propPinRequired")),
    false
  )
  check(
    "A7 NC. stripTiles read straight from the props → caught",
    usesLive(homeCode.replace("const stripTiles = live.stripTiles", "const stripTiles = propStripTiles")),
    false
  )
  // role stays frozen until a reload (Gary's ruling): still the prop.
  check("A7. role is still the first-load prop (frozen until reload, by ruling)", /\brole = null,/.test(homeCode) && !homeCode.includes("live.role"), true)

  // A8 — re-read on store switch.
  const switchBody = homeCode.slice(homeCode.indexOf("const readFor = useRef(storeId)"), homeCode.indexOf("const cycle = useCallback<RefreshCycle>"))
  const rereads = (b: string) =>
    b.includes("readFor.current === storeId") && b.includes("refreshServer().then(acceptDay)") && /\[storeId, refreshServer, acceptDay\]/.test(b)
  check("A8. a store switch re-reads that store at once, then adopts its day", rereads(switchBody), true)
  check("A8 NC. the switch effect without the read → caught", rereads(switchBody.replace("refreshServer().then(acceptDay)", "acceptDay()")), false)
  check("A8 NC. the effect not keyed on storeId → caught", rereads(switchBody.replace("[storeId, refreshServer, acceptDay]", "[refreshServer, acceptDay]")), false)
}

// ─── B. PURE ─────────────────────────────────────────────────────────────────

const R = (type: string, status: number, contentType: string | null = "application/json") => ({
  type,
  status,
  ok: status >= 200 && status < 300,
  contentType,
})

function store(id: string, day: string, extra: Partial<TabletSlice["store"]> = {}): TabletSlice["store"] {
  return { id, name: `Store ${id}`, timezone: "America/Los_Angeles", headerDate: `Header ${day}`, day, staff: [], ...extra }
}
function list(id: string, storeId: string): TabletServerData["checklists"][number] {
  return { id, storeId, name: `List ${id}`, status: "In Progress", completedAt: null, sections: [] }
}

/** A Response-like for readTabletTasks. */
function fakeRes(type: string, status: number, body: unknown, contentType = "application/json"): Response {
  return {
    type,
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers(contentType ? { "content-type": contentType } : {}),
    json: async () => body,
  } as unknown as Response
}

async function pure() {
  console.log("\nB. Pure")
  check("B1. opaqueredirect (manual-mode redirect) → expired", classifyItemsResponse(R("opaqueredirect", 0, null)), "expired")
  check("B2. status 0 → expired", classifyItemsResponse(R("basic", 0, null)), "expired")
  check("B3. a 307 (a non-browser fetch) → expired", classifyItemsResponse(R("basic", 307)), "expired")
  check("B4. 200 text/html (the sign-in page) → expired, never data", classifyItemsResponse(R("basic", 200, "text/html; charset=utf-8")), "expired")
  check("B5. 401 → expired", classifyItemsResponse(R("basic", 401)), "expired")
  check("B6. 500 → failed", classifyItemsResponse(R("basic", 500)), "failed")
  check("B7. 403 → failed", classifyItemsResponse(R("basic", 403)), "failed")
  check("B8. 200 JSON → ok", classifyItemsResponse(R("basic", 200)), "ok")

  const good: TabletSlice = { store: store("s1", "2026-11-11"), checklists: [list("c9", "s1")], pinRequired: false, stripTiles: [] }
  let init: RequestInit | undefined
  let url = ""
  const outcome = await readTabletTasks("s1", (async (u: string, i: RequestInit) => {
    url = u
    init = i
    return fakeRes("basic", 200, good)
  }) as unknown as typeof fetch)
  check("B9. readTabletTasks: ok on the route's shape, from the route's URL", [outcome.kind, url], ["ok", tabletTasksUrl("s1")])
  check('B9. readTabletTasks sends redirect: "manual" and cache: "no-store"', [init?.redirect, init?.cache], ["manual", "no-store"])
  check("B10. readTabletTasks: opaque redirect → expired", (await readTabletTasks("s1", (async () => fakeRes("opaqueredirect", 0, null, "")) as unknown as typeof fetch)).kind, "expired")
  check(
    "B11. readTabletTasks: a thrown fetch → failed, never a throw",
    (await readTabletTasks("s1", (async () => {
      throw new TypeError("Load failed")
    }) as unknown as typeof fetch)).kind,
    "failed"
  )
  check("B12. readTabletTasks: 200 JSON of the wrong shape → failed", (await readTabletTasks("s1", (async () => fakeRes("basic", 200, { items: [] })) as unknown as typeof fetch)).kind, "failed")
  check("B13. readTabletTasks: 500 → failed", (await readTabletTasks("s1", (async () => fakeRes("basic", 500, { error: "x" })) as unknown as typeof fetch)).kind, "failed")

  const prev: TabletServerData = {
    stores: [store("s1", "2026-11-10"), store("s2", "2026-11-10")],
    checklists: [list("c1", "s1"), list("c2", "s2")],
    pinRequired: false,
    stripTiles: [],
  }
  check("B14. a FAILED refresh keeps the previous list (the same object)", applyItemsOutcome(prev, { kind: "failed" }) === prev, true)
  check("B15. an EXPIRED refresh keeps the previous list (the same object)", applyItemsOutcome(prev, { kind: "expired" }) === prev, true)
  const merged = applyItemsOutcome(prev, { kind: "ok", slice: good })
  check(
    "B16. an ok refresh replaces this store's entry and checklists only",
    [merged.stores.map((s) => `${s.id}:${s.day}`), merged.checklists.map((c) => c.id)],
    [["s1:2026-11-11", "s2:2026-11-10"], ["c2", "c9"]]
  )
  check("B16 NC. an ok refresh is NOT the previous object", merged === prev, false)
  check("B17. an ok refresh with ZERO checklists empties that store (a real answer, not a failure)", mergeStoreSlice(prev, { ...good, store: store("s1", "2026-11-10"), checklists: [] }).checklists.map((c) => c.id), ["c2"])
  check("B18. a slice for a store the page does not list is ignored", mergeStoreSlice(prev, { ...good, store: store("s9", "2026-11-10"), checklists: [list("cx", "s9")], pinRequired: true }) === prev, true)

  const T = Date.UTC(2026, 10, 11, 18, 42)
  const fmt = (d: Date) => new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit" }).format(d)
  let h: ItemsHealth = initialItemsHealth(T)
  check("B19. fresh: no line", itemsNotice(h, fmt), null)
  h = nextItemsHealth(h, "failed", T + 60_000)
  check(`B20. one failure: still no line (threshold ${STALE_AFTER_FAILURES})`, itemsNotice(h, fmt), null)
  h = nextItemsHealth(h, "failed", T + 120_000)
  check("B21. two in a row: the quiet line, timed at the last good read, store zone", itemsNotice(h, fmt), "Not updated since 10:42 AM")
  h = nextItemsHealth(h, "ok", T + 180_000)
  check("B22. the next success clears it", itemsNotice(h, fmt), null)
  const miss2 = nextItemsHealth(nextItemsHealth(initialItemsHealth(T), "missed", T + 60_000), "missed", T + 120_000)
  check("B23. two offline-skipped cycles count as two refreshes that did not land", itemsNotice(miss2, fmt), "Not updated since 10:42 AM")
  const exp = nextItemsHealth(initialItemsHealth(T), "expired", T + 60_000)
  check("B24. expired: TAB-4's message at once (no 2-failure wait)", itemsNotice(exp, fmt), SESSION_EXPIRED_MESSAGE)
  check("B25. expired then a failure: still the sign-in message", itemsNotice(nextItemsHealth(exp, "failed", T + 120_000), fmt), SESSION_EXPIRED_MESSAGE)
  check("B26. expired then ok (signed in again elsewhere): cleared", itemsNotice(nextItemsHealth(exp, "ok", T + 120_000), fmt), null)
  check("B26 NC. one failure after one success is not two in a row", itemsNotice(nextItemsHealth(nextItemsHealth(nextItemsHealth(initialItemsHealth(T), "failed", 1), "ok", 2), "failed", 3), fmt), null)

  const base = { visibilityState: "visible", busy: false, refreshing: false, online: true }
  check("B27. offline-miss: visible, idle, offline → a miss", skippedOnlyForOffline({ ...base, online: false }), true)
  check("B28. offline-miss: online → not a miss (the cycle runs)", [skippedOnlyForOffline(base), shouldRunCycle(base)], [false, true])
  check("B29. offline-miss: busy (someone at the tablet) → not a miss", skippedOnlyForOffline({ ...base, online: false, busy: true }), false)
  check("B30. offline-miss: hidden → not a miss", skippedOnlyForOffline({ ...base, online: false, visibilityState: "hidden" }), false)
  check("B31. TAB-5's guard unchanged: offline still never runs a cycle", shouldRunCycle({ ...base, online: false }), false)

  // TAB-8 fix — one answered read carries the PIN switch and the tile order.
  const on = applyItemsOutcome(prev, { kind: "ok", slice: { ...good, pinRequired: true } })
  check("B32. PIN switch OFF → ON: picked up by one answered read", [prev.pinRequired, on.pinRequired], [false, true])
  const off = applyItemsOutcome(on, { kind: "ok", slice: { ...good, pinRequired: false } })
  check("B33. PIN switch ON → OFF: picked up by one answered read", [on.pinRequired, off.pinRequired], [true, false])
  const tiles1 = applyItemsOutcome(prev, { kind: "ok", slice: { ...good, stripTiles: ["sales", "labor-pct"] } })
  const tiles2 = applyItemsOutcome(tiles1, { kind: "ok", slice: { ...good, stripTiles: ["labor-pct", "sales"] } })
  check("B34. a tile-order change: picked up by one answered read", [tiles1.stripTiles, tiles2.stripTiles], [["sales", "labor-pct"], ["labor-pct", "sales"]])
  const same = applyItemsOutcome(tiles2, { kind: "ok", slice: { ...good, stripTiles: ["labor-pct", "sales"] } })
  check("B34. unchanged tiles keep their array (no needless strip re-render)", same.stripTiles === tiles2.stripTiles, true)
  check("B35 NC. a FAILED read does not flip the switch or the tiles", [applyItemsOutcome(on, { kind: "failed" }).pinRequired, applyItemsOutcome(tiles1, { kind: "failed" }).stripTiles], [true, ["sales", "labor-pct"]])
  check("B36 NC. an EXPIRED read does not flip the switch", applyItemsOutcome(off, { kind: "expired" }).pinRequired, false)
  const oldShape = { store: good.store, checklists: good.checklists }
  check(
    "B37 NC. an answer without pinRequired / stripTiles (the c18b0d7 shape) is refused, never read as \"off\"",
    (await readTabletTasks("s1", (async () => fakeRes("basic", 200, oldShape)) as unknown as typeof fetch)).kind,
    "failed"
  )
  check(
    "B37 NC. stripTiles of the wrong type is refused",
    (await readTabletTasks("s1", (async () => fakeRes("basic", 200, { ...good, stripTiles: [1, 2] })) as unknown as typeof fetch)).kind,
    "failed"
  )
}

// ─── C. DATABASE (dev) ───────────────────────────────────────────────────────

async function db() {
  const { prisma } = await import("../src/lib/prisma")
  const { readTabletTasksFor } = await import("../src/app/api/stores/[id]/tablet-tasks/read")
  const { loadTabletData } = await import("../src/app/(app)/dashboard/tablet-data")
  const { businessDayWindow } = await import("../src/lib/reports")

  console.log("\nC. Database (dev branch)")
  const branch = await prisma.$queryRaw<{ b: string | null }[]>`select current_setting('neon.branch_id', true) as b`
  console.log(`     branch id: ${branch[0]?.b ?? "(null — not Neon)"}  — expected dev br-broad-wave-a6vpjdw0`)

  const stamp = Date.now()
  const clerkOrgId = `tab8-fixture-${stamp}`
  const org = await prisma.organization.create({ data: { clerkOrgId, name: "TAB-8 Fixture Org" } })
  const orgB = await prisma.organization.create({ data: { clerkOrgId: `tab8-fixture-b-${stamp}`, name: "TAB-8 Fixture Org B" } })
  try {
    const TZ = "America/Los_Angeles"
    const mkStore = (organizationId: string, name: string, isActive = true) =>
      prisma.store.create({
        data: { organizationId, name, timezone: TZ, isActive, squareLocationId: `tab8-loc-${name.replace(/\W/g, "")}-${stamp}` },
        select: { id: true, name: true, city: true, state: true, timezone: true },
      })
    const s1 = await mkStore(org.id, "TAB-8 Store One")
    const s2 = await mkStore(org.id, "TAB-8 Store Two")
    const sOff = await mkStore(org.id, "TAB-8 Store Inactive", false)
    const sB = await mkStore(orgB.id, "TAB-8 Store OrgB")

    // Staff: one with a PIN, one without, one TERMINATED, one at the other store.
    const staff = (displayName: string, storeId: string, extra: Record<string, unknown> = {}) =>
      prisma.staffMember.create({ data: { organizationId: org.id, displayName, storeAssignments: { create: { storeId } }, ...extra } })
    await staff("TAB-8 Staff Ana", s1.id, { pinSetAt: new Date() })
    await staff("TAB-8 Staff Ben", s1.id)
    await staff("TAB-8 Staff Gone", s1.id, { status: "TERMINATED" })
    await staff("TAB-8 Staff Other", s2.id)

    // Two templates (a store holds one checklist per template per day).
    const mkTemplate = async (name: string) => {
      const t = await prisma.template.create({ data: { organizationId: org.id, name, type: "Opening" } })
      const sec = await prisma.section.create({ data: { templateId: t.id, name: `${name} Section`, sortOrder: 0 } })
      const task = (description: string, orderIndex: number, extra: Record<string, unknown> = {}) =>
        prisma.task.create({ data: { templateId: t.id, sectionName: sec.name, sectionId: sec.id, description, orderIndex, ...extra } })
      return { t, sec, task }
    }
    const open = await mkTemplate("TAB-8 Open")
    const oLive = await open.task("TAB-8 open live", 0)
    const oTemp = await open.task("TAB-8 open temp", 1, { requiresTemp: true, isCritical: true })
    const oRetiredLogged = await open.task("TAB-8 open retired but ticked today", 2, { retiredAt: new Date() })
    await open.task("TAB-8 open retired, never ticked", 3, { retiredAt: new Date() })
    await open.task("TAB-8 open excluded at store one", 4, { excludedStoreIds: [s1.id] })
    const fresh = await mkTemplate("TAB-8 Fresh")
    await fresh.task("TAB-8 fresh one", 0)
    await fresh.task("TAB-8 fresh two", 1)

    const w = businessDayWindow(new Date(), TZ)
    const yesterday = new Date(w.gte.getTime() - 24 * 60 * 60 * 1000)
    const cOpen = await prisma.checklist.create({
      data: { organizationId: org.id, templateId: open.t.id, storeId: s1.id, date: w.gte, status: "In Progress", startedAt: new Date() },
    })
    await prisma.taskLog.create({ data: { checklistId: cOpen.id, taskId: oLive.id, sectionId: open.sec.id } })
    await prisma.taskLog.create({ data: { checklistId: cOpen.id, taskId: oTemp.id, sectionId: open.sec.id, temperatureValue: 38.5 } })
    await prisma.taskLog.create({ data: { checklistId: cOpen.id, taskId: oRetiredLogged.id, sectionId: open.sec.id } })
    const cFresh = await prisma.checklist.create({ data: { organizationId: org.id, templateId: fresh.t.id, storeId: s1.id, date: w.gte } })
    const cPast = await prisma.checklist.create({
      data: { organizationId: org.id, templateId: open.t.id, storeId: s1.id, date: yesterday, status: "Completed", completedAt: yesterday },
    })
    // Store two has a checklist today too: it must never ride in store one's answer.
    const cOther = await prisma.checklist.create({ data: { organizationId: org.id, templateId: fresh.t.id, storeId: s2.id, date: w.gte } })

    const scopeOne = async () => ({ isAdmin: false, storeIds: [s1.id], role: "STORE" as string | null })
    const admin = async () => ({ isAdmin: true, storeIds: [] as string[], role: "ADMIN" as string | null })

    // What /dashboard's render returns today: page.tsx's store select and its
    // loadTabletData(data.orgId, stores) call, for every store the login sees.
    const pageStores = [s1, s2]
    const page = await loadTabletData(org.id, pageStores)
    const res = await readTabletTasksFor(clerkOrgId, s1.id, scopeOne)
    check("C1. in-scope store → 200", res.status, 200)
    if (res.status !== 200) throw new Error("C1 failed; the payload checks below need a 200")
    const body = res.body
    // page.tsx spreads its store select (city, state) into each store; the
    // Tasks panel reads none of those, so the route does not send them.
    const pageStore = page.stores.find((s) => s.id === s1.id)!
    const { city: _c, state: _s, ...pageStoreFields } = pageStore as typeof pageStore & { city: unknown; state: unknown }
    check("C2. store entry equals the render's, field for field (day, headerDate, staff with hasPin)", body.store, pageStoreFields)
    check("C2. staff: ACTIVE, store-assigned, by name; hasPin from pinSetAt", body.store.staff.map((s) => [s.displayName, s.hasPin]), [
      ["TAB-8 Staff Ana", true],
      ["TAB-8 Staff Ben", false],
    ])
    const byId = <T extends { id: string }>(xs: T[]) => [...xs].sort((a, b) => a.id.localeCompare(b.id))
    const pageOne = page.checklists.filter((c) => c.storeId === s1.id)
    check("C3. checklists equal the render's for this store, field for field", byId(body.checklists), byId(pageOne))
    const openOut = body.checklists.find((c) => c.id === cOpen.id)
    check(
      "C4. OPEN checklist: live + temp ticked with its value, retired-but-ticked kept (TPL-3 rule 2), retired-unticked and excluded gone",
      openOut?.sections.flatMap((s) => s.tasks.map((t) => [t.label, t.done, t.value])),
      [
        ["TAB-8 open live", true, null],
        ["TAB-8 open temp", true, 38.5],
        ["TAB-8 open retired but ticked today", true, null],
      ]
    )
    check("C4. OPEN checklist: status and flags as stored", [openOut?.status, openOut?.sections[0]?.tasks[1]?.requiresTemp, openOut?.sections[0]?.tasks[1]?.isCritical], ["In Progress", true, true])
    const freshOut = body.checklists.find((c) => c.id === cFresh.id)
    check("C5. FRESH checklist: Pending, every live task, nothing done", [freshOut?.status, freshOut?.sections.flatMap((s) => s.tasks.map((t) => t.done))], ["Pending", [false, false]])
    check("C6. PAST checklist: absent from both — neither the render nor the route reads another day", [body.checklists.some((c) => c.id === cPast.id), page.checklists.some((c) => c.id === cPast.id)], [false, false])
    check("C7. another store's checklist never rides in this answer", body.checklists.some((c) => c.id === cOther.id), false)
    // TAB-16 (2026-11-12) added `help` to the store entry on purpose: the
    // Ask-a-manager sheet's settings, contacts, manager COUNT (never an
    // address) and recent requests. Anything else new still fails here.
    check(
      "C7. nothing else is in the payload",
      [Object.keys(body).sort(), Object.keys(body.store).sort()],
      [["checklists", "pinRequired", "store", "stripTiles"], ["day", "headerDate", "help", "id", "name", "staff", "timezone"]]
    )

    // Gates.
    let scopeAsked = 0
    const counting = async () => {
      scopeAsked++
      return { isAdmin: false, storeIds: [s1.id], role: "STORE" as string | null }
    }
    check("C8. store outside the caller's scope → 403", (await readTabletTasksFor(clerkOrgId, s2.id, scopeOne)).status, 403)
    check("C9. the same store as ADMIN → 200", (await readTabletTasksFor(clerkOrgId, s2.id, admin)).status, 200)
    check("C10. no orgId → 401, scope never asked", [(await readTabletTasksFor(null, s1.id, counting)).status, scopeAsked], [401, 0])
    check("C11. unknown org → 404, scope never asked", [(await readTabletTasksFor(`tab8-fixture-none-${stamp}`, s1.id, counting)).status, scopeAsked], [404, 0])
    check("C12. another org's store → 404 (not 403), scope never asked", [(await readTabletTasksFor(clerkOrgId, sB.id, counting)).status, scopeAsked], [404, 0])
    check("C13. an inactive store → 404 (the page does not list it)", (await readTabletTasksFor(clerkOrgId, sOff.id, admin)).status, 404)
    check("C14. a found store asks the scope exactly once", [(await readTabletTasksFor(clerkOrgId, s1.id, counting)).status, scopeAsked], [200, 1])

    // Zero writes, measured: nothing in the fixture org changed across the reads above.
    const counts = async () => [
      await prisma.checklist.count({ where: { organizationId: org.id } }),
      await prisma.taskLog.count({ where: { checklist: { organizationId: org.id } } }),
      await prisma.auditLog.count({ where: { organizationId: org.id } }),
      (await prisma.checklist.findUniqueOrThrow({ where: { id: cFresh.id }, select: { status: true, startedAt: true } })).startedAt,
    ]
    const before = await counts()
    await readTabletTasksFor(clerkOrgId, s1.id, scopeOne)
    await readTabletTasksFor(clerkOrgId, s2.id, admin)
    check("C15. reads change nothing: checklists, ticks, AuditLog rows, the fresh row's startedAt", await counts(), before)

    // ── TAB-8 fix (Gary, 2026-11-11): the PIN switch and the tile order reach
    // the tablet within ONE cycle. "One cycle" = one route read, merged with
    // applyItemsOutcome, starting from what the first load rendered. The
    // switch is flipped on THIS fixture org only (by id); restored in finally
    // with the org itself.
    const { pinGateApplies } = await import("../src/lib/tablet-pin-gate")
    const { stripTileKeys } = await import("../src/lib/display-layout")
    const orgRow = () => prisma.organization.findUniqueOrThrow({ where: { id: org.id }, select: { tabletPinRequired: true, tabletLayout: true } })
    // What page.tsx renders for a STORE login at first load.
    const first = await orgRow()
    let state: TabletServerData = {
      stores: page.stores,
      checklists: page.checklists,
      pinRequired: pinGateApplies(first, "STORE"),
      stripTiles: stripTileKeys(first.tabletLayout),
    }
    const oneCycle = async (scope: typeof scopeOne) => {
      const r = await readTabletTasksFor(clerkOrgId, s1.id, scope)
      if (r.status !== 200) throw new Error(`read answered ${r.status}`)
      state = applyItemsOutcome(state, { kind: "ok", slice: r.body })
      return r.body
    }
    check("C17. first load: switch off, no tiles (an org's defaults)", [state.pinRequired, state.stripTiles], [false, []])

    await prisma.organization.update({ where: { id: org.id }, data: { tabletPinRequired: true } })
    const afterOn = await oneCycle(scopeOne)
    check("C18. switch flipped ON → the STORE tablet shows PINs after one read", state.pinRequired, true)
    check("C18. ...and the route agrees with page.tsx's own computation", afterOn.pinRequired, pinGateApplies(await orgRow(), "STORE"))
    const asAdmin = await readTabletTasksFor(clerkOrgId, s1.id, admin)
    check("C19. switch ON, ADMIN login → no PIN (TAB-4 Q2a, as page.tsx)", asAdmin.status === 200 ? asAdmin.body.pinRequired : null, false)

    await prisma.organization.update({ where: { id: org.id }, data: { tabletPinRequired: false } })
    await oneCycle(scopeOne)
    check("C20. switch flipped OFF → the STORE tablet stops asking for PINs after one read", state.pinRequired, false)

    const layout = (keys: [string, boolean][]) => keys.map(([key, enabled]) => ({ key, enabled }))
    await prisma.organization.update({
      where: { id: org.id },
      data: { tabletLayout: layout([["tasks", true], ["messages", true], ["sales", true], ["monthly-goal", true], ["labor-pct", false]]) },
    })
    await oneCycle(scopeOne)
    check("C21. tiles switched on → shown in the saved order after one read", state.stripTiles, ["sales", "monthly-goal"])
    await prisma.organization.update({
      where: { id: org.id },
      data: { tabletLayout: layout([["tasks", true], ["messages", true], ["labor-pct", true], ["monthly-goal", true], ["sales", true]]) },
    })
    const reordered = await oneCycle(scopeOne)
    check("C22. a tile-order change (and one more tile) → the new order after one read", state.stripTiles, ["labor-pct", "monthly-goal", "sales"])
    check("C22. ...and the route agrees with page.tsx's own computation", reordered.stripTiles, stripTileKeys((await orgRow()).tabletLayout))

    // Negative control: the same change, but the read fails — nothing moves.
    await prisma.organization.update({ where: { id: org.id }, data: { tabletPinRequired: true, tabletLayout: Prisma.DbNull } })
    const held = applyItemsOutcome(state, { kind: "failed" })
    check("C23 NC. a failed read after the flip: switch and tiles stay as last read", [held.pinRequired, held.stripTiles], [false, ["labor-pct", "monthly-goal", "sales"]])
    check("C23 NC. an out-of-scope read (403) carries no flags to merge", "pinRequired" in (await readTabletTasksFor(clerkOrgId, s2.id, scopeOne)).body, false)
  } finally {
    for (const id of [org.id, orgB.id]) {
      await prisma.taskLog.deleteMany({ where: { checklist: { organizationId: id } } })
      await prisma.checklist.deleteMany({ where: { organizationId: id } })
      await prisma.task.deleteMany({ where: { template: { organizationId: id } } })
      await prisma.section.deleteMany({ where: { template: { organizationId: id } } })
      await prisma.template.deleteMany({ where: { organizationId: id } })
      await prisma.staffMember.deleteMany({ where: { organizationId: id } })
      await prisma.store.deleteMany({ where: { organizationId: id } })
      await prisma.organization.deleteMany({ where: { id } })
    }
    const left = await prisma.organization.count({ where: { clerkOrgId: { startsWith: "tab8-fixture" } } })
    check("C16. cleanup: no TAB-8 fixture orgs left", left, 0)
    await prisma.$disconnect()
  }
}

const runDb = !process.argv.includes("--no-db")
Promise.resolve()
  .then(() => structure())
  .then(() => pure())
  .then(() => (runDb ? db() : console.log("\nC. skipped (--no-db)")))
  .catch((e) => {
    failures++
    console.error("FAIL  async section threw:", e)
  })
  .finally(() => {
    console.log(`\nTAB-8: ${passes}/${passes + failures} passed`)
    process.exit(failures > 0 ? 1 : 0)
  })
