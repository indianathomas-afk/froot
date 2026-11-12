"use client"

import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react"
import { createPortal } from "react-dom"
import Link from "next/link"
import { AlertTriangle, Check, ChevronDown, ChevronRight, Clock, Delete, GraduationCap } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { BottomSheet } from "@/components/ui/bottom-sheet"
import { PinPad } from "@/components/tablet-pin/pin-pad"
import { isPinRefusal, whoOptions, type PinSession, type WhoOption } from "@/lib/tablet-pin-options"
import { TouchCheck, TouchRow } from "@/components/ui/touch-row"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { formatWindowTime } from "@/lib/checklist-status-display"
import { resolveSingleStore, saveStoreId, useSavedStoreId } from "@/lib/dashboard-store"
import {
  dueChipLabel,
  initialSwitcher,
  orderTodayChecklists,
  shownChecklist,
  switcherReducer,
  type TodayEntry,
} from "@/lib/tablet-today"
import { checklistTitle, checklistTypeStyle } from "@/lib/checklist-types"
import { readError, startTodayChecklist } from "@/lib/checklist-start"
import { ChecklistHero, ChecklistTabs } from "./tablet-checklist-switcher"
import { dueChipFor, dueRowSuffix } from "@/lib/tablet-due"
import {
  CHIP_TONE_CLASS,
  IDLE_CHECK_MS,
  idleWindow,
  cardsBusy,
  cardsReducer,
  dueChipTone,
  hrChipFor,
  initialCards,
  pageScrollReset,
  restoreTarget,
  rolloverDue,
  showHrChip,
  visibleExpanded,
  type CardsEvent,
} from "@/lib/tablet-cards"
import { dayRolledOver, nextShownDay, pruneOverrides, type TickOverride } from "@/lib/tablet-refresh"
import {
  applyItemsOutcome,
  initialItemsHealth,
  itemsNotice,
  nextItemsHealth,
  readTabletTasks,
  type ItemsHealth,
  type TabletServerData,
} from "@/lib/tablet-tasks-refresh"
import type { OwedSummary } from "@/lib/hr-compliance"
import { fetchCard } from "./card-fetch"
import { StripDetail, StripRow, renderedTileKeys, useStripSummary } from "./tablet-strip"
import { MessagesColumn } from "./tablet-messages"
import {
  TabletRefreshProvider,
  useBusyFlag,
  useRefreshLoader,
  useTabletRefresh,
  useTabletRefreshController,
  type RefreshCycle,
} from "./tablet-refresh"
import type { TabletChecklist, TabletStore, TabletTask, TaskHowTo } from "./tablet-data"
import {
  CloseWhenStale,
  DoneToast,
  HowToExpanded,
  HowToImage,
  HowToPanel,
  HowToPill,
  HowToPlayer,
  usePortrait,
  type HowToLayer,
  type HowToOpen,
} from "./tablet-howto"

/** TAB-1b — one button on the name sheet. `id` is what goes in
 *  `completedByStaffId`: "manager" for both generic options, as on desktop.
 *  TAB-4: the shape (and the list) now live in src/lib/tablet-pin-options.ts,
 *  shared with every desktop picker; it adds `disabled` / `note` for Q6. */
type PickerOption = WhoOption

/** TAB-1b — who the following ticks are credited to, for one checklist. */
type Person = { checklistId: string; id: string; label: string }

// TAB-1b's pickerOptions() lived here: the two generic options (both send
// "manager", which the task-log route saves as no name), then the store's
// ACTIVE staff by name. TAB-4 moved it to whoOptions() in
// src/lib/tablet-pin-options.ts, unchanged while PINs are off; while they are
// on (a STORE login, Q2a) the generics go (Q7) and a person with no PIN is
// greyed out (Q6).

// TAB-1 — the tablet home on /dashboard (Direction 1 · Status Stage).
//
// Left: the Tasks panel — Not started / In progress / Done. Right: the existing
// Team Messages card, unchanged (TAB-2 replaces it). No Sales, Goal or Labor
// (Gary's ruling 4). Each column scrolls on its own; the page does not.
// TAB-2, 2026-11-10 — appended; the line above describing the right column is
// spent. The right column is now the Messages column (./tablet-messages.tsx):
// Corporate Update pinned, the thread, a composer fixed at the bottom. In
// portrait it stacks below Tasks. The stat strip moved to TAB-3 (Gary,
// 2026-11-10).
//
// EVERY WRITE IS AN EXISTING ENDPOINT, CALLED THE WAY ITS EXISTING SCREEN CALLS IT:
//   tick / untick   POST /api/checklists/[id]/task-log   (the execution page)
//   value entry     the same route's `temperatureValue`  (accepted since Phase 1)
//   Start, no row   POST /api/checklists {templateId, storeId} (Start Daily Checklist)
//   Submit button   POST /api/checklists/[id]/submit     (the execution page's Submit)
//   due list        POST /api/calendar/occurrences/[id]/complete (the due banner)
// Ticks post as the logged-in account with no staff name (ruling 6), exactly
// as the execution page does when its picker's "Team Member" is chosen.
//
// TAB-1b, 2026-11-09 — appended; the two lines above describe adec345 and are
// spent. Ruling 6's premise ("same as today") was wrong: desktop already asks
// "Who completed this task?" on every tick whenever the store has staff (Gary:
// "Agreed, fix it."). The tablet now follows DESKTOP'S RULE EXACTLY — the same
// list (Team Member, Manager, then the store's ACTIVE staff by name), the same
// condition (asked only when the store has staff; required then, since closing
// the sheet ticks nothing, like desktop's Cancel), the same field
// (`completedByStaffId`, with "manager" for both generic options) and the same
// untick (no name sent). Only HOW it asks differs: the first tick of a
// checklist opens "Who's completing these?", the pick sticks as a "Completing
// as …" chip for the following ticks, and it lives in React state only — gone
// on submit, on reload, and when the panel moves to another checklist.
// PARTIAL SUBMIT sends the same submit desktop's "Submit Partial" sends, after
// a confirm sheet; desktop sends it with no confirm.
//
// TAB-9, 2026-11-10 — appended; "Each column scrolls on its own; the page
// does not" above is SPENT, kept. The page scrolls now (ruling 3): the first
// screen opens as before, and the overdue list (in place, under the header)
// and an expanded card (below the first screen) make it longer. Each column
// keeps one screen's height and its own scroll, but no longer carries
// overscroll-contain, so a flick that reaches a column's end carries on into
// the page instead of stopping dead (audit point 2). Expansion, idle collapse
// and scroll restore: the TAB-9 block in TabletHome and src/lib/tablet-cards.ts.
//
// SUBMIT IS A DELIBERATE TAP, NEVER A SIDE EFFECT OF A TICK (Gary, 2026-11-09,
// TAB-1 fix — replaces adec345's last-tick submit). When every item is ticked
// the In progress panel shows one full-width "Submit <NAME> checklist" button,
// which sends the same submit the desktop Submit button sends. Unticking an
// item hides it again. Done appears ONLY after that submit succeeds with
// status Completed; on failure the error shows and the button stays.
// Why Done waits for submit: a checklist only becomes Completed through submit,
// and the day-close cron files every row that is not Completed as Missed —
// fully ticked or not (api/cron/checklist-day-close). A Done panel over an
// unsubmitted row would be false.

/** One row of GET /api/stores/[id]/templates — the Start Daily Checklist list. */
type TodayRow = TodayEntry & {
  /** TAB-13 — the TemplateType name (route.ts:134; legacy `type` when unset). */
  type: string
  taskCount: number
  existingStatus: string | null
  timeZone: string
}

type DueItem = {
  id: string
  title: string
  categoryLabel: string
  storeId: string
  dueAt: string
  daysOverdue: number
  templateId: string | null
  checklistId: string | null
}

type Override = TickOverride

/** TAB-5 — `value` while `usable`, otherwise the last value that was usable.
 *  How the tablet home keeps showing the day it is on while the server has
 *  already moved to the next one but the page is busy (ruling 3): the new
 *  day's data waits, it never replaces the old day's under an open sheet.
 *  `value` must be referentially stable between renders. */
function useHeld<T>(value: T, usable: boolean): T {
  const [held, setHeld] = useState(value)
  if (usable && held !== value) setHeld(value)
  return usable ? value : held
}

// TAB-14: readError() moved to src/lib/checklist-start.ts, unchanged, with
// Start's POST (RN-2); imported above.

/** TAB-4 — readError plus the route's `code`, so a PIN refusal can drop the
 *  device's session and ask again. */
async function readErrorBody(res: Response): Promise<{ error: string | null; code: string | null }> {
  try {
    const body = (await res.json()) as { error?: unknown; code?: unknown }
    return {
      error: typeof body.error === "string" ? body.error : null,
      code: typeof body.code === "string" ? body.code : null,
    }
  } catch {
    return { error: null, code: null }
  }
}

type SetPin = React.Dispatch<React.SetStateAction<PinSession | null>>

/** One empty tile list, so a missing prop keeps its identity across renders. */
const NO_TILES: string[] = []

export function TabletHome({
  stores: propStores,
  checklists: propChecklists,
  stripTiles: propStripTiles = NO_TILES,
  role = null,
  pinRequired: propPinRequired = false,
}: {
  stores: TabletStore[]
  checklists: TabletChecklist[]
  /** TAB-3 — the stat strip's enabled tiles in the ADMIN's order (stripTileKeys
   *  in page.tsx). Empty — the default — renders no strip and leaves this
   *  layout byte-identical to TAB-2b's. */
  stripTiles?: string[]
  /** TAB-9 fix — the login's role (page.tsx, getUserStoreScope). Only used to
   *  hide the personal HR chip on a shared STORE login (Gary, 2026-11-10). */
  role?: string | null
  /** TAB-4 — the org's "Require a PIN on shared tablets" is on AND this is a
   *  STORE login (page.tsx). False = every screen here is exactly TAB-9's. */
  pinRequired?: boolean
}) {
  // ── TAB-8: the server half, re-read through GET /api/stores/[id]/tablet-tasks ──
  // Starts as this render's props (a fresh read). Every answered re-read
  // replaces the selected store's entry and its checklists (mergeStoreSlice);
  // a failed or expired one changes nothing. A NEW render's props (a navigation
  // back to /dashboard) are newer than any earlier fetch, so they replace it.
  // TAB-8 fix (Gary, 2026-11-11): pinRequired and stripTiles ride on the same
  // answer, so a Shared Tablets switch flipped either way, or a tile-order
  // change, shows within one cycle. `role` (the HR chip), the rail and the
  // store LIST stay as first rendered until a reload — his ruling, kept.
  const fromProps = (): TabletServerData => ({
    stores: propStores,
    checklists: propChecklists,
    pinRequired: propPinRequired,
    stripTiles: propStripTiles,
  })
  const [live, setLive] = useState<TabletServerData>(fromProps)
  const [propsSeen, setPropsSeen] = useState(fromProps)
  if (
    propsSeen.stores !== propStores ||
    propsSeen.checklists !== propChecklists ||
    propsSeen.pinRequired !== propPinRequired ||
    propsSeen.stripTiles !== propStripTiles
  ) {
    const next = fromProps()
    setPropsSeen(next)
    setLive(next)
  }
  const stores = live.stores
  const pinRequired = live.pinRequired
  const stripTiles = live.stripTiles
  const savedStoreId = useSavedStoreId()
  // The latest server render's store. What the page SHOWS may be held one day
  // behind it (TAB-5, below).
  const latestStore = resolveSingleStore(stores, savedStoreId)
  const storeId = latestStore?.id ?? ""
  const storeTimeZone = latestStore?.timezone ?? ""

  // ── TAB-5: the day the tablet home is showing, per store (ruling 2) ──
  // Starts as the server's day for each store. Moves only to a day the SERVER
  // has rendered (nextShownDay), and only while nothing is busy (ruling 3).
  // Until it moves, the previous render's stores and checklists stay on screen.
  const [shown, setShown] = useState<Record<string, string>>(() =>
    Object.fromEntries(stores.map((s) => [s.id, s.day]))
  )
  const shownDay = latestStore ? (shown[latestStore.id] ?? latestStore.day) : ""
  const server = live
  const view = useHeld(server,!latestStore || latestStore.day === shownDay)
  const store = latestStore ? (view.stores.find((s) => s.id === latestStore.id) ?? latestStore) : undefined

  // What the controller's callbacks read: the latest values, not the ones
  // their closure saw.
  const serverDay = latestStore?.day ?? ""
  const latest = useRef({ storeId, serverDay, shownDay })
  useLayoutEffect(() => {
    latest.current = { storeId, serverDay, shownDay }
  })

  // ── Today's checklists for this store (the Start Daily Checklist list) ──
  // TAB-5: a list read after the store's midnight belongs to the NEXT day. It
  // is not shown until the page has moved to that day (ruling 2, only while
  // idle — ruling 3), so it never lands under yesterday's checklist; moving
  // re-reads it (the effect below keys on shownDay).
  const [today, setToday] = useState<{ storeId: string; rows: TodayRow[] | null } | null>(null)
  // Promise chains rather than async/await so every setState sits in a
  // callback — the same shape the desktop dashboard's loaders use. Resolves
  // true when the list answered. A failed RE-read (refresh) keeps what is
  // showing — BUG-6's rule, never flip real data into an error state.
  const loadToday = useCallback(
    (refresh = false): Promise<boolean> => {
      if (!storeId) return Promise.resolve(false)
      const fetchedAt = new Date()
      return fetch(`/api/stores/${storeId}/templates`)
        .then((res) => (res.ok ? (res.json() as Promise<TodayRow[]>) : null))
        .catch(() => null)
        .then((rows) => {
          if (rows === null && refresh) return false
          if (rows !== null && dayRolledOver(latest.current.shownDay, fetchedAt, storeTimeZone)) return true
          setToday({ storeId, rows })
          return rows !== null
        })
    },
    [storeId, storeTimeZone]
  )
  const shownToday = today && today.storeId === storeId ? today : null

  // ── The due feed behind the calendar banner ──
  const [due, setDue] = useState<DueItem[] | null>(null)
  const loadDue = useCallback((): Promise<void> => {
    return fetch("/api/calendar/due", { signal: AbortSignal.timeout(12_000) })
      .then((res) => (res.ok ? (res.json() as Promise<{ items: DueItem[] }>) : { items: [] }))
      .catch(() => ({ items: [] as DueItem[] }))
      .then((body) => setDue(body.items))
  }, [])

  // ── TAB-5: the one refresh controller ──
  const cycleRef = useRef<RefreshCycle | null>(null)
  // TAB-8: a cycle the offline guard skipped is a refresh that did not land.
  const missedRef = useRef<(() => void) | null>(null)
  const ctl = useTabletRefreshController(cycleRef, missedRef)

  // TAB-8 — THE SERVER HALF (the Tasks panel's items and ticks, the header
  // date, the store's day and picker names) IS RE-READ THROUGH
  // GET /api/stores/[id]/tablet-tasks, NOT router.refresh(). Until TAB-8 a
  // failed RSC refresh made Next fall back to a full browser navigation, which
  // on a counter iPad with the wifi down left Safari's error page up. A failed
  // fetch keeps the last good list; an expired sign-in shows TAB-4's message
  // instead of reading the sign-in page as data (src/lib/tablet-tasks-refresh.ts).
  // ONE AT A TIME: each waits for the last, so `syncedFrom` is always the start
  // of the read whose answer is on screen.
  const [syncedFrom, setSyncedFrom] = useState(0)
  const [health, setHealth] = useState<ItemsHealth>(() => initialItemsHealth(Date.now()))
  useLayoutEffect(() => {
    missedRef.current = () => setHealth((h) => nextItemsHealth(h, "missed", Date.now()))
  }, [])
  const serverChain = useRef<Promise<void>>(Promise.resolve())
  const refreshServer = useCallback((): Promise<void> => {
    const next = serverChain.current.then(async () => {
      const id = latest.current.storeId
      if (!id) return
      const startedAt = Date.now()
      const outcome = await readTabletTasks(id)
      if (outcome.kind === "ok") {
        setLive((prev) => applyItemsOutcome(prev, outcome))
        setSyncedFrom(startedAt)
      }
      setHealth((h) => nextItemsHealth(h, outcome.kind, Date.now()))
    })
    serverChain.current = next
    return next
  }, [])

  // Ruling 2: move to the server's day if it has moved on and nothing is busy.
  const acceptDay = useCallback(() => {
    const { storeId: id, serverDay: day, shownDay: cur } = latest.current
    if (!id) return
    const next = nextShownDay(cur, day, ctl.busy())
    if (next === cur) return
    setShown((prev) => ({ ...prev, [id]: next }))
    // Yesterday's list goes with yesterday: a skeleton until the new day's
    // list is read (the loadToday effect keys on shownDay).
    setToday(null)
  }, [ctl, setShown, setToday])
  // Switching stores is a tap, not a refresh: show that store's current day.
  useLayoutEffect(() => {
    acceptDay()
  }, [storeId, acceptDay])
  // TAB-8 fix (Gary, 2026-11-11): "re-read on store switch". The route answers
  // for the selected store only, so another store's items, day and names are
  // as old as the last time it was selected (or the first load). A switch
  // re-reads it at once instead of waiting up to a cycle, then acceptDay moves
  // it to the server's day if that has moved on (after midnight). Not on the
  // first render: the page's own render is that read.
  const readFor = useRef(storeId)
  useEffect(() => {
    if (!storeId || readFor.current === storeId) return
    readFor.current = storeId
    void refreshServer().then(acceptDay)
  }, [storeId, refreshServer, acceptDay])

  /** One cycle (ruling 1). The controller calls it only while the page is
   *  visible, idle and not already refreshing. */
  const cycle = useCallback<RefreshCycle>(async (loaders) => {
    // A day the server reached while the page was busy is adopted first.
    acceptDay()
    await Promise.all([
      loadToday(true),
      loadDue(),
      ...loaders.map((load) => load().catch(() => undefined)),
    ])
    // Ruling 4: re-read the items, so ticks made elsewhere show. TAB-8: every
    // cycle, no longer only after the list answered — that gate existed
    // because a failed router.refresh() navigated the whole page, and a failed
    // fetch does not. The route's `store.day` is also what moves the page to a
    // new day (ruling 2): acceptDay() below adopts it while idle.
    await refreshServer()
    acceptDay()
  }, [acceptDay, loadToday, loadDue, refreshServer])
  useLayoutEffect(() => {
    cycleRef.current = cycle
  }, [cycle])

  useEffect(() => {
    void loadToday()
  }, [loadToday, shownDay])
  useEffect(() => {
    void loadDue()
  }, [loadDue])

  /** After a write that changes which checklist is current: re-read the list,
   *  and re-read the server half for the new row's items / completedAt (TAB-8:
   *  through the tablet-tasks route). */
  const refresh = useCallback(async () => {
    await loadToday()
    await refreshServer()
  }, [loadToday, refreshServer])

  const rows = shownToday ? shownToday.rows : undefined
  const checklistsById = useMemo(() => new Map(view.checklists.map((c) => [c.id, c])), [view.checklists])

  // ── TAB-9: expandable cards, the overdue list in place, a page that scrolls ──
  // All of it is React state in this component (ruling 7): never settings, a
  // cookie or storage, so a reload, another device or another day starts it
  // collapsed. The rules are pure, in src/lib/tablet-cards.ts.
  const scope = `${storeId}:${shownDay}`
  const [cards, dispatchCards] = useReducer(cardsReducer, scope, (sc) => initialCards(sc, 0))
  const act = useCallback((e: CardsEvent) => dispatchCards(e), [])

  // ── TAB-4: the device's PIN session (Gary, 2026-11-10) ──
  // One person, one store, one 10-minute token, in React state only — never a
  // cookie or storage, so a reload drops it. Shared by the Tasks panel and the
  // due list, so a PIN entered for one is reused by the other (design choice
  // #1, accepted with the condition that the due list then shows the chip).
  // Q10: the 5-minute idle (the TAB-9 timer) throws it away, which also
  // clears the "Completing as …" chip. Only ever set while pinRequired.
  const [pin, setPin] = useState<PinSession | null>(null)
  if (cards.idle && pin) setPin(null)

  // ── TAB-15: a task's how-to (panel, player, image viewer, expanded row) ──
  // Held here, not in TasksPanel, because in landscape the panel takes the
  // Messages column's place. React state only. Closed by: its own X / Hide,
  // the task being ticked (TasksPanel), a new day or store (the scope check),
  // and the TAB-9 idle — the line below, the same pattern as the PIN
  // session's — which also sends the page to the top (pageScrollReset).
  // TAB-15 ruling (Gary, 2026-11-12): while a How-to is open the idle waits
  // 15 minutes instead of 5 (HOWTO_IDLE_MS, the tick below); nothing else
  // changes.
  // While open it holds the TAB-5 refresh like any sheet (TasksPanel's
  // "tasks:howto" busy flag).
  const [howToState, setHowTo] = useState<HowToOpen | null>(null)
  if (cards.idle && howToState) setHowTo(null)
  const howTo = howToState && howToState.scope === scope ? howToState : null
  const onHowTo = useCallback(
    (next: Omit<HowToOpen, "scope"> | null) => setHowTo(next ? { ...next, scope } : null),
    [scope]
  )
  const portrait = usePortrait()
  // TAB-11: portrait is one column, so the panel never replaces Messages there
  // — the row expands in place instead (design B).
  const sidePanel = !!howTo && !portrait
  const [howToSlot, setHowToSlot] = useState<HTMLDivElement | null>(null)
  // Ruling 4, the day half: a new day (TAB-5's rollover, which only happens
  // while nothing is busy) or another store starts collapsed.
  useLayoutEffect(() => {
    act({ type: "scope", scope })
  }, [act, scope])

  // Ruling 4, the idle half: five minutes with no touch collapses the open
  // card and the open list. The latest touch lives in a ref, so a touch does
  // not re-render the page; the check runs every IDLE_CHECK_MS. NOTHING ELSE
  // collapses them — a refresh cycle never does.
  const lastTouch = useRef(0)
  const idleNow = useRef(cards.idle)
  // TAB-15: an open How-to (panel, player, image or expanded row — all one
  // state) stretches the window to HOWTO_IDLE_MS. A ref, so the interval
  // below reads the current value without being re-created.
  const howToOpen = useRef(howTo !== null)
  useLayoutEffect(() => {
    idleNow.current = cards.idle
    howToOpen.current = howTo !== null
  })
  useEffect(() => {
    lastTouch.current = Date.now()
    const touched = () => {
      lastTouch.current = Date.now()
      if (idleNow.current) act({ type: "touch", at: lastTouch.current })
    }
    const opts = { capture: true, passive: true } as const
    const events = ["pointerdown", "touchstart", "keydown", "wheel"] as const
    for (const ev of events) window.addEventListener(ev, touched, opts)
    const id = window.setInterval(
      () => act({ type: "tick", at: Date.now(), lastTouchAt: lastTouch.current, idleAfterMs: idleWindow(howToOpen.current) }),
      IDLE_CHECK_MS
    )
    return () => {
      for (const ev of events) window.removeEventListener(ev, touched, opts)
      window.clearInterval(id)
    }
  }, [act])

  // Scrolled away from the top (ruling 3's page scroll).
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  // The strip's payload, read here because its tile row sits on the first
  // screen and an expanded card opens below it (tablet-strip.tsx).
  const strip = useStripSummary(storeId, stripTiles.length > 0, ctl.register)
  const shownCard = visibleExpanded(cards.expanded, renderedTileKeys(stripTiles, strip))

  // Ruling 4: what is open holds the refresh, through TAB-5's busy flags.
  // TAB-9 fix (Gary, 2026-11-10): "the day rollover must never be blocked by
  // scroll position" — once a rollover is due the scroll flag is off. Due
  // depends on the clock, so the flags are re-applied every IDLE_CHECK_MS as
  // well as on every render (a render alone would miss midnight).
  const flagInputs = useRef({ cards, shownCard, scrolled, shownDay, serverDay, storeTimeZone })
  const applyFlags = useCallback(() => {
    const f = flagInputs.current
    const due = rolloverDue(f.shownDay, f.serverDay, new Date(), f.storeTimeZone)
    for (const [key, on] of Object.entries(cardsBusy({ ...f.cards, expanded: f.shownCard }, f.scrolled, due))) ctl.setBusy(key, on)
  }, [ctl])
  useLayoutEffect(() => {
    flagInputs.current = { cards, shownCard, scrolled, shownDay, serverDay, storeTimeZone }
    applyFlags()
  })
  useEffect(() => {
    const id = window.setInterval(applyFlags, IDLE_CHECK_MS)
    return () => window.clearInterval(id)
  }, [applyFlags])
  useEffect(
    () => () => {
      for (const key of Object.keys(cardsBusy({ expanded: null, dueOpen: false, idle: true }, false))) ctl.setBusy(key, false)
    },
    [ctl]
  )

  // Ruling 3: a collapse returns the page to where it was before the first
  // card opened; opening one brings its detail into view, keeping the tile
  // row on screen.
  const savedY = useRef<number | null>(null)
  const prevCard = useRef<string | null>(null)
  const stripRowRef = useRef<HTMLDivElement>(null)
  const detailRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const prev = prevCard.current
    if (prev === shownCard) return
    prevCard.current = shownCard
    const saved = savedY.current
    savedY.current = restoreTarget(saved, prev, shownCard, window.scrollY)
    if (shownCard === null) {
      // An idle collapse goes to the top instead (the effect below).
      if (saved !== null && !idleNow.current) window.scrollTo({ top: saved, behavior: "smooth" })
      return
    }
    const row = stripRowRef.current?.getBoundingClientRect()
    const detail = detailRef.current?.getBoundingClientRect()
    if (!row || !detail) return
    const delta = Math.min(detail.bottom - window.innerHeight + 16, row.top - 16)
    if (delta > 0) window.scrollBy({ top: delta, behavior: "smooth" })
  }, [shownCard])

  // TAB-9 fix (Gary, 2026-11-10): after the 5-minute idle — and on a new day
  // or store — the page goes back to the TOP. That also clears the scrolled
  // flag (the scroll listener sees 0), so the TAB-5 refresh resumes. Declared
  // after the collapse effect above so it is the last scroll applied.
  const prevPage = useRef({ idle: cards.idle, scope: cards.scope })
  useLayoutEffect(() => {
    const target = pageScrollReset(prevPage.current, cards)
    prevPage.current = { idle: cards.idle, scope: cards.scope }
    if (target === null) return
    savedY.current = null
    window.scrollTo({ top: target })
  }, [cards])

  // The first screen keeps today's height: the columns (and the strip row)
  // fill what the header leaves of one screen, whatever opens above or below.
  const headerRef = useRef<HTMLElement>(null)
  const [headerH, setHeaderH] = useState(56)
  useLayoutEffect(() => {
    const el = headerRef.current
    if (!el) return
    const measure = () => setHeaderH(el.getBoundingClientRect().height)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [storeId])

  // The overdue list's feed for this store (TAB-1c's filter and label).
  const dueChip = dueChipFor(due ?? [], storeId, new Date().toISOString())
  const dueEmpty = dueChip.label === null
  useEffect(() => {
    if (dueEmpty) act({ type: "closeDue" })
  }, [act, dueEmpty])

  const notice = store ? itemsNotice(health, (at) => formatWindowTime(at, store.timezone)) : null

  if (!store) {
    return (
      <div className="flex min-h-[calc(100dvh-2rem)] items-center justify-center">
        <p className="text-lg text-[var(--color-muted-foreground)]">
          No store is assigned to this login yet. Ask an admin to add one.
        </p>
      </div>
    )
  }

  return (
    <TabletRefreshProvider value={ctl}>
    {/* TAB-9 ruling 3 — the page scrolls (the shell no longer clips it). The
        first screen is the header plus a box exactly one screen minus the
        header tall: the columns and, when enabled, the strip row — so it
        opens as before. The overdue list opens between them (ruling 1) and an
        expanded card below the box (ruling 2), each making the page longer. */}
    <div className="flex flex-col gap-4">
      <header ref={headerRef} className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-baseline gap-3">
          {stores.length > 1 ? (
            <Select value={store.id} onValueChange={saveStoreId} onOpenChange={(open) => ctl.setBusy("store-select", open)}>
              <SelectTrigger className="h-14 w-auto min-w-56 rounded-xl border-none bg-transparent px-2 text-2xl font-bold shadow-none">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {stores.map((s) => (
                  <SelectItem key={s.id} value={s.id} className="py-3 text-lg">
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <h1 className="truncate text-2xl font-bold text-[var(--color-foreground)]">{store.name}</h1>
          )}
          <p className="text-lg text-[var(--color-muted-foreground)]">{store.headerDate}</p>
          {/* TAB-8 lean 6: one quiet line while the re-read is not landing
              (2 in a row) or the device is signed out. The list stays. */}
          {notice && (
            <p role="status" className="text-sm text-[var(--color-muted-foreground)]">
              {notice}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {/* TAB-9 fix (Gary, 2026-11-10): hidden on a shared STORE login,
              kept for personal logins. Not rendered means not fetched. */}
          {showHrChip(role) && <ComplianceChip />}
          {dueChip.label && (
            <DueChip
              label={dueChip.label}
              overdue={dueChip.overdue}
              open={cards.dueOpen}
              onToggle={() => act({ type: "toggleDue", at: Date.now() })}
            />
          )}
        </div>
      </header>

      {cards.dueOpen && dueChip.items.length > 0 && (
        <DuePanel
          items={dueChip.items}
          onClose={() => act({ type: "toggleDue", at: Date.now() })}
          onChanged={loadDue}
          store={store}
          pinRequired={pinRequired}
          pin={pin}
          onPin={setPin}
        />
      )}

      {/* TAB-3 — the stat strip, below both columns (ruling 4). With no tile
          enabled (the default) the columns render exactly as in TAB-2b. With
          tiles enabled, columns and strip share a flex column: a flex gap only
          falls BETWEEN rendered children, so when no tile is visible to this
          viewer StatStrip renders null and leaves no strip container and no
          gap (Gary, 2026-11-10). Each tile still asks its own gate. */}
      {/* TAB-9: the box is the first screen below the header (p-4 top and
          bottom, plus the header's gap: 48px). */}
      <div className="flex shrink-0 flex-col gap-4" style={{ height: `calc(100dvh - ${48 + headerH}px)` }}>
        {columns("min-h-0 flex-1")}
        {stripTiles.length > 0 && (
          <div ref={stripRowRef} className="empty:hidden">
            <StripRow
              data={strip}
              tiles={stripTiles}
              expanded={shownCard}
              onTap={(key) => act({ type: "tap", key, at: Date.now() })}
            />
          </div>
        )}
      </div>

      {strip && shownCard && (
        <div ref={detailRef}>
          <StripDetail data={strip} expanded={shownCard} onShowLess={() => act({ type: "showLess", at: Date.now() })} />
        </div>
      )}
    </div>
    </TabletRefreshProvider>
  )

  function columns(sizing: string) {
    return (
      <div className={`grid ${sizing} gap-4 landscape:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] portrait:grid-cols-[minmax(0,1fr)] portrait:grid-rows-[minmax(0,3fr)_minmax(0,2fr)]`}>
        {/* TAB-13: the card moved inside TasksPanel (TASKS_CARD) so the
            checklist tabs can sit above it, on the page, as in the mock.
            portrait:grid-cols-[minmax(0,1fr)] above: portrait had no column
            template, so the implicit auto column grew to the tab row's
            unwrapped width and pushed the page sideways. */}
        <section className="flex min-h-0 min-w-0 flex-col gap-3">
          {/* TAB-5: keyed by the day too, so a new day starts the panel clean —
              no ticks, "Completing as …" chip or Done state carried over. */}
          <TasksPanel
            key={`${store!.id}:${shownDay}`}
            store={store!}
            rows={rows}
            checklistsById={checklistsById}
            // While the previous day is held on screen, nothing on it has
            // been re-read, so no local tick may be retired yet.
            syncedFrom={view === server ? syncedFrom : 0}
            onRetry={() => void loadToday()}
            onChanged={refresh}
            pinRequired={pinRequired}
            pin={pin}
            onPin={setPin}
            howTo={howTo}
            onHowTo={onHowTo}
            portrait={portrait}
            howToSlot={howToSlot}
          />
        </section>
        {/* TAB-15 (A2): while a how-to is open in landscape the panel takes the
            Messages column's cell. Messages stays MOUNTED (display:none), so a
            half-typed message and its feed survive; `contents` keeps it the
            grid item it always was. Exactly one of the two is a grid item. */}
        <div className={sidePanel ? "hidden" : "contents"}>
          <MessagesColumn key={store!.id} storeId={store!.id} />
        </div>
        <div ref={setHowToSlot} className={sidePanel ? "flex min-h-0 min-w-0 flex-col" : "hidden"} />
      </div>
    )
  }
}

// ─── Tasks panel ──────────────────────────────────────────────────────────────

// TAB-13 — the card the panel draws in. It used to be the <section> itself;
// it moved in here so the checklist tabs sit above it, on the page.
/** TAB-13 — the moment a tick's write settled (toggle(), pruneOverrides).
 *  Lifted out of the component only for react-hooks/purity: after TAB-13
 *  reshaped TasksPanel's render branches, the React Compiler's lint began
 *  reading toggle()'s inline Date.now() as a render-time call. It is not —
 *  toggle() runs only from a tap or a sheet's save, after an await. */
function settledNow(): number {
  return Date.now()
}

const TASKS_CARD =
  "relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl border border-[var(--color-border)] bg-[var(--color-card)]"

function TasksPanel({
  store,
  rows,
  checklistsById,
  syncedFrom,
  onRetry,
  onChanged,
  pinRequired,
  pin,
  onPin,
  howTo,
  onHowTo,
  portrait,
  howToSlot,
}: {
  store: TabletStore
  /** undefined = loading, null = the list failed to load. */
  rows: TodayRow[] | null | undefined
  checklistsById: Map<string, TabletChecklist>
  /** TAB-5 — when the server read behind `checklistsById` started (ms). */
  syncedFrom: number
  onRetry: () => void
  onChanged: () => Promise<void>
  /** TAB-4 — see TabletHome. */
  pinRequired: boolean
  pin: PinSession | null
  onPin: SetPin
  /** TAB-15 — see TabletHome. */
  howTo: HowToOpen | null
  onHowTo: (next: Omit<HowToOpen, "scope"> | null) => void
  portrait: boolean
  /** Where the landscape panel is portalled: the Messages column's cell. */
  howToSlot: HTMLDivElement | null
}) {
  // Local ticks on top of the server's rows, keyed `${checklistId}:${taskId}`,
  // so a tap reads instantly and a refused write can be put back.
  const [overrides, setOverrides] = useState<Record<string, Override>>({})
  // Mirrors `overrides` for reads inside async handlers (the "was that the last
  // item?" check runs after an await). Every write below updates both.
  const overridesRef = useRef<Record<string, Override>>({})
  // TAB-13 — which checklist the card shows and whether its tick list or Done
  // screen is open (src/lib/tablet-today.ts, switcherReducer). This replaces
  // TAB-1's `started` set and `justFinished`: Start on an existing row still
  // writes nothing (audit point 4) — it OPENS the tick list, and the row turns
  // In Progress at its first tick through task-log; a finished checklist's
  // Done screen is an open "done" view, held until the crew moves on. Opening
  // is a manual pick, so a re-read never swaps an open card (addition 1).
  const [sw, dispatch] = useReducer(switcherReducer, initialSwitcher)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [valueFor, setValueFor] = useState<{ checklistId: string; task: TabletTask } | null>(null)
  // TAB-1b — the sticky person. React state ONLY: never a cookie or storage, so
  // it cannot outlive a reload, a day or a device.
  const [person, setPerson] = useState<Person | null>(null)
  // The name sheet. `task` is the tap that opened it (ticked once a name is
  // picked); null when Change opened it.
  const [nameSheet, setNameSheet] = useState<{ checklistId: string; task: TabletTask | null } | null>(null)
  // The partial-submit confirm sheet, its in-sheet error, and the calm done
  // state shown after it lands.
  const [partialFor, setPartialFor] = useState<string | null>(null)
  const [partialError, setPartialError] = useState<string | null>(null)
  const [partialFinished, setPartialFinished] = useState<{ id: string; done: number; total: number } | null>(null)
  // TAB-4 — the PIN sheet: the name just picked and the tap waiting on it.
  const [pinFor, setPinFor] = useState<{ checklistId: string; task: TabletTask | null; option: PickerOption } | null>(null)

  // ── TAB-5: tell the refresh controller when this panel is busy (ruling 3) ──
  const ctl = useTabletRefresh()
  const track = <T,>(p: Promise<T>): Promise<T> => (ctl ? ctl.track(p) : p)
  useBusyFlag("tasks:sheet", !!valueFor || !!nameSheet || !!partialFor || !!pinFor)
  useBusyFlag("tasks:write", busy !== null)
  // TAB-15: an open how-to (panel, player, image, expanded row) is a sheet.
  useBusyFlag("tasks:howto", howTo !== null)
  const closeHowTo = useCallback(() => onHowTo(null), [onHowTo])

  // TAB-15 — A1's "done · 25 of 38" toast. The un-tick path exists (tap a done
  // row, "Tap to undo"), so Undo is that same toggle. `pendingMark` is a Mark
  // done waiting on the name / PIN / °F sheet; once no sheet is open it either
  // ticked (the optimistic override says done) and becomes the toast, or the
  // sheet was closed without a pick and it is dropped.
  const [pendingMark, setPendingMark] = useState<{ checklistId: string; taskId: string } | null>(null)
  const [toast, setToast] = useState<{ checklistId: string; taskId: string } | null>(null)
  if (pendingMark && !nameSheet && !pinFor && !valueFor) {
    setPendingMark(null)
    if (overrides[`${pendingMark.checklistId}:${pendingMark.taskId}`]?.done) setToast(pendingMark)
  }
  useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(() => setToast(null), 6000)
    return () => window.clearTimeout(id)
  }, [toast])
  // Ruling 4: once a server read that began after a tick settled has landed,
  // that tick's local copy is redundant — drop it, so a later change made on
  // another device shows through instead of being masked by it.
  useEffect(() => {
    const pruned = pruneOverrides(overridesRef.current, syncedFrom)
    if (pruned === overridesRef.current) return
    overridesRef.current = pruned
    setOverrides(pruned)
  }, [syncedFrom])

  if (rows === undefined) {
    return (
      <div className={TASKS_CARD}>
        <PanelSkeleton />
        {howTo && <CloseWhenStale onClose={closeHowTo} />}
      </div>
    )
  }
  if (rows === null) {
    return (
      <div className={TASKS_CARD}>
        {howTo && <CloseWhenStale onClose={closeHowTo} />}
        <div className="flex flex-1 flex-col items-start justify-center gap-4 p-8">
          <p className="text-lg text-[var(--color-muted-foreground)]">Couldn&apos;t load today&apos;s checklists.</p>
          <Button size="touch" variant="outline" onClick={onRetry}>
            Retry
          </Button>
        </div>
      </div>
    )
  }
  // Narrowed for the handlers below, which run after an await.
  const todayRows: TodayRow[] = rows
  /** The template-keyed entry for a checklist row id. */
  const entryIdOf = (checklistId: string) => todayRows.find((r) => r.existingChecklistId === checklistId)?.id ?? null

  function tasksOf(c: TabletChecklist): TabletTask[] {
    return c.sections.flatMap((s) =>
      s.tasks.map((t) => {
        const o = overridesRef.current[`${c.id}:${t.id}`]
        return o ? { ...t, done: o.done, value: o.value } : t
      })
    )
  }
  function withOverrides(c: TabletChecklist): TabletChecklist {
    return {
      ...c,
      sections: c.sections.map((s) => ({
        ...s,
        tasks: s.tasks.map((t) => {
          const o = overrides[`${c.id}:${t.id}`]
          return o ? { ...t, done: o.done, value: o.value } : t
        }),
      })),
    }
  }

  /** TAB-13 — the Done screen for a checklist this device just submitted. */
  function openDone(checklistId: string) {
    const id = entryIdOf(checklistId)
    if (id) dispatch({ type: "open", id, view: "done" })
  }

  async function submit(c: TabletChecklist) {
    setBusy(`submit:${c.id}`)
    try {
      const completedTaskIds = tasksOf(c).filter((t) => t.done).map((t) => t.id)
      let res: Response
      try {
        res = await fetch(`/api/checklists/${c.id}/submit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ completedTaskIds }),
        })
      } catch {
        setError("Every item is saved, but the checklist didn't submit — no connection. Check the store's wifi and tap Submit again.")
        return
      }
      if (!res.ok) {
        setError((await readError(res)) ?? `Every item is saved, but the checklist didn't submit (error ${res.status}). Tap Submit again.`)
        return
      }
      const body = (await res.json().catch(() => ({}))) as { status?: string }
      // Done only on a Completed answer. Anything else (an item unticked on
      // another device in the meantime) is a failure: say so, keep the button.
      if (body.status !== "Completed") {
        setError("The checklist didn't submit as complete — an item may have been unticked elsewhere. Check the list and tap Submit again.")
        await onChanged()
        return
      }
      openDone(c.id)
      setPartialFinished(null)
      setPerson(null)
      setError(null)
      await onChanged()
    } finally {
      setBusy(null)
    }
  }

  // TAB-1b — PARTIAL SUBMIT. The same request as desktop's "Submit Partial"
  // (and as submit() above). The server recomputes status from the saved logs:
  // a partial lands In Progress, or Non-Compliant when a critical task is
  // open. Completed means the rest was ticked elsewhere meanwhile, so the
  // normal Done panel shows. Anything else is a failure, c83a5c3's rule: say so
  // and keep the sheet open.
  async function submitPartial(c: TabletChecklist) {
    setBusy(`partial:${c.id}`)
    setPartialError(null)
    try {
      const tasks = tasksOf(c)
      const completedTaskIds = tasks.filter((t) => t.done).map((t) => t.id)
      let res: Response
      try {
        res = await fetch(`/api/checklists/${c.id}/submit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ completedTaskIds }),
        })
      } catch {
        setPartialError("The ticked items are saved, but the checklist didn't submit — no connection. Check the store's wifi and try again.")
        return
      }
      if (!res.ok) {
        setPartialError((await readError(res)) ?? `The ticked items are saved, but the checklist didn't submit (error ${res.status}). Try again.`)
        return
      }
      const body = (await res.json().catch(() => ({}))) as { status?: string }
      if (body.status === "Completed") {
        setPartialFor(null)
        setPerson(null)
        openDone(c.id)
        await onChanged()
        return
      }
      if (body.status !== "In Progress" && body.status !== "Non-Compliant") {
        setPartialError("The checklist didn't submit as expected. Check the list and try again.")
        await onChanged()
        return
      }
      setPartialFor(null)
      setPerson(null)
      setError(null)
      setPartialFinished({ id: c.id, done: completedTaskIds.length, total: tasks.length })
      openDone(c.id)
      await onChanged()
    } finally {
      setBusy(null)
    }
  }

  /** TAB-4 — the token this device holds for that person here, or null. */
  function tokenFor(staffId: string | null): string | null {
    return pinRequired && pin && staffId && pin.staffId === staffId && pin.storeId === store.id ? pin.token : null
  }

  async function toggle(
    c: TabletChecklist,
    task: TabletTask,
    value: number | null = null,
    staffId: string | null = null,
    // TAB-4: passed in rather than read from `pin`, so a tick fired in the same
    // event as a fresh PIN check carries the fresh token.
    token: string | null = null
  ) {
    const key = `${c.id}:${task.id}`
    const next: Override = task.done ? { done: false, value: null } : { done: true, value }
    const prior = overridesRef.current[key]
    setOverrides((prev) => ({ ...prev, [key]: next }))
    overridesRef.current = { ...overridesRef.current, [key]: next }
    setError(null)
    let res: Response
    try {
      res = await track(fetch(`/api/checklists/${c.id}/task-log`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // TAB-1b: the picked name rides on a tick, exactly as desktop sends it
        // ("manager" for Team Member / Manager). An untick sends none — desktop
        // doesn't, and the route never reads it on an untick.
        // TAB-4: and the PIN token, when this device holds one for that name.
        body: JSON.stringify({
          taskId: task.id,
          completedByStaffId: next.done ? staffId : null,
          temperatureValue: next.done ? value : null,
          ...(next.done && token ? { pinToken: token } : {}),
        }),
      }))
    } catch {
      res = new Response(null, { status: 0 })
    }
    if (!res.ok) {
      const restore = (prev: Record<string, Override>) => {
        const n = { ...prev }
        if (prior) n[key] = prior
        else delete n[key]
        return n
      }
      overridesRef.current = restore(overridesRef.current)
      setOverrides(restore)
      const refused = res.status === 0 ? { error: null, code: null } : await readErrorBody(res)
      // TAB-4: the token ran out or is someone else's — drop the session (and
      // with it the chip), so the next tap asks for a name and PIN again.
      if (isPinRefusal(refused.code)) onPin(null)
      setError(
        res.status === 0
          ? "That didn't save — no connection. Check the store's wifi and tap it again."
          : (refused.error ?? `That didn't save (error ${res.status}). Tap it again.`)
      )
      return
    }
    // TAB-4 Q8 — SLIDING: a gated tick hands back a fresh 10 minutes.
    if (next.done && token) {
      const saved = (await res.json().catch(() => ({}))) as { pinToken?: unknown }
      const fresh = saved.pinToken
      if (typeof fresh === "string") onPin((p) => (p && p.staffId === staffId ? { ...p, token: fresh } : p))
    }
    // TAB-5: the write is saved; stamp when, so the first server read that
    // starts after this moment retires the local copy (pruneOverrides). Only
    // if the tap is still the latest one for this item.
    const settled: Override = { ...next, settledAt: settledNow() }
    const settle = (prev: Record<string, Override>) => (prev[key] === next ? { ...prev, [key]: settled } : prev)
    overridesRef.current = settle(overridesRef.current)
    setOverrides(settle)
    // No submit here — ticking the last item only reveals the Submit button.
  }

  async function start(entry: TodayRow) {
    if (entry.existingChecklistId) {
      dispatch({ type: "open", id: entry.id, view: "list" })
      return
    }
    // No row yet: instantiate today's checklist exactly as Start Daily
    // Checklist does. A login without checklists.create is refused there and
    // here alike — no permission changes. TAB-14 RN-2: the POST and its error
    // sentences moved to startTodayChecklist() (src/lib/checklist-start.ts),
    // unchanged, shared with the tablet Checklists page.
    setBusy(`start:${entry.id}`)
    setError(null)
    try {
      const started = await startTodayChecklist(entry.id, store.id)
      if (!started.ok) {
        setError(started.error)
        return
      }
      // The tick list opens on the new row once the re-read below brings it
      // (a skeleton until then), keyed by the template id, which is stable.
      dispatch({ type: "open", id: entry.id, view: "list" })
      await onChanged()
    } finally {
      setBusy(null)
    }
  }

  // ── TAB-1b: who a tick is credited to ──
  const options = whoOptions(store.staff, pinRequired)
  // Desktop's condition: the picker opens only when the store has staff; with
  // none, a tick saves no name without asking.
  // TAB-4: while PINs are required it ALWAYS asks — an unnamed tick from this
  // login is refused (Q7), so with no names the sheet says so instead.
  const asksForName = pinRequired || store.staff.length > 0

  function tapTask(view: TabletChecklist, t: TabletTask) {
    if (t.done) return void toggle(view, t) // untick: no name, as desktop
    const who = person?.checklistId === view.id ? person : null
    if (asksForName && !who) {
      // First tick of this checklist: the name comes first, then (for a
      // temperature task) the number pad.
      setNameSheet({ checklistId: view.id, task: t })
      return
    }
    if (t.requiresTemp) setValueFor({ checklistId: view.id, task: t })
    else void toggle(view, t, null, who?.id ?? null, tokenFor(who?.id ?? null))
  }

  /** TAB-15 — Mark done from the panel, player or expanded row: THE SAME TAP
   *  as the row's tick circle (tapTask — the name sheet, PIN and °F pad
   *  included). The player gives way to the panel first, so a sheet opens
   *  over the checklist; the panel closes itself once the task reads done. */
  function markDone(view: TabletChecklist, t: TabletTask) {
    onHowTo({ checklistId: view.id, taskId: t.id, layer: "panel" })
    setToast(null)
    setPendingMark({ checklistId: view.id, taskId: t.id })
    tapTask(view, t)
  }

  function pickName(o: PickerOption) {
    const target = nameSheet
    if (!target || o.disabled) return // Q6: a no-PIN name can't be picked
    setNameSheet(null)
    // TAB-4: while PINs are required a name needs its PIN — unless this device
    // already holds a live token for that person here (then no re-entry).
    if (pinRequired && !tokenFor(o.id)) {
      setPinFor({ checklistId: target.checklistId, task: target.task, option: o })
      return
    }
    applyName(target, o, tokenFor(o.id))
  }

  /** TAB-1b's pick, unchanged; TAB-4 threads the token through. */
  function applyName(target: { checklistId: string; task: TabletTask | null }, o: PickerOption, token: string | null) {
    setPerson({ checklistId: target.checklistId, id: o.id, label: o.label })
    if (!target.task) return // Change: nothing to tick
    if (target.task.requiresTemp) {
      setValueFor({ checklistId: target.checklistId, task: target.task })
      return
    }
    const c = checklistsById.get(target.checklistId)
    if (c) void toggle(c, target.task, null, o.id, token)
  }

  /** TAB-4 — the PIN checked: hold the session, then carry on with the tap. */
  function pinVerified(token: string) {
    const t = pinFor
    setPinFor(null)
    if (!t) return
    onPin({ staffId: t.option.id, storeId: store.id, label: t.option.label, token })
    applyName({ checklistId: t.checklistId, task: t.task }, t.option, token)
  }

  // ── Which state (TAB-13: every checklist today, one tab each) ──
  const rowOf = (e: TodayRow) => (e.existingChecklistId ? checklistsById.get(e.existingChecklistId) : undefined)
  /** Started and not completed: the server says so, or a tick (saved or still
   *  in flight on this device) does. Status alone misses a Pending row with a
   *  first tick on its way; ticks alone miss one started on another device
   *  whose items the re-read has not brought yet. */
  function inProgress(e: TodayRow): boolean {
    if (e.lifecycleState === "completed" || !e.existingChecklistId) return false
    if (e.existingStatus && e.existingStatus !== "Pending") return true
    const row = rowOf(e)
    if (!row) return false
    return row.status !== "Pending" || withOverrides(row).sections.some((s) => s.tasks.some((t) => t.done))
  }
  /** The tick list's own numbers when the row exists (per-store exclusions
   *  applied); the route's template count for a checklist nobody has started. */
  function countsOf(e: TodayRow): { done: number; total: number } {
    const row = rowOf(e)
    if (!row) return { done: 0, total: e.taskCount }
    const all = withOverrides(row).sections.flatMap((s) => s.tasks)
    return { done: all.filter((t) => t.done).length, total: all.length }
  }
  const ordered = orderTodayChecklists(rows, inProgress)
  // The tab and hero title are the TYPE name (R5). Two checklists of the same
  // type today would read identically, so those — and a template with no type
  // name at all — show the template's own name instead (colour and icon still
  // come from the type). TAB-14: the rule moved to checklistTitle() in
  // src/lib/checklist-types.ts, unchanged, so the Checklists page shares it.
  const labelOf = (e: TodayRow) => checklistTitle(e, ordered)
  const shown = shownChecklist(sw, ordered.map((e) => e.id))
  const entry = shown.id ? ordered.find((e) => e.id === shown.id) : undefined
  const tabbed = ordered.length > 1
  // The checklist the In progress panel is showing, if it is showing one.
  let shownId: string | null = null
  // TAB-15 — the open how-to's task, when it is an unticked task with training
  // on the list showing now. Anything else means the state is stale.
  let howToView: { view: TabletChecklist; task: TabletTask & { howTo: TaskHowTo } } | null = null
  const setLayer = (layer: HowToLayer) => howTo && onHowTo({ checklistId: howTo.checklistId, taskId: howTo.taskId, layer })

  let body: React.ReactNode
  if (!entry) {
    body = (
      <div className="flex flex-1 flex-col items-start justify-center gap-3 p-8">
        <p className="text-2xl font-bold text-[var(--color-foreground)]">No checklists today</p>
        <p className="text-lg text-[var(--color-muted-foreground)]">
          Nothing is scheduled for {store.name} today. Checklists come from templates assigned to this store.
        </p>
      </div>
    )
  } else if (shown.view === "done") {
    const row = rowOf(entry)
    const partial = partialFinished && row && partialFinished.id === row.id ? partialFinished : null
    // "Up next": the first checklist still to do, in tab order.
    const upNext = ordered.find((o) => o.id !== entry.id && o.lifecycleState !== "completed") ?? null
    body = row ? (
      <DonePanel
        checklist={withOverrides(row)}
        timeZone={entry.timeZone}
        upNext={partial ? null : upNext}
        onStartNext={(e) => void start(e)}
        busy={busy}
        partial={partial ? { done: partial.done, total: partial.total } : undefined}
        onKeepGoing={
          partial
            ? () => {
                setPartialFinished(null)
                dispatch({ type: "open", id: entry.id, view: "list" })
              }
            : undefined
        }
      />
    ) : (
      <PanelSkeleton />
    )
  } else if (shown.view === "list") {
    const row = rowOf(entry)
    const view = row ? withOverrides(row) : undefined
    if (!view) {
      // Just started: the re-read that brings the new row is on its way.
      body = <PanelSkeleton />
    } else {
      shownId = view.id
      const target = howTo && howTo.checklistId === view.id ? view.sections.flatMap((s) => s.tasks).find((t) => t.id === howTo.taskId) : undefined
      if (target && !target.done && target.howTo) howToView = { view, task: { ...target, howTo: target.howTo } }
      body = (
        <InProgressPanel
          checklist={view}
          entry={entry}
          busy={busy}
          howToId={howToView ? howToView.task.id : null}
          portrait={portrait}
          onPill={(t) =>
            howToView?.task.id === t.id ? closeHowTo() : onHowTo({ checklistId: view.id, taskId: t.id, layer: "panel" })
          }
          renderExpanded={(t) =>
            howToView && howToView.task.id === t.id && howTo ? (
              <HowToExpanded
                task={howToView.task}
                layer={howTo.layer}
                onLayer={setLayer}
                onMarkDone={() => markDone(view, t)}
                disabled={busy === `submit:${view.id}`}
              />
            ) : null
          }
          person={person?.checklistId === view.id ? person.label : null}
          onChangePerson={() => setNameSheet({ checklistId: view.id, task: null })}
          onTap={(t) => tapTask(view, t)}
          onSubmit={() => void submit(view)}
          onSubmitPartial={() => {
            setPartialError(null)
            setPartialFor(view.id)
          }}
        />
      )
    }
  } else {
    // The Option 1 hero. Start / Continue open the tick list in this card;
    // View opens the Done screen (RN-1, RN-5). Nothing navigates.
    const completed = entry.lifecycleState === "completed"
    const started = inProgress(entry)
    const { done, total } = countsOf(entry)
    body = (
      <ChecklistHero
        label={labelOf(entry)}
        style={checklistTypeStyle(entry.type)}
        total={total}
        done={done}
        status={completed ? "Completed" : started ? "In progress" : "Not started"}
        due={dueLabel(entry)}
        completed={completed}
        action={completed ? "View" : started ? "Continue" : "Start"}
        busy={busy === `start:${entry.id}`}
        onAction={() => {
          if (completed) dispatch({ type: "open", id: entry.id, view: "done" })
          else if (started) dispatch({ type: "open", id: entry.id, view: "list" })
          else void start(entry)
        }}
        tabbed={tabbed}
        tabId={entry.id}
      />
    )
  }

  const tabs = tabbed ? (
    <ChecklistTabs
      items={ordered.map((e) => {
        const { done, total } = countsOf(e)
        return {
          id: e.id,
          label: labelOf(e),
          sub: e.lifecycleState === "completed" ? "Done" : `${done} of ${total}`,
          style: checklistTypeStyle(e.type),
        }
      })}
      selectedId={entry?.id ?? null}
      onSelect={(id) => {
        setPartialFinished(null)
        dispatch({ type: "tap", id })
      }}
    />
  ) : null

  // The chip clears when the panel moves to a different checklist (or off the
  // In progress panel altogether). A state update during render, React's
  // documented pattern for resetting state when an input changes.
  if (person && person.checklistId !== shownId) setPerson(null)
  // TAB-4 — while PINs are required the chip stands only on a live session for
  // that person: the idle clear (Q10), a refused token, or a different person
  // verified on the due list all drop it.
  else if (pinRequired && person && !tokenFor(person.id)) setPerson(null)

  const partialRowForSheet = partialFor ? checklistsById.get(partialFor) : undefined
  const partialOpen = partialRowForSheet
    ? withOverrides(partialRowForSheet).sections.flatMap((s) => s.tasks).filter((t) => !t.done).length
    : 0
  const partialBusy = busy === `partial:${partialFor}`

  const hv = howToView as { view: TabletChecklist; task: TabletTask & { howTo: TaskHowTo } } | null
  const toastView = toast ? checklistsById.get(toast.checklistId) : undefined
  const toastAll = toastView ? withOverrides(toastView).sections.flatMap((s) => s.tasks) : []
  const toastTask = toast ? toastAll.find((t) => t.id === toast.taskId && t.done) : undefined

  return (
    <>
      {tabs}
      <div className={TASKS_CARD}>
        {body}
        {howTo && !hv && <CloseWhenStale onClose={closeHowTo} />}
        {toastView && toastTask && (
          <DoneToast
            label={toastTask.label}
            done={toastAll.filter((t) => t.done).length}
            total={toastAll.length}
            onUndo={() => {
              setToast(null)
              void toggle(toastView, toastTask)
            }}
          />
        )}
        {error && (
          <p role="alert" className="border-t border-[var(--color-border)] bg-[var(--color-warning-bg)] px-5 py-3 text-base font-medium text-[var(--color-warning-text)]">
            {error}
          </p>
        )}
      </div>
      {/* TAB-15 — A2 in the Messages column's place (landscape only; portrait
          expands the row instead), and the two full-screen layers over both. */}
      {hv && howTo && !portrait && howToSlot &&
        createPortal(
          <HowToPanel
            task={hv.task}
            checklistName={hv.view.name}
            layer={howTo.layer}
            onClose={closeHowTo}
            onLayer={setLayer}
            onMarkDone={() => markDone(hv.view, hv.task)}
            disabled={busy === `submit:${hv.view.id}`}
          />,
          howToSlot
        )}
      {hv && howTo?.layer === "player" && (
        <HowToPlayer
          task={hv.task}
          checklistName={hv.view.name}
          onBack={() => setLayer("panel")}
          onOpenImage={() => setLayer("image")}
          onMarkDone={() => markDone(hv.view, hv.task)}
          disabled={busy === `submit:${hv.view.id}`}
        />
      )}
      {hv && howTo?.layer === "image" && hv.task.howTo.doc && (
        <HowToImage doc={hv.task.howTo.doc} onBack={() => setLayer("panel")} />
      )}
      <ValueSheet
        key={valueFor?.task.id ?? "closed"}
        task={valueFor?.task ?? null}
        onClose={() => setValueFor(null)}
        onSave={(v) => {
          const target = valueFor
          setValueFor(null)
          const c = target ? checklistsById.get(target.checklistId) : undefined
          const who = target && person?.checklistId === target.checklistId ? person.id : null
          if (c && target) void toggle(c, target.task, v, who, tokenFor(who))
        }}
      />
      <NameSheet
        key={nameSheet ? `name:${nameSheet.checklistId}:${nameSheet.task?.id ?? "change"}` : "name:closed"}
        open={!!nameSheet}
        options={options}
        onClose={() => setNameSheet(null)}
        onPick={pickName}
      />
      <PinSheet
        target={pinFor ? { staffId: pinFor.option.id, name: pinFor.option.label } : null}
        storeId={store.id}
        onClose={() => setPinFor(null)}
        onVerified={pinVerified}
      />
      <BottomSheet
        open={!!partialRowForSheet}
        onClose={() => {
          if (!partialBusy) setPartialFor(null)
        }}
        title={`Submit with ${partialOpen} ${partialOpen === 1 ? "task" : "tasks"} unfinished?`}
      >
        <div className="mx-auto flex max-w-md flex-col gap-4 pb-2">
          <p className="text-lg text-[var(--color-muted-foreground)]">
            The ticked items are already saved. Submitting files this checklist as it stands.
          </p>
          {partialError && (
            <p role="alert" className="rounded-xl border border-[var(--color-warning-border)] bg-[var(--color-warning-bg)] px-4 py-3 text-base font-medium text-[var(--color-warning-text)]">
              {partialError}
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Button size="touch" variant="outline" onClick={() => setPartialFor(null)} disabled={partialBusy}>
              Keep going
            </Button>
            <Button
              size="touch"
              onClick={() => partialRowForSheet && void submitPartial(partialRowForSheet)}
              disabled={partialBusy}
            >
              {partialBusy ? "Submitting…" : "Submit partial"}
            </Button>
          </div>
        </div>
      </BottomSheet>
    </>
  )
}

// ─── TAB-1b: "Who's completing these?" ───────────────────────────────────────

/** Above this many names a search box appears — past ~12 the two-column grid
 *  outgrows the sheet's height on a landscape iPad and starts to scroll. */
const NAME_SEARCH_AT = 12

function NameSheet({
  open,
  options,
  onClose,
  onPick,
}: {
  open: boolean
  options: PickerOption[]
  onClose: () => void
  onPick: (o: PickerOption) => void
}) {
  // Remounted per opening (keyed by the caller), so the search starts empty.
  const [query, setQuery] = useState("")
  const q = query.trim().toLowerCase()
  const shown = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options

  return (
    <BottomSheet open={open} onClose={onClose} title="Who's completing these?">
      <div className="flex flex-col gap-4 pb-2">
        {options.length > NAME_SEARCH_AT && (
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search names"
            aria-label="Search names"
            className="h-14 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-background)] px-4 text-lg text-[var(--color-foreground)] outline-none focus:border-[var(--color-primary)]"
          />
        )}
        <div className="grid grid-cols-2 gap-3">
          {shown.map((o) => (
            <Button
              key={o.key}
              size="touch"
              variant="outline"
              className={cn("h-16 justify-start truncate", o.note && "flex-col items-start justify-center gap-0")}
              disabled={o.disabled}
              onClick={() => onPick(o)}
            >
              {o.label}
              {/* TAB-4 Q6 — "No PIN — ask a manager", greyed with the button. */}
              {o.note && <span className="text-sm font-normal">{o.note}</span>}
            </Button>
          ))}
        </div>
        {options.length === 0 ? (
          // TAB-4: PINs required and nobody here has a name to pick yet.
          <p className="text-lg text-[var(--color-muted-foreground)]">
            Nobody at this store can be picked yet. Ask a manager to set a PIN for each person on their staff page.
          </p>
        ) : (
          shown.length === 0 && <p className="text-lg text-[var(--color-muted-foreground)]">No name matches “{query}”.</p>
        )}
      </div>
    </BottomSheet>
  )
}

// ─── TAB-4: the PIN sheet ─────────────────────────────────────────────────────

function PinSheet({
  target,
  storeId,
  onClose,
  onVerified,
}: {
  target: { staffId: string; name: string } | null
  storeId: string
  onClose: () => void
  onVerified: (token: string) => void
}) {
  return (
    <BottomSheet open={!!target} onClose={onClose} title="Enter PIN">
      {target && (
        // Remounted per person, so it always opens empty.
        <PinPad key={target.staffId} staffId={target.staffId} storeId={storeId} name={target.name} onVerified={onVerified} />
      )}
    </BottomSheet>
  )
}

function PanelSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-3 p-5">
      <Skeleton className="h-24 w-full rounded-2xl" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
    </div>
  )
}

// TAB-14 RN-2: dueLabel() moved to dueChipLabel() in src/lib/tablet-today.ts,
// unchanged, so the tablet Checklists page's Due chip reads the same.
const dueLabel = dueChipLabel

// ─── In progress: dark sticky banner, remaining items under section headers ──

function InProgressPanel({
  checklist,
  entry,
  busy,
  person,
  onChangePerson,
  onTap,
  onSubmit,
  onSubmitPartial,
  howToId,
  portrait,
  onPill,
  renderExpanded,
}: {
  checklist: TabletChecklist
  entry: TodayRow
  busy: string | null
  /** TAB-15 — the task whose how-to is open (highlighted row), or null. */
  howToId: string | null
  portrait: boolean
  onPill: (t: TabletTask) => void
  /** TAB-15 (B) — the open row's training, drawn under it in portrait. */
  renderExpanded: (t: TabletTask) => React.ReactNode
  /** TAB-1b — the sticky person's name, or null when nobody is chosen yet. */
  person: string | null
  onChangePerson: () => void
  onTap: (t: TabletTask) => void
  onSubmit: () => void
  onSubmitPartial: () => void
}) {
  const [showDone, setShowDone] = useState(false)
  const all = checklist.sections.flatMap((s) => s.tasks)
  const total = all.length
  const doneTasks = all.filter((t) => t.done)
  const left = total - doneTasks.length
  const due = dueLabel(entry)
  const submitting = busy === `submit:${checklist.id}`
  // "Submit Opening checklist", not "Submit Mid-day checklist checklist".
  const submitName = checklist.name.replace(/\s+checklist\s*$/i, "")

  return (
    <>
      <div className="shrink-0 bg-[var(--color-foreground)] px-6 pb-5 pt-5 text-[var(--color-background)]">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-3xl font-extrabold tracking-tight">
            <span className="uppercase">{checklist.name}</span> · {doneTasks.length} of {total}
          </h2>
          <p className="text-lg font-semibold opacity-80">
            {left} left{due ? ` · ${due.charAt(0).toLowerCase()}${due.slice(1)}` : ""}
          </p>
        </div>
        <div className="mt-4 h-3 overflow-hidden rounded-full bg-[var(--color-background)]/20">
          <div
            className="h-full rounded-full bg-[var(--color-primary)] transition-all duration-300"
            style={{ width: `${total ? (doneTasks.length / total) * 100 : 0}%` }}
          />
        </div>
      </div>

      {/* TAB-1b — the sticky person. Outside the scroll area, so it stays put
          under the banner while the list scrolls. */}
      {person && (
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-accent)] px-5 py-1">
          <p className="min-w-0 truncate text-lg text-[var(--color-foreground)]">
            Completing as <span className="font-bold">{person}</span>
          </p>
          <button
            type="button"
            onClick={onChangePerson}
            disabled={submitting}
            className="flex min-h-14 shrink-0 items-center px-3 text-lg font-semibold text-[var(--color-primary)] underline underline-offset-4 disabled:opacity-50"
          >
            Change
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 snap-y snap-proximity overflow-y-auto">
        {doneTasks.length > 0 && (
          <div className="border-b border-[var(--color-border)]">
            <TouchRow onClick={() => setShowDone((v) => !v)} aria-expanded={showDone} className="snap-start font-semibold">
              <span className="flex size-9 items-center justify-center rounded-full bg-[var(--color-primary)] text-[var(--color-primary-foreground)]">
                <Check className="h-5 w-5" />
              </span>
              {doneTasks.length} done
              <span className="ml-auto flex items-center gap-1 text-base text-[var(--color-muted-foreground)]">
                {showDone ? "Hide" : "Show"}
                <ChevronDown className={cn("h-5 w-5 transition-transform", showDone && "rotate-180")} />
              </span>
            </TouchRow>
            {showDone &&
              doneTasks.map((t) => (
                <TouchRow key={t.id} state="done" onClick={() => onTap(t)} title="Tap to undo" disabled={submitting}>
                  <span className="min-w-0 flex-1">{t.label}</span>
                  {t.value !== null && <span className="text-base no-underline">{t.value}°F</span>}
                  <TouchCheck checked />
                </TouchRow>
              ))}
          </div>
        )}

        {checklist.sections.map((s) => {
          const open = s.tasks.filter((t) => !t.done)
          if (open.length === 0) return null
          return (
            <div key={s.key}>
              <div className="sticky top-0 z-10 flex snap-start items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-muted)] px-5 py-2.5 text-base font-bold uppercase tracking-wider text-[var(--color-muted-foreground)]">
                <span>{s.name}</span>
                <span>{open.length} left</span>
              </div>
              {open.map((t) => {
                const label = (
                  <span className={cn("min-w-0 flex-1", t.isCritical && "font-semibold text-[var(--color-destructive)]")}>
                    {t.label}
                  </span>
                )
                const logChip = t.requiresTemp && (
                  <span className="shrink-0 rounded-full border border-[var(--color-warning-border)] bg-[var(--color-warning-bg)] px-3 py-1 text-sm font-semibold text-[var(--color-warning-text)]">
                    Log °F
                  </span>
                )
                // A task with no training renders exactly as before TAB-15.
                if (!t.howTo)
                  return (
                    <TouchRow key={t.id} size="roomy" onClick={() => onTap(t)} disabled={submitting}>
                      {label}
                      {logChip}
                      <TouchCheck checked={false} />
                    </TouchRow>
                  )
                // TAB-15 (A1) — a pill can't sit inside the row's <button>, so
                // the row is split: the text and the tick circle are two
                // buttons doing the row's one tap (onTap, unchanged), and the
                // pill between them is the only new way in.
                const isOpen = howToId === t.id
                return (
                  <div
                    key={t.id}
                    className={cn(
                      "border-b border-[var(--color-border)] last:border-b-0",
                      isOpen ? "bg-[var(--color-accent)]" : "bg-[var(--color-card)]"
                    )}
                  >
                    <div className="flex min-h-[76px] items-center">
                      <button
                        type="button"
                        onClick={() => onTap(t)}
                        disabled={submitting}
                        className="flex min-h-[76px] min-w-0 flex-1 items-center gap-4 py-4 pl-5 pr-3 text-left text-lg text-[var(--color-foreground)] transition-colors active:bg-[var(--color-accent)] disabled:pointer-events-none disabled:opacity-50"
                      >
                        {label}
                        {logChip}
                      </button>
                      <HowToPill
                        howTo={t.howTo}
                        state={isOpen ? (portrait ? "expanded" : "open") : "closed"}
                        onClick={() => onPill(t)}
                        disabled={submitting}
                      />
                      <button
                        type="button"
                        onClick={() => onTap(t)}
                        disabled={submitting}
                        aria-label={`Tick: ${t.label}`}
                        className="flex min-h-[76px] items-center pl-4 pr-5 transition-colors active:bg-[var(--color-accent)] disabled:pointer-events-none disabled:opacity-50"
                      >
                        <TouchCheck checked={false} />
                      </button>
                    </div>
                    {isOpen && portrait && renderExpanded(t)}
                  </div>
                )
              })}
            </div>
          )
        })}

        {/* Every item ticked and not yet submitted. Unticking any item makes
            `left` non-zero and the button goes away again. */}
        {total > 0 && left === 0 && (
          <div className="p-6">
            <Button size="touch-lg" onClick={onSubmit} disabled={submitting}>
              {submitting ? "Submitting…" : `Submit ${submitName} checklist`}
            </Button>
          </div>
        )}

        {/* TAB-1b — partial submit: a quiet link while some but not all items
            are ticked. The big Submit above stays for the all-ticked case. */}
        {doneTasks.length > 0 && left > 0 && (
          <div className="flex justify-center px-6 py-4">
            <button
              type="button"
              onClick={onSubmitPartial}
              className="flex min-h-14 items-center px-3 text-lg font-semibold text-[var(--color-muted-foreground)] underline underline-offset-4"
            >
              Submit partial ({doneTasks.length} of {total})
            </button>
          </div>
        )}
      </div>
    </>
  )
}

// ─── Done: calm green, with what's next ──────────────────────────────────────

function DonePanel({
  checklist,
  timeZone,
  upNext,
  onStartNext,
  busy,
  partial,
  onKeepGoing,
}: {
  checklist: TabletChecklist
  timeZone: string
  upNext: TodayRow | null
  onStartNext: (e: TodayRow) => void
  busy: string | null
  /** TAB-1b — set after a partial submit: the calm, not-green variant. */
  partial?: { done: number; total: number }
  /** TAB-1b — back to the In progress panel after a partial submit. */
  onKeepGoing?: () => void
}) {
  const all = checklist.sections.flatMap((s) => s.tasks)
  const finished = checklist.completedAt ? formatWindowTime(new Date(checklist.completedAt), timeZone) : null
  const nextDueNow = upNext && (upNext.lifecycleState === "active" || upNext.lifecycleState === "overdue")
  const nextDue = upNext ? dueLabel(upNext) : null

  return (
    <div
      className={cn(
        "flex flex-1 flex-col items-center gap-6 overflow-y-auto p-8 text-center",
        partial ? "bg-[var(--color-muted)]" : "bg-[var(--color-success-bg)]"
      )}
    >
      <span
        className={cn(
          "mt-4 flex size-24 shrink-0 items-center justify-center rounded-full",
          partial
            ? "border-4 border-[var(--color-muted-foreground)] bg-[var(--color-card)] text-[var(--color-muted-foreground)]"
            : "bg-[var(--color-success)] text-[var(--color-primary-foreground)]"
        )}
      >
        <Check className="size-14" strokeWidth={3} />
      </span>
      <div>
        <h2 className="text-4xl font-extrabold text-[var(--color-foreground)]">
          {partial ? `Partial submitted · ${partial.done} of ${partial.total}` : `${checklist.name} done`}
        </h2>
        <p className="mt-2 text-xl text-[var(--color-muted-foreground)]">
          {/* Gary, 2026-11-09: partial submit stays at desktop parity, and day
              close still files any unfinished checklist Missed — so say so. */}
          {partial
            ? "Unfinished checklists are still marked Missed at day close."
            : `All ${all.length} tasks checked off${finished ? ` · finished ${finished}` : ""}`}
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {checklist.sections.map((s) => (
          <span
            key={s.key}
            className={cn(
              "rounded-full border bg-[var(--color-card)] px-4 py-2 text-base font-semibold",
              partial
                ? "border-[var(--color-border)] text-[var(--color-foreground)]"
                : "border-[var(--color-success-border)] text-[var(--color-success-text)]"
            )}
          >
            {s.name} {s.tasks.filter((t) => t.done).length}/{s.tasks.length}
          </span>
        ))}
      </div>

      {upNext && (
        <div className="flex w-full max-w-md items-center gap-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-5 text-left">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-[var(--color-muted)]">
            <Clock className="h-6 w-6 text-[var(--color-muted-foreground)]" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold uppercase tracking-wider text-[var(--color-muted-foreground)]">Up next</p>
            <p className="text-xl font-bold text-[var(--color-foreground)]">{upNext.name}</p>
            {nextDue && <p className="text-base text-[var(--color-muted-foreground)]">{nextDue}</p>}
          </div>
          {nextDueNow && (
            <Button size="touch" onClick={() => onStartNext(upNext)} disabled={busy === `start:${upNext.id}`}>
              Start
            </Button>
          )}
        </div>
      )}

      {partial && onKeepGoing && (
        <Button size="touch" variant="outline" onClick={onKeepGoing}>
          Keep working on it
        </Button>
      )}

      <Link
        href={`/store-view/checklist/${checklist.id}`}
        className={cn(
          "flex min-h-14 items-center text-lg font-semibold underline underline-offset-4",
          partial ? "text-[var(--color-foreground)]" : "text-[var(--color-success-text)]"
        )}
      >
        Review checked items
      </Link>
    </div>
  )
}

// ─── Value entry: a bottom sheet with a number pad (audit point 6) ───────────

const PAD = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "±", "0", "."]

function ValueSheet({
  task,
  onClose,
  onSave,
}: {
  task: TabletTask | null
  onClose: () => void
  onSave: (value: number) => void
}) {
  // Remounted per task (keyed by the caller), so it always opens empty.
  const [text, setText] = useState("")

  function press(k: string) {
    setText((t) => {
      if (k === "±") return t.startsWith("-") ? t.slice(1) : `-${t}`
      if (k === "." && t.includes(".")) return t
      if (t.replace("-", "").length >= 6) return t
      return t + k
    })
  }

  const value = Number(text)
  const valid = text !== "" && text !== "-" && text !== "." && text !== "-." && Number.isFinite(value)

  return (
    <BottomSheet open={!!task} onClose={onClose} title={task?.label ?? ""}>
      <div className="mx-auto flex max-w-sm flex-col gap-4">
        <p className="rounded-2xl bg-[var(--color-muted)] px-5 py-4 text-right text-5xl font-bold tabular-nums text-[var(--color-foreground)]">
          {text || <span className="text-[var(--color-muted-foreground)]">—</span>}
          <span className="ml-2 text-2xl text-[var(--color-muted-foreground)]">°F</span>
        </p>
        <div className="grid grid-cols-3 gap-3">
          {PAD.map((k) => (
            <Button key={k} size="touch" variant="outline" className="h-16 text-2xl" onClick={() => press(k)}>
              {k}
            </Button>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Button size="touch" variant="outline" className="h-16" aria-label="Delete" onClick={() => setText((t) => t.slice(0, -1))}>
            <Delete />
          </Button>
          <Button size="touch" className="col-span-2 h-16" disabled={!valid} onClick={() => valid && onSave(value)}>
            Save
          </Button>
        </div>
      </div>
    </BottomSheet>
  )
}

// ─── Overdue chip + the due list as a bottom sheet (ruling 7) ────────────────
//
// TAB-9, 2026-11-10 — appended; "as a bottom sheet" above is SPENT, kept. The
// list now opens IN PLACE under the header (TAB-9 ruling 1): no overlay,
// nothing frozen, the page scrolls past it. The chip toggles it; its open
// state is TabletHome's (it idles shut with the cards, ruling 4). The rows and
// their actions are the sheet's, unchanged. The chip's filter, count and label
// are still dueChipFor (TAB-1c); its colour is dueChipTone — this chip alone
// is red and says "overdue" (TAB-9 ruling 6).

function DueChip({
  label,
  overdue,
  open,
  onToggle,
}: {
  label: string
  overdue: number
  open: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls="tablet-due-list"
      className={cn("flex min-h-14 items-center gap-2 rounded-full px-6 text-lg font-bold", CHIP_TONE_CLASS[dueChipTone(overdue)])}
    >
      <AlertTriangle className="h-5 w-5" />
      {label}
      <ChevronDown className={cn("h-5 w-5 transition-transform", open && "rotate-180")} />
    </button>
  )
}

function DuePanel({
  items,
  onClose,
  onChanged,
  store,
  pinRequired,
  pin,
  onPin,
}: {
  items: DueItem[]
  onClose: () => void
  onChanged: () => Promise<void>
  /** TAB-4 — the store's names, and the device's PIN session (TabletHome). */
  store: TabletStore
  pinRequired: boolean
  pin: PinSession | null
  onPin: SetPin
}) {
  const [completing, setCompleting] = useState<string | null>(null)
  // TAB-4 — the name sheet and PIN sheet for a Complete (itemId null = Change).
  const [nameFor, setNameFor] = useState<{ itemId: string | null } | null>(null)
  const [pinFor, setPinFor] = useState<{ itemId: string | null; option: PickerOption } | null>(null)
  const [error, setError] = useState<string | null>(null)
  // TAB-5 ruling 3: a Complete in flight holds the refresh. (The list being
  // open is TabletHome's "due:list" flag.)
  useBusyFlag("due:complete", completing !== null)
  useBusyFlag("due:sheet", !!nameFor || !!pinFor)
  const nowIso = new Date().toISOString()
  // TAB-4 — the live session for THIS store, if the device holds one.
  const live = pinRequired && pin && pin.storeId === store.id ? pin : null

  async function complete(id: string, who: PinSession | null = live) {
    // TAB-4 (Q7): while PINs are required a completion names a verified person.
    // No live session → the name sheet first; a live one is reused (design
    // choice #1), and the chip above the list says whose it is.
    if (pinRequired && !who) {
      setNameFor({ itemId: id })
      return
    }
    setCompleting(id)
    setError(null)
    const res = await fetch(`/api/calendar/occurrences/${id}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Switch off: `{}`, exactly as before TAB-4.
      body: JSON.stringify(pinRequired && who ? { completedByStaffId: who.staffId, pinToken: who.token } : {}),
    }).catch(() => null)
    setCompleting(null)
    // TAB-4: with PINs on, a refusal says why (it used to be silent, and still
    // is with the switch off — that path is untouched).
    if (pinRequired && who) {
      if (!res) {
        setError("That didn't save — no connection. Check the store's wifi and try again.")
      } else if (!res.ok) {
        const refused = await readErrorBody(res)
        if (isPinRefusal(refused.code)) onPin(null)
        setError(refused.error ?? `That didn't save (error ${res.status}). Try again.`)
      } else {
        const saved = (await res.json().catch(() => ({}))) as { pinToken?: unknown }
        const fresh = saved.pinToken
        if (typeof fresh === "string") onPin((p) => (p && p.staffId === who.staffId ? { ...p, token: fresh } : p))
      }
    }
    await onChanged()
  }

  function pickName(o: PickerOption) {
    const t = nameFor
    if (!t || o.disabled) return
    setNameFor(null)
    if (live && live.staffId === o.id) {
      if (t.itemId) void complete(t.itemId, live)
      return
    }
    setPinFor({ itemId: t.itemId, option: o })
  }

  function pinVerified(token: string) {
    const t = pinFor
    setPinFor(null)
    if (!t) return
    const session: PinSession = { staffId: t.option.id, storeId: store.id, label: t.option.label, token }
    onPin(session)
    if (t.itemId) void complete(t.itemId, session)
  }

  return (
    <section
      id="tablet-due-list"
      aria-label="Due at this store"
      className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-card)] px-6 py-3"
    >
      <div className="flex items-center justify-between gap-4 border-b border-[var(--color-border)] pb-3">
        <h2 className="text-xl font-bold text-[var(--color-foreground)]">Due at this store</h2>
        <Button size="touch" variant="outline" onClick={onClose}>
          Close
        </Button>
      </div>
      {/* TAB-4 — Gary's condition on design choice #1: whenever a reused token
          is in play here, the "Completing as …" chip shows whose it is. */}
      {live && (
        <div className="-mx-6 flex items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-accent)] px-6 py-1">
          <p className="min-w-0 truncate text-lg text-[var(--color-foreground)]">
            Completing as <span className="font-bold">{live.label}</span>
          </p>
          <button
            type="button"
            onClick={() => setNameFor({ itemId: null })}
            disabled={completing !== null}
            className="flex min-h-14 shrink-0 items-center px-3 text-lg font-semibold text-[var(--color-primary)] underline underline-offset-4 disabled:opacity-50"
          >
            Change
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 rounded-xl border border-[var(--color-warning-border)] bg-[var(--color-warning-bg)] px-4 py-3 text-base font-medium text-[var(--color-warning-text)]">
          {error}
        </p>
      )}
      <ul className="divide-y divide-[var(--color-border)]">
        {items.map((item) => (
          <li key={item.id} className="flex min-h-16 items-center justify-between gap-4 py-3">
            <div className="min-w-0">
              <p className="text-lg font-semibold text-[var(--color-foreground)]">{item.title}</p>
              <p className="text-base text-[var(--color-muted-foreground)]">
                {item.categoryLabel}
                {dueRowSuffix(item, nowIso)}
              </p>
            </div>
            {item.templateId ? (
              // CAL-2 ruling 3: a scheduled checklist completes by submitting
              // the checklist, so the row links there instead of ticking.
              item.checklistId ? (
                <Button asChild size="touch" variant="outline">
                  <a href={`/store-view/checklist/${item.checklistId}`}>Open checklist</a>
                </Button>
              ) : null
            ) : (
              <Button size="touch" variant="outline" onClick={() => void complete(item.id)} disabled={completing === item.id}>
                {completing === item.id ? "Saving…" : "Complete"}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {pinRequired && (
        <>
          <NameSheet
            key={nameFor ? `due-name:${nameFor.itemId ?? "change"}` : "due-name:closed"}
            open={!!nameFor}
            options={whoOptions(store.staff, true)}
            onClose={() => setNameFor(null)}
            onPick={pickName}
          />
          <PinSheet
            target={pinFor ? { staffId: pinFor.option.id, name: pinFor.option.label } : null}
            storeId={store.id}
            onClose={() => setPinFor(null)}
            onVerified={pinVerified}
          />
        </>
      )}
    </section>
  )
}

// ─── TAB-1c: the SELF-1 compliance banner, as a header chip ──────────────────
//
// TAB-1 dropped the desktop dashboard's ComplianceBanner (compliance-banner.tsx)
// from the tablet along with the calendar banner, and no ruling covered it, so a
// person's own overdue training or documents became invisible on the tablet.
// TAB-1c brings it back as a chip (Gary chose this over filing a row,
// 2026-11-10; DECISIONS DRAFT rider on the 2026-11-09 TAB-1 entry):
// the same endpoint, the same rule (renders only when the signed-in person owes
// something), the same words, the same colours (red when anything is overdue,
// amber otherwise), the same /my link, and no dismiss. A device login resolves
// to no staff member and the route answers owed: null, so it stays silent.
//
// TAB-5 — re-read on every refresh cycle (ruling 1). The answer replaces the
// chip: owing nothing now clears it. A failed read keeps what is showing.
//
// TAB-9, 2026-11-10 — appended; "the same words, the same colours (red when
// anything is overdue, amber otherwise)" above is SPENT, kept. Two chips side
// by side that both went red and both said "overdue" read as one alarm (Gary,
// TAB-9 ruling 6). This chip now reads "My HR · N" (hrChipFor) and is amber
// when something is past due, neutral otherwise — never red, never the word
// "overdue"; only the store's DueChip is. The endpoint, the rule (renders only
// when the signed-in person owes something) and the /my link are unchanged.
// ON A SHARED STORE LOGIN it shows whatever the login resolves to through
// getActiveStaffSelf — a staff member linked to that User, or the one staff
// member with its email — which may be one PERSON's items on a counter
// tablet. RULING NOW item in the TAB-9 report; not changed here.
// ── TAB-9 fix, 2026-11-10 — appended; the two lines above are SPENT, kept.
// Gary ruled: "HR chip — hide it on STORE logins in Tablet mode; keep it for
// personal logins." TabletHome renders this chip only when showHrChip(role)
// (src/lib/tablet-cards.ts), so a STORE login neither shows nor fetches it.
// Desktop's ComplianceBanner is unchanged.
function ComplianceChip() {
  const [owed, setOwed] = useState<OwedSummary | null>(null)
  const live = useRef(true)
  const load = useCallback(
    () =>
      fetchCard<{ owed: OwedSummary | null }>("my compliance", "/api/dashboard/my-compliance").then((data) => {
        if (live.current && data) setOwed(data.owed ?? null)
      }),
    []
  )
  useEffect(() => {
    live.current = true
    void load()
    return () => {
      live.current = false
    }
  }, [load])
  useRefreshLoader(load)

  if (!owed) return null
  const chip = hrChipFor(owed)

  return (
    <Link
      href="/my"
      aria-label={chip.ariaLabel}
      className={cn("flex min-h-14 items-center gap-2 rounded-full px-6 py-2 text-lg font-bold", CHIP_TONE_CLASS[chip.tone])}
    >
      <GraduationCap className="h-5 w-5 shrink-0" />
      {chip.label}
      <ChevronRight className="h-5 w-5 shrink-0" />
    </Link>
  )
}
