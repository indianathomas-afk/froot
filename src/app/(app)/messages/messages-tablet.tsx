"use client"

import { useLayoutEffect, useRef, useState } from "react"
import {
  Camera,
  Check,
  ChevronDown,
  ChevronUp,
  CirclePlay,
  List,
  Megaphone,
  MessageSquare,
  PackageX,
  Paperclip,
  Pencil,
  Trash2,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
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
import { cn } from "@/lib/utils"
import { saveStoreId } from "@/lib/dashboard-store"
import { useKeyboardInset } from "@/app/(app)/dashboard/tablet-messages"
import {
  DeleteUpdateButton,
  EMOJI,
  MessageAttachments,
  NewUpdateDialog,
  TYPE_META,
  avatarColor,
  timeAgo,
  updateTargetLabel,
  useAttachmentPicker,
  useComposer,
  useCorporateUpdates,
  useMessageActions,
  useMessagesFeed,
  useMessagesStoreId,
  useReactionToggle,
  type CorpUpdate,
  type FeedMessage,
} from "./messages-client"
import { MessageTypePicker, TABLET_TYPE_ORDER } from "./type-picker"

// TAB-11, 2026-11-11 — Team Messages in Tablet mode (Claude Design canvas
// "Froot Tablet Messages", frames "A · Option 2"). Gary's rulings R1–R5
// (DECISIONS 2026-11-11 TAB-11):
//   R1  Tablet mode only. page.tsx renders this only when the device's view
//       cookie is "tablet"; desktop's MessagesClient is untouched in output.
//   R2  1024px and wider: two panes (filters | feed + composer). Narrower:
//       one column — header band, feed, composer pinned at the bottom.
//   R3  General is listed FIRST in every tablet type list (filters, picker).
//   R4  The type returns to General after every post — useComposer.post()
//       already did this on desktop; the tablet shares that one function.
//   R5  No new features. Every fetch, post, reaction, edit, resolve and
//       delete is the desktop hook in messages-client.tsx — this file only
//       lays them out at touch size.
//
// SCROLLING. The page never scrolls: this component is one viewport tall
// (h-dvh, overflow hidden — TabletShell gives /messages a full-bleed
// container). The left panel, the feed, and (portrait) the header band
// scroll on their own. When the iPad keyboard opens, the feed column takes
// bottom padding equal to what the keyboard covers (useKeyboardInset, TAB-2's
// visualViewport measure), so the composer sits directly above the keyboard;
// in portrait the header band also folds away while typing so the feed keeps
// some room (the same choice TAB-2's Messages column makes).

// R3's TABLET_TYPE_ORDER (General first) and the Type button + picker moved
// to ./type-picker.tsx in TAB-12, shared with the tablet home's composer.

const STATUS_OPTIONS = [
  { value: "all", label: "Any status" },
  { value: "open", label: "Open" },
  { value: "resolved", label: "Resolved" },
  { value: "archived", label: "Archived" },
]

type Store = { id: string; name: string }

export function MessagesTablet({
  stores,
  role,
  inventoryActive,
}: {
  stores: Store[]
  role: string
  inventoryActive: boolean
}) {
  const storeId = useMessagesStoreId(stores)
  const isManager = role === "ADMIN" || role === "MANAGER"
  const isAdmin = role === "ADMIN"
  const feed = useMessagesFeed(storeId)
  // Read once here and handed to both layouts' cards, so the CSS-hidden one
  // never fetches a second time.
  const corporate = useCorporateUpdates(storeId)
  const inset = useKeyboardInset()
  const typing = inset > 0

  return (
    <div data-testid="tablet-messages" className="flex h-dvh min-w-0 overflow-hidden">
      {/* ── Landscape: the left panel ─────────────────────────────────────── */}
      <aside
        data-testid="tablet-messages-panel"
        className="hidden w-[372px] shrink-0 flex-col gap-6 overflow-y-auto border-r border-[var(--color-border)] px-6 py-6 lg:flex"
      >
        <PageHeader stores={stores} storeId={storeId} />
        <CorporateCard {...corporate} isAdmin={isAdmin} stores={stores} />
        <fieldset>
          <legend className="mb-2.5 text-[13px] font-semibold uppercase tracking-[0.08em] text-[var(--color-muted-foreground)]">
            Type
          </legend>
          <div className="grid grid-cols-2 gap-2">
            <TypeChips value={feed.typeFilter} onChange={feed.setTypeFilter} />
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-2.5 text-[13px] font-semibold uppercase tracking-[0.08em] text-[var(--color-muted-foreground)]">
            Status
          </legend>
          <StatusSelect value={feed.statusFilter} onChange={feed.setStatusFilter} className="w-full" />
        </fieldset>
      </aside>

      {/* ── The feed column (both orientations) ───────────────────────────── */}
      <section
        className="flex min-w-0 flex-1 flex-col"
        style={inset > 0 ? { paddingBottom: inset } : undefined}
      >
        {/* Portrait: the header band */}
        <div
          data-testid="tablet-messages-band"
          className={cn(
            "max-h-[45dvh] shrink-0 space-y-4 overflow-y-auto border-b border-[var(--color-border)] px-6 pt-6 pb-4 lg:hidden",
            typing && "hidden"
          )}
        >
          <PageHeader stores={stores} storeId={storeId} />
          <CorporateCard {...corporate} isAdmin={isAdmin} stores={stores} />
          <div className="flex items-center gap-3">
            <div className="relative min-w-0 flex-1">
              <div
                data-testid="tablet-type-strip"
                className="flex gap-2 overflow-x-auto pr-12 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
                <TypeChips value={feed.typeFilter} onChange={feed.setTypeFilter} strip />
              </div>
              {/* The fade says "more this way" at the right edge. */}
              <div className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-[var(--color-background)] to-transparent" />
            </div>
            <div className="h-8 w-px shrink-0 bg-[var(--color-border)]" />
            <StatusSelect value={feed.statusFilter} onChange={feed.setStatusFilter} className="w-auto shrink-0" />
          </div>
        </div>

        <div data-testid="tablet-feed" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pt-5 pb-5">
          <Feed feed={feed} isManager={isManager} />
        </div>

        <TabletComposer storeId={storeId} inventoryActive={inventoryActive} onPosted={feed.prependMessage} />
      </section>
    </div>
  )
}

// ─── Header ───────────────────────────────────────────────────────────────────

function PageHeader({ stores, storeId }: { stores: Store[]; storeId: string }) {
  return (
    <div>
      <h1 className="text-[28px] font-bold leading-tight text-[var(--color-foreground)]">Team Messages</h1>
      <p className="mt-1 text-[15px] text-[var(--color-muted-foreground)]">
        Shift notes, shortages, equipment issues, and shoutouts — one feed per store.
      </p>
      {/* The desktop page's store picker, at touch size (multi-store only). */}
      {stores.length > 1 && (
        <Select value={storeId} onValueChange={saveStoreId}>
          <SelectTrigger className="mt-3 h-12 w-full rounded-full bg-[var(--color-card)] px-5 text-base font-semibold">
            <SelectValue placeholder="Select store" />
          </SelectTrigger>
          <SelectContent>
            {stores.map((s) => (
              <SelectItem key={s.id} value={s.id} className="min-h-12 text-base">
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  )
}

// ─── Corporate updates ────────────────────────────────────────────────────────
// The tablet home's pinned-update look (tablet-messages.tsx PinnedUpdate) over
// the desktop card's behaviour: first update, "Show N more" / "Show less",
// admins' New update / target / Delete. Desktop has no way to hide the card,
// so neither does this (no collapse chevron — TAB-11 audit item 3).

function CorporateCard({
  updates,
  load,
  isAdmin,
  stores,
}: {
  updates: CorpUpdate[] | null
  load: () => void
  isAdmin: boolean
  stores: Store[]
}) {
  const [expanded, setExpanded] = useState(false)

  if (updates === null) return <Skeleton className="h-36 w-full rounded-2xl" />
  const published = updates.filter((u) => u.publishedAt)
  const shown = expanded ? published : published.slice(0, 1)
  if (published.length === 0 && !isAdmin) return null

  return (
    <div data-testid="tablet-corporate" className="rounded-2xl bg-gradient-to-br from-[#FCE0CC] to-[#F6C8A6] p-4">
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--color-primary)]">
          <Megaphone className="h-[18px] w-[18px] text-white" />
        </div>
        <p className="flex-1 text-[13px] font-extrabold tracking-[0.08em] text-[#8A3E17]">CORPORATE UPDATES</p>
        {isAdmin && <NewUpdateDialog stores={stores} onCreated={load} triggerClassName="h-11 rounded-full px-4 text-[15px]" />}
      </div>
      {published.length === 0 ? (
        <p className="mt-3 text-[15px] text-[#6B4326]">No updates published yet.</p>
      ) : (
        <>
          {shown.map((u) => (
            <div key={u.id} className="mt-3">
              <p className="text-lg font-bold leading-snug text-[#1C1917]">{u.title}</p>
              <p className="mt-0.5 text-[15px] whitespace-pre-wrap text-[#6B4326]">{u.body}</p>
              <MessageAttachments attachments={u.attachments} />
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3">
                <p className="text-sm font-semibold text-[#8A3E17]">Posted {timeAgo(u.publishedAt!)}</p>
                {isAdmin && (
                  <p className="text-sm text-[#8A3E17]/80" title="Which stores see this update">
                    → {updateTargetLabel(u.storeIds, stores)}
                  </p>
                )}
                {isAdmin && (
                  <DeleteUpdateButton id={u.id} onDeleted={load} className="inline-flex min-h-11 items-center px-1 text-sm" />
                )}
              </div>
            </div>
          ))}
          {published.length > 1 && (
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              className="mt-3 inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-full bg-white/60 text-base font-bold text-[#8A3E17] active:bg-white"
            >
              {expanded ? "Show less" : `Show ${published.length - 1} more`}
              {expanded ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
            </button>
          )}
        </>
      )}
    </div>
  )
}

// ─── Filters ──────────────────────────────────────────────────────────────────

function TypeChips({ value, onChange, strip = false }: { value: string; onChange: (v: string) => void; strip?: boolean }) {
  const options = [
    { value: "all", label: "All types", Icon: List },
    ...TABLET_TYPE_ORDER.map((t) => ({ value: t, label: TYPE_META[t].label, Icon: TYPE_META[t].icon })),
  ]
  return (
    <>
      {options.map(({ value: v, label, Icon }) => {
        const active = value === v
        return (
          <button
            key={v}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(v)}
            className={cn(
              "inline-flex h-12 items-center gap-2.5 rounded-full border px-4 text-[15px] font-semibold whitespace-nowrap transition-colors",
              strip && "shrink-0",
              active
                ? "border-[var(--color-foreground)] bg-[var(--color-foreground)] text-white"
                : "border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-foreground)] active:bg-[var(--color-accent)]"
            )}
          >
            <Icon className="h-[18px] w-[18px] shrink-0" />
            {label}
          </button>
        )
      })}
    </>
  )
}

function StatusSelect({ value, onChange, className }: { value: string; onChange: (v: string) => void; className?: string }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        aria-label="Status"
        className={cn(
          "h-12 gap-2 rounded-full bg-[var(--color-card)] px-5 text-[15px] font-semibold text-[var(--color-foreground)] [&>svg]:h-5 [&>svg]:w-5 [&>svg]:opacity-70",
          className
        )}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="min-w-[12rem]">
        {STATUS_OPTIONS.map((o) => (
          <SelectItem key={o.value} value={o.value} className="min-h-12 text-base">
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

// ─── Feed ─────────────────────────────────────────────────────────────────────

function Feed({ feed, isManager }: { feed: ReturnType<typeof useMessagesFeed>; isManager: boolean }) {
  const { messages, nextCursor, loadingMore, loadMore, replaceMessage, removeMessage } = feed

  if (messages === null) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-36 w-full rounded-2xl" />
        ))}
      </div>
    )
  }
  if (messages.length === 0) {
    return (
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] px-6 py-12 text-center">
        <MessageSquare className="mx-auto mb-3 h-10 w-10 text-[var(--color-muted-foreground)]" />
        <p className="text-lg font-semibold text-[var(--color-foreground)]">No messages yet</p>
        <p className="mt-1 text-[17px] text-[var(--color-muted-foreground)]">
          Be the first — post a shift note or give someone a shoutout below.
        </p>
      </div>
    )
  }
  return (
    <div className="space-y-3">
      {messages.map((m) => (
        <TabletMessageCard key={m.id} message={m} isManager={isManager} onChanged={replaceMessage} onDeleted={removeMessage} />
      ))}
      {nextCursor && (
        <Button
          variant="outline"
          className="h-12 w-full rounded-full bg-[var(--color-card)] text-base font-semibold"
          onClick={loadMore}
          disabled={loadingMore}
        >
          {loadingMore ? "Loading…" : "Load older messages"}
        </Button>
      )}
    </div>
  )
}

function TabletMessageCard({
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
  const { editing, setEditing, draft, setDraft, canEdit, canDelete, ticketish, saveEdit, setStatus, deleteMessage } =
    useMessageActions({ message, isManager, onChanged, onDeleted })
  const toggle = useReactionToggle(message, onChanged)

  return (
    <article data-testid="tablet-message-card" className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] px-5 py-4">
      <div className="flex gap-4">
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-lg font-bold text-white"
          style={{ backgroundColor: avatarColor(message.author.name) }}
        >
          {message.author.initial}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <div className="flex min-h-11 min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1">
              <p className="text-lg font-bold text-[var(--color-foreground)]">{message.author.name}</p>
              <span className="text-[15px] text-[var(--color-muted-foreground)]">
                {timeAgo(message.createdAt)}
                {message.editedAt && " · edited"}
              </span>
              <span className="inline-flex h-[30px] items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-secondary)] px-3 text-sm font-semibold text-[var(--color-secondary-foreground)]">
                <Icon className="h-4 w-4" />
                {meta.label}
                {message.shiftPhase && ` · ${message.shiftPhase}`}
              </span>
              {ticketish && (
                <span
                  className={cn(
                    "inline-flex h-[30px] items-center rounded-full px-3 text-xs font-bold uppercase",
                    message.status === "open"
                      ? "bg-[var(--color-destructive)] text-[var(--color-destructive-foreground)]"
                      : "bg-[var(--color-secondary)] text-[var(--color-secondary-foreground)]"
                  )}
                >
                  {message.status}
                </span>
              )}
              {message.postedForDate && (
                <span className="text-sm text-[var(--color-muted-foreground)]">
                  → {message.postedToTemplate?.name ?? "Everyone"} ({message.postedForDate})
                </span>
              )}
              {/* Handoff lifecycle: acknowledged beats expired; an active note shows neither. */}
              {message.postedForDate && message.acknowledgedAt && (
                <span
                  className="inline-flex h-[30px] items-center gap-1 rounded-full bg-[var(--color-secondary)] px-3 text-xs font-bold uppercase text-[var(--color-secondary-foreground)]"
                  title={message.acknowledgedBy ? `Acknowledged by ${message.acknowledgedBy}` : undefined}
                >
                  <Check className="h-3.5 w-3.5" />
                  Acknowledged{message.acknowledgedBy ? ` · ${message.acknowledgedBy}` : ""}
                </span>
              )}
              {message.postedForDate && !message.acknowledgedAt && message.expiresAt && new Date(message.expiresAt) <= new Date() && (
                <span className="inline-flex h-[30px] items-center rounded-full border border-[var(--color-border)] px-3 text-xs font-bold uppercase text-[var(--color-muted-foreground)]">
                  Expired
                </span>
              )}
            </div>

            {/* Actions — exactly desktop's, at 44px. */}
            <div className="flex shrink-0 items-center gap-1">
              {isManager && ticketish && (
                <Button
                  variant="outline"
                  className="h-11 rounded-full px-4 text-[15px] font-semibold"
                  onClick={() => setStatus(message.status === "open" ? "resolved" : "open")}
                >
                  {message.status === "open" ? "Resolve" : "Reopen"}
                </Button>
              )}
              {canEdit && !editing && (
                <button
                  type="button"
                  aria-label="Edit (15-minute window)"
                  className="flex h-11 w-11 items-center justify-center rounded-full text-[var(--color-muted-foreground)] active:bg-[var(--color-accent)]"
                  onClick={() => {
                    setDraft(message.body)
                    setEditing(true)
                  }}
                >
                  <Pencil className="h-5 w-5" />
                </button>
              )}
              {canDelete && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <button
                      type="button"
                      aria-label="Delete"
                      className="flex h-11 w-11 items-center justify-center rounded-full text-[var(--color-muted-foreground)] active:bg-[var(--color-accent)]"
                    >
                      <Trash2 className="h-5 w-5" />
                    </button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete this message?</AlertDialogTitle>
                      <AlertDialogDescription>It will be removed from the feed for everyone.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel className="h-12 px-6 text-base">Cancel</AlertDialogCancel>
                      <AlertDialogAction className="h-12 px-6 text-base" onClick={deleteMessage}>
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          </div>

          {editing ? (
            <div className="mt-2 space-y-2">
              <textarea
                rows={3}
                maxLength={2000}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="block w-full resize-none rounded-2xl border border-[var(--color-border)] bg-[var(--color-background)] px-4 py-3 text-lg leading-[1.4] text-[var(--color-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/40"
              />
              <div className="flex gap-2">
                <Button className="h-12 rounded-full px-6 text-base font-semibold" onClick={saveEdit} disabled={!draft.trim()}>
                  Save
                </Button>
                <Button variant="outline" className="h-12 rounded-full px-6 text-base font-semibold" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <p className="mt-1 text-lg leading-[1.4] whitespace-pre-wrap break-words text-[var(--color-foreground)]">{message.body}</p>
          )}

          {message.linkedIngredient && (
            <span className="mt-2 inline-flex h-[30px] items-center gap-1.5 rounded-full border border-[var(--color-border)] px-3 text-sm font-semibold">
              <PackageX className="h-4 w-4" />
              {message.linkedIngredient.name}
            </span>
          )}

          <MessageAttachments attachments={message.attachments} />

          {/* Reactions — desktop's six and desktop's states, at fingertip size. */}
          <div className="mt-3 flex flex-wrap gap-2">
            {EMOJI.map((emoji) => {
              const r = message.reactions.find((x) => x.emoji === emoji)
              return (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => toggle(emoji)}
                  aria-label={r?.reactedByMe ? `Remove ${emoji} reaction` : `React ${emoji}`}
                  aria-pressed={r?.reactedByMe ?? false}
                  className={cn(
                    "inline-flex h-11 min-w-14 items-center justify-center gap-1.5 rounded-full border px-3 transition-colors",
                    r?.reactedByMe
                      ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
                      : r
                        ? "border-[var(--color-border)] bg-[var(--color-muted)] text-[var(--color-foreground)]"
                        : "border-[var(--color-border)] bg-[var(--color-card)] active:bg-[var(--color-accent)]"
                  )}
                >
                  <span className="text-[22px] leading-none">{emoji}</span>
                  {r && <span className="text-base font-bold">{r.count}</span>}
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </article>
  )
}

// ─── Composer ─────────────────────────────────────────────────────────────────
// Desktop's Composer (useComposer + useAttachmentPicker), laid out as the
// canvas's two rows. The attachment labels drop to icons when the pane is
// too narrow to hold the row on one line (1024px landscape, iPad mini).

function TabletComposer({
  storeId,
  inventoryActive,
  onPosted,
}: {
  storeId: string
  inventoryActive: boolean
  onPosted: (m: FeedMessage) => void
}) {
  const c = useComposer({ storeId, inventoryActive, onPosted })
  const picker = useAttachmentPicker({
    attachments: c.attachments,
    setAttachments: c.setAttachments,
    setUploading: c.setUploading,
    onError: c.setError,
  })
  const boxRef = useRef<HTMLTextAreaElement>(null)

  // The message box grows with its text, to about four lines, then scrolls.
  useLayoutEffect(() => {
    const el = boxRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight + 2, 130)}px`
  }, [c.body])

  const pill =
    "inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-card)] px-4 text-base font-semibold text-[var(--color-foreground)] active:bg-[var(--color-accent)] disabled:opacity-50"

  return (
    <div
      data-testid="tablet-composer"
      className="@container shrink-0 space-y-3 border-t border-[var(--color-border)] bg-[var(--color-card)] px-6 pt-3 pb-4 shadow-[0_-8px_20px_-12px_rgb(0_0_0/0.18)]"
    >
      {picker.inputs}

      {c.type === "shift_note" && (
        <Select value={c.shiftPhase} onValueChange={c.setShiftPhase}>
          <SelectTrigger aria-label="Shift" className="h-12 w-52 rounded-full bg-[var(--color-card)] px-5 text-base font-semibold">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="opening" className="min-h-12 text-base">Opening</SelectItem>
            <SelectItem value="mid" className="min-h-12 text-base">Mid-shift</SelectItem>
            <SelectItem value="closing" className="min-h-12 text-base">Closing</SelectItem>
          </SelectContent>
        </Select>
      )}

      {c.type === "shortage" && inventoryActive && (
        <div>
          {c.linkedIngredient ? (
            <span className="inline-flex h-12 items-center gap-2 rounded-full bg-[var(--color-secondary)] pr-1 pl-4 text-base font-semibold">
              <PackageX className="h-[18px] w-[18px]" />
              {c.linkedIngredient.name}
              <button
                type="button"
                aria-label="Remove ingredient"
                onClick={() => c.setLinkedIngredient(null)}
                className="flex h-11 w-11 items-center justify-center rounded-full active:bg-[var(--color-accent)]"
              >
                <X className="h-5 w-5" />
              </button>
            </span>
          ) : (
            <div className="relative">
              <Input
                placeholder="Link an ingredient (optional) — start typing…"
                value={c.ingredientQuery}
                onChange={(e) => c.setIngredientQuery(e.target.value)}
                className="h-12 rounded-full px-5 text-lg"
              />
              {c.ingredientMatches.length > 0 && (
                <div className="absolute bottom-full z-10 mb-1 w-full overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] shadow-md">
                  {c.ingredientMatches.map((i) => (
                    <button
                      key={i.id}
                      type="button"
                      className="block min-h-12 w-full px-5 text-left text-base active:bg-[var(--color-accent)]"
                      onClick={() => {
                        c.setLinkedIngredient(i)
                        c.setIngredientQuery("")
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

      {c.attachments.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {c.attachments.map((a, idx) => (
            <span
              key={idx}
              className="inline-flex h-12 max-w-72 items-center gap-2 rounded-full bg-[var(--color-secondary)] pr-1 pl-4 text-[15px] font-semibold"
            >
              {a.kind === "image" ? (
                <Camera className="h-[18px] w-[18px] shrink-0" />
              ) : a.kind === "youtube" ? (
                <CirclePlay className="h-[18px] w-[18px] shrink-0" />
              ) : (
                <Paperclip className="h-[18px] w-[18px] shrink-0" />
              )}
              <span className="truncate">{a.filename ?? (a.kind === "youtube" ? "YouTube video" : a.url)}</span>
              <button
                type="button"
                aria-label="Remove attachment"
                onClick={() => picker.removeAttachment(idx)}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full active:bg-[var(--color-accent)]"
              >
                <X className="h-5 w-5" />
              </button>
            </span>
          ))}
        </div>
      )}

      {picker.youtubeOpen && (
        <div className="flex gap-2">
          <Input
            placeholder="Paste a YouTube link"
            value={picker.youtubeUrl}
            onChange={(e) => picker.setYoutubeUrl(e.target.value)}
            className="h-12 rounded-full px-5 text-lg"
          />
          <Button
            variant="outline"
            className="h-12 rounded-full px-6 text-base font-semibold"
            onClick={picker.addYoutube}
            disabled={!picker.youtubeUrl.trim()}
          >
            Add
          </Button>
        </div>
      )}

      {c.uploading && <p className="text-[15px] text-[var(--color-muted-foreground)]">Uploading…</p>}

      {/* Row 1 — the message box */}
      <textarea
        ref={boxRef}
        data-testid="tablet-message-box"
        rows={1}
        maxLength={2000}
        value={c.body}
        onChange={(e) => c.setBody(e.target.value)}
        placeholder={c.placeholder}
        aria-label="Message"
        className="block max-h-[130px] min-h-[52px] w-full resize-none overflow-y-auto rounded-[26px] border border-[var(--color-border)] bg-[var(--color-background)] px-5 py-[12px] text-lg leading-[1.4] text-[var(--color-foreground)] placeholder:text-[var(--color-muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/40"
      />

      {/* Row 2 — type, attachments, Post */}
      <div className="flex items-center gap-2">
        <MessageTypePicker variant="feed" type={c.type} onPick={c.setType} />

        <button type="button" aria-label="Photo" className={pill} onClick={picker.openPhoto} disabled={c.uploading}>
          <Camera className="h-[18px] w-[18px]" />
          <span className="hidden @min-[660px]:inline">Photo</span>
        </button>
        <button type="button" aria-label="File" className={pill} onClick={picker.openFile} disabled={c.uploading}>
          <Paperclip className="h-[18px] w-[18px]" />
          <span className="hidden @min-[660px]:inline">File</span>
        </button>
        <button
          type="button"
          aria-label="Video"
          aria-pressed={picker.youtubeOpen}
          className={pill}
          onClick={() => picker.setYoutubeOpen((o) => !o)}
        >
          <CirclePlay className="h-[18px] w-[18px]" />
          <span className="hidden @min-[660px]:inline">Video</span>
        </button>

        <span className="flex-1" />

        <Button
          data-testid="tablet-post"
          onClick={c.post}
          disabled={!c.canPost}
          className="h-12 shrink-0 rounded-full px-7 text-[19px] font-bold"
        >
          {c.posting ? "Posting…" : "Post"}
        </Button>
      </div>

      {c.error && (
        <p role="alert" className="text-base font-medium text-[var(--color-destructive)]">
          {c.error}
        </p>
      )}
    </div>
  )
}
