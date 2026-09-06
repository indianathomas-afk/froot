"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Search, X } from "lucide-react"
import { cn } from "@/lib/utils"

// SEARCH-1 — the global search bar, pinned at the top of the (app) sidebar.
//
// TWO GROUPS, NOT THREE. The "Go to" nav group was dropped by Gary on
// 2026-09-06; see the header of src/lib/search.ts for why, and DEBT-91 for the
// lift that would unblock it. This component renders whatever groups the route
// returns, in the order the route returns them, and omits empty ones — adding
// the third group later is a server change, not a change here.
//
// DROPDOWN ONLY. There is no /search results page this phase, so Enter on a
// highlighted row navigates to that row and Enter with nothing highlighted does
// nothing. An input that looks like it should submit somewhere and does not is
// worse than one that plainly cannot.
//
// NO Cmd+K. STORE logins are shared iPads with no keyboard — the input must be
// reachable by touch alone, so there is no shortcut to discover and no shortcut
// handler to collide with anything. Rows are 44px minimum for the same reason
// (min-h-11 = 2.75rem = 44px), and so is the collapsed rail's button.
//
// EXISTING DESIGN TOKENS ONLY. Every colour here is a --color-* variable
// already in use elsewhere in this file's sibling components; no new token, no
// new spacing scale.

type SearchGroupKey = "training" | "help"

type SearchRow = {
  group: SearchGroupKey
  id: string
  title: string
  subtitle: string
  href: string
  preview?: boolean
}

type SearchGroup = { group: SearchGroupKey; rows: SearchRow[] }

const GROUP_LABEL: Record<SearchGroupKey, string> = {
  training: "Training",
  help: "Help",
}

const MIN_QUERY_LENGTH = 2
const DEBOUNCE_MS = 250

export function GlobalSearch({ collapsed = false }: { collapsed?: boolean }) {
  const router = useRouter()
  const [query, setQuery] = useState("")
  const [groups, setGroups] = useState<SearchGroup[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // The in-flight request. A new keystroke aborts it rather than letting two
  // responses race — without this a slow early response can overwrite a fast
  // later one and the dropdown shows results for a prefix the user has left.
  const abortRef = useRef<AbortController | null>(null)

  // Flattened in render order, so arrow keys cross group boundaries in the
  // order the reader sees rather than per group.
  const rows = groups.flatMap((g) => g.rows)

  const close = useCallback(() => {
    setOpen(false)
    setActive(-1)
  }, [])

  // Below the minimum length the dropdown clears — and it clears HERE, in the
  // event handler, not in the effect below. Clearing it there would be a
  // synchronous setState in an effect body: a cascading render, and the one
  // thing react-hooks/set-state-in-effect refuses. The effect's job is the
  // debounced fetch and nothing else.
  const reset = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setGroups([])
    setActive(-1)
    setOpen(false)
  }, [])

  function onQueryChange(value: string) {
    setQuery(value)
    if (value.trim().length < MIN_QUERY_LENGTH) reset()
  }

  // 250ms debounce. The setState calls inside the timeout are asynchronous by
  // construction, which is why they are permitted where the ones above are not.
  useEffect(() => {
    if (query.trim().length < MIN_QUERY_LENGTH) return
    const timer = setTimeout(() => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      fetch(`/api/search?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal })
        .then((r) => (r.ok ? r.json() : { groups: [] }))
        .then((data: { groups?: SearchGroup[] }) => {
          setGroups((data.groups ?? []).filter((g) => g.rows.length > 0))
          setActive(-1)
          setOpen(true)
        })
        .catch(() => {
          // An aborted request is the normal path on every keystroke, not an
          // error worth surfacing.
        })
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query])

  // Click outside closes. Pointerdown rather than click so a touch that starts
  // outside the panel closes it without waiting for a full tap.
  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) close()
    }
    document.addEventListener("pointerdown", onPointerDown)
    return () => document.removeEventListener("pointerdown", onPointerDown)
  }, [open, close])

  const go = useCallback(
    (row: SearchRow) => {
      setOpen(false)
      setActive(-1)
      setQuery("")
      setGroups([])
      router.push(row.href)
    },
    [router]
  )

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      close()
      inputRef.current?.blur()
      return
    }
    if (!rows.length) return
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setOpen(true)
      setActive((i) => (i + 1) % rows.length)
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setOpen(true)
      setActive((i) => (i <= 0 ? rows.length - 1 : i - 1))
    } else if (e.key === "Enter" && active >= 0 && active < rows.length) {
      e.preventDefault()
      go(rows[active])
    }
  }

  const input = (
    <div className="relative">
      <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--color-muted-foreground)] pointer-events-none" />
      <input
        ref={inputRef}
        type="search"
        value={query}
        placeholder="Search"
        aria-label="Search training and help"
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => {
          if (rows.length) setOpen(true)
        }}
        className="w-full min-h-11 pl-8 pr-8 rounded border border-[var(--color-border)] bg-[var(--color-background)] text-sm text-[var(--color-foreground)] placeholder:text-[var(--color-muted-foreground)] focus:outline-none focus:border-[var(--color-primary)] transition-colors"
      />
      {query && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            setQuery("")
            reset()
            inputRef.current?.focus()
          }}
          className="absolute right-1 top-1/2 -translate-y-1/2 p-2 rounded text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )

  const results =
    open && rows.length > 0 ? (
      <div className="max-h-80 overflow-y-auto rounded border border-[var(--color-border)] bg-[var(--color-card)] shadow-lg py-1">
        {groups.map((group) => (
          <div key={group.group}>
            {/* Every group carries a header. Empty groups never reach here —
                they are filtered out when the response lands. */}
            <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
              {GROUP_LABEL[group.group]}
            </div>
            {group.rows.map((row) => {
              const index = rows.indexOf(row)
              return (
                <button
                  key={`${row.group}:${row.id}`}
                  type="button"
                  onClick={() => go(row)}
                  onMouseEnter={() => setActive(index)}
                  className={cn(
                    "w-full min-h-11 px-3 py-2 flex flex-col items-start text-left transition-colors",
                    index === active
                      ? "bg-[var(--color-primary)]/10"
                      : "hover:bg-[var(--color-accent)]"
                  )}
                >
                  <span className="text-sm text-[var(--color-foreground)] line-clamp-1">
                    {row.title}
                    {/* HELP-1 ruling 2: a module-preview article is readable in
                        full with its deep links inert. Marking it here keeps it
                        from reading as a broken link when the reader arrives. */}
                    {row.preview && (
                      <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
                        Preview
                      </span>
                    )}
                  </span>
                  {row.subtitle && (
                    <span className="text-xs text-[var(--color-muted-foreground)] line-clamp-1">
                      {row.subtitle}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        ))}
      </div>
    ) : null

  // The 60px rail. A magnifier opens the SAME panel — one implementation, laid
  // out beside the rail instead of beneath the input.
  if (collapsed) {
    return (
      <div ref={rootRef} className="relative px-2 py-2 border-b border-[var(--color-border)]">
        <button
          type="button"
          title="Search"
          aria-label="Search"
          onClick={() => {
            setOpen(true)
            // The input mounts with the panel, so focus after paint.
            requestAnimationFrame(() => inputRef.current?.focus())
          }}
          className="w-full min-h-11 flex items-center justify-center rounded text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] transition-colors"
        >
          <Search className="h-4 w-4" />
        </button>
        {open && (
          <div className="absolute left-full top-2 ml-1 w-72 z-50 space-y-1">
            {input}
            {results}
          </div>
        )}
      </div>
    )
  }

  return (
    <div ref={rootRef} className="relative px-2 py-2 border-b border-[var(--color-border)]">
      {input}
      {results && <div className="absolute left-2 right-2 top-full z-50">{results}</div>}
    </div>
  )
}
