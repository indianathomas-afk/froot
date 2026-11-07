"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react"
import { ChevronDown } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

// ── NOTIFY-UI-ACCORDION: COLLAPSIBLE SETTINGS SECTIONS ───────────────────────
//
// Built for /settings/notifications (Gary: "make the page collapsible so an
// admin sees only the settings they need" — accordion, with Expand all). It is
// a shared component rather than per-card edits so the card BODIES stay
// untouched: the page passes each card's existing CardContent children in, and
// this file owns only the header, the chevron and the clipping wrapper.
//
// COLLAPSED CONTENT STAYS MOUNTED. LOAD-BEARING. A threshold typed and not yet
// saved lives in a client island's state inside the card body; unmounting the
// body on collapse would throw that edit away without a word. The body is
// clipped to height 0 and made `inert` (out of the tab order and away from
// assistive tech) — never removed. Same choice, and same reason for `inert`
// over aria-hidden alone, as CAL-2c's banner list (calendar-due-banner.tsx).
//
// DEFAULT: ALL COLLAPSED. Open state is remembered PER BROWSER under one
// localStorage key, as CAL-2c's banner preference is — a cosmetic preference,
// not a per-user DB row (that would be a migration, a capability and a write
// path for something that decides only what starts open on this laptop).
// Empty, garbled or unreadable storage = all collapsed.
//
// WHY useSyncExternalStore AND NOT CAL-2c's FETCH CONTINUATION. CAL-2c reads
// storage in the continuation of the fetch it already makes, because a bare
// setState in a mount effect is what react-hooks/set-state-in-effect rejects.
// This page makes no client fetch, so there is no continuation to ride. The
// external-store hook is React's own answer to the same two constraints: the
// server snapshot ("" = all collapsed) is what hydrates, so there is no
// hydration mismatch, and there is no setState in an effect at all.
//
// ANIMATION: hand-rolled measured height with a CSS height transition. NOT the
// accordion-down / accordion-up keyframes in globals.css (dead CSS that needs a
// Radix-set variable) and NOT a Radix install. Motion runs only for a click,
// never for the state restored from storage on load, and never under
// prefers-reduced-motion.

const STORAGE_KEY = "froot.notifySettings.open"

// In-memory copy of the last write. When storage throws (Safari private
// window, blocked site data) the toggles still work for this visit; only the
// memory across reloads is lost.
let memoryValue: string | null = null
const listeners = new Set<() => void>()

function readRaw(): string {
  if (memoryValue !== null) return memoryValue
  try {
    return localStorage.getItem(STORAGE_KEY) ?? ""
  } catch {
    return ""
  }
}

function writeRaw(value: string) {
  memoryValue = value
  try {
    localStorage.setItem(STORAGE_KEY, value)
  } catch {
    // Quota, private mode, blocked storage — see memoryValue.
  }
  for (const l of listeners) l()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

// Anything that is not a JSON object of id → true reads as "nothing open".
function parseOpen(raw: string): Record<string, boolean> {
  if (!raw) return {}
  try {
    const v: unknown = JSON.parse(raw)
    if (!v || typeof v !== "object" || Array.isArray(v)) return {}
    const out: Record<string, boolean> = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (val === true) out[k] = true
    }
    return out
  } catch {
    return {}
  }
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches
  } catch {
    return false
  }
}

type Ctx = {
  ids: string[]
  isOpen: (id: string) => boolean
  setOpen: (id: string, open: boolean) => void
  setAll: (open: boolean) => void
  /** True only during the commit that a click caused. */
  shouldAnimate: () => boolean
}

const SectionsContext = createContext<Ctx | null>(null)

function useSections(): Ctx {
  const ctx = useContext(SectionsContext)
  if (!ctx) throw new Error("CollapsibleSection must be inside CollapsibleSections")
  return ctx
}

/**
 * Holds the open/closed state for every section on the page. `ids` is the
 * list of sections the page actually renders this request (some cards are
 * conditional), so Expand all / Collapse all acts on exactly those.
 */
export function CollapsibleSections({ ids, children }: { ids: string[]; children: ReactNode }) {
  const raw = useSyncExternalStore(subscribe, readRaw, () => "")
  const openMap = useMemo(() => parseOpen(raw), [raw])
  const animateRef = useRef(false)

  // Runs after every commit, after the sections' layout effects have read the
  // flag — so the flag covers exactly the one commit a click produced.
  useEffect(() => {
    animateRef.current = false
  })

  const isOpen = useCallback((id: string) => openMap[id] === true, [openMap])

  const write = useCallback((next: Record<string, boolean>) => {
    animateRef.current = !prefersReducedMotion()
    const trimmed: Record<string, boolean> = {}
    for (const [k, v] of Object.entries(next)) if (v) trimmed[k] = true
    writeRaw(JSON.stringify(trimmed))
  }, [])

  const setOpen = useCallback(
    (id: string, open: boolean) => write({ ...parseOpen(readRaw()), [id]: open }),
    [write]
  )

  const setAll = useCallback(
    (open: boolean) => {
      const next = parseOpen(readRaw())
      for (const id of ids) next[id] = open
      write(next)
    },
    [ids, write]
  )

  // STABLE IDENTITY ON PURPOSE. Each section's layout effect lists it as a
  // dependency; if it changed whenever ANY section toggled, a section mid-way
  // through opening would have its transitionend listener torn down by a click
  // on a different chevron and be left frozen at a pixel height.
  const shouldAnimate = useCallback(() => animateRef.current, [])

  const value = useMemo<Ctx>(
    () => ({ ids, isOpen, setOpen, setAll, shouldAnimate }),
    [ids, isOpen, setOpen, setAll, shouldAnimate]
  )

  return <SectionsContext.Provider value={value}>{children}</SectionsContext.Provider>
}

/** One button whose label follows state: any section collapsed → "Expand all". */
export function ExpandAllButton() {
  const { ids, isOpen, setAll } = useSections()
  const anyCollapsed = ids.some((id) => !isOpen(id))
  return (
    <button
      type="button"
      onClick={() => setAll(anyCollapsed)}
      className="min-h-[44px] rounded-md border border-[var(--color-border)] px-3 text-sm font-medium text-[var(--color-foreground)] hover:border-[var(--color-primary)]"
    >
      {anyCollapsed ? "Expand all" : "Collapse all"}
    </button>
  )
}

/**
 * A Card whose body collapses behind its header. `summary` is a one-line
 * status built only from data the page already loaded; omit it when there is
 * no honest one-liner.
 */
export function CollapsibleSection({
  id,
  title,
  summary,
  className,
  children,
}: {
  id: string
  title: string
  summary?: string
  className?: string
  children: ReactNode
}) {
  const { isOpen, setOpen, shouldAnimate } = useSections()
  const open = isOpen(id)
  const bodyId = `notify-section-${id}`
  const outerRef = useRef<HTMLDivElement | null>(null)
  const innerRef = useRef<HTMLDivElement | null>(null)
  const prevOpen = useRef(open)

  // React renders the END state (height auto or 0). On a click-caused change,
  // before paint, run the height from where it was to where it is going, then
  // hand back to React's value. Changes that are not clicks — the stored state
  // arriving after hydration — skip this and simply appear.
  useLayoutEffect(() => {
    const was = prevOpen.current
    prevOpen.current = open
    if (was === open || !shouldAnimate()) return
    const outer = outerRef.current
    const inner = innerRef.current
    if (!outer || !inner) return
    const h = inner.scrollHeight
    if (h === 0) return
    outer.style.height = open ? "0px" : `${h}px`
    void outer.offsetHeight // force reflow so the start height takes
    outer.style.height = open ? `${h}px` : "0px"
    const done = (e: TransitionEvent) => {
      if (e.target !== outer || e.propertyName !== "height") return
      outer.removeEventListener("transitionend", done)
      // Open and settled is height:auto, so the card can grow (a contact
      // added, an error line shown) without a frozen measurement clipping it.
      if (open) outer.style.height = ""
    }
    outer.addEventListener("transitionend", done)
    return () => outer.removeEventListener("transitionend", done)
  }, [open, shouldAnimate])

  return (
    <Card className={className}>
      <CardHeader>
        {/* The WAI accordion shape: the heading WRAPS the button (a heading
            may not sit inside a button). CardTitle is an h3, so the page's
            heading outline is what it was before. */}
        <CardTitle>
          <button
            type="button"
            onClick={() => setOpen(id, !open)}
            aria-expanded={open}
            aria-controls={bodyId}
            className="-m-2 flex min-h-[44px] w-[calc(100%+1rem)] items-center gap-3 rounded-md p-2 text-left"
          >
            <span className="min-w-0 flex-1">
              <span className="block">{title}</span>
              {summary && (
                <span className="mt-1.5 block text-sm font-normal tracking-normal leading-snug text-[var(--color-muted-foreground)]">
                  {summary}
                </span>
              )}
            </span>
            <ChevronDown
              aria-hidden
              className={`h-5 w-5 shrink-0 text-[var(--color-muted-foreground)] transition-transform duration-200 ${
                open ? "rotate-180" : ""
              }`}
            />
          </button>
        </CardTitle>
      </CardHeader>
      <div
        ref={outerRef}
        id={bodyId}
        role="region"
        aria-label={title}
        inert={!open}
        style={{ overflow: "hidden", height: open ? undefined : 0, transition: "height 200ms ease-out" }}
      >
        <div ref={innerRef}>
          <CardContent>{children}</CardContent>
        </div>
      </div>
    </Card>
  )
}
