"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { ChevronDown, ChevronUp, GripVertical, Lock } from "lucide-react"
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core"
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
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
import { ANCHOR_REQUIRED_ERROR, cardDef, defaultLayout, hasAnchorOn, type LayoutEntry, type Surface } from "@/lib/display-layout"

// TAB-3 — the two tabs of /settings/display. Each tab edits a DRAFT of its
// layout and saves the whole list in one PUT (the route requires the full
// list, every key once — audit F5). Reordering is touch-size up/down arrows on
// every row (ruling 6) plus dnd-kit drag handles, because the repo already
// ships dnd-kit (templates/template-form.tsx is the pattern copied).
// "Reset to defaults" asks first (AlertDialog, § Design System) and stores
// NULL, so the org follows Froot's defaults from then on.

export function DisplaySettingsClient({
  dashboard,
  tablet,
  dashboardIsDefault,
  tabletIsDefault,
}: {
  dashboard: LayoutEntry[]
  tablet: LayoutEntry[]
  dashboardIsDefault: boolean
  tabletIsDefault: boolean
}) {
  return (
    <Tabs defaultValue="dashboard">
      <TabsList className="mb-4">
        <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
        <TabsTrigger value="tablet">Tablet</TabsTrigger>
      </TabsList>
      <TabsContent value="dashboard">
        <LayoutEditor surface="dashboard" saved={dashboard} isDefault={dashboardIsDefault} />
      </TabsContent>
      <TabsContent value="tablet">
        <LayoutEditor surface="tablet" saved={tablet} isDefault={tabletIsDefault} />
      </TabsContent>
    </Tabs>
  )
}

function LayoutEditor({ surface, saved, isDefault }: { surface: Surface; saved: LayoutEntry[]; isDefault: boolean }) {
  const router = useRouter()
  const [draft, setDraft] = useState<LayoutEntry[]>(saved)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null)

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved)
  const locked = draft.filter((e) => cardDef(surface, e.key)?.locked)
  const movable = draft.filter((e) => !cardDef(surface, e.key)?.locked)
  // Mirrors the route's rule — F6 as refined by Gary: at least one card that
  // is never module-gated stays on — so the page refuses before the server
  // has to (staging test 3). The route still refuses on its own.
  const noneOn = surface === "dashboard" && !hasAnchorOn(draft)

  // template-form's sensor: PointerSensor covers touch too (pointer events),
  // provided the handle sets touch-action: none; distance 8 keeps a tap on
  // the handle from starting a drag.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  function setMovable(next: LayoutEntry[]) {
    setDraft([...locked, ...next])
    setMessage(null)
  }

  function move(key: string, delta: -1 | 1) {
    const i = movable.findIndex((e) => e.key === key)
    const j = i + delta
    if (i < 0 || j < 0 || j >= movable.length) return
    setMovable(arrayMove(movable, i, j))
  }

  function toggle(key: string, enabled: boolean) {
    setMovable(movable.map((e) => (e.key === key ? { ...e, enabled } : e)))
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const from = movable.findIndex((e) => e.key === active.id)
    const to = movable.findIndex((e) => e.key === over.id)
    if (from < 0 || to < 0) return
    setMovable(arrayMove(movable, from, to))
  }

  async function put(layout: LayoutEntry[] | null): Promise<boolean> {
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch("/api/display/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ surface, layout }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setMessage({ kind: "error", text: body?.error ?? `Couldn't save (HTTP ${res.status}).` })
        return false
      }
      return true
    } catch {
      setMessage({ kind: "error", text: "Couldn't save — check your connection and try again." })
      return false
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    if (await put(draft)) {
      setMessage({ kind: "ok", text: "Saved." })
      router.refresh()
    }
  }

  async function reset() {
    if (await put(null)) {
      setDraft(defaultLayout(surface))
      setMessage({ kind: "ok", text: "Back to Froot's defaults." })
      router.refresh()
    }
  }

  const ids = movable.map((e) => e.key)

  return (
    <Card>
      <CardContent className="pt-5 space-y-5">
        {surface === "tablet" && (
          <section>
            <p className="text-[11px] font-semibold tracking-wide text-[var(--color-muted-foreground)] uppercase mb-2">
              Always on in Tablet mode
            </p>
            <div className="rounded-lg border border-[var(--color-border)] divide-y divide-[var(--color-border)]">
              {locked.map((e) => (
                <LockedRow key={e.key} surface={surface} entry={e} />
              ))}
            </div>
          </section>
        )}

        <section>
          <p className="text-[11px] font-semibold tracking-wide text-[var(--color-muted-foreground)] uppercase mb-2">
            {surface === "dashboard" ? "Desktop dashboard · top to bottom" : "Stat strip below the columns · left to right"}
          </p>
          {surface === "tablet" && (
            <p className="text-sm text-[var(--color-muted-foreground)] mb-2">
              The strip shows only when at least one tile is on.
            </p>
          )}
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={ids} strategy={verticalListSortingStrategy}>
              <div className="rounded-lg border border-[var(--color-border)] divide-y divide-[var(--color-border)]">
                {movable.map((e, i) => (
                  <SortableRow
                    key={e.key}
                    surface={surface}
                    entry={e}
                    first={i === 0}
                    last={i === movable.length - 1}
                    disabled={busy}
                    onMove={move}
                    onToggle={toggle}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </section>

        {noneOn && (
          <p className="text-sm font-medium text-[var(--color-destructive)]">{ANCHOR_REQUIRED_ERROR}</p>
        )}
        {message && (
          <p
            className={`text-sm ${message.kind === "error" ? "text-[var(--color-destructive)]" : "text-[var(--color-muted-foreground)]"}`}
            role={message.kind === "error" ? "alert" : "status"}
          >
            {message.text}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3 border-t border-[var(--color-border)] pt-4">
          <Button className="min-h-11" onClick={save} disabled={busy || !dirty || noneOn}>
            {busy ? "Saving…" : "Save"}
          </Button>
          {dirty && (
            <Button
              variant="outline"
              className="min-h-11"
              disabled={busy}
              onClick={() => {
                setDraft(saved)
                setMessage(null)
              }}
            >
              Discard changes
            </Button>
          )}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" className="min-h-11 ml-auto" disabled={busy}>
                Reset to defaults
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Reset the {surface === "dashboard" ? "Dashboard" : "Tablet"} layout?</AlertDialogTitle>
                <AlertDialogDescription>
                  {surface === "dashboard"
                    ? "Every desktop card comes back on, in Froot's default order, for everyone in your organization."
                    : "The stat strip's tiles all go off and return to Froot's default order, for everyone in your organization."}{" "}
                  Unsaved changes on this tab are discarded.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={reset}>Reset to defaults</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
        {isDefault && !dirty && (
          <p className="text-xs text-[var(--color-muted-foreground)]">Using Froot&apos;s defaults.</p>
        )}
      </CardContent>
    </Card>
  )
}

function RowText({ surface, entry }: { surface: Surface; entry: LayoutEntry }) {
  const def = cardDef(surface, entry.key)
  return (
    <div className="min-w-0 flex-1">
      <p className="text-[15px] font-semibold text-[var(--color-foreground)]">{def?.label ?? entry.key}</p>
      <p className="text-sm text-[var(--color-muted-foreground)]">{def?.description}</p>
      {def?.note && <p className="text-xs text-[var(--color-muted-foreground)]/80 mt-0.5">{def.note}</p>}
    </div>
  )
}

function LockedRow({ surface, entry }: { surface: Surface; entry: LayoutEntry }) {
  return (
    <div className="flex items-center gap-3 px-3 py-3 min-h-16 bg-[var(--color-muted)]/40">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center text-[var(--color-muted-foreground)]">
        <Lock className="h-4 w-4" />
      </span>
      <RowText surface={surface} entry={entry} />
      <span className="text-sm font-medium text-[var(--color-muted-foreground)] whitespace-nowrap">Locked on</span>
    </div>
  )
}

function SortableRow({
  surface,
  entry,
  first,
  last,
  disabled,
  onMove,
  onToggle,
}: {
  surface: Surface
  entry: LayoutEntry
  first: boolean
  last: boolean
  disabled: boolean
  onMove: (key: string, delta: -1 | 1) => void
  onToggle: (key: string, enabled: boolean) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: entry.key })
  const label = cardDef(surface, entry.key)?.label ?? entry.key
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : 1,
        position: "relative",
        zIndex: isDragging ? 10 : undefined,
      }}
      className="flex items-center gap-2 px-2 py-2 min-h-16 bg-[var(--color-card)]"
    >
      {/* touchAction none: without it iPad Safari scrolls instead of dragging. */}
      <button
        type="button"
        {...listeners}
        {...attributes}
        aria-label={`Drag to reorder ${label}`}
        className={`flex h-11 w-9 shrink-0 items-center justify-center rounded text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] ${isDragging ? "cursor-grabbing" : "cursor-grab"}`}
        style={{ touchAction: "none" }}
      >
        <GripVertical className="h-5 w-5" />
      </button>
      <div className={`min-w-0 flex-1 flex ${entry.enabled ? "" : "opacity-60"}`}>
        <RowText surface={surface} entry={entry} />
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={() => onMove(entry.key, -1)}
          disabled={disabled || first}
          aria-label={`Move ${label} up`}
          className="flex h-11 w-11 items-center justify-center rounded-md border border-[var(--color-border)] text-[var(--color-foreground)] hover:bg-[var(--color-accent)] disabled:opacity-30"
        >
          <ChevronUp className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={() => onMove(entry.key, 1)}
          disabled={disabled || last}
          aria-label={`Move ${label} down`}
          className="flex h-11 w-11 items-center justify-center rounded-md border border-[var(--color-border)] text-[var(--color-foreground)] hover:bg-[var(--color-accent)] disabled:opacity-30"
        >
          <ChevronDown className="h-5 w-5" />
        </button>
        {/* The Switch's own 36×20 control sits inside a 44px label tap target. */}
        <label className="flex h-11 min-w-14 cursor-pointer items-center justify-center pl-1">
          <Switch
            checked={entry.enabled}
            disabled={disabled}
            onCheckedChange={(v) => onToggle(entry.key, v)}
            aria-label={`Show ${label}`}
          />
        </label>
      </div>
    </div>
  )
}
