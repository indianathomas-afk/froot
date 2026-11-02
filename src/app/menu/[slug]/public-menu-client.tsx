"use client"

import { useEffect, useMemo, useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { NutritionFactsLabel } from "@/components/nutrition/nutrition-facts-label"
import { PUBLIC_ALLERGEN_LABELS, type PublicItem, type PublicMenuPayload } from "@/lib/public-menu"

// N-3 public menu, client side: search and the allergen filter run here, over
// the payload only. Filter rule: "hide items containing …" also hides every
// item whose allergens are NOT shown (unverified, or only partly verified —
// N3-F1, N3-F7), because an unknown is never safe to show under a filter.
// The cross-contact notice is always shown with allergens and the filter (N3-F4).

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" })
}

export function PublicMenuClient({ payload, embed }: { payload: PublicMenuPayload; embed: boolean }) {
  const [query, setQuery] = useState("")
  const [avoid, setAvoid] = useState<Set<string>>(new Set())
  const [open, setOpen] = useState<{ item: PublicItem; size: number } | null>(null)

  // Auto-height for the embed: post our height to the host page, which the
  // optional snippet on the publish page listens for. Height only — nothing
  // else crosses the frame.
  useEffect(() => {
    if (!embed || window.parent === window) return
    const post = () => window.parent.postMessage({ type: "froot-menu-height", height: document.documentElement.scrollHeight }, "*")
    const ro = new ResizeObserver(post)
    ro.observe(document.body)
    post()
    return () => ro.disconnect()
  }, [embed])

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    return payload.groups
      .map((g) => ({
        name: g.name,
        items: g.items.filter((it) => {
          if (q && !it.name.toLowerCase().includes(q)) return false
          if (avoid.size === 0) return true
          return it.allergens !== null && !it.allergens.some((a) => avoid.has(a))
        }),
      }))
      .filter((g) => g.items.length > 0)
  }, [payload.groups, query, avoid])

  const total = payload.groups.reduce((n, g) => n + g.items.length, 0)
  const verifiedSizes = open ? open.item.sizes.map((s, i) => ({ s, i })).filter((x) => x.s.label) : []
  const current = open ? open.item.sizes[open.size] : null

  return (
    <div className="min-h-full bg-white text-neutral-900">
      <div className="mx-auto max-w-3xl px-4 py-6">
        {!embed && (
          <header className="mb-5">
            <h1 className="text-2xl font-bold">{payload.orgName}</h1>
            <p className="text-sm text-neutral-600">Nutrition &amp; allergens</p>
          </header>
        )}

        {total === 0 ? (
          <p className="py-12 text-center text-neutral-600">Nutrition information is coming soon.</p>
        ) : (
          <>
            <div className="mb-4 space-y-3">
              <Input placeholder="Search the menu" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search the menu" />
              <div>
                <p className="text-sm font-medium mb-2">Hide items containing:</p>
                <div className="flex flex-wrap gap-2">
                  {PUBLIC_ALLERGEN_LABELS.map((a) => {
                    const on = avoid.has(a)
                    return (
                      <button
                        key={a}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setAvoid((s) => { const n = new Set(s); if (on) n.delete(a); else n.add(a); return n })}
                        className={`min-h-[44px] rounded-full border px-4 text-sm ${on ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 bg-white"}`}
                      >
                        {a}
                      </button>
                    )
                  })}
                </div>
                {avoid.size > 0 && (
                  <p className="text-xs text-neutral-600 mt-2">Items without allergen information yet are hidden too.</p>
                )}
                <p className="text-xs text-neutral-600 mt-2">{payload.crossContactNotice}</p>
              </div>
            </div>

            {groups.length === 0 ? (
              <p className="py-8 text-center text-neutral-600">No items match. Try clearing the search or the allergen filter.</p>
            ) : (
              groups.map((g) => (
                <section key={g.name} className="mb-6">
                  <h2 className="text-lg font-semibold border-b border-neutral-200 pb-1 mb-2">{g.name}</h2>
                  <ul className="divide-y divide-neutral-100">
                    {g.items.map((it, idx) => {
                      const first = it.sizes.findIndex((s) => s.label)
                      const tappable = first !== -1
                      return (
                        <li key={`${idx}-${it.name}`}>
                          <button
                            type="button"
                            disabled={!tappable}
                            onClick={() => tappable && setOpen({ item: it, size: first })}
                            className="w-full text-left py-3 min-h-[44px] disabled:cursor-default"
                          >
                            <div className="flex items-baseline justify-between gap-3">
                              <span className="font-medium">{it.name}</span>
                              {tappable && <span className="text-xs text-neutral-500 shrink-0">Nutrition facts ›</span>}
                            </div>
                            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-neutral-700">
                              {it.sizes.map((s) => (
                                <span key={s.name}>
                                  {s.name}: {s.calories !== null ? <span className="tabular-nums">{s.calories} cal</span> : <span className="text-neutral-500">coming soon</span>}
                                </span>
                              ))}
                            </div>
                            <p className="mt-1 text-xs text-neutral-600">
                              {!tappable
                                ? "Nutrition coming soon"
                                : it.allergens === null
                                  ? "Allergens coming soon"
                                  : it.allergens.length
                                    ? `Contains: ${it.allergens.join(", ")}`
                                    : "No major allergens in the standard recipe"}
                            </p>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </section>
              ))
            )}
          </>
        )}

        <footer className="mt-8 border-t border-neutral-200 pt-4 space-y-2 text-xs text-neutral-600">
          <p>{payload.disclaimer}</p>
          <p>{payload.crossContactNotice}</p>
          {payload.lastUpdated && <p>Last updated {formatDate(payload.lastUpdated)}</p>}
          {!embed && <p className="text-neutral-400">Powered by Froot</p>}
        </footer>
      </div>

      <Dialog open={open !== null} onOpenChange={(v) => !v && setOpen(null)}>
        <DialogContent className="max-w-md bg-white text-neutral-900 max-h-[90vh] overflow-y-auto">
          {open && current && (
            <>
              <DialogTitle>{open.item.name}</DialogTitle>
              <DialogDescription className="sr-only">Nutrition Facts for {open.item.name}, {current.name}</DialogDescription>
              {verifiedSizes.length > 1 && (
                <div className="flex flex-wrap gap-2" role="tablist" aria-label="Size">
                  {verifiedSizes.map(({ s, i }) => (
                    <button
                      key={s.name}
                      type="button"
                      role="tab"
                      aria-selected={i === open.size}
                      onClick={() => setOpen({ item: open.item, size: i })}
                      className={`min-h-[44px] rounded-full border px-4 text-sm ${i === open.size ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300"}`}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              )}
              {current.label && <NutritionFactsLabel label={current.label} />}
              <p className="text-xs text-neutral-600">{payload.crossContactNotice}</p>
              <p className="text-xs text-neutral-600">{payload.disclaimer}</p>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
