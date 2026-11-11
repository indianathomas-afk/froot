"use client"

import { useEffect, useRef } from "react"
import { ArrowRight, Check, Clock } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ChecklistTypeStyle } from "@/lib/checklist-types"

// TAB-13 — "Home · Option 1 — Switcher on the hero" (Froot Tablet — Checklists
// PDF). A row of tabs, one per checklist today, above the hero card; the hero
// takes the selected checklist's type colour and icon. Which tab is selected,
// and in what order they come, is src/lib/tablet-today.ts (R3/RN-3, pinned by
// scripts/verify-tab13-switcher.ts); the colours and icons are
// src/lib/checklist-types.ts. Everything here is presentation: the parent
// (TasksPanel in tablet-home.tsx) owns the state and every write.
//
// ACCESSIBILITY (R8): role tablist / tab / tabpanel with aria-selected; tabs
// are 84px tall (≥ 44px); arrow keys move between tabs. White text on the
// orange / teal / purple / grey fills passes only as LARGE text, so every line
// of text on a fill is ≥ 19px bold or ≥ 24px — including a filled tab's
// "12 of 31", which the mock draws at 15px.

export interface ChecklistTabItem {
  id: string
  /** The type name as the org spells it (or the template name — see TasksPanel). */
  label: string
  /** "12 of 31" or "Done". */
  sub: string
  style: ChecklistTypeStyle
}

export const SWITCHER_PANEL_ID = "tablet-checklist-panel"
const tabDomId = (id: string) => `tablet-checklist-tab-${id}`

export function ChecklistTabs({
  items,
  selectedId,
  onSelect,
}: {
  items: ChecklistTabItem[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const listRef = useRef<HTMLDivElement>(null)

  // R6: more tabs than fit scroll sideways — keep the selected one in view
  // (the auto-pick can land on a tab that starts off-screen).
  useEffect(() => {
    if (!selectedId) return
    const el = listRef.current?.querySelector<HTMLElement>(`#${CSS.escape(tabDomId(selectedId))}`)
    el?.scrollIntoView({ block: "nearest", inline: "nearest" })
  }, [selectedId])

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return
    const at = items.findIndex((i) => i.id === selectedId)
    const next = items[(at + (e.key === "ArrowRight" ? 1 : -1) + items.length) % items.length]
    if (!next) return
    e.preventDefault()
    onSelect(next.id)
    listRef.current?.querySelector<HTMLElement>(`#${CSS.escape(tabDomId(next.id))}`)?.focus()
  }

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label="Today's checklists"
      onKeyDown={onKeyDown}
      // No wrapping and no shrinking text (R6): tabs keep their natural width,
      // share out any spare room, and the row scrolls once they do not fit.
      className="flex shrink-0 gap-3 overflow-x-auto [scrollbar-width:none]"
    >
      {items.map((item) => {
        const selected = item.id === selectedId
        const { Icon } = item.style
        return (
          <button
            key={item.id}
            id={tabDomId(item.id)}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={SWITCHER_PANEL_ID}
            tabIndex={selected ? 0 : -1}
            onClick={() => onSelect(item.id)}
            className={cn(
              "flex min-h-[84px] shrink-0 grow basis-auto items-center gap-3 rounded-2xl border-2 px-4 py-2 text-left transition-colors",
              selected
                ? cn(item.style.fill, item.style.ink, "border-transparent")
                : "border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-foreground)]"
            )}
          >
            <span
              className={cn(
                "flex size-11 shrink-0 items-center justify-center rounded-xl",
                selected ? item.style.onFillChip : cn(item.style.fill, item.style.ink)
              )}
            >
              <Icon className="size-6" aria-hidden />
            </span>
            <span className="flex flex-col">
              <span className="whitespace-nowrap text-xl font-extrabold uppercase leading-tight tracking-tight">{item.label}</span>
              <span
                className={cn(
                  "whitespace-nowrap leading-tight",
                  // R8: on a fill, ≥ 19px bold. Off a fill, ordinary muted text.
                  selected ? "text-xl font-bold" : "text-base font-semibold text-[var(--color-muted-foreground)]"
                )}
              >
                {item.sub}
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

export function ChecklistHero({
  label,
  style,
  total,
  done,
  status,
  due,
  completed,
  action,
  busy,
  onAction,
  tabbed,
  tabId,
}: {
  label: string
  style: ChecklistTypeStyle
  total: number
  done: number
  status: "Not started" | "In progress" | "Completed"
  /** "Due 7:00 PM" / "Overdue · was due 7:00 PM", or null. */
  due: string | null
  completed: boolean
  action: "Start" | "Continue" | "View"
  busy: boolean
  onAction: () => void
  /** Whether the tab row is showing (R6: not for a single checklist). */
  tabbed: boolean
  tabId: string
}) {
  const { Icon } = style
  return (
    <div
      id={SWITCHER_PANEL_ID}
      role={tabbed ? "tabpanel" : undefined}
      aria-labelledby={tabbed ? tabDomId(tabId) : undefined}
      className={cn("flex flex-1 flex-col gap-5 overflow-y-auto p-8", style.fill, style.ink)}
    >
      <div className="flex items-start justify-between gap-3">
        <span className={cn("flex size-16 shrink-0 items-center justify-center rounded-2xl", style.onFillChip)}>
          <Icon className="size-9" aria-hidden />
        </span>
        <div className="flex flex-wrap justify-end gap-2">
          {due && !completed && (
            <span
              className={cn(
                "inline-flex items-center gap-2 rounded-full bg-[var(--color-card)] px-5 py-2 text-xl font-bold",
                style.chipText
              )}
            >
              <Clock className="size-5" aria-hidden />
              {due}
            </span>
          )}
          {completed && (
            <span className="inline-flex items-center gap-2 rounded-full border border-[var(--color-success-border)] bg-[var(--color-success-bg)] px-5 py-2 text-xl font-bold text-[var(--color-success-text)]">
              <Check className="size-5" aria-hidden />
              Completed
            </span>
          )}
        </div>
      </div>

      <div className="min-w-0">
        <h2 className="break-words text-6xl font-extrabold uppercase leading-none tracking-tight">{label}</h2>
        <p className="mt-3 text-2xl font-semibold">
          {total} {total === 1 ? "task" : "tasks"} · {status}
        </p>
      </div>

      <div className="mt-auto flex flex-col gap-3">
        <p className="text-xl font-bold">
          {done} of {total} done
        </p>
        <div className={cn("h-3 overflow-hidden rounded-full", style.onFillTrack)}>
          <div
            className={cn("h-full rounded-full transition-all duration-300", style.onFillBar)}
            style={{ width: `${total ? (done / total) * 100 : 0}%` }}
          />
        </div>
        <button
          type="button"
          onClick={onAction}
          disabled={busy}
          className="mt-2 flex min-h-20 w-full items-center justify-center gap-3 rounded-2xl bg-[var(--color-background)] text-3xl font-bold text-[var(--color-foreground)] disabled:opacity-60"
        >
          {busy ? "Starting…" : action}
          {!busy && <ArrowRight className="size-8" aria-hidden />}
        </button>
      </div>
    </div>
  )
}
