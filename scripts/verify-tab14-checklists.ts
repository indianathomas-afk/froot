/**
 * TAB-14 — the tablet Checklists page, pinned.
 *
 *   npx tsx scripts/verify-tab14-checklists.ts
 *
 * PURE, in the verify-tab13-switcher.ts style, plus a few SOURCE checks
 * (labelled "source:") where the rule is a line of wiring rather than a value.
 *
 * WHAT THIS CAN DETECT:
 *   - THE STORE FILTER (R2) — the page resolving a different store from tablet
 *     Home and the rail: a saved id this login can see wins; a stale or "all"
 *     id falls back to the FIRST store of Home's list (active, name asc — the
 *     tablet branch's query). Cases 1-4.
 *   - THE ORDER AND "DONE TODAY" (R4) — TAB-13's RN-3 order kept, completed
 *     split off into Done today, Missed never shown; the staging Las Brisas
 *     shape from the Gate 1 audit. Cases 5-8.
 *   - THE BANNER'S STORE FILTER (R8) — the feed asked for this store only, the
 *     desktop mounts still asking for every store, and the set matching tablet
 *     Home's chip. Cases 9-12.
 *   - RN-6 NAMING AND THE TEMPLATE-NAME LINE (R5 + RN-3 as amended: same
 *     normalization and aliases as checklist-types.ts) — and that moving
 *     Home's labelOf into checklistTitle changed nothing. Cases 13-22.
 *   - THE CHIPS (RN-1 as amended) — "Opens <time>" in the STORE's zone, and
 *     dueChipLabel reading exactly as Home's old dueLabel. Cases 23-26.
 *   - START (RN-2) — the shared POST is the request tablet Home sent, with
 *     Home's sentences, and hands back the row id. Cases 27-32.
 *
 * WHAT IT CANNOT DETECT: what the routes return, whether the page renders
 * these classes, whether the refresh cycle fires (tablet-refresh.tsx's timer
 * is verify-tab5-refresh's), or anything about a real browser. Gate 3 / 5.
 */
import { readFileSync } from "node:fs"
import { resolveSingleStore } from "../src/lib/dashboard-store"
import { dueChipLabel, opensChipLabel, orderTodayChecklists, splitForChecklistsPage, type TodayEntry } from "../src/lib/tablet-today"
import { checklistTitle, normalizeTypeName, templateNameLine, type NamedChecklist } from "../src/lib/checklist-types"
import { dueChipFor, dueFeedUrl } from "../src/lib/tablet-due"
import { formatWindowTime } from "../src/lib/checklist-status-display"
import { START_FORBIDDEN_MESSAGE, START_OFFLINE_MESSAGE, startTodayChecklist } from "../src/lib/checklist-start"

let failures = 0

function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  const ok = a === e
  if (!ok) failures++
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}`)
  if (!ok) console.log(`      expected ${e}\n      actual   ${a}`)
}

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")

async function main() {
  // ── R2: which store ─────────────────────────────────────────────────────────
  console.log("R2 — the store (resolveSingleStore over Home's list)")
  const stores = [{ id: "s-carson" }, { id: "s-lasbrisas" }, { id: "s-sparks" }]
  check("1. a saved id this login can see is the store", resolveSingleStore(stores, "s-lasbrisas")?.id, "s-lasbrisas")
  check("2. a stale saved id (another login's store) falls back to the first", resolveSingleStore(stores, "s-elsewhere")?.id, "s-carson")
  check("3. the rollup sentinel 'all' falls back to the first", resolveSingleStore(stores, "all")?.id, "s-carson")
  const page = src("src/app/(app)/checklists/page.tsx")
  const tabletQuery = page.slice(page.indexOf("async function getTabletChecklists"), page.indexOf("export default async function"))
  check(
    "4. source: the tablet branch's store list is Home's (active, name asc, scoped) and the branch returns before the desktop page",
    [
      tabletQuery.includes("isActive: true"),
      tabletQuery.includes('orderBy: { name: "asc" }'),
      tabletQuery.includes("getUserStoreScope()"),
      page.indexOf('(await getViewMode()) === "tablet"') < page.indexOf("const { store } = await searchParams"),
    ],
    [true, true, true, true]
  )

  // ── R4: order and Done today ────────────────────────────────────────────────
  console.log("R4 — order (TAB-13 RN-3) and Done today")
  type E = TodayEntry & { started: boolean }
  const e = (id: string, state: TodayEntry["lifecycleState"], end: string | null, started = false): E => ({
    id,
    name: id,
    existingChecklistId: started || state === "completed" ? `row-${id}` : null,
    lifecycleState: state,
    expectedEndAt: end,
    started,
  })
  // Staging, Las Brisas, 2026-11-11 (Gate 1 audit b): Closer upcoming, no row;
  // Mid-Shift active, Pending row; Opener overdue, In Progress; Overdue Test
  // (Cleaning) completed.
  const lasBrisas = [
    e("Closer Checklist", "upcoming", "2026-11-12T07:00:00.000Z"),
    e("Mid-Shift Checklist", "active", "2026-11-12T03:00:00.000Z"),
    e("Opener Checklist", "overdue", "2026-11-11T17:00:00.000Z", true),
    e("Overdue Test", "completed", "2026-11-12T08:00:00.000Z"),
  ]
  const split = splitForChecklistsPage(orderTodayChecklists(lasBrisas, (x) => x.started))
  check("5. Las Brisas: in progress, then due now, then upcoming as tiles", split.tiles.map((x) => x.id), [
    "Opener Checklist",
    "Mid-Shift Checklist",
    "Closer Checklist",
  ])
  check("6. Las Brisas: the completed one is in Done today, not a tile", split.doneToday.map((x) => x.id), ["Overdue Test"])
  const two = splitForChecklistsPage(
    orderTodayChecklists(
      [e("B", "completed", "2026-11-11T20:00:00.000Z"), e("A", "completed", "2026-11-11T18:00:00.000Z"), e("C", "active", null)],
      (x) => x.started
    )
  )
  check("7. Done today keeps the RN-3 order (earliest due first)", [two.tiles.map((x) => x.id), two.doneToday.map((x) => x.id)], [["C"], ["A", "B"]])
  check(
    "8. Missed is never a tile or a Done-today row",
    splitForChecklistsPage(orderTodayChecklists([e("M", "missed", null), e("D", "active", null)], () => false)),
    { tiles: [e("D", "active", null)], doneToday: [] }
  )

  // ── R8: the banner's store filter ───────────────────────────────────────────
  console.log("R8 — the overdue banner, this store only")
  check("9. a store asks the feed for that store only", dueFeedUrl("s-lasbrisas"), "/api/calendar/due?storeId=s-lasbrisas")
  check("10. no store (the desktop mounts) asks for every store, as before", [dueFeedUrl(undefined), dueFeedUrl(null), dueFeedUrl("")], [
    "/api/calendar/due",
    "/api/calendar/due",
    "/api/calendar/due",
  ])
  const feed = [
    { id: "1", storeId: "s-lasbrisas", dueAt: "2026-09-25T20:00:00.000Z", daysOverdue: 47 },
    { id: "2", storeId: "s-meadowood", dueAt: "2026-11-10T20:00:00.000Z", daysOverdue: 1 },
    { id: "3", storeId: "s-lasbrisas", dueAt: "2026-11-11T23:00:00.000Z", daysOverdue: 0 },
  ]
  // The route's ?storeId= keeps exactly the rows whose storeId is that store
  // (resolveStoreScope → [storeId] → `storeId: { in: [storeId] }`), which is
  // the filter tablet Home's chip applies client-side.
  check(
    "11. this store's set is the set tablet Home's chip keeps (same items, same overdue count)",
    (() => {
      const chip = dueChipFor(feed, "s-lasbrisas", "2026-11-11T22:00:00.000Z")
      return [chip.items.map((i) => i.id), chip.overdue]
    })(),
    [["1", "3"], 1]
  )
  const tabletSrc = src("src/app/(app)/checklists/checklists-tablet.tsx")
  const bannerSrc = src("src/components/calendar-due-banner.tsx")
  check(
    "12. source: the tablet page passes its store; the banner's feed URL comes from dueFeedUrl; desktop page passes none",
    [
      /<CalendarDueBanner[^>]*storeId=\{store\.id\}/.test(tabletSrc),
      bannerSrc.includes("const feedUrl = dueFeedUrl(storeId)"),
      /<CalendarDueBanner pinRequired=\{pin\.pinRequired\} pinStaffByStore=\{pin\.pinStaffByStore\} \/>/.test(page),
    ],
    [true, true, true]
  )

  // ── RN-6 naming and the template-name line ──────────────────────────────────
  console.log("Naming — RN-6 title and the RN-3 template line")
  const n = (id: string, type: string | null): NamedChecklist => ({ id, name: id, type })
  // Home's labelOf before TAB-14 moved it (tablet-home.tsx, 993977f), verbatim.
  const typeOf = (x: NamedChecklist) => x.type?.trim() || x.name
  const homeLabelOf = (x: NamedChecklist, all: NamedChecklist[]) =>
    all.some((o) => o.id !== x.id && normalizeTypeName(typeOf(o)) === normalizeTypeName(typeOf(x))) ? x.name : typeOf(x)
  const days: NamedChecklist[][] = [
    [n("Opener Checklist", "Opener"), n("Mid-Shift Checklist", "Mid-Shift"), n("Overdue Test", "Cleaning")],
    [n("Deep clean", "Cleaning"), n("Overdue Test", "Cleaning"), n("Closer Checklist", "Closer")],
    [n("No type", ""), n("Also none", "  "), n("Mid A", "Mid Shift"), n("Mid B", "MID-SHIFT")],
    [n("Close up", "Closer"), n("Closing", "Closing")],
  ]
  check(
    "13. checklistTitle is Home's old labelOf on every case (the move changed nothing)",
    days.flatMap((all) => all.map((x) => checklistTitle(x, all) === homeLabelOf(x, all))).every(Boolean),
    true
  )
  const lb = [n("Closer Checklist", "Closer"), n("Mid-Shift Checklist", "Mid-Shift"), n("Opener Checklist", "Opener"), n("Overdue Test", "Cleaning")]
  check("14. Las Brisas titles are the type names", lb.map((x) => checklistTitle(x, lb)), ["Closer", "Mid-Shift", "Opener", "Cleaning"])
  check("15. 'Overdue Test' (Cleaning) gets its template name as a second line", templateNameLine(lb[3], lb), "Overdue Test")
  check("16. Keva's own templates say their type already — no second line", [lb[0], lb[1], lb[2]].map((x) => templateNameLine(x, lb)), [
    null,
    null,
    null,
  ])
  const alias = [n("Closing duties", "Closer"), n("Closer jobs", "Closing")]
  check("17. Closer = Closing both ways (the alias)", alias.map((x) => templateNameLine(x, [x])), [null, null])
  check(
    "18. case, spaces and punctuation are ignored (letters only)",
    [templateNameLine(n("MID SHIFT tasks", "Mid-Shift"), []), templateNameLine(n("open-er list", "Opener"), [])],
    [null, null]
  )
  check("19. a type the key does not know compares by its own name", [
    templateNameLine(n("Weekly deep clean", "Deep Clean"), []),
    templateNameLine(n("Morning tasks", "Prep"), []),
  ], [null, "Morning tasks"])
  const dup = [n("Deep clean", "Cleaning"), n("Overdue Test", "Cleaning")]
  check("20. two of a type: titles are the template names (RN-6) and no second line", [
    dup.map((x) => checklistTitle(x, dup)),
    dup.map((x) => templateNameLine(x, dup)),
  ], [["Deep clean", "Overdue Test"], [null, null]])
  check("21. no type name: the title is the template name, no second line", [
    checklistTitle(n("Inventory", ""), []),
    templateNameLine(n("Inventory", ""), []),
  ], ["Inventory", null])
  check("22. a template named exactly its type: no second line", templateNameLine(n("cleaning", "Cleaning"), []), null)

  // ── The chips ───────────────────────────────────────────────────────────────
  console.log("Chips — RN-1 Opens <time>, and Home's Due label")
  const tz = "America/Los_Angeles"
  check("23. 'Opens' is the window start in the STORE's zone", opensChipLabel({ expectedStartAt: "2026-11-12T01:00:00.000Z", timeZone: tz }), "Opens 5:00 PM")
  check("24. … and in another store's zone, the same instant reads its own time", opensChipLabel({ expectedStartAt: "2026-11-12T01:00:00.000Z", timeZone: "America/Denver" }), "Opens 6:00 PM")
  check("25. no window start → no Opens chip (the tile falls back to Due)", [opensChipLabel({ expectedStartAt: null, timeZone: tz }), opensChipLabel({ timeZone: tz })], [null, null])
  // Home's dueLabel before TAB-14 moved it (tablet-home.tsx, 993977f), verbatim.
  const homeDueLabel = (x: { expectedEndAt: string | null; lifecycleState: TodayEntry["lifecycleState"]; timeZone: string }) => {
    if (!x.expectedEndAt) return null
    const at = formatWindowTime(new Date(x.expectedEndAt), x.timeZone)
    return x.lifecycleState === "overdue" ? `Overdue · was due ${at}` : `Due ${at}`
  }
  const dueCases = [
    { expectedEndAt: "2026-11-12T03:00:00.000Z", lifecycleState: "active" as const, timeZone: tz },
    { expectedEndAt: "2026-11-11T17:00:00.000Z", lifecycleState: "overdue" as const, timeZone: tz },
    { expectedEndAt: null, lifecycleState: "upcoming" as const, timeZone: tz },
  ]
  check("26. dueChipLabel is Home's old dueLabel", dueCases.map(dueChipLabel), dueCases.map(homeDueLabel))

  // ── Start ───────────────────────────────────────────────────────────────────
  console.log("Start — the shared POST (RN-2)")
  const calls: { url: string; init: RequestInit | undefined }[] = []
  const fake =
    (status: number, body: unknown): typeof fetch =>
    async (url, init) => {
      calls.push({ url: String(url), init })
      return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
    }
  const created = await startTodayChecklist("tpl-closer", "s-lasbrisas", fake(201, { id: "row-new" }))
  check(
    "27. the request is tablet Home's: POST /api/checklists, JSON {templateId, storeId}",
    [calls[0].url, calls[0].init?.method, calls[0].init?.body, (calls[0].init?.headers as Record<string, string>)["Content-Type"]],
    ["/api/checklists", "POST", JSON.stringify({ templateId: "tpl-closer", storeId: "s-lasbrisas" }), "application/json"]
  )
  check("28. 201 hands back the new row's id", created, { ok: true, id: "row-new" })
  check("29. 200 (today's row already exists) hands back that row", await startTodayChecklist("t", "s", fake(200, { id: "row-old" })), {
    ok: true,
    id: "row-old",
  })
  check("30. 403 is Home's sentence", await startTodayChecklist("t", "s", fake(403, { error: "Forbidden" })), {
    ok: false,
    error: START_FORBIDDEN_MESSAGE,
  })
  check(
    "31. any other refusal is the route's own error, else Home's fallback",
    [
      await startTodayChecklist("t", "s", fake(409, { error: "This template runs weekly or monthly. Add it to the calendar to schedule it." })),
      await startTodayChecklist("t", "s", fake(500, undefined)),
    ],
    [
      { ok: false, error: "This template runs weekly or monthly. Add it to the calendar to schedule it." },
      { ok: false, error: "Couldn't start (error 500)." },
    ]
  )
  const offline = await startTodayChecklist("t", "s", async () => {
    throw new TypeError("Failed to fetch")
  })
  check("32. no connection is Home's sentence, and it never throws", offline, { ok: false, error: START_OFFLINE_MESSAGE })

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

void main()
