"use client"

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type Dispatch, type ReactNode, type SetStateAction } from "react"
import {
  Camera,
  FileText,
  Loader2,
  Megaphone,
  MessageSquare,
  PackageX,
  Paperclip,
  PartyPopper,
  Pencil,
  StickyNote,
  Trash2,
  UserRound,
  Wrench,
  CirclePlay,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

// ─── Types (mirror the API serializers) ───────────────────────────────────────

export type FeedAttachment = {
  id: string
  kind: "image" | "document" | "youtube"
  url: string
  filename: string | null
  youtubeId: string | null
}

export type FeedMessage = {
  id: string
  storeId: string
  type: string
  shiftPhase: string | null
  body: string
  status: "open" | "resolved" | "archived"
  author: { name: string; initial: string }
  isMine: boolean
  linkedIngredient: { id: string; name: string } | null
  postedToTemplate: { id: string; name: string } | null
  postedForDate: string | null
  attachments: FeedAttachment[]
  reactions: { emoji: string; count: number; reactedByMe: boolean }[]
  createdAt: string
  editedAt: string | null
  resolvedAt: string | null
}

type CorpUpdate = {
  id: string
  title: string
  body: string
  storeIds: string[]
  publishedAt: string | null
  pinnedUntil: string | null
  author: string | null
  attachments: FeedAttachment[]
}

type PendingAttachment = {
  kind: "image" | "document" | "youtube"
  url: string
  filename?: string | null
  contentType?: string | null
  sizeBytes?: number | null
}

// ─── Message type metadata ────────────────────────────────────────────────────

export const TYPE_META: Record<string, { label: string; icon: typeof MessageSquare; className: string }> = {
  shift_note: { label: "Shift Note", icon: StickyNote, className: "bg-amber-100 text-amber-800" },
  shortage: { label: "Shortage", icon: PackageX, className: "bg-red-100 text-red-800" },
  equipment: { label: "Equipment", icon: Wrench, className: "bg-slate-200 text-slate-800" },
  customer_feedback: { label: "Customer", icon: UserRound, className: "bg-blue-100 text-blue-800" },
  staffing: { label: "Staffing", icon: UserRound, className: "bg-purple-100 text-purple-800" },
  shoutout: { label: "Shoutout", icon: PartyPopper, className: "bg-green-100 text-green-800" },
  general: { label: "General", icon: MessageSquare, className: "bg-[var(--color-muted)] text-[var(--color-muted-foreground)]" },
}

const EMOJI = ["👍", "🎉", "❤️", "😂", "👀", "🙏"]

const AVATAR_COLORS = ["#F97316", "#0EA5E9", "#8B5CF6", "#10B981", "#EF4444", "#F59E0B", "#6366F1"]
export function avatarColor(name: string): string {
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

export function timeAgo(iso: string): string {
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

// ─── Persisted store selection (same key as the dashboard so navigation
// between the two keeps the store) ────────────────────────────────────────────

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

// ─── Page component ───────────────────────────────────────────────────────────

export function MessagesClient({
  stores,
  role,
  inventoryActive,
}: {
  stores: { id: string; name: string }[]
  role: string
  inventoryActive: boolean
}) {
  const savedStoreId = useSavedStoreId()
  const storeId = stores.find((s) => s.id === savedStoreId)?.id ?? stores[0]?.id ?? ""
  const isManager = role === "ADMIN" || role === "MANAGER"

  const [typeFilter, setTypeFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState("all")
  // Keyed by (store, filters) so any change shows skeletons instead of a
  // stale feed — no synchronous state reset needed in the effect.
  const feedKey = `${storeId}|${typeFilter}|${statusFilter}`
  const [feed, setFeed] = useState<{ key: string; messages: FeedMessage[]; nextCursor: string | null } | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)

  const feedQuery = useCallback(
    (before?: string) => {
      const params = new URLSearchParams({ storeId })
      if (typeFilter !== "all") params.set("type", typeFilter)
      if (statusFilter !== "all") params.set("status", statusFilter)
      if (before) params.set("before", before)
      return `/api/messages?${params}`
    },
    [storeId, typeFilter, statusFilter]
  )

  useEffect(() => {
    if (!storeId) return
    fetch(feedQuery())
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setFeed({ key: feedKey, messages: d.messages, nextCursor: d.nextCursor })
      })
      .catch(() => setFeed({ key: feedKey, messages: [], nextCursor: null }))
  }, [storeId, feedKey, feedQuery])

  const messages = feed && feed.key === feedKey ? feed.messages : null
  const nextCursor = feed && feed.key === feedKey ? feed.nextCursor : null

  // Everything visible counts as read once the feed loads.
  useEffect(() => {
    if (!storeId || messages === null) return
    fetch("/api/messages/mark-read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storeId, upTo: new Date().toISOString() }),
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId, messages === null])

  async function loadMore() {
    if (!nextCursor) return
    setLoadingMore(true)
    try {
      const res = await fetch(feedQuery(nextCursor))
      if (res.ok) {
        const d = await res.json()
        setFeed((prev) =>
          prev ? { ...prev, messages: [...prev.messages, ...d.messages], nextCursor: d.nextCursor } : prev
        )
      }
    } finally {
      setLoadingMore(false)
    }
  }

  function replaceMessage(updated: FeedMessage) {
    setFeed((prev) => (prev ? { ...prev, messages: prev.messages.map((m) => (m.id === updated.id ? updated : m)) } : prev))
  }

  function removeMessage(id: string) {
    setFeed((prev) => (prev ? { ...prev, messages: prev.messages.filter((m) => m.id !== id) } : prev))
  }

  return (
    <div className="space-y-4 max-w-3xl">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-foreground)]">Team Messages</h1>
          <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
            Shift notes, shortages, equipment issues, and shoutouts — one feed per store.
          </p>
        </div>
        {stores.length > 1 && (
          <Select value={storeId} onValueChange={saveStoreId}>
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

      <CorporateSection isAdmin={role === "ADMIN"} storeId={storeId} stores={stores} />

      <Composer
        storeId={storeId}
        inventoryActive={inventoryActive}
        onPosted={(m) => setFeed((prev) => (prev ? { ...prev, messages: [m, ...prev.messages] } : prev))}
      />

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {Object.entries(TYPE_META).map(([value, meta]) => (
              <SelectItem key={value} value={value}>
                {meta.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any status</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Feed */}
      {messages === null ? (
        <div className="space-y-3">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : messages.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <MessageSquare className="h-8 w-8 mx-auto text-[var(--color-muted-foreground)] mb-2" />
            <p className="text-sm font-medium text-[var(--color-foreground)]">No messages yet</p>
            <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
              Be the first — post a shift note or give someone a shoutout above.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {messages.map((m) => (
            <MessageCard
              key={m.id}
              message={m}
              isManager={isManager}
              onChanged={replaceMessage}
              onDeleted={removeMessage}
            />
          ))}
          {nextCursor && (
            <Button variant="outline" className="w-full" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : "Load older messages"}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Corporate updates ────────────────────────────────────────────────────────

function CorporateSection({
  isAdmin,
  storeId,
  stores,
}: {
  isAdmin: boolean
  storeId: string
  stores: { id: string; name: string }[]
}) {
  // Keyed by storeId so switching stores shows the skeleton, not stale updates.
  const [updatesRes, setUpdatesRes] = useState<{ storeId: string; updates: CorpUpdate[] } | null>(null)
  const [expanded, setExpanded] = useState(false)

  const load = useCallback(() => {
    if (!storeId) return
    fetch(`/api/corporate-updates?limit=10&storeId=${storeId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setUpdatesRes({ storeId, updates: d?.updates ?? [] }))
      .catch(() => setUpdatesRes({ storeId, updates: [] }))
  }, [storeId])

  useEffect(() => {
    load()
  }, [load])

  const updates = updatesRes && updatesRes.storeId === storeId ? updatesRes.updates : null
  if (updates === null) return <Skeleton className="h-24 w-full" />
  const published = updates.filter((u) => u.publishedAt)
  const shown = expanded ? published : published.slice(0, 1)
  if (published.length === 0 && !isAdmin) return null

  function targetLabel(ids: string[]): string {
    if (ids.length === 0) return "All locations"
    const names = ids.map((id) => stores.find((s) => s.id === id)?.name ?? "Unknown store")
    return names.join(", ")
  }

  return (
    <div className="rounded-xl p-5 bg-gradient-to-br from-[#FCE0CC] to-[#F6C8A6]">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-6 h-6 rounded bg-[var(--color-primary)] flex items-center justify-center">
          <Megaphone className="h-3.5 w-3.5 text-white" />
        </div>
        <p className="text-[13px] font-extrabold tracking-wide text-[#8A3E17] flex-1">CORPORATE UPDATES</p>
        {isAdmin && <NewUpdateDialog stores={stores} onCreated={load} />}
      </div>
      {published.length === 0 ? (
        <p className="text-[13px] text-[#6B4326]">No updates published yet.</p>
      ) : (
        <div className="space-y-3">
          {shown.map((u) => (
            <div key={u.id}>
              <p className="text-base font-bold text-[#1C1917]">{u.title}</p>
              <p className="text-[13px] text-[#6B4326] whitespace-pre-wrap">{u.body}</p>
              <MessageAttachments attachments={u.attachments} />
              <div className="flex items-center gap-3 mt-1">
                <p className="text-xs font-bold text-[#8A3E17]">Posted {timeAgo(u.publishedAt!)}</p>
                {isAdmin && (
                  <p className="text-xs text-[#8A3E17]/80" title="Which stores see this update">
                    → {targetLabel(u.storeIds)}
                  </p>
                )}
                {isAdmin && <DeleteUpdateButton id={u.id} onDeleted={load} />}
              </div>
            </div>
          ))}
          {published.length > 1 && (
            <button className="text-xs font-bold text-[#8A3E17] hover:underline" onClick={() => setExpanded((e) => !e)}>
              {expanded ? "Show less" : `Show ${published.length - 1} more`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function NewUpdateDialog({ stores, onCreated }: { stores: { id: string; name: string }[]; onCreated: () => void }) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [allLocations, setAllLocations] = useState(true)
  const [selectedStoreIds, setSelectedStoreIds] = useState<string[]>([])
  const [attachments, setAttachments] = useState<PendingAttachment[]>([])
  const [uploading, setUploading] = useState(false)
  const [pinDays, setPinDays] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function toggleStore(id: string, checked: boolean) {
    // Picking a specific store overrides "All Locations".
    setAllLocations(false)
    setSelectedStoreIds((prev) => (checked ? [...prev, id] : prev.filter((s) => s !== id)))
  }

  const noTarget = !allLocations && selectedStoreIds.length === 0

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const pinnedUntil = Number(pinDays) > 0 ? new Date(Date.now() + Number(pinDays) * 86400000).toISOString() : null
      const res = await fetch("/api/corporate-updates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          body,
          storeIds: allLocations ? [] : selectedStoreIds,
          pinnedUntil,
          publish: true,
          attachments,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => null)
        setError(d?.error ?? "Failed to publish update")
        return
      }
      setOpen(false)
      setTitle("")
      setBody("")
      setAllLocations(true)
      setSelectedStoreIds([])
      setAttachments([])
      setPinDays("")
      onCreated()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="bg-white/60 border-[#8A3E17]/30 text-[#8A3E17] hover:bg-white">
          New update
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New corporate update</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input placeholder="Title" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
          <Textarea placeholder="What does every store need to know?" rows={5} maxLength={5000} value={body} onChange={(e) => setBody(e.target.value)} />

          <AttachmentComposer
            attachments={attachments}
            setAttachments={setAttachments}
            uploading={uploading}
            setUploading={setUploading}
            onError={setError}
          />

          <div className="space-y-1.5">
            <Label className="text-sm">Send to</Label>
            <div className="rounded-md border border-[var(--color-border)] p-2.5 space-y-2 max-h-44 overflow-y-auto">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="all-locations"
                  checked={allLocations}
                  onCheckedChange={(v) => {
                    setAllLocations(v === true)
                    if (v === true) setSelectedStoreIds([])
                  }}
                />
                <Label htmlFor="all-locations" className="text-sm font-semibold">
                  All Locations
                </Label>
              </div>
              {stores.map((s) => (
                <div key={s.id} className="flex items-center gap-2 pl-5">
                  <Checkbox
                    id={`target-store-${s.id}`}
                    checked={!allLocations && selectedStoreIds.includes(s.id)}
                    onCheckedChange={(v) => toggleStore(s.id, v === true)}
                  />
                  <Label htmlFor={`target-store-${s.id}`} className="text-sm font-normal">
                    {s.name}
                  </Label>
                </div>
              ))}
            </div>
            {noTarget && (
              <p className="text-xs text-[var(--color-muted-foreground)]">
                Choose All Locations or pick at least one store.
              </p>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Label htmlFor="pin-days" className="text-sm shrink-0">
              Pin on dashboard for
            </Label>
            <Input id="pin-days" type="number" min="0" placeholder="∞" className="w-20" value={pinDays} onChange={(e) => setPinDays(e.target.value)} />
            <span className="text-sm text-[var(--color-muted-foreground)]">days (blank = until replaced)</span>
          </div>
          {error && <p className="text-sm text-[var(--color-destructive)]">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving || uploading || !title.trim() || !body.trim() || noTarget}>
              {saving ? "Publishing…" : "Publish"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function DeleteUpdateButton({ id, onDeleted }: { id: string; onDeleted: () => void }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <button className="text-xs text-[#8A3E17]/70 hover:text-[#8A3E17] underline">Delete</button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this update?</AlertDialogTitle>
          <AlertDialogDescription>It disappears from every store&apos;s dashboard immediately.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={async () => {
              await fetch(`/api/corporate-updates/${id}`, { method: "DELETE" })
              onDeleted()
            }}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// ─── Attachment composer ──────────────────────────────────────────────────────
// Photo / File / YouTube pickers + pending-attachment badges, shared by the
// team-message composer and the corporate-update dialog so upload behavior,
// validation, and styling stay identical.

function AttachmentComposer({
  attachments,
  setAttachments,
  uploading,
  setUploading,
  onError,
  trailing,
}: {
  attachments: PendingAttachment[]
  setAttachments: Dispatch<SetStateAction<PendingAttachment[]>>
  uploading: boolean
  setUploading: (v: boolean) => void
  onError: (msg: string | null) => void
  trailing?: ReactNode
}) {
  const [youtubeOpen, setYoutubeOpen] = useState(false)
  const [youtubeUrl, setYoutubeUrl] = useState("")
  const photoInputRef = useRef<HTMLInputElement>(null)
  const docInputRef = useRef<HTMLInputElement>(null)

  async function uploadFile(file: File) {
    if (attachments.length >= 4) {
      onError("Max 4 attachments per message")
      return
    }
    setUploading(true)
    onError(null)
    try {
      const form = new FormData()
      form.append("file", file)
      const res = await fetch("/api/upload/message-attachment", { method: "POST", body: form })
      const d = await res.json()
      if (!res.ok) {
        onError(d?.error ?? "Upload failed")
        return
      }
      setAttachments((prev) => [...prev, d])
    } finally {
      setUploading(false)
    }
  }

  function addYoutube() {
    if (!youtubeUrl.trim()) return
    if (attachments.length >= 4) {
      onError("Max 4 attachments per message")
      return
    }
    setAttachments((prev) => [...prev, { kind: "youtube", url: youtubeUrl.trim() }])
    setYoutubeUrl("")
    setYoutubeOpen(false)
  }

  return (
    <>
      {/* Pending attachments */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {attachments.map((a, idx) => (
            <Badge key={idx} variant="secondary" className="gap-1 max-w-56">
              {a.kind === "image" ? <Camera className="h-3 w-3" /> : a.kind === "youtube" ? <CirclePlay className="h-3 w-3" /> : <FileText className="h-3 w-3" />}
              <span className="truncate">{a.filename ?? (a.kind === "youtube" ? "YouTube video" : a.url)}</span>
              <button
                onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== idx))}
                className="ml-1 hover:text-[var(--color-destructive)]"
              >
                ×
              </button>
            </Badge>
          ))}
        </div>
      )}

      {youtubeOpen && (
        <div className="flex gap-2">
          <Input placeholder="Paste a YouTube link" value={youtubeUrl} onChange={(e) => setYoutubeUrl(e.target.value)} />
          <Button variant="outline" onClick={addYoutube} disabled={!youtubeUrl.trim()}>
            Add
          </Button>
        </div>
      )}

      <div className="flex items-center gap-2">
        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) uploadFile(f)
            e.target.value = ""
          }}
        />
        <input
          ref={docInputRef}
          type="file"
          accept=".pdf,.docx,.xlsx,application/pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) uploadFile(f)
            e.target.value = ""
          }}
        />
        <Button variant="outline" size="sm" onClick={() => photoInputRef.current?.click()} disabled={uploading}>
          <Camera className="h-4 w-4" />
          Photo
        </Button>
        <Button variant="outline" size="sm" onClick={() => docInputRef.current?.click()} disabled={uploading}>
          <Paperclip className="h-4 w-4" />
          File
        </Button>
        <Button variant="outline" size="sm" onClick={() => setYoutubeOpen((o) => !o)}>
          <CirclePlay className="h-4 w-4" />
          Video
        </Button>
        {uploading && <Loader2 className="h-4 w-4 animate-spin text-[var(--color-muted-foreground)]" />}
        {trailing}
      </div>
    </>
  )
}

// ─── Composer ─────────────────────────────────────────────────────────────────

function Composer({
  storeId,
  inventoryActive,
  onPosted,
}: {
  storeId: string
  inventoryActive: boolean
  onPosted: (m: FeedMessage) => void
}) {
  const [type, setType] = useState("general")
  const [body, setBody] = useState("")
  const [shiftPhase, setShiftPhase] = useState("opening")
  const [attachments, setAttachments] = useState<PendingAttachment[]>([])
  const [uploading, setUploading] = useState(false)
  const [posting, setPosting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Shortage → optional ingredient link (inventory module only).
  const [ingredients, setIngredients] = useState<{ id: string; name: string }[] | null>(null)
  const [ingredientQuery, setIngredientQuery] = useState("")
  const [linkedIngredient, setLinkedIngredient] = useState<{ id: string; name: string } | null>(null)

  useEffect(() => {
    if (type !== "shortage" || !inventoryActive || ingredients !== null) return
    fetch("/api/inventory/ingredients")
      .then((r) => (r.ok ? r.json() : []))
      .then((list: { id: string; name: string }[]) => setIngredients(list.map((i) => ({ id: i.id, name: i.name }))))
      .catch(() => setIngredients([]))
  }, [type, inventoryActive, ingredients])

  async function post() {
    setPosting(true)
    setError(null)
    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId,
          type,
          body,
          shiftPhase: type === "shift_note" ? shiftPhase : undefined,
          linkedIngredientId: type === "shortage" ? linkedIngredient?.id : undefined,
          attachments,
        }),
      })
      const d = await res.json()
      if (!res.ok) {
        setError(d?.error ?? "Failed to post")
        return
      }
      onPosted(d)
      setBody("")
      setAttachments([])
      setLinkedIngredient(null)
      setIngredientQuery("")
      setType("general")
    } finally {
      setPosting(false)
    }
  }

  const ingredientMatches =
    ingredientQuery.trim().length > 0 && ingredients
      ? ingredients.filter((i) => i.name.toLowerCase().includes(ingredientQuery.trim().toLowerCase())).slice(0, 6)
      : []

  return (
    <Card>
      <CardContent className="pt-5 pb-4 space-y-3">
        {/* Type picker — big tap targets, camera-first culture */}
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(TYPE_META).map(([value, meta]) => {
            const Icon = meta.icon
            const active = type === value
            return (
              <button
                key={value}
                onClick={() => setType(value)}
                className={cn(
                  "flex items-center gap-1.5 min-h-[38px] px-3 py-1.5 rounded-lg border text-[13px] font-medium transition-colors",
                  active
                    ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
                    : "border-[var(--color-border)] text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]"
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {meta.label}
              </button>
            )
          })}
        </div>

        {type === "shift_note" && (
          <Select value={shiftPhase} onValueChange={setShiftPhase}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="opening">Opening</SelectItem>
              <SelectItem value="mid">Mid-shift</SelectItem>
              <SelectItem value="closing">Closing</SelectItem>
            </SelectContent>
          </Select>
        )}

        {type === "shortage" && inventoryActive && (
          <div>
            {linkedIngredient ? (
              <Badge variant="secondary" className="gap-1">
                <PackageX className="h-3 w-3" />
                {linkedIngredient.name}
                <button onClick={() => setLinkedIngredient(null)} className="ml-1 hover:text-[var(--color-destructive)]">
                  ×
                </button>
              </Badge>
            ) : (
              <div className="relative">
                <Input
                  placeholder="Link an ingredient (optional) — start typing…"
                  value={ingredientQuery}
                  onChange={(e) => setIngredientQuery(e.target.value)}
                />
                {ingredientMatches.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-card)] shadow-md">
                    {ingredientMatches.map((i) => (
                      <button
                        key={i.id}
                        className="block w-full text-left px-3 py-2 text-sm hover:bg-[var(--color-accent)]"
                        onClick={() => {
                          setLinkedIngredient(i)
                          setIngredientQuery("")
                        }}
                      >
                        {i.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <Textarea
          placeholder={
            type === "shoutout" ? "Who crushed it today?" : type === "shortage" ? "What are we running low on?" : "Share with the team…"
          }
          rows={3}
          maxLength={2000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />

        <AttachmentComposer
          attachments={attachments}
          setAttachments={setAttachments}
          uploading={uploading}
          setUploading={setUploading}
          onError={setError}
          trailing={
            <>
              <span className="flex-1" />
              <Button onClick={post} disabled={posting || uploading || !body.trim() || !storeId}>
                {posting ? "Posting…" : "Post"}
              </Button>
            </>
          }
        />

        {error && <p className="text-sm text-[var(--color-destructive)]">{error}</p>}
      </CardContent>
    </Card>
  )
}

// ─── Message card ─────────────────────────────────────────────────────────────

export function MessageAttachments({ attachments }: { attachments: FeedAttachment[] }) {
  if (attachments.length === 0) return null
  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap gap-2">
        {attachments
          .filter((a) => a.kind === "image")
          .map((a) => (
            <a key={a.id} href={a.url} target="_blank" rel="noopener noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={a.url} alt={a.filename ?? "attachment"} className="h-24 w-24 rounded-lg object-cover border border-[var(--color-border)]" />
            </a>
          ))}
        {attachments
          .filter((a) => a.kind === "document")
          .map((a) => (
            <a
              key={a.id}
              href={a.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-[var(--color-border)] text-sm hover:bg-[var(--color-accent)]"
            >
              <FileText className="h-4 w-4 text-[var(--color-muted-foreground)]" />
              {a.filename ?? "Document"}
            </a>
          ))}
      </div>
      {attachments
        .filter((a) => a.kind === "youtube" && a.youtubeId)
        .map((a) => (
          <div key={a.id} className="aspect-video max-w-md rounded-lg overflow-hidden border border-[var(--color-border)]">
            <iframe
              src={`https://www.youtube.com/embed/${a.youtubeId}`}
              title="YouTube video"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              className="w-full h-full"
            />
          </div>
        ))}
    </div>
  )
}

export function ReactionBar({
  message,
  onChanged,
}: {
  message: FeedMessage
  onChanged: (m: FeedMessage) => void
}) {
  async function toggle(emoji: string) {
    const existing = message.reactions.find((r) => r.emoji === emoji)
    const mine = existing?.reactedByMe ?? false
    // Optimistic update, then reconcile from the server response.
    const optimistic: FeedMessage = {
      ...message,
      reactions: mine
        ? message.reactions
            .map((r) => (r.emoji === emoji ? { ...r, count: r.count - 1, reactedByMe: false } : r))
            .filter((r) => r.count > 0)
        : existing
          ? message.reactions.map((r) => (r.emoji === emoji ? { ...r, count: r.count + 1, reactedByMe: true } : r))
          : [...message.reactions, { emoji, count: 1, reactedByMe: true }],
    }
    onChanged(optimistic)
    await fetch(`/api/messages/${message.id}/reactions/${encodeURIComponent(emoji)}`, {
      method: mine ? "DELETE" : "PUT",
    }).catch(() => {})
  }

  return (
    <div className="flex flex-wrap items-center gap-1 mt-2">
      {EMOJI.map((emoji) => {
        const r = message.reactions.find((x) => x.emoji === emoji)
        return (
          <button
            key={emoji}
            onClick={() => toggle(emoji)}
            className={cn(
              "inline-flex items-center gap-1 min-h-[30px] px-2 py-0.5 rounded-full border text-[13px] transition-colors",
              r?.reactedByMe
                ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10"
                : r
                  ? "border-[var(--color-border)] bg-[var(--color-muted)]"
                  : "border-transparent text-[var(--color-muted-foreground)]/50 hover:border-[var(--color-border)] hover:text-[var(--color-foreground)]"
            )}
            title={r?.reactedByMe ? "Remove reaction" : "React"}
          >
            <span>{emoji}</span>
            {r && <span className="font-semibold text-xs">{r.count}</span>}
          </button>
        )
      })}
    </div>
  )
}

function MessageCard({
  message,
  isManager,
  onChanged,
  onDeleted,
}: {
  message: FeedMessage
  isManager: boolean
  onChanged: (m: FeedMessage) => void
  onDeleted: (id: string) => void
}) {
  const meta = TYPE_META[message.type] ?? TYPE_META.general
  const Icon = meta.icon
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(message.body)
  // Snapshot of "now" at mount — the 15-minute edit window doesn't need to
  // tick live, and the server enforces it anyway.
  const [mountedAt] = useState(() => Date.now())
  const canEdit = message.isMine && mountedAt - new Date(message.createdAt).getTime() < 15 * 60 * 1000
  const canDelete = message.isMine || isManager
  const ticketish = message.type === "shortage" || message.type === "equipment"

  async function saveEdit() {
    const res = await fetch(`/api/messages/${message.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: draft }),
    })
    if (res.ok) {
      onChanged(await res.json())
      setEditing(false)
    }
  }

  async function setStatus(status: string) {
    const res = await fetch(`/api/messages/${message.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    })
    if (res.ok) onChanged(await res.json())
  }

  return (
    <Card>
      <CardContent className="pt-4 pb-3">
        <div className="flex gap-3">
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0"
            style={{ backgroundColor: avatarColor(message.author.name) }}
          >
            {message.author.initial}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-[14px] font-bold text-[var(--color-foreground)]">{message.author.name}</p>
              <span className="text-xs text-[var(--color-muted-foreground)]">
                {timeAgo(message.createdAt)}
                {message.editedAt && " · edited"}
              </span>
              <Badge className={cn("gap-1 font-medium border-0", meta.className)}>
                <Icon className="h-3 w-3" />
                {meta.label}
                {message.shiftPhase && ` · ${message.shiftPhase}`}
              </Badge>
              {ticketish && (
                <Badge variant={message.status === "open" ? "destructive" : "secondary"} className="uppercase text-[10px]">
                  {message.status}
                </Badge>
              )}
              {message.postedToTemplate && (
                <span className="text-xs text-[var(--color-muted-foreground)]">
                  → {message.postedToTemplate.name}
                  {message.postedForDate && ` (${message.postedForDate})`}
                </span>
              )}
            </div>

            {editing ? (
              <div className="mt-2 space-y-2">
                <Textarea rows={3} maxLength={2000} value={draft} onChange={(e) => setDraft(e.target.value)} />
                <div className="flex gap-2">
                  <Button size="sm" onClick={saveEdit} disabled={!draft.trim()}>
                    Save
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setEditing(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-[13.5px] text-[var(--color-foreground)] mt-1 whitespace-pre-wrap">{message.body}</p>
            )}

            {message.linkedIngredient && (
              <Badge variant="outline" className="mt-2 gap-1">
                <PackageX className="h-3 w-3" />
                {message.linkedIngredient.name}
              </Badge>
            )}

            <MessageAttachments attachments={message.attachments} />
            <ReactionBar message={message} onChanged={onChanged} />
          </div>

          {/* Actions */}
          <div className="flex flex-col items-end gap-1 shrink-0">
            {isManager && ticketish && (
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setStatus(message.status === "open" ? "resolved" : "open")}>
                {message.status === "open" ? "Resolve" : "Reopen"}
              </Button>
            )}
            <div className="flex gap-1">
              {canEdit && !editing && (
                <button
                  className="p-1.5 rounded hover:bg-[var(--color-accent)] text-[var(--color-muted-foreground)]"
                  title="Edit (15-minute window)"
                  onClick={() => {
                    setDraft(message.body)
                    setEditing(true)
                  }}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              )}
              {canDelete && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <button className="p-1.5 rounded hover:bg-[var(--color-accent)] text-[var(--color-muted-foreground)]" title="Delete">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete this message?</AlertDialogTitle>
                      <AlertDialogDescription>It will be removed from the feed for everyone.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={async () => {
                          const res = await fetch(`/api/messages/${message.id}`, { method: "DELETE" })
                          if (res.ok) onDeleted(message.id)
                        }}
                      >
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
