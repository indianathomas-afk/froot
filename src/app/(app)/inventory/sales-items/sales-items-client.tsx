"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Info, RefreshCw } from "lucide-react"
import { formatDistanceToNow } from "date-fns"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

type SalesItem = {
  id: string
  displayName: string
  menuGroup: string | null
  priceCents: number | null
  squareVariationId: string
}

export function SalesItemsClient({
  salesItems,
  isAdmin,
  lastCatalogSyncAt,
  squareConnected,
}: {
  salesItems: SalesItem[]
  isAdmin: boolean
  lastCatalogSyncAt: string | null
  squareConnected: boolean
}) {
  const [search, setSearch] = useState("")
  const [menuGroupFilter, setMenuGroupFilter] = useState("all")

  const menuGroups = useMemo(
    () => Array.from(new Set(salesItems.map((s) => s.menuGroup).filter((g): g is string => !!g))).sort(),
    [salesItems]
  )

  const filtered = useMemo(() => {
    return salesItems.filter((s) => {
      if (menuGroupFilter !== "all" && s.menuGroup !== menuGroupFilter) return false
      if (search.trim() && !s.displayName.toLowerCase().includes(search.trim().toLowerCase())) return false
      return true
    })
  }, [salesItems, search, menuGroupFilter])

  return (
    <div>
      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-foreground)]">Sales Items</h1>
          <p className="text-sm text-[var(--color-muted-foreground)] mt-1">Sellable products synced from Square, read-only.</p>
        </div>
        {isAdmin && <SyncButton squareConnected={squareConnected} lastCatalogSyncAt={lastCatalogSyncAt} />}
      </div>

      <div className="flex items-start gap-2 bg-[var(--color-info-bg)] border border-[var(--color-info-border)] text-[var(--color-info-text)] text-sm rounded-lg px-4 py-3 mb-6">
        <Info className="h-4 w-4 mt-0.5 shrink-0" />
        <p>Sales items are sellable products synced from Square. Ingredients are what you count and order — manage them in Ingredients.</p>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-6">
        <Input placeholder="Search sales items..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
        <Select value={menuGroupFilter} onValueChange={setMenuGroupFilter}>
          <SelectTrigger className="w-48"><SelectValue placeholder="All Menu Groups" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Menu Groups</SelectItem>
            {menuGroups.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] overflow-hidden">
        {salesItems.length === 0 ? (
          <div className="p-16 text-center text-[var(--color-muted-foreground)]">
            <p className="text-sm mb-1">No sales items yet.</p>
            <p className="text-xs">
              {squareConnected
                ? isAdmin
                  ? "Click \"Sync from Square\" to import your catalog."
                  : "Ask an admin to sync the Square catalog."
                : "Connect Square in Settings, then sync your catalog."}
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-16 text-center text-[var(--color-muted-foreground)]">
            <p className="text-sm">No sales items match your filters.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--color-border)]">
                  {["Item", "Menu Group", "Price", "POS ID"].map((h) => (
                    <th key={h} className="text-left text-xs font-medium text-[var(--color-muted-foreground)] px-4 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr key={s.id} className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-accent)]/30 transition-colors">
                    <td className="px-4 py-3 text-sm font-medium text-[var(--color-foreground)]">{s.displayName}</td>
                    <td className="px-4 py-3 text-sm text-[var(--color-muted-foreground)]">{s.menuGroup ?? "—"}</td>
                    <td className="px-4 py-3 text-sm text-[var(--color-muted-foreground)]">
                      {s.priceCents != null ? `$${(s.priceCents / 100).toFixed(2)}` : "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-[var(--color-muted-foreground)] font-mono">{s.squareVariationId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function SyncButton({ squareConnected, lastCatalogSyncAt }: { squareConnected: boolean; lastCatalogSyncAt: string | null }) {
  const router = useRouter()
  const [syncing, setSyncing] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  async function handleSync() {
    setSyncing(true)
    setResult(null)
    try {
      const res = await fetch("/api/square/sales-items/sync", { method: "POST" })
      const data = await res.json()
      if (!res.ok) {
        setResult({ ok: false, message: data.error ?? "Sync failed" })
        return
      }
      setResult({ ok: true, message: `Synced ${data.categories} categories, ${data.salesItems} sales items` })
      router.refresh()
    } catch {
      setResult({ ok: false, message: "Sync failed — check your connection" })
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="text-right">
      <Button onClick={handleSync} disabled={syncing || !squareConnected} variant="outline">
        <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
        {syncing ? "Syncing..." : "Sync from Square"}
      </Button>
      {!squareConnected && <p className="text-xs text-[var(--color-muted-foreground)] mt-1">Connect Square in Settings first</p>}
      {lastCatalogSyncAt && !result && (
        <p className="text-xs text-[var(--color-muted-foreground)] mt-1">
          Last synced {formatDistanceToNow(new Date(lastCatalogSyncAt), { addSuffix: true })}
        </p>
      )}
      {result && (
        <p className={`text-xs mt-1 ${result.ok ? "text-[var(--color-success-text)]" : "text-[var(--color-destructive)]"}`}>{result.message}</p>
      )}
    </div>
  )
}
