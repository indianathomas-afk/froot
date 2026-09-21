"use client"

import { useEffect, useId, useRef, useState } from "react"
import { AlertTriangle, CalendarClock, Check, ChevronDown } from "lucide-react"

// ── CAL-1: THE DUE-REMINDER BANNER ───────────────────────────────────────────
//
// Mounts on /dashboard and on /checklists (the NAV-1 "Daily Tasks" target — the
// two places STORE and STAFF actually land).
//
// IT LIVES IN src/components/, NOT BESIDE A PAGE. SELF-1's banner sits under
// (app)/dashboard/ because it renders on one page. This one renders on two, and
// a client component imported across route folders from a sibling page
// directory is the exact shape CLAUDE.md § "Verifying a guard covers every
// path" records: HR-11j's uncovered ceremony route was a shared client imported
// across a route-group boundary, and the guard had been built on the page that
// OWNED the client. A shared component belongs somewhere neither page owns.
//
// REUSES SELF-1'S SHELL AND NOT ITS DATA. The bar, icon, semibold line and
// `text-xs opacity-90` subline are copied from compliance-banner.tsx so the two
// banners read as one system when they stack. The data path is deliberately
// different: SELF-1 goes through getActiveStaffSelf(), which is an HR gate that
// resolves a STAFF MEMBER, and a calendar occurrence is scoped to a STORE.
//
// NO RESERVED SLOT. It arrives a beat after paint and pushes the page down once
// when it does. SELF-1 considered reserving the slot and rejected it — most
// people owe nothing, so a reserved slot is a permanent empty gap at the top of
// almost every dashboard in the org. A second banner reserving one would
// reintroduce exactly the gap that argument rejected. Named here so it is not
// later filed as a layout bug.
//
// NO DISMISS CONTROL, deliberately, as in SELF-1: it clears when the work is
// done and on nothing else.
//
// ── CAL-2c: THE ROLLUP ───────────────────────────────────────────────────────
//
// COLLAPSE IS NOT DISMISS (Gary, 2026-09-20). An all-stores reminder fans out
// to one occurrence per store, so a nine-store org owing two things renders
// eighteen red rows above any business data. The list now rolls up behind a
// chevron — but the rolled-up row still carries the count due, the count
// overdue, the "N days overdue" figure and the red surface, and THERE IS STILL
// NO DISMISS: the banner clears on completion and on nothing else (CAL-1 B7 /
// SELF-1, unchanged).
//
// THE HEIGHT ANIMATION REUSES THE `accordion-down` / `accordion-up` KEYFRAMES
// already in globals.css, AND HAS TO FEED THEM THEIR HEIGHT. Those keyframes
// animate to `var(--radix-accordion-content-height)`, which only a Radix
// Accordion or Collapsible sets — and this repo has neither installed (see
// package.json: no @radix-ui/react-accordion, no @radix-ui/react-collapsible).
// They were dead CSS. Installing Radix to revive them would be a new dependency
// for a cosmetic toggle, so the measured content height is written into that
// same custom property from here instead. NAV-1's sidebar accordion is likewise
// hand-rolled — useState + a localStorage preference read after mount + a
// rotated ChevronDown — and this follows it rather than inventing a second
// pattern.

type DueItem = {
  id: string
  title: string
  category: string
  categoryLabel: string
  priority: string
  storeId: string
  storeName: string
  dueAt: string
  daysOverdue: number
  /** CAL-2. Set makes this a SCHEDULED CHECKLIST, not a reminder: the row gets
   *  "Open checklist" instead of an inline Complete, because completion of the
   *  occurrence IS the checklist's submit (ruling 3). The complete route
   *  refuses it independently, so this is the affordance and not the gate. */
  templateId: string | null
  checklistId: string | null
}

type DueResponse = {
  items: DueItem[]
  earliestDueAt: string | null
  overdueCount: number
  maxDaysOverdue: number
}

// CAL-2c. Per browser, not per user row in the database — a cosmetic preference
// that would need a migration, a capability and a write path to store server
// side, which is a TIER 3 shape for something that only decides whether a list
// starts open on this laptop.
const OPEN_KEY = "froot.calBanner.open"

// More than this many items and the banner starts rolled up. At or below it the
// banner starts open, so a single store owing one reminder sees exactly what it
// saw before CAL-2c.
const COLLAPSE_ABOVE = 3

// EVERY ACCESS IN try/catch, BOTH DIRECTIONS. localStorage throws outright in a
// Safari private window and under a blocked-cookies policy; it is a preference,
// and a preference that cannot be read must not be able to take the banner down
// with it. A failed read returns null and the threshold decides.
function readOpenPref(): boolean | null {
  try {
    const v = localStorage.getItem(OPEN_KEY)
    return v === "1" ? true : v === "0" ? false : null
  } catch {
    return null
  }
}

function writeOpenPref(open: boolean) {
  try {
    localStorage.setItem(OPEN_KEY, open ? "1" : "0")
  } catch {
    // Quota, private mode, blocked storage. The toggle still works for this
    // visit; only the memory of it is lost.
  }
}

type StoreChip = { storeId: string; storeName: string; count: number; overdue: number }

// OVERDUE IS `dueAt <= now`, WHICH IS RULING 8 AND IS NOT `daysOverdue > 0`.
// CAL-2b / DEBT-101: an item past its store close on its own due date is
// genuinely overdue AND genuinely zero days old, so counting days here would
// silently drop today's late work out of the overdue tally.
function chipsFor(items: DueItem[], nowIso: string): StoreChip[] {
  const by = new Map<string, StoreChip>()
  for (const i of items) {
    const c = by.get(i.storeId) ?? { storeId: i.storeId, storeName: i.storeName, count: 0, overdue: 0 }
    c.count += 1
    if (i.dueAt <= nowIso) c.overdue += 1
    by.set(i.storeId, c)
  }
  // Overdue stores first, then by how much is owed, then by name so the strip
  // does not reshuffle between two stores that are level.
  return [...by.values()].sort(
    (a, b) =>
      Number(b.overdue > 0) - Number(a.overdue > 0) ||
      b.count - a.count ||
      a.storeName.localeCompare(b.storeName)
  )
}

export function CalendarDueBanner() {
  const [data, setData] = useState<DueResponse | null>(null)
  const [completing, setCompleting] = useState<string | null>(null)
  const [caughtUp, setCaughtUp] = useState(false)
  // Whether this session has ever SEEN something due. The "all caught up" state
  // fires only on a non-empty → empty TRANSITION, so a first load with nothing
  // due renders nothing at all rather than congratulating someone for a list
  // they never had.
  const hadItems = useRef(false)

  // CAL-2c. null = nobody has chosen on this browser, so the threshold decides.
  // Once it is a boolean the person's choice wins, at every item count.
  const [openPref, setOpenPref] = useState<boolean | null>(null)
  const [storeFilter, setStoreFilter] = useState<string | null>(null)
  const [anim, setAnim] = useState<"down" | "up" | null>(null)
  const [contentH, setContentH] = useState(0)
  const innerRef = useRef<HTMLDivElement | null>(null)
  const listId = useId()

  async function load(): Promise<DueResponse | null> {
    try {
      const res = await fetch("/api/calendar/due", { signal: AbortSignal.timeout(12_000) })
      // 404 is the module being off (ruling 9) — silence, not an error.
      if (!res.ok) {
        if (res.status !== 404) console.error(`[calendar] due feed failed: HTTP ${res.status}`)
        return null
      }
      return (await res.json()) as DueResponse
    } catch (err) {
      console.error("[calendar] due feed fetch error:", err)
      return null
    }
  }

  useEffect(() => {
    let live = true
    load().then((d) => {
      if (!live || !d) return
      if (d.items.length > 0) hadItems.current = true
      // CAL-2c — THE STORED PREFERENCE IS READ AFTER MOUNT, NEVER IN THE
      // INITIAL STATE: the server has no localStorage, and seeding from it
      // during render is the hydration mismatch NAV-1's sidebar comment warns
      // about. IT IS READ IN THIS CONTINUATION RATHER THAN IN AN EFFECT OF ITS
      // OWN because a synchronous setState in a mount effect body is what
      // react-hooks/set-state-in-effect rejects — the same constraint
      // calendar-client.tsx documents for its feed. It costs nothing: the
      // banner renders nothing at all until this response lands, so there is no
      // frame in which the preference could have been applied any earlier.
      const stored = readOpenPref()
      if (stored !== null) setOpenPref(stored)
      setData(d)
    })
    return () => {
      live = false
    }
  }, [])

  async function complete(id: string) {
    setCompleting(id)
    const res = await fetch(`/api/calendar/occurrences/${id}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }).catch(() => null)
    setCompleting(null)
    // A 409 means somebody else got there first — the right response is to
    // re-read, not to argue with the floor about who tapped first.
    if (!res?.ok && res?.status !== 409) return

    const next = await load()
    if (!next) return
    // CAL-2c. A filter pinned to a store that has just been finished would
    // render an empty list under a live banner. Clear it, and clear it too when
    // only one store is left owing anything, because the chip strip that set the
    // filter is gone at that point.
    if (storeFilter) {
      const stores = new Set(next.items.map((i) => i.storeId))
      if (!stores.has(storeFilter) || stores.size <= 1) setStoreFilter(null)
    }
    if (next.items.length === 0 && hadItems.current) {
      setCaughtUp(true)
      // ~3s, then clear. The success state is a moment, not furniture.
      setTimeout(() => {
        setCaughtUp(false)
        setData(next)
      }, 3000)
    }
    setData(next)
  }

  if (caughtUp) {
    return (
      <div
        className="cal-caught-up mb-6 flex items-center gap-3 rounded-lg border px-5 py-4 bg-[var(--color-success-bg)] text-[var(--color-success-text)] border-[var(--color-success-border)]"
        role="status"
      >
        <Check className="h-5 w-5 shrink-0" />
        <p className="text-sm font-semibold">You&apos;re all caught up</p>
      </div>
    )
  }

  // Nothing due, or the feed refused (module off, no store scope, a failed
  // load): render nothing. Identical to SELF-1's single `if (!owed) return null`.
  if (!data || data.items.length === 0) return null

  const overdue = data.overdueCount > 0
  const plural = data.items.length === 1 ? "" : "s"
  // "1 day overdue", never "1 days overdue".
  const dayWord = data.maxDaysOverdue === 1 ? "day" : "days"

  const chips = chipsFor(data.items, new Date().toISOString())
  // Row 2 earns its space only when there is something to choose between.
  const multiStore = chips.length > 1
  const filter = multiStore ? storeFilter : null
  const shown = filter ? data.items.filter((i) => i.storeId === filter) : data.items
  // Subheadings group the list only when the list actually spans stores — with a
  // filter applied it does not, and a single heading over every row is noise.
  const shownStores = [...new Set(shown.map((i) => i.storeId))]
  const grouped = shownStores.length > 1

  const open = openPref ?? data.items.length <= COLLAPSE_ABOVE

  function toggle() {
    const next = !open
    // Measure before the state change: at this instant the list still holds its
    // current geometry, and scrollHeight on the inner element is readable even
    // while the clipping parent is at height 0.
    const h = innerRef.current?.scrollHeight ?? 0
    setContentH(h)
    let reduced = false
    try {
      reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    } catch {
      reduced = false
    }
    // THE INFORMATION IS IN THE TEXT AND THE COLOUR; THE MOTION IS DECORATION
    // AND IS THE PART THAT GOES — the same rule globals.css states for the pulse
    // and the caught-up check, applied here in JS because this animation needs a
    // measured height and so is authored inline.
    setAnim(reduced || h === 0 ? null : next ? "down" : "up")
    setOpenPref(next)
    writeOpenPref(next)
  }

  return (
    <div
      // THE SINGLE PULSE, OVERDUE STATE ONLY. A banner for work merely due today
      // does not move — the pulse is the escalation, and spending it on the
      // ordinary case is how it stops meaning anything. One run, keyframe in
      // globals.css, and it cannot loop.
      //
      // CAL-2c: it fires ON MOUNT, collapsed or open. The pulse is the
      // escalation arriving, and rolling the list up does not make the work less
      // late — a person who collapsed the banner yesterday still gets the pulse
      // today.
      className={`${overdue ? "cal-pulse-once" : ""} mb-6 rounded-lg border px-5 py-4 ${
        overdue
          ? "bg-[var(--color-destructive)] text-[var(--color-destructive-foreground)] border-transparent"
          : "bg-[var(--color-warning-bg)] text-[var(--color-warning-text)] border-[var(--color-warning-border)]"
      }`}
      role="status"
    >
      <div className="flex items-center gap-3">
        {overdue ? <AlertTriangle className="h-5 w-5 shrink-0" /> : <CalendarClock className="h-5 w-5 shrink-0" />}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            {/* CAL-2: "reminder" was right when a reminder was the only thing
                this banner could carry. It now carries scheduled checklists
                too, and calling one of those a reminder in the one line
                somebody reads on the way past would be a small, daily lie.
                CAL-2c extends this line with the overdue COUNT and leaves the
                noun alone for that same reason. */}
            {data.items.length} item{plural} due
            {overdue && ` · ${data.overdueCount} overdue`}
          </p>
          {/* CAL-2b / DEBT-101 — "DUE TODAY", NEVER "0 DAYS OVERDUE".
              The count is calendar days now, so an item past its store close on
              its own due date is genuinely overdue AND genuinely zero days old.
              The banner already went red for it; this line says what the number
              means instead of leaving the escalation unexplained.
              CAL-2c: THIS SUBLINE IS PART OF THE ROLLED-UP ROW and does not hide
              with the list — the "N days overdue" figure is one of the four
              things Gary's ruling requires a collapsed banner to keep carrying. */}
          {overdue && (
            <p className="text-xs opacity-90">
              <strong className="font-bold">
                {data.maxDaysOverdue > 0 ? `${data.maxDaysOverdue} ${dayWord} overdue` : "Due today"}
              </strong>
            </p>
          )}
        </div>
        {/* THE CHEVRON IS THE WHOLE CONTROL, AND IT IS NOT A DISMISS. It rolls
            the list up and leaves every figure above it on screen. */}
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-controls={listId}
          // ≥44px tap target, same floor as the row buttons below.
          className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-transparent hover:border-current/40"
          title={open ? "Hide reminders" : "Show reminders"}
        >
          <ChevronDown className={`h-5 w-5 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
        </button>
      </div>

      {/* ROW 2 — THE STORE STRIP. Only when the list spans more than one store;
          on a single-store account this is a row of one chip saying what the
          headline already said. */}
      {multiStore && (
        <div className="mt-3 flex flex-wrap gap-2">
          {chips.map((c) => {
            const active = filter === c.storeId
            return (
              <button
                key={c.storeId}
                type="button"
                onClick={() => setStoreFilter(active ? null : c.storeId)}
                aria-pressed={active}
                title={active ? `Show all stores` : `Show only ${c.storeName}`}
                className={`min-h-[44px] rounded-full border px-3 text-xs ${
                  c.overdue > 0 ? "font-bold" : "font-medium"
                } ${active ? "border-current bg-current/20" : "border-current/40"}`}
              >
                {c.storeName} {c.count}
              </button>
            )
          })}
        </div>
      )}

      {/* THE LIST STAYS MOUNTED WHILE COLLAPSED so the height animation has
          something to measure and so completing the last item still reflows
          correctly. `inert` is what keeps a clipped row out of the tab order —
          aria-hidden alone would hide it from a screen reader while leaving its
          Complete button focusable, which is the worse of the two failures. */}
      <div
        id={listId}
        aria-hidden={!open}
        inert={!open}
        onAnimationEnd={() => setAnim(null)}
        style={{
          overflow: "hidden",
          // Open and settled means height:auto, not a frozen measurement — the
          // list shrinks by a row every time somebody completes something.
          height: open ? undefined : 0,
          ...(anim
            ? {
                ["--radix-accordion-content-height" as string]: `${contentH}px`,
                animation: `${anim === "down" ? "accordion-down" : "accordion-up"} 200ms ease-out`,
              }
            : null),
        }}
      >
        <div ref={innerRef}>
          {shownStores.map((storeId) => {
            const rows = shown.filter((i) => i.storeId === storeId)
            return (
              <div key={storeId}>
                {grouped && (
                  <p className="mt-3 text-xs font-semibold uppercase tracking-wide opacity-80">
                    {rows[0].storeName}
                  </p>
                )}
                <ul className={grouped ? "mt-1 space-y-2" : "mt-3 space-y-2"}>
                  {rows.map((item) => (
                    <li key={item.id} className="flex items-center justify-between gap-3 text-sm">
                      <span className="flex min-w-0 items-center gap-2">
                        <span
                          aria-hidden
                          className="h-3 w-1 shrink-0 rounded-full"
                          style={{ backgroundColor: `var(--color-cal-${item.category})` }}
                        />
                        <span className="truncate">
                          {item.title}
                          <span className="opacity-80">
                            {" "}
                            {/* The store name is already the subheading when the
                                list is grouped; repeating it on every row is the
                                wall of text CAL-2c exists to thin out. */}
                            {grouped ? "" : `· ${item.storeName} `}· {item.categoryLabel}
                          </span>
                        </span>
                      </span>
                      {item.templateId ? (
                        // CAL-2, ruling 3: no separate tick. The link is the control.
                        // Rendered only when there is somewhere to go — the occurrence's
                        // link is SetNull-able, and a button to nowhere is worse than a
                        // row with no button.
                        item.checklistId ? (
                          <a
                            href={`/store-view/checklist/${item.checklistId}`}
                            // ≥44px tap target, as below — same surface, same floor.
                            className="flex min-h-[44px] shrink-0 items-center rounded-md border border-current/40 px-3 text-xs font-medium"
                          >
                            Open checklist
                          </a>
                        ) : null
                      ) : (
                        <button
                          type="button"
                          onClick={() => complete(item.id)}
                          disabled={completing === item.id}
                          // ≥44px tap target — the floor completes these on a phone
                          // (§ Design System: checklist execution surfaces are mobile-first).
                          className="min-h-[44px] shrink-0 rounded-md border border-current/40 px-3 text-xs font-medium disabled:opacity-60"
                        >
                          {completing === item.id ? "Saving…" : "Complete"}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
