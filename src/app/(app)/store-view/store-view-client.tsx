"use client"

import { useState } from "react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { Play } from "lucide-react"
import { useRouter } from "next/navigation"

interface Store {
  id: string
  name: string
  storeNumber: string | null
}

interface Checklist {
  id: string
  templateName: string
  templateType: string
  taskCount: number
  estimatedMinutes: number
}

export function StoreViewClient({ stores }: { stores: Store[] }) {
  const [selectedStoreId, setSelectedStoreId] = useState<string>("")
  const [selectedStore, setSelectedStore] = useState<Store | null>(null)
  const [checklists, setChecklists] = useState<Checklist[]>([])
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleStoreSelect(storeId: string) {
    setSelectedStoreId(storeId)
    const store = stores.find((s) => s.id === storeId) ?? null
    setSelectedStore(store)
    if (!storeId) { setChecklists([]); return }

    setLoading(true)
    try {
      const res = await fetch(`/api/checklists?storeId=${storeId}&today=1`)
      if (res.ok) {
        const data = await res.json()
        setChecklists(data)
      }
    } finally {
      setLoading(false)
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
            <span>🏪</span>
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
                  {s.storeNumber ? `#${s.storeNumber} - ` : ""}{s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-foreground)]">Store Dashboard: {selectedStore.name}</h1>
          <p className="text-sm text-[var(--color-muted-foreground)] mt-1">Preview what staff members see at this location</p>
        </div>
        <Button variant="outline" onClick={() => { setSelectedStore(null); setSelectedStoreId(""); setChecklists([]) }}>
          Change Store
        </Button>
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
              <div className="h-5 bg-[var(--color-muted)] rounded mb-2 w-3/4"></div>
              <div className="h-4 bg-[var(--color-muted)] rounded mb-4 w-1/2"></div>
              <div className="h-9 bg-[var(--color-muted)] rounded"></div>
            </div>
          ))}
        </div>
      ) : checklists.length === 0 ? (
        <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-12 text-center">
          <p className="font-medium text-[var(--color-foreground)] mb-1">No checklists available</p>
          <p className="text-sm text-[var(--color-muted-foreground)]">No checklists have been generated for this store today.</p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {checklists.map((checklist) => (
            <div key={checklist.id} className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-5">
              <h3 className="font-semibold text-[var(--color-foreground)] mb-1">{checklist.templateName}</h3>
              <p className="text-sm text-[var(--color-muted-foreground)] mb-4">
                {checklist.taskCount} tasks • ~{checklist.estimatedMinutes} min
              </p>
              <button
                onClick={() => router.push(`/store-view/checklist/${checklist.id}`)}
                className="w-full flex items-center justify-center gap-2 bg-[var(--color-primary)] text-[var(--color-primary-foreground)] py-2 rounded-md text-sm font-medium hover:opacity-90 transition-opacity"
              >
                <div className="w-4 h-4 rounded-full border-2 border-white flex items-center justify-center">
                  <Play className="h-2 w-2 fill-white" />
                </div>
                Start Checklist
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
