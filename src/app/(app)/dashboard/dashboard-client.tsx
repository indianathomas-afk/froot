"use client"

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react"
import Link from "next/link"
import { ChevronLeft, ChevronRight, ClipboardList, Megaphone, StickyNote } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { projectMonthEnd } from "@/lib/pacing"
import { MessageAttachments, type FeedAttachment } from "@/app/(app)/messages/messages-client"
import { SalesPerformanceCard } from "./sales-performance-card"
import { LaborBudgetCard } from "./labor-budget-card"
import { LaborCoverageCard } from "./labor-coverage-card"
import { RollupView } from "./rollup-view"

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
    source: "plan" | "manual" | null
    mtdGoal: number | null
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

// ─── Comms (mirror /api/dashboard/comms — Phase I-14) ─────────────────────────

type ShiftNote = {
  id: string
  body: string
  author: { name: string; initial: string }
  createdAt: string
  postedToTemplate: { id: string; name: string } | null
  attachments: FeedAttachment[]
}

type Comms = {
  shiftNotes: ShiftNote[]
  teamMessagesPreview: {
    messages: {
      id: string
      body: string
      author: { name: string; initial: string }
      createdAt: string
    }[]
    unreadCount: number
  }
  corporateUpdate: {
    id: string
    title: string
    body: string
    publishedAt: string
    attachments: FeedAttachment[]
  } | null
}

function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return "Yesterday"
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

// ─── Instagram feed (mirror /api/instagram/feed) ──────────────────────────────

type InstagramPost = {
  id: string
  media_type: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM"
  media_url?: string
  permalink: string
  thumbnail_url?: string
  caption?: string
}

type InstagramFeed = {
  connected: boolean
  enabled: boolean
  username: string | null
  profileUrl: string | null
  posts: InstagramPost[]
}

// ─── Formatting ───────────────────────────────────────────────────────────────

const usd = (n: number | null | undefined, digits = 0) =>
  n === null || n === undefined
    ? "—"
    : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: digits, minimumFractionDigits: digits })

// ─── Persisted store selection (same external-store pattern as the sidebar) ──

const STORE_KEY = "froot.dashboard.store"
const STORE_EVENT = "froot-dashboard-store"

// Sentinel picker value for the all-locations rollup (Phase F-4) — only
// offered when the user can see more than one store.
const ALL_STORES = "all"

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
  laborEnabled = false,
}: {
  stores: { id: string; name: string; location: string }[]
  countRecency: { storeId: string; storeName: string; days: number | null }[]
  laborEnabled?: boolean
}) {
  const savedStoreId = useSavedStoreId()
  const storeId =
    savedStoreId === ALL_STORES && stores.length > 1
      ? ALL_STORES
      : stores.find((s) => s.id === savedStoreId)?.id ?? stores[0]?.id ?? ""
  const setStoreId = saveStoreId
  const isRollup = storeId === ALL_STORES
  const [summary, setSummary] = useState<Summary | null>(null)
  // Keyed by storeId (like `current` below) so switching stores shows the
  // skeleton instead of the previous store's messages.
  const [commsRes, setCommsRes] = useState<{ storeId: string; data: Comms | null } | null>(null)
  const [checkedOverride, setCheckedOverride] = useState<Record<string, boolean>>({})

  const load = useCallback(() => {
    if (!storeId || storeId === ALL_STORES) return
    fetch(`/api/dashboard/summary?storeId=${storeId}`)
      .then((res): Promise<Summary | null> => (res.ok ? res.json() : Promise.resolve(null)))
      .then(setSummary)
      .catch(() => setSummary(null))
    fetch(`/api/dashboard/comms?storeId=${storeId}`)
      .then((res): Promise<Comms | null> => (res.ok ? res.json() : Promise.resolve(null)))
      .then((data) => setCommsRes({ storeId, data }))
      .catch(() => setCommsRes({ storeId, data: null }))
  }, [storeId])

  useEffect(() => {
    load()
  }, [load])

  const current = summary && summary.store.id === storeId ? summary : null
  const loading = !isRollup && !!storeId && current === null
  const comms = commsRes && commsRes.storeId === storeId ? commsRes.data : null
  const commsLoading = !isRollup && !!storeId && (commsRes === null || commsRes.storeId !== storeId)
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
            {isRollup ? " · All locations" : store ? ` · ${store.name}${store.location ? ` — ${store.location}` : ""}` : ""}
          </p>
        </div>
        {stores.length > 1 && (
          <Select value={storeId} onValueChange={setStoreId}>
            <SelectTrigger className="w-52">
              <SelectValue placeholder="Select store" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_STORES}>All locations</SelectItem>
              {stores.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {isRollup ? (
        /* All-locations rollup: company totals + store ranking (F-4) */
        <RollupView />
      ) : (
        <>
          {/* Sales row: Performance (2) + Monthly Goal (1). */}
          <div className="flex flex-wrap gap-4">
            <div className="flex-[2] min-w-[320px] md:min-w-[420px]">
              <SalesPerformanceCard storeId={storeId} />
            </div>
            <div className="flex-1 min-w-[260px]">
              <MonthlyGoalCard loading={loading} summary={current} onSaved={load} />
            </div>
          </div>

          {/* Labor row (both gates): its own row — NOT stacked inside the
              sales-row columns, whose h-full cards would push these below and
              hide them. Same column widths so Coverage sits directly beneath
              Sales (aligned hourly axes) and the Budget hero beneath Monthly Goal. */}
          {laborEnabled && (
            <div className="flex flex-wrap gap-4">
              <div className="flex-[2] min-w-[320px] md:min-w-[420px]">
                <LaborCoverageCard storeId={storeId} />
              </div>
              <div className="flex-1 min-w-[260px]">
                <LaborBudgetCard storeId={storeId} />
              </div>
            </div>
          )}

          {/* Three equal cards */}
          <div className="flex flex-wrap gap-4">
            <div className="flex-1 min-w-[280px]">
              <TeamMessagesCard loading={commsLoading} comms={comms} />
            </div>
            {/* The corporate box collapses entirely when no update is active */}
            {(commsLoading || comms?.corporateUpdate) && (
              <div className="flex-1 min-w-[280px]">
                <CorporateUpdateCard loading={commsLoading} update={comms?.corporateUpdate ?? null} />
              </div>
            )}
            <div className="flex-1 min-w-[280px] space-y-4">
              {/* Unacknowledged handoff notes sit above the checklist box and
                  collapse to nothing once every note is acknowledged. */}
              <ShiftNotesCard
                notes={comms?.shiftNotes ?? []}
                onAcknowledged={(id) =>
                  setCommsRes((prev) =>
                    prev?.data
                      ? { ...prev, data: { ...prev.data, shiftNotes: prev.data.shiftNotes.filter((n) => n.id !== id) } }
                      : prev
                  )
                }
              />
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
        </>
      )}

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
  // Goal-weighted pacing when a Forecasting plan provides an MTD goal,
  // run-rate otherwise — src/lib/pacing.ts, shared with the rollup.
  const extrapolated = projectMonthEnd({
    mtdActual: mtd,
    mtdGoal: goal.mtdGoal,
    monthGoal: goal.goalAmount,
    daysElapsed: goal.daysElapsed,
    daysInMonth: goal.daysInMonth,
  })
  const pctToGoal = (extrapolated / goal.goalAmount) * 100
  const onTrack = pctToGoal >= 100

  return (
    <Card className="h-full">
      <CardContent className="pt-5 pb-4 h-full flex flex-col">
        <div className="flex items-center justify-between mb-1">
          <p className="text-[15px] font-bold text-[var(--color-foreground)]">Monthly Goal</p>
          {goal.source === "plan" ? (
            <Link
              href="/forecasting"
              className="text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-primary)]"
            >
              Forecasting →
            </Link>
          ) : (
            summary.canManageGoal && (
              <button
                className="text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-primary)]"
                onClick={() => {
                  setAmount(String(goal.goalAmount))
                  setEditing(true)
                }}
              >
                Edit
              </button>
            )
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

// ─── Team Messages (live — Phase I-14) ────────────────────────────────────────

function TeamMessagesCard({ loading, comms }: { loading: boolean; comms: Comms | null }) {
  if (loading) return <Skeleton className="h-56 w-full" />

  const preview = comms?.teamMessagesPreview
  return (
    <Card className="h-full hover:shadow-md transition-shadow">
      <CardContent className="pt-5 pb-4 h-full flex flex-col">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[15px] font-bold text-[var(--color-foreground)]">Team Messages</p>
          {preview && preview.unreadCount > 0 && (
            <span className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-[var(--color-primary)] text-white text-xs font-semibold">
              {preview.unreadCount > 99 ? "99+" : preview.unreadCount}
            </span>
          )}
        </div>
        {!preview || preview.messages.length === 0 ? (
          <div className="flex-1 flex flex-col items-start justify-center gap-2">
            <p className="text-sm text-[var(--color-muted-foreground)]">
              No messages yet at this store — leave the first shift note or shoutout.
            </p>
            <Link href="/messages">
              <Button size="sm">Post a message</Button>
            </Link>
          </div>
        ) : (
          <Link href="/messages" className="block flex-1">
            <div className="max-h-[220px] overflow-y-auto space-y-3 pr-1">
              {preview.messages.map((m) => (
                <div key={m.id} className="flex gap-2.5">
                  <div className="w-7 h-7 rounded-full bg-[var(--color-primary)]/15 flex items-center justify-center text-xs font-bold text-[var(--color-primary)] shrink-0">
                    {m.author.initial}
                  </div>
                  <div className="min-w-0">
                    <p className="text-[13px] font-bold text-[var(--color-foreground)]">
                      {m.author.name}{" "}
                      <span className="font-normal text-[var(--color-muted-foreground)]/70 text-xs">{timeAgo(m.createdAt)}</span>
                    </p>
                    <p className="text-[12.5px] text-[var(--color-muted-foreground)]">{m.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </Link>
        )}
        <Link href="/messages" className="text-xs font-bold text-[var(--color-primary)] mt-3 hover:underline">
          Open the feed →
        </Link>
      </CardContent>
    </Card>
  )
}

// ─── Corporate Update (live — Phase I-14) ─────────────────────────────────────

function CorporateUpdateCard({ loading, update }: { loading: boolean; update: NonNullable<Comms["corporateUpdate"]> | null }) {
  if (loading) return <Skeleton className="h-56 w-full" />
  if (!update) return null

  // Not wrapped in a Link — attachments carry their own links (documents,
  // YouTube embed), which can't nest inside an anchor. The footer navigates.
  return (
    <div className="h-full rounded-xl p-5 bg-gradient-to-br from-[#FCE0CC] to-[#F6C8A6] flex flex-col hover:shadow-md transition-shadow">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-6 h-6 rounded bg-[var(--color-primary)] flex items-center justify-center">
          <Megaphone className="h-3.5 w-3.5 text-white" />
        </div>
        <p className="text-[13px] font-extrabold tracking-wide text-[#8A3E17]">CORPORATE UPDATE</p>
      </div>
      <p className="text-base font-bold text-[#1C1917] mb-1">{update.title}</p>
      <p className="text-[13px] text-[#6B4326] flex-1 line-clamp-5 whitespace-pre-wrap">{update.body}</p>
      <MessageAttachments attachments={update.attachments ?? []} />
      <Link href="/messages" className="text-xs font-bold text-[#8A3E17] mt-3 hover:underline">
        Posted {timeAgo(update.publishedAt)} →
      </Link>
    </div>
  )
}

// ─── Notes for this shift (handoff notes surfacing today) ────────────────────

function ShiftNotesCard({ notes, onAcknowledged }: { notes: ShiftNote[]; onAcknowledged: (id: string) => void }) {
  const [ackingId, setAckingId] = useState<string | null>(null)

  if (notes.length === 0) return null

  async function acknowledge(id: string) {
    setAckingId(id)
    try {
      const res = await fetch(`/api/messages/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acknowledged: true }),
      })
      if (res.ok) onAcknowledged(id)
    } finally {
      setAckingId(null)
    }
  }

  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
      <div className="flex items-center gap-2 mb-2">
        <StickyNote className="h-4 w-4 text-amber-700" />
        <p className="text-[13px] font-extrabold tracking-wide text-amber-900">NOTES FOR THIS SHIFT</p>
      </div>
      <div className="space-y-3">
        {notes.map((n) => (
          <div key={n.id} className="flex items-start gap-2.5">
            <div className="w-7 h-7 rounded-full bg-amber-200 flex items-center justify-center text-xs font-bold text-amber-900 shrink-0">
              {n.author.initial}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-bold text-amber-950">
                {n.author.name}{" "}
                <span className="font-normal text-amber-800/70 text-xs">{timeAgo(n.createdAt)}</span>
              </p>
              <p className="text-[12.5px] text-amber-950/90 whitespace-pre-wrap line-clamp-3">{n.body}</p>
              <p className="text-[11px] text-amber-800/80 mt-0.5">
                → {n.postedToTemplate ? n.postedToTemplate.name : "Everyone"}
              </p>
            </div>
            <button
              onClick={() => acknowledge(n.id)}
              disabled={ackingId === n.id}
              className="min-h-[32px] px-2.5 rounded-md border border-amber-400 bg-white text-amber-900 text-[11px] font-semibold hover:bg-amber-100 disabled:opacity-50 shrink-0"
            >
              {ackingId === n.id ? "…" : "Acknowledge"}
            </button>
          </div>
        ))}
      </div>
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

// ─── Instagram strip (live — /api/instagram/feed, served from server cache) ──

function InstagramStrip() {
  const [offset, setOffset] = useState(0)
  const [feed, setFeed] = useState<InstagramFeed | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch("/api/instagram/feed?limit=12")
      .then((r): Promise<InstagramFeed | null> => (r.ok ? r.json() : Promise.resolve(null)))
      .then((data) => {
        if (cancelled) return
        setFeed(data)
        setLoaded(true)
      })
      .catch(() => {
        if (!cancelled) setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Not connected or toggled off (or the feed call failed) → no card at all.
  if (loaded && (!feed || !feed.connected || !feed.enabled || feed.posts.length === 0)) return null

  const visible = 6
  const posts = feed?.posts ?? []
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
          {!loaded
            ? Array.from({ length: visible }).map((_, i) => (
                <Skeleton key={i} className="w-[72px] h-[72px] rounded-lg shrink-0" />
              ))
            : posts.slice(offset, offset + visible).map((p) => {
                const src = p.media_type === "VIDEO" ? p.thumbnail_url : p.media_url
                return (
                  <a
                    key={p.id}
                    href={p.permalink}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={p.caption ?? "Open on Instagram"}
                    className="w-[72px] h-[72px] rounded-lg shrink-0 overflow-hidden bg-[var(--color-muted)] hover:opacity-90 transition-opacity"
                  >
                    {src && (
                      // Plain <img>: IG CDN hostnames rotate, so next/image can't pin them.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={src} alt={p.caption ?? "Instagram post"} loading="lazy" className="w-full h-full object-cover" />
                    )}
                  </a>
                )
              })}
        </div>
        <button
          onClick={() => setOffset((o) => Math.min(maxOffset, o + 1))}
          disabled={offset >= maxOffset}
          className="w-7 h-7 rounded-full border border-[var(--color-border)] flex items-center justify-center text-[var(--color-muted-foreground)] disabled:opacity-40 hover:bg-[var(--color-accent)]"
          aria-label="Next posts"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        {feed?.username && (
          <a
            href={feed.profileUrl ?? `https://www.instagram.com/${feed.username}/`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[12.5px] font-bold text-[var(--color-primary)] hover:underline"
          >
            @{feed.username} →
          </a>
        )}
      </CardContent>
    </Card>
  )
}
