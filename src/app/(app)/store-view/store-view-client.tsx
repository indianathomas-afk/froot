"use client"

import { useState, useEffect, useRef } from "react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { Play, Store } from "lucide-react"
import { useRouter } from "next/navigation"

interface StoreItem {
  id: string
  name: string
  storeNumber: string | null
}

interface TemplateOption {
  id: string
  name: string
  type: string
  taskCount: number
  estimatedMinutes: number
  existingChecklistId: string | null
  existingStatus: string | null
}

export function StoreViewClient({ stores, autoStoreId }: { stores: StoreItem[]; autoStoreId?: string | null }) {
  const autoStore = autoStoreId ? stores.find((s) => s.id === autoStoreId) ?? null : null
  const [selectedStoreId, setSelectedStoreId] = useState<string>(autoStoreId ?? "")
  const [selectedStore, setSelectedStore] = useState<StoreItem | null>(autoStore)
  const [templates, setTemplates] = useState<TemplateOption[]>([])
  const [loading, setLoading] = useState(!!autoStore)
  const [starting, setStarting] = useState<string | null>(null)
  const router = useRouter()
  const autoSelected = useRef(false)

  async function handleStoreSelect(storeId: string) {
    setSelectedStoreId(storeId)
    const store = stores.find((s) => s.id === storeId) ?? null
    setSelectedStore(store)
    if (!storeId) { setTemplates([]); return }

    setLoading(true)
    try {
      const res = await fetch(`/api/stores/${storeId}/templates`)
      if (res.ok) setTemplates(await res.json())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (autoStoreId && !autoSelected.current) {
      autoSelected.current = true
      handleStoreSelect(autoStoreId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStoreId])

  async function startChecklist(template: TemplateOption) {
    // If checklist already exists today, go straight to it
    if (template.existingChecklistId) {
      router.push(`/store-view/checklist/${template.existingChecklistId}`)
      return
    }

    setStarting(template.id)
    try {
      const res = await fetch("/api/checklists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: template.id, storeId: selectedStoreId }),
      })
      const data = await res.json()
      if (data.id) router.push(`/store-view/checklist/${data.id}`)
    } finally {
      setStarting(null)
    }
  }

  if (!selectedStore) {
    return (
      <div>
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-[var(--color-foreground)]">Store Dashboard Preview</h1>
          <p className="text-sm text-[var(--color-muted-foreground)] mt-1">Select a store to preview what staff members see</p>
        </div>

        <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-6 max-w-sm">
          <div className="flex items-center gap-2 mb-2">
            <Store className="h-4 w-4 text-[var(--color-muted-foreground)]" />
            <h2 className="font-semibold text-[var(--color-foreground)]">Select Store</h2>
          </div>
          <p className="text-sm text-[var(--color-muted-foreground)] mb-4">Choose a store to view available checklists</p>
          <Select value={selectedStoreId} onValueChange={handleStoreSelect}>
            <SelectTrigger>
              <SelectValue placeholder="Choose a store..." />
            </SelectTrigger>
            <SelectContent>
              {stores.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}{s.storeNumber ? ` (#${s.storeNumber})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    )
  }

  const statusLabel = (t: TemplateOption) => {
    if (!t.existingStatus) return null
    if (t.existingStatus === "Completed") return { text: "Completed", cls: "text-[var(--color-success-text)] bg-[var(--color-success-bg)]" }
    if (t.existingStatus === "In Progress") return { text: "In Progress", cls: "text-[var(--color-info-text)] bg-[var(--color-info-bg)]" }
    return null
  }

  return (
    <div>
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-foreground)]">Store Dashboard: {selectedStore.name}</h1>
          <p className="text-sm text-[var(--color-muted-foreground)] mt-1">Preview what staff members see at this location</p>
        </div>
        {stores.length > 1 && (
          <Button variant="outline" onClick={() => { setSelectedStore(null); setSelectedStoreId(""); setTemplates([]) }}>
            Change Store
          </Button>
        )}
      </div>

      <div className="mb-4">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-5 h-5 rounded-full bg-[var(--color-primary)] flex items-center justify-center">
            <Play className="h-3 w-3 text-white fill-white" />
          </div>
          <h2 className="font-semibold text-[var(--color-foreground)]">Available Checklists</h2>
        </div>
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Click &ldquo;Start Checklist&rdquo; to begin. Once completed, it won&apos;t appear again until tomorrow.
        </p>
      </div>

      {loading ? (
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-5 animate-pulse">
              <div className="h-5 bg-[var(--color-muted)] rounded mb-2 w-3/4" />
              <div className="h-4 bg-[var(--color-muted)] rounded mb-4 w-1/2" />
              <div className="h-9 bg-[var(--color-muted)] rounded" />
            </div>
          ))}
        </div>
      ) : templates.length === 0 ? (
        <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-12 text-center">
          <p className="font-medium text-[var(--color-foreground)] mb-1">No checklists available</p>
          <p className="text-sm text-[var(--color-muted-foreground)]">No active templates are assigned to this store.</p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {templates.map((template) => {
            const badge = statusLabel(template)
            const isStarting = starting === template.id
            return (
              <div key={template.id} className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-5">
                <div className="flex items-start justify-between mb-1">
                  <h3 className="font-semibold text-[var(--color-foreground)]">{template.name}</h3>
                  {badge && (
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${badge.cls}`}>{badge.text}</span>
                  )}
                </div>
                <p className="text-sm text-[var(--color-muted-foreground)] mb-4">
                  {template.taskCount} tasks{template.estimatedMinutes > 0 ? ` • ~${template.estimatedMinutes} min` : ""}
                </p>
                <button
                  onClick={() => startChecklist(template)}
                  disabled={isStarting}
                  className="w-full flex items-center justify-center gap-2 bg-[var(--color-primary)] text-[var(--color-primary-foreground)] py-2 rounded-md text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-60"
                >
                  <div className="w-4 h-4 rounded-full border-2 border-white flex items-center justify-center">
                    <Play className="h-2 w-2 fill-white" />
                  </div>
                  {isStarting ? "Starting..." : template.existingChecklistId ? "Continue Checklist" : "Start Checklist"}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
