"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { AlertTriangle, Copy, Warehouse } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ByAreaView } from "./by-area-view"
import { ByIngredientView } from "./by-ingredient-view"

export type AreaIngredient = {
  mappingId: string
  ingredientId: string
  sortOrder: number
  brand: string | null
  name: string
  categoryName: string | null
  reportingUnit: string
  costPerReportingUnit: number
}

export type StorageAreaData = {
  id: string
  name: string
  sortOrder: number
  ingredients: AreaIngredient[]
}

export type UnassignedIngredient = {
  ingredientId: string
  brand: string | null
  name: string
  categoryName: string | null
  reportingUnit: string
  costPerReportingUnit: number
}

export type AreasResponse = {
  areas: StorageAreaData[]
  unassigned: UnassignedIngredient[]
}

export function ingredientDisplayName(i: { brand: string | null; name: string }) {
  return i.brand ? `${i.brand} ${i.name}` : i.name
}

export function StorageAreasClient({
  stores,
  canManage,
  isAdmin,
}: {
  stores: { id: string; name: string }[]
  canManage: boolean
  isAdmin: boolean
}) {
  const [storeId, setStoreId] = useState(stores[0]?.id ?? "")
  // Keyed by store so switching stores shows a fresh skeleton instead of stale data.
  const [result, setResult] = useState<{ storeId: string; data: AreasResponse } | null>(null)
  const [view, setView] = useState<"area" | "ingredient">("area")
  const [unassignedOnly, setUnassignedOnly] = useState(false)
  const [copyOpen, setCopyOpen] = useState(false)
  const defaultViewApplied = useRef(false)

  const [prevStoreId, setPrevStoreId] = useState(storeId)
  if (prevStoreId !== storeId) {
    setPrevStoreId(storeId)
    setUnassignedOnly(false)
  }

  const refresh = useCallback(() => {
    if (!storeId) return
    fetch(`/api/inventory/storage-areas?storeId=${storeId}`)
      .then((res): Promise<AreasResponse> => (res.ok ? res.json() : Promise.resolve({ areas: [], unassigned: [] })))
      .then((json) => {
        setResult({ storeId, data: json })
        // Setup isn't done while ingredients can't be counted — open on the bulk
        // assignment view the first time the page loads with unassigned items.
        if (!defaultViewApplied.current) {
          defaultViewApplied.current = true
          if (json.unassigned.length > 0) setView("ingredient")
        }
      })
      .catch(() => setResult({ storeId, data: { areas: [], unassigned: [] } }))
  }, [storeId])

  useEffect(() => {
    refresh()
  }, [refresh])

  const data = result?.storeId === storeId ? result.data : null
  const loading = data === null

  if (stores.length === 0) {
    return (
      <div className="p-16 text-center text-[var(--color-muted-foreground)]">
        <p className="text-sm">No stores available. Add a store first, then set up its storage areas.</p>
      </div>
    )
  }

  const unassignedCount = data?.unassigned.length ?? 0

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-foreground)]">Storage Areas</h1>
          <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
            Organize ingredients by where they live in each store — counts walk area by area.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={storeId} onValueChange={setStoreId}>
            <SelectTrigger className="w-52 min-h-11">
              <SelectValue placeholder="Select store" />
            </SelectTrigger>
            <SelectContent>
              {stores.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {isAdmin && stores.length > 1 && (
            <Button variant="outline" onClick={() => setCopyOpen(true)}>
              <Copy className="h-4 w-4" />
              Copy from store
            </Button>
          )}
        </div>
      </div>

      {unassignedCount > 0 && (
        <button
          onClick={() => {
            setView("ingredient")
            setUnassignedOnly(true)
          }}
          className="w-full flex items-center gap-3 mb-6 px-4 py-3 rounded-lg border border-[var(--color-warning-border)] bg-[var(--color-warning-bg)] text-left hover:opacity-90 transition-opacity"
        >
          <AlertTriangle className="h-5 w-5 text-[var(--color-warning-text)] shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-[var(--color-warning-text)]">
              {unassignedCount} ingredient{unassignedCount === 1 ? "" : "s"} can&apos;t be counted yet
            </p>
            <p className="text-xs text-[var(--color-warning-text)]/80">
              Assign them to a storage area at this store so they appear on count sheets. Tap to review.
            </p>
          </div>
          <Badge variant="warning">{unassignedCount}</Badge>
        </button>
      )}

      <Tabs value={view} onValueChange={(v) => setView(v as "area" | "ingredient")}>
        <TabsList className="mb-4">
          <TabsTrigger value="area" className="min-h-10 px-4">
            By area
          </TabsTrigger>
          <TabsTrigger value="ingredient" className="min-h-10 px-4">
            By ingredient
          </TabsTrigger>
        </TabsList>

        <TabsContent value="area">
          {loading || !data ? (
            <AreasSkeleton />
          ) : (
            <ByAreaView storeId={storeId} data={data} canManage={canManage} refresh={refresh} />
          )}
        </TabsContent>

        <TabsContent value="ingredient">
          {loading || !data ? (
            <AreasSkeleton />
          ) : (
            <ByIngredientView
              storeId={storeId}
              data={data}
              canManage={canManage}
              refresh={refresh}
              unassignedOnly={unassignedOnly}
              setUnassignedOnly={setUnassignedOnly}
            />
          )}
        </TabsContent>
      </Tabs>

      {isAdmin && copyOpen && (
        <CopyAreasDialog
          onClose={() => setCopyOpen(false)}
          stores={stores}
          targetStoreId={storeId}
          currentAreas={data?.areas ?? []}
          onCopied={refresh}
        />
      )}
    </div>
  )
}

function AreasSkeleton() {
  return (
    <div className="space-y-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-24 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] animate-pulse" />
      ))}
    </div>
  )
}

// Admin multi-store rollout: build the layout once, copy it onto a new store,
// then tweak. Merge-add — existing areas/mappings on the target are untouched.
function CopyAreasDialog({
  onClose,
  stores,
  targetStoreId,
  currentAreas,
  onCopied,
}: {
  onClose: () => void
  stores: { id: string; name: string }[]
  targetStoreId: string
  currentAreas: StorageAreaData[]
  onCopied: () => void
}) {
  const [sourceStoreId, setSourceStoreId] = useState("")
  // Keyed by source store so a stale response never previews as another store's layout.
  const [previewResult, setPreviewResult] = useState<{ storeId: string; areas: StorageAreaData[] } | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!sourceStoreId) return
    let cancelled = false
    fetch(`/api/inventory/storage-areas?storeId=${sourceStoreId}`)
      .then((r) => r.json())
      .then((json: AreasResponse) => {
        if (!cancelled) setPreviewResult({ storeId: sourceStoreId, areas: json.areas ?? [] })
      })
      .catch(() => {
        if (!cancelled) setError("Could not load the source store's areas")
      })
    return () => {
      cancelled = true
    }
  }, [sourceStoreId])

  const preview = previewResult?.storeId === sourceStoreId ? previewResult.areas : null

  const currentNames = new Set(currentAreas.map((a) => a.name.trim().toLowerCase()))
  const targetStore = stores.find((s) => s.id === targetStoreId)

  async function confirmCopy() {
    setSaving(true)
    setError("")
    const res = await fetch("/api/inventory/storage-areas/copy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceStoreId, targetStoreId }),
    })
    setSaving(false)
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      setError(body?.error ?? "Copy failed")
      return
    }
    onClose()
    onCopied()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Copy areas from another store</DialogTitle>
          <DialogDescription>
            Duplicates areas, ingredient assignments, and ordering onto {targetStore?.name ?? "this store"}. Existing
            areas with the same name gain any missing ingredients; nothing is removed.
          </DialogDescription>
        </DialogHeader>

        <Select value={sourceStoreId} onValueChange={setSourceStoreId}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Copy from…" />
          </SelectTrigger>
          <SelectContent>
            {stores
              .filter((s) => s.id !== targetStoreId)
              .map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>

        {preview && (
          <div className="max-h-56 overflow-y-auto rounded-md border border-[var(--color-border)] divide-y divide-[var(--color-border)]">
            {preview.length === 0 ? (
              <p className="p-4 text-sm text-[var(--color-muted-foreground)]">That store has no storage areas yet.</p>
            ) : (
              preview.map((area) => (
                <div key={area.id} className="flex items-center justify-between px-3 py-2">
                  <div className="flex items-center gap-2 text-sm">
                    <Warehouse className="h-4 w-4 text-[var(--color-muted-foreground)]" />
                    <span className="font-medium">{area.name}</span>
                    <span className="text-xs text-[var(--color-muted-foreground)]">
                      {area.ingredients.length} ingredient{area.ingredients.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <Badge variant={currentNames.has(area.name.trim().toLowerCase()) ? "secondary" : "success"}>
                    {currentNames.has(area.name.trim().toLowerCase()) ? "Merges into existing" : "New area"}
                  </Badge>
                </div>
              ))
            )}
          </div>
        )}

        {error && <p className="text-sm text-[var(--color-destructive)]">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={confirmCopy} disabled={!sourceStoreId || !preview || preview.length === 0 || saving}>
            {saving ? "Copying…" : "Copy areas"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
