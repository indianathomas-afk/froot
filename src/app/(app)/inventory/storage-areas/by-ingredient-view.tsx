"use client"

import { useEffect, useMemo, useState } from "react"
import { Layers, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ingredientDisplayName, type AreasResponse } from "./storage-areas-client"

type IngredientRow = {
  id: string
  brand: string | null
  name: string
  categoryName: string | null
  vendorNames: string[]
  reportingUnit: string
  costPerReportingUnit: number
}

type GroupBy = "category" | "vendor" | "unassigned"

// Tri-state for the bulk dialog: assign to every selected ingredient, remove
// from every selected ingredient, or leave each one's membership as-is.
type AreaAction = "add" | "remove" | "mixed"

export function ByIngredientView({
  storeId,
  data,
  canManage,
  refresh,
  unassignedOnly,
  setUnassignedOnly,
}: {
  storeId: string
  data: AreasResponse
  canManage: boolean
  refresh: () => void
  unassignedOnly: boolean
  setUnassignedOnly: (v: boolean) => void
}) {
  const [ingredients, setIngredients] = useState<IngredientRow[] | null>(null)
  const [q, setQ] = useState("")
  const [groupBy, setGroupBy] = useState<GroupBy>("unassigned")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [assignOpen, setAssignOpen] = useState(false)

  useEffect(() => {
    fetch("/api/inventory/ingredients?view=active")
      .then((r) => r.json())
      .then((rows) => setIngredients(Array.isArray(rows) ? rows : []))
      .catch(() => setIngredients([]))
  }, [])

  // ingredientId → area ids it's mapped into at this store
  const membership = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const area of data.areas) {
      for (const ing of area.ingredients) {
        map.set(ing.ingredientId, [...(map.get(ing.ingredientId) ?? []), area.id])
      }
    }
    return map
  }, [data.areas])

  const areaNameById = useMemo(() => new Map(data.areas.map((a) => [a.id, a.name])), [data.areas])

  // Clear selection when the store changes — selections are per-store decisions.
  const [prevStoreId, setPrevStoreId] = useState(storeId)
  if (prevStoreId !== storeId) {
    setPrevStoreId(storeId)
    setSelected(new Set())
  }

  const filtered = useMemo(() => {
    if (!ingredients) return []
    const query = q.trim().toLowerCase()
    return ingredients.filter((i) => {
      if (unassignedOnly && (membership.get(i.id)?.length ?? 0) > 0) return false
      if (!query) return true
      return (
        ingredientDisplayName(i).toLowerCase().includes(query) ||
        (i.categoryName ?? "").toLowerCase().includes(query)
      )
    })
  }, [ingredients, q, unassignedOnly, membership])

  const groups = useMemo(() => {
    const map = new Map<string, IngredientRow[]>()
    for (const row of filtered) {
      let key: string
      if (groupBy === "category") key = row.categoryName ?? "Uncategorized"
      else if (groupBy === "vendor") key = row.vendorNames[0] ?? "No vendor"
      else key = (membership.get(row.id)?.length ?? 0) === 0 ? "Unassigned" : "Assigned"
      map.set(key, [...(map.get(key) ?? []), row])
    }
    const entries = [...map.entries()]
    if (groupBy === "unassigned") {
      // Unassigned first — that's the triage order.
      entries.sort((a, b) => (a[0] === "Unassigned" ? -1 : b[0] === "Unassigned" ? 1 : 0))
    } else {
      entries.sort((a, b) => a[0].localeCompare(b[0]))
    }
    return entries
  }, [filtered, groupBy, membership])

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleGroup(rows: IngredientRow[]) {
    const allSelected = rows.every((r) => selected.has(r.id))
    setSelected((prev) => {
      const next = new Set(prev)
      for (const r of rows) {
        if (allSelected) next.delete(r.id)
        else next.add(r.id)
      }
      return next
    })
  }

  if (ingredients === null) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-16 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div className="pb-20">
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--color-muted-foreground)]" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search ingredients…"
            className="pl-9 w-64 min-h-11"
          />
        </div>
        <Select value={groupBy} onValueChange={(v) => setGroupBy(v as GroupBy)}>
          <SelectTrigger className="w-48 min-h-11">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="unassigned">Group: Unassigned first</SelectItem>
            <SelectItem value="category">Group: Category</SelectItem>
            <SelectItem value="vendor">Group: Vendor</SelectItem>
          </SelectContent>
        </Select>
        <button
          onClick={() => setUnassignedOnly(!unassignedOnly)}
          className={`inline-flex items-center min-h-11 px-3 rounded-md border text-sm transition-colors ${
            unassignedOnly
              ? "border-[var(--color-warning-border)] bg-[var(--color-warning-bg)] text-[var(--color-warning-text)] font-medium"
              : "border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]"
          }`}
        >
          Unassigned only
        </button>
      </div>

      {data.areas.length === 0 && (
        <p className="text-sm text-[var(--color-muted-foreground)] mb-4">
          This store has no storage areas yet — create some in the By&nbsp;area view before assigning.
        </p>
      )}

      <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-16 text-center text-[var(--color-muted-foreground)]">
            <p className="text-sm">
              {unassignedOnly ? "Every active ingredient is assigned to at least one area. 🎉" : "No ingredients match."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--color-border)]">
                  <th className="w-12 px-4 py-3" />
                  <th className="text-left text-xs font-medium text-[var(--color-muted-foreground)] px-4 py-3">Ingredient</th>
                  <th className="text-left text-xs font-medium text-[var(--color-muted-foreground)] px-4 py-3">Category</th>
                  <th className="text-left text-xs font-medium text-[var(--color-muted-foreground)] px-4 py-3">Areas</th>
                  <th className="text-right text-xs font-medium text-[var(--color-muted-foreground)] px-4 py-3">Cost / unit</th>
                </tr>
              </thead>
              <tbody>
                {groups.map(([groupName, rows]) => {
                  const selectedInGroup = rows.filter((r) => selected.has(r.id)).length
                  return [
                    <tr key={`group-${groupName}`} className="bg-[var(--color-accent)]/40 border-b border-[var(--color-border)]">
                      <td className="px-4 py-2">
                        {canManage && (
                          <Checkbox
                            checked={
                              selectedInGroup === 0 ? false : selectedInGroup === rows.length ? true : "indeterminate"
                            }
                            onCheckedChange={() => toggleGroup(rows)}
                            aria-label={`Select all in ${groupName}`}
                          />
                        )}
                      </td>
                      <td colSpan={4} className="px-4 py-2 text-xs font-semibold text-[var(--color-foreground)] uppercase tracking-wide">
                        {groupName}
                        <span className="ml-2 font-normal normal-case text-[var(--color-muted-foreground)]">
                          {rows.length}
                        </span>
                      </td>
                    </tr>,
                    ...rows.map((row) => {
                      const areaIds = membership.get(row.id) ?? []
                      return (
                        <tr
                          key={row.id}
                          className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-accent)]/30 transition-colors"
                        >
                          <td className="px-4 py-3">
                            {canManage && (
                              <Checkbox
                                checked={selected.has(row.id)}
                                onCheckedChange={() => toggleRow(row.id)}
                                aria-label={`Select ${ingredientDisplayName(row)}`}
                              />
                            )}
                          </td>
                          <td className="px-4 py-3 text-sm text-[var(--color-foreground)]">
                            {ingredientDisplayName(row)}
                          </td>
                          <td className="px-4 py-3 text-sm text-[var(--color-muted-foreground)]">
                            {row.categoryName ?? "—"}
                          </td>
                          <td className="px-4 py-3">
                            {areaIds.length === 0 ? (
                              <Badge variant="warning">Unassigned</Badge>
                            ) : (
                              <div className="flex flex-wrap gap-1">
                                {areaIds.map((areaId) => (
                                  <Badge key={areaId} variant="secondary">
                                    {areaNameById.get(areaId) ?? "?"}
                                  </Badge>
                                ))}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-sm text-right text-[var(--color-muted-foreground)] whitespace-nowrap">
                            ${row.costPerReportingUnit.toFixed(2)}/{row.reportingUnit}
                          </td>
                        </tr>
                      )
                    }),
                  ]
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {canManage && selected.size > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 px-4 py-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] shadow-lg">
          <span className="text-sm text-[var(--color-foreground)]">
            <strong>{selected.size}</strong> selected
          </span>
          <Button onClick={() => setAssignOpen(true)} disabled={data.areas.length === 0} className="min-h-11">
            <Layers className="h-4 w-4" />
            Assign to areas…
          </Button>
          <Button variant="ghost" onClick={() => setSelected(new Set())} className="min-h-11">
            Clear
          </Button>
        </div>
      )}

      {assignOpen && (
        <AssignDialog
          onClose={() => setAssignOpen(false)}
          storeId={storeId}
          areas={data.areas.map((a) => ({ id: a.id, name: a.name }))}
          membership={membership}
          selectedIds={[...selected]}
          onSaved={() => {
            setSelected(new Set())
            refresh()
          }}
        />
      )}
    </div>
  )
}

function AssignDialog({
  onClose,
  storeId,
  areas,
  membership,
  selectedIds,
  onSaved,
}: {
  onClose: () => void
  storeId: string
  areas: { id: string; name: string }[]
  membership: Map<string, string[]>
  selectedIds: string[]
  onSaved: () => void
}) {
  // Mounted fresh each time the dialog opens, so initial state comes straight
  // from the current selection's membership.
  const [initial] = useState(() => {
    const actions: Record<string, AreaAction> = {}
    const mixed = new Set<string>()
    for (const area of areas) {
      const count = selectedIds.filter((id) => (membership.get(id) ?? []).includes(area.id)).length
      if (count === 0) actions[area.id] = "remove"
      else if (count === selectedIds.length) actions[area.id] = "add"
      else {
        actions[area.id] = "mixed"
        mixed.add(area.id)
      }
    }
    return { actions, mixed }
  })
  const [actions, setActions] = useState<Record<string, AreaAction>>(initial.actions)
  const initialMixed = initial.mixed
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  function cycle(areaId: string) {
    setActions((prev) => {
      const current = prev[areaId]
      let next: AreaAction
      if (current === "mixed") next = "add"
      else if (current === "add") next = "remove"
      else next = initialMixed.has(areaId) ? "mixed" : "add"
      return { ...prev, [areaId]: next }
    })
  }

  async function save() {
    setSaving(true)
    setError("")
    const res = await fetch("/api/inventory/storage-areas/assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        storeId,
        ingredientIds: selectedIds,
        addAreaIds: areas.filter((a) => actions[a.id] === "add").map((a) => a.id),
        removeAreaIds: areas.filter((a) => actions[a.id] === "remove").map((a) => a.id),
      }),
    })
    setSaving(false)
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      setError(body?.error ?? "Save failed")
      return
    }
    onClose()
    onSaved()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Assign {selectedIds.length} ingredient{selectedIds.length === 1 ? "" : "s"} to areas
          </DialogTitle>
          <DialogDescription>
            Check an area to put every selected ingredient in it; uncheck to take them all out. A dash means the
            selection is split — leave it to keep those assignments as they are.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1 max-h-72 overflow-y-auto">
          {areas.map((area) => (
            <button
              key={area.id}
              onClick={() => cycle(area.id)}
              className="w-full flex items-center gap-3 px-3 py-2.5 min-h-11 rounded-md hover:bg-[var(--color-accent)] transition-colors text-left"
            >
              <Checkbox
                checked={actions[area.id] === "add" ? true : actions[area.id] === "mixed" ? "indeterminate" : false}
                className="pointer-events-none"
                tabIndex={-1}
              />
              <span className="flex-1 text-sm text-[var(--color-foreground)]">{area.name}</span>
              {actions[area.id] === "mixed" && (
                <span className="text-xs text-[var(--color-muted-foreground)]">unchanged</span>
              )}
            </button>
          ))}
        </div>

        {error && <p className="text-sm text-[var(--color-destructive)]">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save assignments"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
