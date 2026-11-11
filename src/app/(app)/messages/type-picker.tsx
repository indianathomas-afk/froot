"use client"

import { useCallback, useLayoutEffect, useState, type RefObject } from "react"
import { Check, ChevronDown, ChevronUp } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { TYPE_META } from "./messages-client"

// TAB-12, 2026-11-11 — the message-type picker, shared by the two Tablet-mode
// composers: Team Messages (TAB-11's Type button, variant "feed") and the
// tablet home's Messages column (the type tag inside the box, variant
// "home"). TAB-11's button and popover moved here unchanged — same classes,
// same 52px rows, same General-first order (TAB-11 R3) and TYPE_META icons
// (TAB-11 R6). Gary's rulings R1–R6, DECISIONS 2026-11-11 TAB-12.
//
// The home variant differs only where TAB-12 says it does:
//   - the trigger is a 44px tag (icon 18px, label 15px/650, chevron 15px)
//     that tints while open or while the type isn't General;
//   - the panel spans the Messages column (8px in from each edge), opens
//     upward, never flips under the keyboard, and caps its height at the
//     visible space above the tag (the panel scrolls only if that is short);
//   - 48px rows, one column if the panel is too narrow for two;
//   - R6: Shift Note is a full-width row of three 44px phase buttons
//     (Opening / Mid / Closing) — one tap sets the type AND the phase, so a
//     shift note never posts without one (the API refuses it without).
//   - Focus stays in the message box (mousedown default prevented, no
//     auto-focus into the panel), so the iPad keyboard stays up.

/** TAB-11 R3 — General first, then desktop's order for the rest. */
export const TABLET_TYPE_ORDER = ["general", "shift_note", "shortage", "equipment", "customer_feedback", "staffing", "shoutout"]

/** TAB-12 R6 — the home picker's shift phases, in shift order. */
export const HOME_SHIFT_PHASES = [
  { value: "opening", label: "Opening" },
  { value: "mid", label: "Mid" },
  { value: "closing", label: "Closing" },
] as const

/** The home tag's label: "Shift Note · Mid", or the type's own label. */
export function typeTagLabel(type: string, shiftPhase: string | null): string {
  const label = (TYPE_META[type] ?? TYPE_META.general).label
  if (type !== "shift_note") return label
  const phase = HOME_SHIFT_PHASES.find((p) => p.value === shiftPhase)
  return phase ? `${label} · ${phase.label}` : label
}

const keepFocus = (e: React.MouseEvent) => e.preventDefault()

export function MessageTypePicker(
  props:
    | { variant: "feed"; type: string; onPick: (type: string) => void }
    | {
        variant: "home"
        type: string
        shiftPhase: string | null
        onPick: (type: string, shiftPhase: string | null) => void
        /** The Messages column — the panel's width and left edge come from it. */
        boundaryRef: RefObject<HTMLElement | null>
        /** useKeyboardInset()'s value; a change re-measures the open panel. */
        keyboardInset: number
      }
) {
  const [open, setOpen] = useState(false)
  if (props.variant === "feed") return <FeedPicker {...props} open={open} setOpen={setOpen} />
  return <HomePicker {...props} open={open} setOpen={setOpen} />
}

// ─── Team Messages (TAB-11, unchanged) ────────────────────────────────────────

function FeedPicker({
  type,
  onPick,
  open,
  setOpen,
}: {
  type: string
  onPick: (type: string) => void
  open: boolean
  setOpen: (open: boolean) => void
}) {
  const meta = TYPE_META[type] ?? TYPE_META.general
  const TypeIcon = meta.icon
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="tablet-type-button"
          className="inline-flex h-12 shrink-0 items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-secondary)] px-4 data-[state=open]:border-[var(--color-primary)]"
        >
          <span className="text-[15px] text-[var(--color-muted-foreground)]">Type</span>
          <TypeIcon className="h-[18px] w-[18px] text-[var(--color-foreground)]" />
          <span className="text-base font-bold text-[var(--color-foreground)]">{meta.label}</span>
          {open ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" sideOffset={8} className="w-[440px] max-w-[calc(100vw-7rem)] rounded-2xl p-4">
        <p className="mb-3 text-[15px] font-semibold text-[var(--color-muted-foreground)]">Message type</p>
        <div className="grid grid-cols-2 gap-2">
          {TABLET_TYPE_ORDER.map((t) => {
            const m = TYPE_META[t]
            const active = type === t
            return (
              <button
                key={t}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  onPick(t)
                  setOpen(false)
                }}
                className={cn(
                  "flex h-[52px] items-center gap-3 rounded-xl border px-4 text-[17px] font-semibold transition-colors",
                  active
                    ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
                    : "border-[var(--color-border)] text-[var(--color-foreground)] active:bg-[var(--color-accent)]"
                )}
              >
                <m.icon className="h-5 w-5 shrink-0" />
                <span className="flex-1 text-left">{m.label}</span>
                {active && <Check className="h-5 w-5 shrink-0" />}
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}

// ─── Tablet home (TAB-12) ─────────────────────────────────────────────────────

const ACTIVE = "border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
const IDLE = "border-[var(--color-border)] text-[var(--color-foreground)] active:bg-[var(--color-accent)]"

function HomePicker({
  type,
  shiftPhase,
  onPick,
  boundaryRef,
  keyboardInset,
  open,
  setOpen,
}: {
  type: string
  shiftPhase: string | null
  onPick: (type: string, shiftPhase: string | null) => void
  boundaryRef: RefObject<HTMLElement | null>
  keyboardInset: number
  open: boolean
  setOpen: (open: boolean) => void
}) {
  const meta = TYPE_META[type] ?? TYPE_META.general
  const TypeIcon = meta.icon
  const tinted = open || type !== "general"

  // Where the panel goes: the column's width less 8px a side, its left edge
  // 8px in from the column's, its height no more than the space between the
  // top of what is visible (visualViewport — the keyboard may have scrolled
  // the page) and the tag.
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null)
  const [box, setBox] = useState<{ width: number; alignOffset: number; maxHeight: number } | null>(null)
  const measure = useCallback(() => {
    const col = boundaryRef.current?.getBoundingClientRect()
    const tag = trigger?.getBoundingClientRect()
    if (!col || !tag) return
    const visibleTop = window.visualViewport?.offsetTop ?? 0
    setBox({
      width: Math.round(col.width - 16),
      alignOffset: Math.round(col.left + 8 - tag.left),
      maxHeight: Math.max(160, Math.floor(tag.top - visibleTop - 8 - 8)),
    })
  }, [boundaryRef, trigger])
  useLayoutEffect(() => {
    if (!open) return
    measure()
    window.addEventListener("resize", measure)
    return () => window.removeEventListener("resize", measure)
  }, [open, measure, keyboardInset])

  function pick(t: string, phase: string | null) {
    onPick(t, phase)
    setOpen(false)
  }

  const others = TABLET_TYPE_ORDER.filter((t) => t !== "shift_note")
  const ShiftIcon = TYPE_META.shift_note.icon
  const shiftActive = type === "shift_note"

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          ref={setTrigger}
          type="button"
          data-testid="home-type-tag"
          aria-label={`Message type: ${typeTagLabel(type, shiftPhase)}`}
          onMouseDown={keepFocus}
          className={cn(
            "inline-flex h-11 max-w-full shrink-0 items-center gap-1 rounded-full border pr-1.5 pl-2 text-[var(--color-foreground)]",
            tinted
              ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10"
              : "border-[var(--color-border)] bg-[var(--color-secondary)]"
          )}
        >
          <TypeIcon className="h-[18px] w-[18px] shrink-0" />
          <span className="truncate text-[15px] font-[650]">{typeTagLabel(type, shiftPhase)}</span>
          {open ? <ChevronUp className="h-[15px] w-[15px] shrink-0" /> : <ChevronDown className="h-[15px] w-[15px] shrink-0" />}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        avoidCollisions={false}
        alignOffset={box?.alignOffset ?? 0}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        data-testid="home-type-picker"
        style={box ? { width: box.width, maxHeight: box.maxHeight } : { visibility: "hidden" }}
        className="@container overflow-y-auto rounded-2xl p-3"
      >
        <p className="mb-2 text-[15px] font-semibold text-[var(--color-muted-foreground)]">Message type</p>
        <div className="grid grid-cols-1 gap-2 @min-[300px]:grid-cols-2">
          {others.map((t) => {
            const m = TYPE_META[t]
            const active = type === t
            return (
              <button
                key={t}
                type="button"
                aria-pressed={active}
                onMouseDown={keepFocus}
                onClick={() => pick(t, null)}
                className={cn(
                  "flex h-12 min-w-0 items-center gap-2.5 rounded-xl border px-3 text-base font-semibold transition-colors",
                  active ? ACTIVE : IDLE
                )}
              >
                <m.icon className="h-5 w-5 shrink-0" />
                <span className="min-w-0 flex-1 truncate text-left">{m.label}</span>
                {active && <Check className="h-[18px] w-[18px] shrink-0" />}
              </button>
            )
          })}
          {/* R6 — Shift Note: one tap on a phase sets type + phase. Last, so
              it sits nearest the tag; the six others keep General-first order. */}
          <div
            role="group"
            aria-label="Shift Note"
            data-testid="home-shift-note-row"
            className={cn(
              "flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-xl border py-[1px] pr-[1px] pl-3 @min-[300px]:col-span-2",
              shiftActive ? "border-[var(--color-primary)] bg-[var(--color-primary)]/10" : "border-[var(--color-border)]"
            )}
          >
            <span
              className={cn(
                "flex h-11 shrink-0 items-center gap-2.5 text-base font-semibold",
                shiftActive ? "text-[var(--color-primary)]" : "text-[var(--color-foreground)]"
              )}
            >
              <ShiftIcon className="h-5 w-5 shrink-0" />
              Shift Note
            </span>
            <span className="flex min-w-[204px] flex-1 gap-1.5">
              {HOME_SHIFT_PHASES.map((p) => {
                const active = shiftActive && shiftPhase === p.value
                return (
                  <button
                    key={p.value}
                    type="button"
                    aria-pressed={active}
                    aria-label={`Shift Note · ${p.label}`}
                    onMouseDown={keepFocus}
                    onClick={() => pick("shift_note", p.value)}
                    className={cn(
                      "flex h-11 min-w-11 flex-1 items-center justify-center gap-1 rounded-lg border px-2 text-[15px] font-semibold transition-colors",
                      active
                        ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-white"
                        : "border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-foreground)] active:bg-[var(--color-accent)]"
                    )}
                  >
                    {active && <Check className="h-4 w-4 shrink-0" />}
                    {p.label}
                  </button>
                )
              })}
            </span>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
