"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { Tablet, MapPin, ArrowLeft } from "lucide-react"

// ENG-1 — the client half of /staff/engagement. Fetches the ADMIN-gated route
// and renders rows; holds no authority of its own. Skeletons rather than a
// spinner, per the design system.

type Store = { id: string; name: string; storeNumber: string | null }
type Row = {
  id: string
  email: string
  name: string | null
  role: string
  isDeviceLogin: boolean
  stores: { id: string; name: string }[]
  lastSeenAt: string | null
  lastSeenLocation: string | null
  totalCount: number
  topPages: { path: string; count: number }[]
}

function relative(iso: string | null): string {
  if (!iso) return "Never"
  const then = new Date(iso).getTime()
  const mins = Math.floor((Date.now() - then) / 60000)
  if (mins < 1) return "Just now"
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

export function EngagementClient({ store, stores }: { store: Store | null; stores: Store[] }) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    const qs = store ? `?store=${encodeURIComponent(store.id)}` : ""
    fetch(`/api/staff/engagement${qs}`)
      .then(async (r) => {
        if (r.status === 403) throw new Error("You do not have access to this view.")
        if (!r.ok) throw new Error("Could not load engagement data.")
        // A SIGNED-OUT SESSION DOES NOT ARRIVE AS !r.ok. The proxy answers 307 to
        // /sign-in, fetch follows it transparently, and this lands as a 200 whose
        // body is HTML — so r.json() throws a raw "Unexpected token '<'" that was
        // rendering straight into the page. Caught locally on the /menu harness,
        // 2026-08-30. Check the content type rather than trusting ok.
        const type = r.headers.get("content-type") ?? ""
        if (!type.includes("application/json")) throw new Error("Your session has expired. Reload the page to sign in again.")
        return r.json()
      })
      .then((d) => { if (live) setRows(d.rows as Row[]) })
      .catch((e) => { if (live) setError(e instanceof Error ? e.message : "Could not load engagement data.") })
    return () => { live = false }
  }, [store])

  const storeLabel = store ? `${store.storeNumber ? `#${store.storeNumber} — ` : ""}${store.name}` : null

  return (
    <div>
      <div className="flex items-start justify-between mb-6">
        <div>
          {store && (
            <Link href="/staff/engagement" className="inline-flex items-center gap-1 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] mb-2">
              <ArrowLeft className="h-3.5 w-3.5" /> All logins
            </Link>
          )}
          <h1 className="text-2xl font-bold text-[var(--color-foreground)]">
            {store ? `Engagement — ${storeLabel}` : "Engagement"}
          </h1>
          <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
            {store
              ? "Logins that belong to this location, and the pages they use. Shared store devices are counted as the store."
              : "Every login, when it was last active, and what it is used for. Page counts cover the last 30 days."}
          </p>
        </div>
        {stores.length > 0 && (
          <select
            className="h-9 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] px-3 text-sm"
            value={store?.id ?? ""}
            onChange={(e) => {
              window.location.href = e.target.value ? `/staff/engagement?store=${e.target.value}` : "/staff/engagement"
            }}
          >
            <option value="">All locations</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.storeNumber ? `#${s.storeNumber} — ` : ""}{s.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {error && (
        <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-8 text-center">
          <p className="text-sm text-[var(--color-muted-foreground)]">{error}</p>
        </div>
      )}

      {!error && rows === null && (
        <div className="space-y-3">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full rounded-lg" />)}
        </div>
      )}

      {!error && rows !== null && rows.length === 0 && (
        <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-16 text-center">
          <p className="font-medium text-[var(--color-foreground)] mb-1">No logins here yet</p>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            Logins appear once they exist. Activity appears the first time someone uses the app.
          </p>
        </div>
      )}

      {!error && rows !== null && rows.length > 0 && (
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.id} className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-[var(--color-foreground)]">{r.name ?? r.email}</span>
                    {/* ENG-1 ruling 4 — a shared store device is labelled as the
                        store, never presented as a person. No attempt is made to
                        attribute its activity to whoever held the iPad. */}
                    {r.isDeviceLogin ? (
                      <Badge variant="secondary" className="gap-1">
                        <Tablet className="h-3 w-3" /> Store device
                      </Badge>
                    ) : (
                      <Badge variant="outline">{r.role}</Badge>
                    )}
                  </div>
                  <p className="text-xs text-[var(--color-muted-foreground)] mt-0.5 truncate">{r.email}</p>
                  {r.stores.length > 0 && (
                    <p className="text-xs text-[var(--color-muted-foreground)] mt-0.5">
                      {r.stores.map((s) => s.name).join(", ")}
                    </p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <p className={`text-sm font-medium ${r.lastSeenAt ? "text-[var(--color-foreground)]" : "text-[var(--color-muted-foreground)]"}`}>
                    {relative(r.lastSeenAt)}
                  </p>
                  {/* Location is omitted for store devices: the iPad never
                      leaves the store, so the city adds nothing and reads as
                      tracking a person rather than describing a location. */}
                  {!r.isDeviceLogin && r.lastSeenLocation && (
                    <p className="text-xs text-[var(--color-muted-foreground)] inline-flex items-center gap-1 mt-0.5">
                      <MapPin className="h-3 w-3" /> {r.lastSeenLocation}
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-3 pt-3 border-t border-[var(--color-border)] flex items-center justify-between gap-4">
                <div className="flex gap-2 flex-wrap min-w-0">
                  {r.topPages.length === 0 ? (
                    <span className="text-xs text-[var(--color-muted-foreground)]">No activity in the last 30 days</span>
                  ) : (
                    r.topPages.map((p) => (
                      <span key={p.path} className="text-xs bg-[var(--color-muted)] border border-[var(--color-border)] rounded-full px-2 py-0.5 text-[var(--color-muted-foreground)]">
                        {p.path} · {p.count}
                      </span>
                    ))
                  )}
                </div>
                <span className="text-xs text-[var(--color-muted-foreground)] shrink-0">
                  {r.totalCount} view{r.totalCount === 1 ? "" : "s"} / 30d
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
