"use client"

import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react"
import { Check, ChevronDown } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import type { InboxIngredient, InboxItem } from "./label-inbox-client"

// N-1e: which ingredient an inbox file is for. N1E-F2 (Gary, 2026-11-02,
// "Accept all leans"): "suggest, never assign; the ADMIN confirms every file's
// ingredient before Apply is enabled." A suggestion is shown as a suggestion
// with its own Confirm button; nothing is saved until the ADMIN clicks Confirm
// or picks an ingredient. The select starts EMPTY even when there is a
// suggestion, so a confirmed value always came from a click.

//
// N-1e-UI (Gary's staging test, 2026-11-03): the picker is a searchable
// combobox — with ~225 ingredients a plain select had to be scrolled end to
// end, and it opened upward and clipped. Typing filters on the same display
// name the rest of Nutrition uses (brand + name), case- and accent-insensitive,
// every word must match. The list sits in a Popover, which opens below and
// flips above only when there is no room, and is capped to the space available
// so it scrolls on its own and never runs off-screen.

const label = (i: InboxIngredient) => (i.brand ? `${i.brand} ${i.name}` : i.name)
const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()

export function IngredientPicker({
  item,
  ingredients,
  disabled,
  onAssign,
}: {
  item: InboxItem
  ingredients: InboxIngredient[]
  disabled?: boolean
  onAssign: (ingredientId: string | null) => Promise<void>
}) {
  const [saving, setSaving] = useState(false)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const listId = useId()
  const searchable = useMemo(() => ingredients.map((i) => ({ i, text: fold(label(i)) })), [ingredients])
  const matches = useMemo(() => {
    const words = fold(query).split(/\s+/).filter(Boolean)
    return words.length ? searchable.filter((s) => words.every((w) => s.text.includes(w))).map((s) => s.i) : ingredients
  }, [query, searchable, ingredients])
  const suggested = !item.ingredientId && item.suggestedIngredientId ? ingredients.find((i) => i.id === item.suggestedIngredientId) : undefined
  const confirmed = item.ingredientId ? ingredients.find((i) => i.id === item.ingredientId) : undefined
  const assign = (id: string | null) => {
    setSaving(true)
    onAssign(id).finally(() => setSaving(false))
  }
  const off = disabled || saving
  const openChange = (next: boolean) => {
    setOpen(next)
    setQuery("")
    setActive(0)
  }
  const choose = (id: string) => {
    openChange(false)
    if (id !== item.ingredientId) assign(id)
  }
  const move = (to: number) => {
    setActive(to)
    listRef.current?.querySelector(`[data-index="${to}"]`)?.scrollIntoView({ block: "nearest" })
  }
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault()
      if (matches.length) move(Math.min(active + 1, matches.length - 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      if (matches.length) move(Math.max(active - 1, 0))
    } else if (e.key === "Enter") {
      e.preventDefault()
      if (matches[active]) choose(matches[active].id)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="w-64 max-w-full">
        <Popover open={open} onOpenChange={openChange}>
          <PopoverTrigger asChild disabled={off}>
            <button
              type="button"
              aria-haspopup="listbox"
              className="flex h-8 w-full items-center justify-between gap-2 rounded-md border border-[var(--color-input)] bg-transparent px-3 text-left text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-ring)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className={cn("truncate", !confirmed && "text-[var(--color-muted-foreground)]")}>
                {confirmed ? label(confirmed) : "Pick the ingredient…"}
              </span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            side="bottom"
            collisionPadding={8}
            className="flex w-[var(--radix-popover-trigger-width)] min-w-64 flex-col p-1 max-h-[min(20rem,var(--radix-popover-content-available-height))]"
          >
            <Input
              autoFocus
              role="combobox"
              aria-expanded
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={matches[active] ? `${listId}-${active}` : undefined}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                move(0)
              }}
              onKeyDown={onKeyDown}
              placeholder="Search ingredients…"
              aria-label="Search ingredients"
              className="h-8 text-xs mb-1 shrink-0"
            />
            <div ref={listRef} id={listId} role="listbox" className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {matches.length === 0 ? (
                <p className="px-2 py-1.5 text-xs text-[var(--color-muted-foreground)]">No ingredient matches “{query.trim()}”</p>
              ) : (
                matches.map((i, n) => (
                  <button
                    key={i.id}
                    type="button"
                    role="option"
                    id={`${listId}-${n}`}
                    aria-selected={i.id === item.ingredientId}
                    data-index={n}
                    onMouseMove={() => n !== active && setActive(n)}
                    onClick={() => choose(i.id)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs",
                      n === active && "bg-[var(--color-accent)]",
                    )}
                  >
                    <Check className={cn("h-3.5 w-3.5 shrink-0", i.id === item.ingredientId ? "opacity-100" : "opacity-0")} />
                    <span className="truncate">{label(i)}</span>
                  </button>
                ))
              )}
            </div>
          </PopoverContent>
        </Popover>
      </div>
      {confirmed && (
        <>
          <span className="text-xs text-[#25ba3b]">Confirmed</span>
          <Button variant="outline" size="sm" className="h-7 text-xs" disabled={off} onClick={() => assign(null)}>Change</Button>
        </>
      )}
      {suggested && (
        <>
          <span className="text-xs text-[var(--color-muted-foreground)]">Suggested: {label(suggested)}</span>
          <Button size="sm" className="h-7 text-xs" disabled={off} onClick={() => assign(suggested.id)}>Confirm</Button>
        </>
      )}
      {!confirmed && !suggested && <span className="text-xs text-[#efa201]">No confident match — pick one</span>}
    </div>
  )
}
