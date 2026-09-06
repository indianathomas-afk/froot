"use client"

import { useState, type ReactNode } from "react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

// STAFF-1. Same sentinel and the same "All locations" label as the Dashboard's
// store selector (dashboard-client.tsx :330). The PATTERN and the STRING are
// reused verbatim; the STORAGE is deliberately not. The Dashboard persists its
// choice to localStorage under a shared key and broadcasts it — sharing that
// key here would make picking a store on the Dashboard silently narrow the
// Staff roster, which is a behaviour nobody asked for. This filter holds plain
// component state that resets on reload. UX-2 is the phase that unifies the
// selector sites; this is a NEW SITE for it to absorb, not a pre-emption of it.
const ALL_STORES = "all"

/**
 * Holds which store's card is on screen.
 *
 * IT OWNS NO RENDERING OF ITS OWN beyond the dropdown. `heading`, `subtitle`,
 * `actions`, every `cards[].node` and `extras` arrive as ALREADY-RENDERED
 * SERVER NODES and are passed straight through — no Prisma model, no wage, no
 * compliance summary crosses the client boundary, and the cards themselves are
 * built by the same server code that built them before this component existed.
 * The only reason this is a client component at all is that the selection spans
 * two places in the layout: the dropdown under the subtitle, and the card list
 * below it.
 *
 * `cards` is the SAME array the page already filters to render — so a MANAGER's
 * dropdown can only ever list the stores their page already shows.
 */
export function StaffLocationFilter({
  heading,
  subtitle,
  actions,
  cards,
  extras,
}: {
  heading: ReactNode
  subtitle: ReactNode
  actions: ReactNode
  cards: { id: string; label: string; node: ReactNode }[]
  // The Corporate and Unassigned blocks. They belong to no store, so picking a
  // store hides them — "renders only that store's card". Nothing about WHERE
  // corporate staff are grouped changes; only whether this view is showing them.
  extras: ReactNode
}) {
  const [storeId, setStoreId] = useState(ALL_STORES)
  const isAll = storeId === ALL_STORES
  // A store that vanished from `cards` between renders cannot happen (the array
  // is server-built per request), but falling back to every card rather than
  // none keeps an unknown selection from emptying the page.
  const visible = isAll ? cards : cards.filter((c) => c.id === storeId)

  return (
    <>
      <div className="flex items-start justify-between mb-6">
        <div>
          {heading}
          {subtitle}
          <div className="mt-3">
            <Select value={storeId} onValueChange={setStoreId}>
              <SelectTrigger className="w-52">
                <SelectValue placeholder="Select store" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_STORES}>All locations</SelectItem>
                {cards.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {actions}
      </div>

      <div className="space-y-4">
        {visible.map((c) => c.node)}
        {isAll && extras}
      </div>
    </>
  )
}
