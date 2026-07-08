"use client"

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react"
import Link from "next/link"
import { ChevronLeft, ChevronRight, ClipboardList, Megaphone } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SalesPerformanceCard } from "./sales-performance-card"

// ─── Types (mirror /api/dashboard/summary) ────────────────────────────────────

type HourPoint = { hour: number; net: number }

type Summary = {
  store: { id: string; name: string; timezone: string }
  today: string
  canManageGoal: boolean
  salesAvailable: boolean
  sales: {
    today: { total: number; hourly: HourPoint[] }
    lastYear: { date: string; total: number; hourly: HourPoint[] } | null
    monthToDate: number
  } | null
  goal: {
    month: string
    goalAmount: number | null
    monthToDate: number | null
    daysElapsed: number
    daysInMonth: number
  }
  checklist: {
    total: number
    completed: number
    items: { id: string; checklistId: string; label: string; checked: boolean }[]
    firstChecklistId: string | null
  }
}

// ─── MOCK DATA — Team Messages / Corporate Update / Instagram backends are
// later builds. Shapes match the README "State Management" spec so the real
// providers swap in without touching layout. ──────────────────────────────────

type TeamMessage = { id: string; sender: string; initial: string; timestamp: string; text: string }

const MOCK_TEAM_MESSAGES: TeamMessage[] = [
  { id: "m1", sender: "Alyssa", initial: "A", timestamp: "2h ago", text: "Walk-in restocked — strawberries and mango are up front." },
  { id: "m2", sender: "Marcus", initial: "M", timestamp: "4h ago", text: "Blender 2 is making a grinding noise, put in a ticket." },
  { id: "m3", sender: "Dee", initial: "D", timestamp: "Yesterday", text: "Great shift tonight team — record smoothie hour! 🎉" },
]

type CorporateUpdate = { headline: string; body: string; postedDaysAgo: number }

const MOCK_CORPORATE_UPDATE: CorporateUpdate = {
  headline: "Summer menu launches Monday",
  body: "New Dragon Fruit Splash and Mango Chili Limeade hit all stores next week. Training materials are in your checklists.",
  postedDaysAgo: 2,
}

type InstagramPost = { id: string; hue: number }

const MOCK_INSTAGRAM: { handle: string; url: string; posts: InstagramPost[] } = {
  handle: "@kevajuice_reno",
  url: "https://instagram.com/kevajuice_reno",
  posts: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ id: `p${n}`, hue: (n * 37) % 60 })),
}

// ─── Formatting ───────────────────────────────────────────────────────────────

const usd = (n: number | null | undefined, digits = 0) =>
  n === null || n === undefined
    ? "—"
    : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: digits, minimumFractionDigits: digits })

// ─── Persisted store selection (same external-store pattern as the sidebar) ──

const STORE_KEY = "froot.dashboard.store"
const STORE_EVENT = "froot-dashboard-store"

function subscribeStoreKey(callback: () => void) {
  window.addEventListener("storage", callback)
  window.addEventListener(STORE_EVENT, callback)
  return () => {
    window.removeEventListener("storage", callback)
    window.removeEventListener(STORE_EVENT, callback)
  }
}

function useSavedStoreId(): string | null {
  return useSyncExternalStore(
    subscribeStoreKey,
    () => localStorage.getItem(STORE_KEY),
    () => null
  )
}

function saveStoreId(id: string) {
  localStorage.setItem(STORE_KEY, id)
  window.dispatchEvent(new Event(STORE_EVENT))
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DashboardClient({
  stores,
  countRecency,
}: {
  stores: { id: string; name: string; location: string }[]
  countRecency: { storeId: string; storeName: string; days: number | null }[]
}) {
  const savedStoreId = useSavedStoreId()
  const storeId = stores.find((s) => s.id === savedStoreId)?.id ?? stores[0]?.id ?? ""
  const setStoreId = saveStoreId
  const [summary, setSummary] = useState<Summary | null>(null)
  const [checkedOverride, setCheckedOverride] = useState<Record<string, boolean>>({})

  const load = useCallback(() => {
    if (!storeId) return
    fetch(`/api/dashboard/summary?storeId=${storeId}`)
      .then((res): Promise<Summary | null> => (res.ok ? res.json() : Promise.resolve(null)))
      .then(setSummary)
      .catch(() => setSummary(null))
  }, [storeId])

  useEffect(() => {
    load()
  }, [load])

  const current = summary && summary.store.id === storeId ? summary : null
  const loading = !!storeId && current === null
  const store = stores.find((s) => s.id === storeId)

  const headerDate = useMemo(
    () => new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }),
    []
  )

  return (
    <div className="space-y-4">
      {/* Page header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-foreground)]">Dashboard</h1>
          <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
            {headerDate}
            {store ? ` · ${store.name}${store.location ? ` — ${store.location}` : ""}` : ""}
          </p>
        </div>
        {stores.length > 1 && (
          <Select value={storeId} onValueChange={setStoreId}>
            <SelectTrigger className="w-52">
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
        )}
      </div>

      {/* Sales row: Performance (2) + Monthly Goal (1) */}
      <div className="flex flex-wrap gap-4">
        <div className="flex-[2] min-w-[320px] md:min-w-[420px]">
          <SalesPerformanceCard storeId={storeId} />
        </div>
        <div className="flex-1 min-w-[260px]">
          <MonthlyGoalCard loading={loading} summary={current} onSaved={load} />
        </div>
      </div>

      {/* Three equal cards */}
      <div className="flex flex-wrap gap-4">
        <div className="flex-1 min-w-[280px]">
          <TeamMessagesCard />
        </div>
        <div className="flex-1 min-w-[280px]">
          <CorporateUpdateCard />
        </div>
        <div className="flex-1 min-w-[280px]">
          <ShiftChecklistCard
            loading={loading}
            summary={current}
            checkedOverride={checkedOverride}
            onToggle={(id) =>
              setCheckedOverride((prev) => {
                const item = current?.checklist.items.find((i) => i.id === id)
                const base = item?.checked ?? false
                const cur = prev[id] ?? base
                return { ...prev, [id]: !cur }
              })
            }
          />
        </div>
      </div>

      {/* Instagram strip */}
      <InstagramStrip />

      {/* Days since last count (kept from I-4) */}
      {countRecency.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-[var(--color-foreground)] mb-2">Days since last inventory count</h2>
          <div className="flex flex-wrap gap-3">
            {countRecency.map(({ storeId: sid, storeName, days }) => (
              <Link key={sid} href="/inventory/counts" className="flex-1 min-w-[160px]">
                <Card className="hover:shadow-md transition-shadow h-full">
                  <CardContent className="p-3 flex items-center justify-between">
                    <div>
                      <p className="text-xs text-[var(--color-muted-foreground)] truncate">{storeName}</p>
                      <p className="text-lg font-bold text-[var(--color-foreground)]">
                        {days === null ? "Never" : days === 0 ? "Today" : `${days}d`}
                      </p>
                    </div>
                    <ClipboardList className="h-4 w-4 text-[var(--color-muted-foreground)]" />
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Monthly Goal ─────────────────────────────────────────────────────────────

function MonthlyGoalCard({ loading, summary, onSaved }: { loading: boolean; summary: Summary | null; onSaved: () => void }) {
  const [editing, setEditing] = useState(false)
  const [amount, setAmount] = useState("")
  const [saving, setSaving] = useState(false)

  if (loading) return <Skeleton className="h-64 w-full" />
  if (!summary) return <Skeleton className="h-64 w-full" />

  const { goal } = summary
  const mtd = goal.monthToDate ?? 0
  const monthName = new Date(`${goal.month}T12:00:00Z`).toLocaleDateString("en-US", { month: "long" })
  const daysLeft = goal.daysInMonth - goal.daysElapsed

  async function saveGoal() {
    const value = Number(amount)
    if (!value || value <= 0) return
    setSaving(true)
    await fetch("/api/dashboard/goal", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storeId: summary!.store.id, month: summary!.goal.month, goalAmount: value }),
    })
    setSaving(false)
    setEditing(false)
    onSaved()
  }

  if (goal.goalAmount === null) {
    return (
      <Card className="h-full">
        <CardContent className="pt-5 pb-4 h-full flex flex-col">
          <p className="text-[15px] font-bold text-[var(--color-foreground)] mb-2">Monthly Goal</p>
          {summary.canManageGoal ? (
            editing ? (
              <div className="space-y-2">
                <Input
                  type="number"
                  min="1"
                  placeholder={`${monthName} sales goal ($)`}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={saveGoal} disabled={saving || !Number(amount)}>
                    {saving ? "Saving…" : "Save goal"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setEditing(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-start justify-center gap-2">
                <p className="text-sm text-[var(--color-muted-foreground)]">
                  No goal set for {monthName}. Set one to track pace and projection.
                </p>
                <Button size="sm" onClick={() => setEditing(true)}>
                  Set a goal
                </Button>
              </div>
            )
          ) : (
            <p className="flex-1 flex items-center text-sm text-[var(--color-muted-foreground)]">
              No goal set for {monthName} yet — ask your manager to set one.
            </p>
          )}
        </CardContent>
      </Card>
    )
  }

  const pctOfGoal = Math.min(1, mtd / goal.goalAmount)
  const toGo = Math.max(0, goal.goalAmount - mtd)
  const extrapolated = goal.daysElapsed > 0 ? (mtd / goal.daysElapsed) * goal.daysInMonth : 0
  const pctToGoal = (extrapolated / goal.goalAmount) * 100
  const onTrack = pctToGoal >= 100

  return (
    <Card className="h-full">
      <CardContent className="pt-5 pb-4 h-full flex flex-col">
        <div className="flex items-center justify-between mb-1">
          <p className="text-[15px] font-bold text-[var(--color-foreground)]">Monthly Goal</p>
          {summary.canManageGoal && (
            <button
              className="text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-primary)]"
              onClick={() => {
                setAmount(String(goal.goalAmount))
                setEditing(true)
              }}
            >
              Edit
            </button>
          )}
        </div>

        {editing ? (
          <div className="space-y-2 mb-2">
            <Input type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <div className="flex gap-2">
              <Button size="sm" onClick={saveGoal} disabled={saving || !Number(amount)}>
                {saving ? "Saving…" : "Save"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-[28px] leading-tight font-extrabold text-[var(--color-foreground)]">{usd(mtd)}</p>
            <p className="text-[12.5px] text-[var(--color-muted-foreground)] mb-3">of {usd(goal.goalAmount)} goal</p>
          </>
        )}

        <div className="h-[11px] rounded-full bg-[var(--color-muted)] overflow-hidden mb-2">
          <div
            className="h-full rounded-full bg-gradient-to-r from-[#F4A462] to-[var(--color-primary)]"
            style={{ width: `${(pctOfGoal * 100).toFixed(1)}%` }}
          />
        </div>
        <p className="text-[13px] font-bold text-[var(--color-primary)] mb-3">
          {(pctOfGoal * 100).toFixed(0)}% of goal · {usd(toGo)} to go
        </p>

        <div className="border-t border-[var(--color-border)] pt-3">
          <p className="text-[11px] font-semibold tracking-wide text-[var(--color-muted-foreground)]">
            EXTRAPOLATED TO MONTH END
          </p>
          <p className="text-xl font-extrabold text-[var(--color-foreground)]">{usd(extrapolated)}</p>
          <p
            className={`text-[12.5px] font-bold ${
              onTrack ? "text-[var(--color-success-text,#1d7c2e)]" : "text-[var(--color-warning-text,#a36a00)]"
            }`}
          >
            {pctToGoal.toFixed(1)}% to goal, based on trend
          </p>
        </div>

        <p className="text-[11.5px] text-[var(--color-muted-foreground)] mt-auto pt-3">
          {daysLeft} day{daysLeft === 1 ? "" : "s"} left in {monthName}
        </p>
      </CardContent>
    </Card>
  )
}

// ─── Team Messages (mock — later build) ───────────────────────────────────────

function TeamMessagesCard() {
  return (
    <Card className="h-full">
      <CardContent className="pt-5 pb-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[15px] font-bold text-[var(--color-foreground)]">Team Messages</p>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)] bg-[var(--color-muted)] rounded px-1.5 py-0.5">
            Preview
          </span>
        </div>
        <div className="max-h-[220px] overflow-y-auto space-y-3 pr-1">
          {MOCK_TEAM_MESSAGES.map((m) => (
            <div key={m.id} className="flex gap-2.5">
              <div className="w-7 h-7 rounded-full bg-[var(--color-primary)]/15 flex items-center justify-center text-xs font-bold text-[var(--color-primary)] shrink-0">
                {m.initial}
              </div>
              <div className="min-w-0">
                <p className="text-[13px] font-bold text-[var(--color-foreground)]">
                  {m.sender} <span className="font-normal text-[var(--color-muted-foreground)]/70 text-xs">{m.timestamp}</span>
                </p>
                <p className="text-[12.5px] text-[var(--color-muted-foreground)]">{m.text}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-[var(--color-muted-foreground)] mt-3">
          Team messaging ships in a later build — this is sample content.
        </p>
      </CardContent>
    </Card>
  )
}

// ─── Corporate Update (mock — later build) ────────────────────────────────────

function CorporateUpdateCard() {
  const u = MOCK_CORPORATE_UPDATE
  return (
    <div className="h-full rounded-xl p-5 bg-gradient-to-br from-[#FCE0CC] to-[#F6C8A6] flex flex-col">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-6 h-6 rounded bg-[var(--color-primary)] flex items-center justify-center">
          <Megaphone className="h-3.5 w-3.5 text-white" />
        </div>
        <p className="text-[13px] font-extrabold tracking-wide text-[#8A3E17]">CORPORATE UPDATE</p>
      </div>
      <p className="text-base font-bold text-[#1C1917] mb-1">{u.headline}</p>
      <p className="text-[13px] text-[#6B4326] flex-1">{u.body}</p>
      <p className="text-xs font-bold text-[#8A3E17] mt-3">
        Posted {u.postedDaysAgo} days ago → <span className="font-normal">(sample — corporate updates ship later)</span>
      </p>
    </div>
  )
}

// ─── Shift Checklist (real data) ──────────────────────────────────────────────

function ShiftChecklistCard({
  loading,
  summary,
  checkedOverride,
  onToggle,
}: {
  loading: boolean
  summary: Summary | null
  checkedOverride: Record<string, boolean>
  onToggle: (taskId: string) => void
}) {
  if (loading || !summary) return <Skeleton className="h-56 w-full" />

  const cl = summary.checklist
  const isChecked = (id: string, base: boolean) => checkedOverride[id] ?? base
  const shownCompleted =
    cl.completed +
    Object.entries(checkedOverride).reduce((delta, [id, val]) => {
      const item = cl.items.find((i) => i.id === id)
      if (!item) return delta
      return delta + (val === item.checked ? 0 : val ? 1 : -1)
    }, 0)

  return (
    <Card className="h-full">
      <CardContent className="pt-5 pb-4 h-full flex flex-col">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[15px] font-bold text-[var(--color-foreground)]">Shift Checklist</p>
          <p className="text-[13px] font-bold text-[var(--color-muted-foreground)]">
            {shownCompleted}/{cl.total}
          </p>
        </div>

        {cl.total === 0 ? (
          <p className="flex-1 text-sm text-[var(--color-muted-foreground)]">
            No checklists generated for today at this store.
          </p>
        ) : (
          <div className="space-y-2 flex-1">
            {cl.items.map((item) => {
              const checked = isChecked(item.id, item.checked)
              return (
                <button
                  key={item.id}
                  onClick={() => onToggle(item.id)}
                  className="flex items-center gap-2.5 w-full text-left group"
                  title="Preview toggle — complete tasks for real in the checklist"
                >
                  <span
                    className={`w-4 h-4 rounded shrink-0 border-2 flex items-center justify-center ${
                      checked ? "bg-[var(--color-primary)] border-[var(--color-primary)]" : "border-[var(--color-border)]"
                    }`}
                  >
                    {checked && <span className="text-white text-[10px] leading-none">✓</span>}
                  </span>
                  <span
                    className={`text-[13px] ${
                      checked
                        ? "text-[var(--color-muted-foreground)] line-through"
                        : "text-[var(--color-foreground)] group-hover:text-[var(--color-primary)]"
                    }`}
                  >
                    {item.label}
                  </span>
                </button>
              )
            })}
            {cl.total > cl.items.length && (
              <p className="text-xs text-[var(--color-muted-foreground)]">+ {cl.total - cl.items.length} more…</p>
            )}
          </div>
        )}

        <Link
          href={cl.firstChecklistId ? `/store-view/checklist/${cl.firstChecklistId}` : "/checklists"}
          className="text-xs font-bold text-[var(--color-primary)] mt-3 hover:underline"
        >
          View full checklist →
        </Link>
      </CardContent>
    </Card>
  )
}

// ─── Instagram strip (mock — later build) ─────────────────────────────────────

function InstagramStrip() {
  const [offset, setOffset] = useState(0)
  const visible = 6
  const posts = MOCK_INSTAGRAM.posts
  const maxOffset = Math.max(0, posts.length - visible)

  return (
    <Card>
      <CardContent className="py-4 flex items-center gap-3 flex-wrap">
        <p className="text-[15px] font-bold text-[var(--color-foreground)] mr-1">Instagram</p>
        <button
          onClick={() => setOffset((o) => Math.max(0, o - 1))}
          disabled={offset === 0}
          className="w-7 h-7 rounded-full border border-[var(--color-border)] flex items-center justify-center text-[var(--color-muted-foreground)] disabled:opacity-40 hover:bg-[var(--color-accent)]"
          aria-label="Previous posts"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="flex gap-2 overflow-hidden flex-1 min-w-[200px]">
          {posts.slice(offset, offset + visible).map((p) => (
            <div
              key={p.id}
              className="w-[72px] h-[72px] rounded-lg shrink-0"
              style={{
                background: `repeating-linear-gradient(45deg, hsl(${20 + p.hue} 70% 85%), hsl(${20 + p.hue} 70% 85%) 8px, hsl(${20 + p.hue} 60% 78%) 8px, hsl(${20 + p.hue} 60% 78%) 16px)`,
              }}
              title="Placeholder — real posts arrive when the Instagram integration ships"
            />
          ))}
        </div>
        <button
          onClick={() => setOffset((o) => Math.min(maxOffset, o + 1))}
          disabled={offset >= maxOffset}
          className="w-7 h-7 rounded-full border border-[var(--color-border)] flex items-center justify-center text-[var(--color-muted-foreground)] disabled:opacity-40 hover:bg-[var(--color-accent)]"
          aria-label="Next posts"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <a
          href={MOCK_INSTAGRAM.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[12.5px] font-bold text-[var(--color-primary)] hover:underline"
        >
          {MOCK_INSTAGRAM.handle} →
        </a>
      </CardContent>
    </Card>
  )
}
