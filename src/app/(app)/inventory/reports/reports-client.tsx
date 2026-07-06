"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { RefreshCw, AlertTriangle, TrendingUp, Moon, ChevronDown, ChevronRight } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Line,
  LineChart,
  Bar,
  BarChart,
  XAxis,
  YAxis,
  Tooltip as ChartTooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts"

// ─── Types (mirror the /api/inventory/reports responses) ─────────────────────

type PeriodOption = {
  beginCountId: string
  endCountId: string
  label: string
  startDate: string
  endDate: string
  beginValue: number
  endValue: number
  beginFinalizedAt: string
  endFinalizedAt: string
}

type PeriodsMeta = {
  squareLinked: boolean
  syncedThrough: string | null
  timezone: string
  periods: PeriodOption[]
}

type GlRow = { glCode: string | null; categoryName: string | null; usage: number }
type NegativeUsageRow = { ingredientId: string; ingredientName: string; usage: number }

type CogsRow = {
  beginCountId: string
  endCountId: string
  label: string
  startDate: string
  endDate: string
  beginning: number
  purchases: number
  ending: number
  usage: number
  sales: number
  costPct: number | null
  glBreakdown: GlRow[]
  negativeUsage: NegativeUsageRow[]
}

type ItemSalesRow = {
  squareVariationId: string
  displayName: string
  menuGroup: string | null
  priceCents: number | null
  quantitySold: number
  grossSales: number
  avgPrice: number | null
  pctOfSales: number
}

type ValuationRow = {
  storeId: string
  storeName: string
  value: number | null
  countName: string | null
  countFinalizedAt: string | null
}

type TurnoverRow = {
  ingredientId: string
  ingredientName: string
  reportingUnit: string | null
  usageQty: number
  usageValue: number
  avgOnHandQty: number
  turns: number | null
  isDeadStock: boolean
  isFastMover: boolean
}

type VendorRow = {
  vendorId: string
  vendorName: string
  total: number
  poCount: number
  avgLeadTimeDays: number | null
  monthly: { month: string; value: number }[]
}

// ─── Formatting ───────────────────────────────────────────────────────────────

const usd = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD" })

const pct = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${(n * 100).toFixed(1)}%`)

const num = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 })

function daysBetween(from: string, to: string): number {
  return Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1)
}

function isoDaysAgo(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ReportsClient({ stores }: { stores: { id: string; name: string }[] }) {
  const [storeId, setStoreId] = useState(stores[0]?.id ?? "")
  const [meta, setMeta] = useState<PeriodsMeta | null>(null)
  const [periodSel, setPeriodSel] = useState<string>("latest") // "latest" | "all" | "custom" | endCountId
  const [customFrom, setCustomFrom] = useState(isoDaysAgo(30))
  const [customTo, setCustomTo] = useState(isoDaysAgo(0))

  type ReportBundle = {
    key: string
    cogs: CogsRow[] | null
    itemSales: { items: ItemSalesRow[]; totalGross: number } | null
    valuation: { stores: ValuationRow[]; total: number; asOf: string } | null
    turnover: { ingredients: TurnoverRow[]; periodCount: number } | null
    vendors: { vendors: VendorRow[]; total: number } | null
    failed: boolean
  }
  const [bundle, setBundle] = useState<ReportBundle | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)

  // Resolve the selected range from the period picker.
  const range = useMemo((): { from: string; to: string } | null => {
    if (periodSel === "custom") return { from: customFrom, to: customTo }
    if (!meta || meta.periods.length === 0) return null
    if (periodSel === "all") {
      return { from: meta.periods[meta.periods.length - 1].startDate, to: meta.periods[0].endDate }
    }
    const p = periodSel === "latest" ? meta.periods[0] : meta.periods.find((x) => x.endCountId === periodSel)
    return p ? { from: p.startDate, to: p.endDate } : null
  }, [periodSel, meta, customFrom, customTo])

  const loadMeta = useCallback(() => {
    if (!storeId) return
    fetch(`/api/inventory/reports/periods?storeId=${storeId}`)
      .then((res): Promise<PeriodsMeta | null> => (res.ok ? res.json() : Promise.resolve(null)))
      .then(setMeta)
      .catch(() => setMeta(null))
  }, [storeId])

  useEffect(() => {
    loadMeta()
  }, [loadMeta])

  const rangeKey = storeId && range ? `${storeId}|${range.from}|${range.to}` : ""

  const loadReports = useCallback(() => {
    if (!rangeKey) return
    const [sid, from, to] = rangeKey.split("|")
    const qs = `storeId=${sid}&from=${from}&to=${to}`
    Promise.all([
      fetch(`/api/inventory/reports/cogs?${qs}`),
      fetch(`/api/inventory/reports/item-sales?${qs}`),
      fetch(`/api/inventory/reports/valuation?date=${to}`),
      fetch(`/api/inventory/reports/turnover?${qs}`),
      fetch(`/api/inventory/reports/vendor-spend?${qs}`),
    ])
      .then(async ([cogsRes, itemsRes, valRes, turnRes, vendRes]) =>
        setBundle({
          key: rangeKey,
          cogs: cogsRes.ok ? (await cogsRes.json()).periods : null,
          itemSales: itemsRes.ok ? await itemsRes.json() : null,
          valuation: valRes.ok ? await valRes.json() : null,
          turnover: turnRes.ok ? await turnRes.json() : null,
          vendors: vendRes.ok ? await vendRes.json() : null,
          failed: false,
        })
      )
      .catch(() =>
        setBundle({ key: rangeKey, cogs: null, itemSales: null, valuation: null, turnover: null, vendors: null, failed: true })
      )
  }, [rangeKey])

  useEffect(() => {
    loadReports()
  }, [loadReports])

  const current = bundle && bundle.key === rangeKey ? bundle : null
  const loading = !!rangeKey && current === null
  const cogs = current?.cogs ?? null
  const itemSales = current?.itemSales ?? null
  const valuation = current?.valuation ?? null
  const turnover = current?.turnover ?? null
  const vendors = current?.vendors ?? null
  const error = syncError ?? (current?.failed ? "Couldn't load reports — try again." : null)

  async function syncNow() {
    if (!storeId || !range) return
    setSyncing(true)
    setSyncError(null)
    try {
      const res = await fetch("/api/square/sales/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId, startDate: range.from, endDate: range.to }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setSyncError(data?.error ?? "Sales sync failed")
      } else {
        loadMeta()
        loadReports()
      }
    } finally {
      setSyncing(false)
    }
  }

  // ── Summary aggregates ──
  const summary = useMemo(() => {
    if (!cogs || cogs.length === 0 || !range) return null
    const sales = cogs.reduce((s, r) => s + r.sales, 0)
    const usage = cogs.reduce((s, r) => s + r.usage, 0)
    const sitting = cogs[cogs.length - 1].ending
    const days = daysBetween(range.from, range.to)
    const weeklyUsage = (usage / days) * 7
    return {
      sales,
      usage,
      costPct: sales > 0 ? usage / sales : null,
      sitting,
      weeksOnHand: weeklyUsage > 0 ? sitting / weeklyUsage : null,
    }
  }, [cogs, range])

  const glTotals = useMemo(() => {
    if (!cogs) return []
    const map = new Map<string, GlRow>()
    for (const row of cogs) {
      for (const gl of row.glBreakdown) {
        const key = gl.glCode ?? "—"
        const cur = map.get(key) ?? { glCode: gl.glCode, categoryName: gl.categoryName, usage: 0 }
        cur.usage += gl.usage
        map.set(key, cur)
      }
    }
    return [...map.values()].sort((a, b) => b.usage - a.usage)
  }, [cogs])

  const menuGroupTotals = useMemo(() => {
    if (!itemSales) return []
    const map = new Map<string, { menuGroup: string; qty: number; gross: number }>()
    for (const i of itemSales.items) {
      const key = i.menuGroup ?? "Ungrouped"
      const cur = map.get(key) ?? { menuGroup: key, qty: 0, gross: 0 }
      cur.qty += i.quantitySold
      cur.gross += i.grossSales
      map.set(key, cur)
    }
    return [...map.values()].sort((a, b) => b.gross - a.gross)
  }, [itemSales])

  const noPeriods = meta !== null && meta.periods.length === 0

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-[var(--color-foreground)]">Inventory Reports</h1>
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Sales, usage and cost % from your counts, purchases, and Square sales.
        </p>
      </div>

      {/* Report header: store + period + sync — shared by every tab */}
      <Card>
        <CardContent className="py-4 flex flex-wrap items-end gap-3">
          <div className="min-w-[180px]">
            <label className="text-xs font-medium text-[var(--color-muted-foreground)] block mb-1">Store</label>
            <Select value={storeId} onValueChange={setStoreId}>
              <SelectTrigger>
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
          </div>

          <div className="min-w-[240px]">
            <label className="text-xs font-medium text-[var(--color-muted-foreground)] block mb-1">
              Period
              <span title="Inventory periods run between consecutive finalized counts — reports are most meaningful across a full period. Partial counts never form boundaries.">
                {" "}ⓘ
              </span>
            </label>
            <Select value={periodSel} onValueChange={setPeriodSel}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="latest" disabled={noPeriods}>
                  Latest inventory period
                </SelectItem>
                <SelectItem value="all" disabled={noPeriods}>
                  All inventory periods
                </SelectItem>
                {meta?.periods.map((p) => (
                  <SelectItem key={p.endCountId} value={p.endCountId}>
                    {p.startDate} → {p.endDate}
                  </SelectItem>
                ))}
                <SelectItem value="custom">Custom date range</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {periodSel === "custom" && (
            <>
              <div>
                <label className="text-xs font-medium text-[var(--color-muted-foreground)] block mb-1">From</label>
                <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="w-[150px]" />
              </div>
              <div>
                <label className="text-xs font-medium text-[var(--color-muted-foreground)] block mb-1">To</label>
                <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="w-[150px]" />
              </div>
            </>
          )}

          <div className="flex-1" />

          <div className="text-right">
            <p className="text-xs text-[var(--color-muted-foreground)] mb-1">
              {meta?.squareLinked
                ? meta.syncedThrough
                  ? `Sales synced through ${meta.syncedThrough}`
                  : "No sales synced yet"
                : "Square not linked for this store"}
            </p>
            <Button size="sm" variant="outline" onClick={syncNow} disabled={syncing || !meta?.squareLinked || !range}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${syncing ? "animate-spin" : ""}`} />
              {syncing ? "Syncing…" : "Sync now"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {error && (
        <div className="text-sm text-[var(--color-destructive)] bg-[var(--color-destructive)]/10 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      {noPeriods && (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-sm font-medium text-[var(--color-foreground)] mb-1">No inventory periods yet</p>
            <p className="text-sm text-[var(--color-muted-foreground)]">
              Usage and cost % need two finalized (non-partial) counts to bracket a period. Finalize your counts, then
              come back — Item Sales works right away with a custom date range.
            </p>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="summary">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="item-sales">Item Sales</TabsTrigger>
          <TabsTrigger value="periods">Periods (COGS)</TabsTrigger>
          <TabsTrigger value="valuation">Valuation</TabsTrigger>
          <TabsTrigger value="turnover">Turnover</TabsTrigger>
          <TabsTrigger value="vendor-spend">Vendor Spend</TabsTrigger>
        </TabsList>

        {/* ── SUMMARY ── */}
        <TabsContent value="summary" className="space-y-4">
          {loading ? (
            <SummarySkeleton />
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <StatCard label="Sales" hint="Net (pre-tax) sales from Square for the selected window." value={usd(summary?.sales ?? null)} />
                <StatCard
                  label="Usage $"
                  hint="Beginning inventory + received purchases − ending inventory, summed across the selected periods."
                  value={usd(summary?.usage ?? null)}
                />
                <StatCard label="Cost %" hint="Usage ÷ Sales — what your sold product actually cost you." value={pct(summary?.costPct)} />
                <StatCard
                  label="Sitting Inventory"
                  hint="Value of the ending count of the last selected period."
                  value={usd(summary?.sitting ?? null)}
                />
                <StatCard
                  label="Weeks on hand"
                  hint="Sitting inventory ÷ average weekly usage — how long current stock lasts at this pace."
                  value={summary?.weeksOnHand != null ? summary.weeksOnHand.toFixed(1) : "—"}
                />
              </div>

              {cogs && cogs.length > 1 && (
                <Card>
                  <CardContent className="pt-4">
                    <p className="text-sm font-semibold mb-2">Cost % by period</p>
                    <div className="h-56">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={cogs.map((r) => ({ name: r.endDate, costPct: r.costPct != null ? +(r.costPct * 100).toFixed(1) : null }))}>
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                          <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                          <YAxis tick={{ fontSize: 11 }} unit="%" />
                          <ChartTooltip formatter={(v) => [`${v}%`, "Cost %"]} />
                          <Line type="monotone" dataKey="costPct" stroke="var(--color-primary)" strokeWidth={2.5} dot />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
              )}

              <div className="grid md:grid-cols-2 gap-4">
                <TopSellers items={itemSales?.items ?? []} />
                <Card>
                  <CardContent className="pt-4">
                    <p className="text-sm font-semibold mb-2" title="Usage $ by GL category across the selected periods — line-level count values plus received purchases.">
                      Usage by GL category
                    </p>
                    {glTotals.length === 0 ? (
                      <p className="text-sm text-[var(--color-muted-foreground)]">No period data in this window.</p>
                    ) : (
                      <table className="w-full text-sm">
                        <tbody>
                          {glTotals.map((g) => (
                            <tr key={g.glCode ?? "none"} className="border-b border-[var(--color-border)] last:border-0">
                              <td className="py-1.5">{g.categoryName ?? "Uncategorized"}</td>
                              <td className="py-1.5 text-[var(--color-muted-foreground)]">{g.glCode ?? "—"}</td>
                              <td className="py-1.5 text-right font-medium">{usd(g.usage)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </CardContent>
                </Card>
              </div>

              {menuGroupTotals.length > 0 && (
                <Card>
                  <CardContent className="pt-4">
                    <p className="text-sm font-semibold mb-2">Sales by menu group</p>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-[var(--color-muted-foreground)]">
                          <th className="py-1 font-medium">Menu group</th>
                          <th className="py-1 font-medium text-right">Qty sold</th>
                          <th className="py-1 font-medium text-right">Gross sales</th>
                        </tr>
                      </thead>
                      <tbody>
                        {menuGroupTotals.map((m) => (
                          <tr key={m.menuGroup} className="border-b border-[var(--color-border)] last:border-0">
                            <td className="py-1.5">{m.menuGroup}</td>
                            <td className="py-1.5 text-right">{num(m.qty)}</td>
                            <td className="py-1.5 text-right font-medium">{usd(m.gross)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </TabsContent>

        {/* ── ITEM SALES ── */}
        <TabsContent value="item-sales">
          <ItemSalesTab data={itemSales} loading={loading} onSync={syncNow} squareLinked={!!meta?.squareLinked} />
        </TabsContent>

        {/* ── PERIODS (COGS) ── */}
        <TabsContent value="periods">
          <PeriodsTab rows={cogs} loading={loading} />
        </TabsContent>

        {/* ── VALUATION ── */}
        <TabsContent value="valuation">
          {loading || !valuation ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <Card>
              <CardContent className="pt-4">
                <p className="text-sm text-[var(--color-muted-foreground)] mb-3">
                  Sitting inventory value as of <span className="font-medium">{valuation.asOf}</span> — the latest
                  finalized, non-partial count per store on or before that date.
                </p>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-[var(--color-muted-foreground)]">
                      <th className="py-1 font-medium">Store</th>
                      <th className="py-1 font-medium">Count</th>
                      <th className="py-1 font-medium text-right">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {valuation.stores.map((r) => (
                      <tr key={r.storeId} className="border-b border-[var(--color-border)] last:border-0">
                        <td className="py-1.5">{r.storeName}</td>
                        <td className="py-1.5 text-[var(--color-muted-foreground)]">
                          {r.countName ?? (r.countFinalizedAt ? r.countFinalizedAt.slice(0, 10) : "No finalized count")}
                        </td>
                        <td className="py-1.5 text-right font-medium">{usd(r.value)}</td>
                      </tr>
                    ))}
                    <tr>
                      <td className="py-2 font-semibold">Company-wide</td>
                      <td />
                      <td className="py-2 text-right font-semibold">{usd(valuation.total)}</td>
                    </tr>
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── TURNOVER ── */}
        <TabsContent value="turnover">
          {loading || !turnover ? (
            <Skeleton className="h-40 w-full" />
          ) : turnover.ingredients.length === 0 ? (
            <EmptyCard text="Turnover needs at least one inventory period in the selected window." />
          ) : (
            <Card>
              <CardContent className="pt-4 overflow-x-auto">
                <p className="text-sm text-[var(--color-muted-foreground)] mb-3">
                  Usage vs. average on-hand across {turnover.periodCount} period{turnover.periodCount === 1 ? "" : "s"}.
                  <TrendingUp className="inline h-3.5 w-3.5 mx-1 text-[var(--color-primary)]" />
                  fast movers (top decile by usage $) ·
                  <Moon className="inline h-3.5 w-3.5 mx-1 text-[var(--color-muted-foreground)]" />
                  dead stock (no usage 2+ periods).
                </p>
                <table className="w-full text-sm min-w-[560px]">
                  <thead>
                    <tr className="text-left text-xs text-[var(--color-muted-foreground)]">
                      <th className="py-1 font-medium">Ingredient</th>
                      <th className="py-1 font-medium text-right">Usage qty</th>
                      <th className="py-1 font-medium text-right">Usage $</th>
                      <th className="py-1 font-medium text-right">Avg on hand</th>
                      <th className="py-1 font-medium text-right">Turns</th>
                      <th className="py-1 font-medium" />
                    </tr>
                  </thead>
                  <tbody>
                    {turnover.ingredients.map((r) => (
                      <tr key={r.ingredientId} className="border-b border-[var(--color-border)] last:border-0">
                        <td className="py-1.5">{r.ingredientName}</td>
                        <td className="py-1.5 text-right">
                          {num(r.usageQty)} {r.reportingUnit ?? ""}
                        </td>
                        <td className="py-1.5 text-right">{usd(r.usageValue)}</td>
                        <td className="py-1.5 text-right">{num(r.avgOnHandQty)}</td>
                        <td className="py-1.5 text-right">{r.turns != null ? r.turns.toFixed(1) : "—"}</td>
                        <td className="py-1.5">
                          {r.isFastMover && (
                            <Badge variant="secondary" className="mr-1">
                              Fast mover
                            </Badge>
                          )}
                          {r.isDeadStock && <Badge variant="outline">Dead stock</Badge>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── VENDOR SPEND ── */}
        <TabsContent value="vendor-spend">
          {loading || !vendors ? (
            <Skeleton className="h-40 w-full" />
          ) : vendors.vendors.length === 0 ? (
            <EmptyCard text="No received purchase orders in the selected window." />
          ) : (
            <div className="space-y-4">
              <Card>
                <CardContent className="pt-4 overflow-x-auto">
                  <table className="w-full text-sm min-w-[520px]">
                    <thead>
                      <tr className="text-left text-xs text-[var(--color-muted-foreground)]">
                        <th className="py-1 font-medium">Vendor</th>
                        <th className="py-1 font-medium text-right">Received value</th>
                        <th className="py-1 font-medium text-right">POs</th>
                        <th className="py-1 font-medium text-right" title="Average days from order to full receipt">
                          Avg lead time
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {vendors.vendors.map((v) => (
                        <tr key={v.vendorId} className="border-b border-[var(--color-border)] last:border-0">
                          <td className="py-1.5">{v.vendorName}</td>
                          <td className="py-1.5 text-right font-medium">{usd(v.total)}</td>
                          <td className="py-1.5 text-right">{v.poCount}</td>
                          <td className="py-1.5 text-right">
                            {v.avgLeadTimeDays != null ? `${v.avgLeadTimeDays.toFixed(1)} d` : "—"}
                          </td>
                        </tr>
                      ))}
                      <tr>
                        <td className="py-2 font-semibold">Total</td>
                        <td className="py-2 text-right font-semibold">{usd(vendors.total)}</td>
                        <td colSpan={2} />
                      </tr>
                    </tbody>
                  </table>
                </CardContent>
              </Card>

              <VendorTrendChart vendors={vendors.vendors} />
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ─── Pieces ───────────────────────────────────────────────────────────────────

function StatCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card>
      <CardContent className="pt-4 pb-3" title={hint}>
        <p className="text-xs font-medium text-[var(--color-muted-foreground)] uppercase tracking-wide">{label}</p>
        <p className="text-xl font-bold text-[var(--color-foreground)] mt-1">{value}</p>
      </CardContent>
    </Card>
  )
}

function SummarySkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
      <Skeleton className="h-56 w-full" />
    </div>
  )
}

function EmptyCard({ text }: { text: string }) {
  return (
    <Card>
      <CardContent className="py-8 text-center">
        <p className="text-sm text-[var(--color-muted-foreground)]">{text}</p>
      </CardContent>
    </Card>
  )
}

function TopSellers({ items }: { items: ItemSalesRow[] }) {
  const [mode, setMode] = useState<"top" | "bottom">("top")
  const shown = useMemo(() => {
    const sorted = [...items].sort((a, b) => b.grossSales - a.grossSales)
    return mode === "top" ? sorted.slice(0, 10) : sorted.slice(-10).reverse()
  }, [items, mode])

  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-semibold">{mode === "top" ? "Top sellers" : "Bottom sellers"}</p>
          <div className="flex gap-1">
            <Button size="sm" variant={mode === "top" ? "default" : "outline"} onClick={() => setMode("top")}>
              Top
            </Button>
            <Button size="sm" variant={mode === "bottom" ? "default" : "outline"} onClick={() => setMode("bottom")}>
              Bottom
            </Button>
          </div>
        </div>
        {shown.length === 0 ? (
          <p className="text-sm text-[var(--color-muted-foreground)]">No sales in this window — sync sales to populate.</p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {shown.map((i) => (
                <tr key={i.squareVariationId} className="border-b border-[var(--color-border)] last:border-0">
                  <td className="py-1.5 pr-2">{i.displayName}</td>
                  <td className="py-1.5 text-right text-[var(--color-muted-foreground)]">{num(i.quantitySold)}×</td>
                  <td className="py-1.5 text-right font-medium">{usd(i.grossSales)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  )
}

function ItemSalesTab({
  data,
  loading,
  onSync,
  squareLinked,
}: {
  data: { items: ItemSalesRow[]; totalGross: number } | null
  loading: boolean
  onSync: () => void
  squareLinked: boolean
}) {
  const [search, setSearch] = useState("")
  const [groupBy, setGroupBy] = useState(false)

  const filtered = useMemo(() => {
    if (!data) return []
    const q = search.trim().toLowerCase()
    return q ? data.items.filter((i) => i.displayName.toLowerCase().includes(q)) : data.items
  }, [data, search])

  const groups = useMemo(() => {
    if (!groupBy) return null
    const map = new Map<string, ItemSalesRow[]>()
    for (const i of filtered) {
      const key = i.menuGroup ?? "Ungrouped"
      map.set(key, [...(map.get(key) ?? []), i])
    }
    return [...map.entries()].sort(
      (a, b) => b[1].reduce((s, i) => s + i.grossSales, 0) - a[1].reduce((s, i) => s + i.grossSales, 0)
    )
  }, [filtered, groupBy])

  if (loading || !data) return <Skeleton className="h-40 w-full" />

  if (data.items.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-sm font-medium text-[var(--color-foreground)] mb-1">No item sales in this window</p>
          <p className="text-sm text-[var(--color-muted-foreground)] mb-4">
            {squareLinked
              ? "The sales cache may not cover these dates yet."
              : "Link this store to a Square location, then sync sales."}
          </p>
          {squareLinked && (
            <Button size="sm" onClick={onSync}>
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              Sync sales for this range
            </Button>
          )}
        </CardContent>
      </Card>
    )
  }

  const renderRows = (rows: ItemSalesRow[]) =>
    rows.map((i) => (
      <tr key={i.squareVariationId} className="border-b border-[var(--color-border)] last:border-0">
        <td className="py-1.5 pr-2">{i.displayName}</td>
        <td className="py-1.5 text-[var(--color-muted-foreground)]">{i.menuGroup ?? "—"}</td>
        <td className="py-1.5 text-right">{num(i.quantitySold)}</td>
        <td className="py-1.5 text-right">{usd(i.avgPrice)}</td>
        <td className="py-1.5 text-right font-medium">{usd(i.grossSales)}</td>
        <td className="py-1.5 text-right text-[var(--color-muted-foreground)]">{pct(i.pctOfSales)}</td>
      </tr>
    ))

  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <Input placeholder="Search items…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-56" />
          <Button size="sm" variant={groupBy ? "default" : "outline"} onClick={() => setGroupBy((g) => !g)}>
            Group by menu group
          </Button>
          <div className="flex-1" />
          <p className="text-sm text-[var(--color-muted-foreground)]">
            Total gross: <span className="font-semibold text-[var(--color-foreground)]">{usd(data.totalGross)}</span>
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[620px]">
            <thead>
              <tr className="text-left text-xs text-[var(--color-muted-foreground)]">
                <th className="py-1 font-medium">Item</th>
                <th className="py-1 font-medium">Menu group</th>
                <th className="py-1 font-medium text-right">Qty sold</th>
                <th className="py-1 font-medium text-right" title="Gross sales ÷ quantity over the window">
                  Avg price
                </th>
                <th className="py-1 font-medium text-right">Gross sales</th>
                <th className="py-1 font-medium text-right">% of sales</th>
              </tr>
            </thead>
            <tbody>
              {groups
                ? groups.map(([group, rows]) => (
                    <FragmentRows key={group} group={group} rows={rows} renderRows={renderRows} />
                  ))
                : renderRows(filtered)}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}

function FragmentRows({
  group,
  rows,
  renderRows,
}: {
  group: string
  rows: ItemSalesRow[]
  renderRows: (rows: ItemSalesRow[]) => React.ReactNode
}) {
  return (
    <>
      <tr>
        <td colSpan={6} className="pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">
          {group} · {usd(rows.reduce((s, i) => s + i.grossSales, 0))}
        </td>
      </tr>
      {renderRows(rows)}
    </>
  )
}

function PeriodsTab({ rows, loading }: { rows: CogsRow[] | null; loading: boolean }) {
  const [open, setOpen] = useState<string | null>(null)

  if (loading || !rows) return <Skeleton className="h-40 w-full" />
  if (rows.length === 0) return <EmptyCard text="No inventory periods in the selected window — finalize two non-partial counts to create one." />

  return (
    <Card>
      <CardContent className="pt-4 overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead>
            <tr className="text-left text-xs text-[var(--color-muted-foreground)]">
              <th className="py-1 font-medium" />
              <th className="py-1 font-medium">Period</th>
              <th className="py-1 font-medium text-right" title="Value of the count that opens the period">Beginning</th>
              <th className="py-1 font-medium text-right" title="Received purchase value within the period">Purchases</th>
              <th className="py-1 font-medium text-right" title="Value of the count that closes the period">Ending</th>
              <th className="py-1 font-medium text-right" title="Beginning + Purchases − Ending">Usage</th>
              <th className="py-1 font-medium text-right" title="Net Square sales attributed to the period">Sales</th>
              <th className="py-1 font-medium text-right" title="Usage ÷ Sales">Cost %</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <PeriodRow key={r.endCountId} row={r} open={open === r.endCountId} onToggle={() => setOpen(open === r.endCountId ? null : r.endCountId)} />
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  )
}

function PeriodRow({ row, open, onToggle }: { row: CogsRow; open: boolean; onToggle: () => void }) {
  return (
    <>
      <tr className="border-b border-[var(--color-border)] cursor-pointer hover:bg-[var(--color-accent)]/50" onClick={onToggle}>
        <td className="py-1.5 w-6">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </td>
        <td className="py-1.5">
          {row.label}
          {row.negativeUsage.length > 0 && (
            <span title={`${row.negativeUsage.length} ingredient(s) with negative usage — likely a data-entry error`}>
              <AlertTriangle className="inline h-3.5 w-3.5 ml-1.5 text-[var(--color-destructive)]" />
            </span>
          )}
        </td>
        <td className="py-1.5 text-right">{usd(row.beginning)}</td>
        <td className="py-1.5 text-right">{usd(row.purchases)}</td>
        <td className="py-1.5 text-right">{usd(row.ending)}</td>
        <td className="py-1.5 text-right font-medium">{usd(row.usage)}</td>
        <td className="py-1.5 text-right">{usd(row.sales)}</td>
        <td className="py-1.5 text-right font-medium">{pct(row.costPct)}</td>
      </tr>
      {open && (
        <tr className="border-b border-[var(--color-border)] bg-[var(--color-accent)]/30">
          <td />
          <td colSpan={7} className="py-3 pr-2">
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)] mb-1.5">
                  Usage by GL category
                </p>
                {row.glBreakdown.length === 0 ? (
                  <p className="text-sm text-[var(--color-muted-foreground)]">No line-level data.</p>
                ) : (
                  <table className="w-full text-sm">
                    <tbody>
                      {row.glBreakdown.map((g) => (
                        <tr key={g.glCode ?? "none"}>
                          <td className="py-1">{g.categoryName ?? "Uncategorized"}</td>
                          <td className="py-1 text-[var(--color-muted-foreground)]">{g.glCode ?? "—"}</td>
                          <td className="py-1 text-right">{usd(g.usage)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)] mb-1.5">
                  Negative usage — check these
                </p>
                {row.negativeUsage.length === 0 ? (
                  <p className="text-sm text-[var(--color-muted-foreground)]">None — clean period.</p>
                ) : (
                  <>
                    <table className="w-full text-sm mb-2">
                      <tbody>
                        {row.negativeUsage.map((n) => (
                          <tr key={n.ingredientId}>
                            <td className="py-1 text-[var(--color-destructive)] font-medium">{n.ingredientName}</td>
                            <td className="py-1 text-right text-[var(--color-destructive)]">{usd(n.usage)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="text-xs text-[var(--color-muted-foreground)]">
                      Negative usage means an item ended with more than beginning + received. Usual causes: a miscount on
                      either boundary count, a delivery received into the wrong period, or a missing purchase record.
                    </p>
                  </>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function VendorTrendChart({ vendors }: { vendors: VendorRow[] }) {
  const data = useMemo(() => {
    const months = new Map<string, Record<string, number | string>>()
    for (const v of vendors) {
      for (const m of v.monthly) {
        const row = months.get(m.month) ?? { month: m.month }
        row[v.vendorName] = ((row[v.vendorName] as number) ?? 0) + m.value
        months.set(m.month, row)
      }
    }
    return [...months.values()].sort((a, b) => String(a.month).localeCompare(String(b.month)))
  }, [vendors])

  if (data.length < 2) return null
  const top = vendors.slice(0, 5)
  const palette = ["var(--color-primary)", "#efa201", "#0081f2", "#25ba3b", "#8b7e74"]

  return (
    <Card>
      <CardContent className="pt-4">
        <p className="text-sm font-semibold mb-2">Monthly received value (top vendors)</p>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <ChartTooltip />
              {top.map((v, i) => (
                <Bar key={v.vendorId} dataKey={v.vendorName} stackId="a" fill={palette[i % palette.length]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}
