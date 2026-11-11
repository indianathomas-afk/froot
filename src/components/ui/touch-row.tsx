"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

// TAB-1 — a whole-row tap target for checklist items on the tablet shell.
// The same cva pattern as Button: the row is the button, so the hit area is the
// full width and 64–76px tall rather than a 24px circle at the far edge.
const touchRowVariants = cva(
  "flex w-full items-center gap-4 px-5 text-left text-lg transition-colors disabled:pointer-events-none disabled:opacity-50 border-b border-[var(--color-border)] last:border-b-0",
  {
    variants: {
      size: {
        default: "min-h-16 py-3",
        roomy: "min-h-[76px] py-4",
      },
      state: {
        open: "bg-[var(--color-card)] text-[var(--color-foreground)] active:bg-[var(--color-accent)]",
        done: "bg-[var(--color-card)] text-[var(--color-muted-foreground)] line-through active:bg-[var(--color-accent)]",
        busy: "bg-[var(--color-accent)] text-[var(--color-foreground)]",
      },
    },
    defaultVariants: { size: "default", state: "open" },
  }
)

export interface TouchRowProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof touchRowVariants> {}

const TouchRow = React.forwardRef<HTMLButtonElement, TouchRowProps>(
  ({ className, size, state, type = "button", ...props }, ref) => (
    <button ref={ref} type={type} className={cn(touchRowVariants({ size, state, className }))} {...props} />
  )
)
TouchRow.displayName = "TouchRow"

/** The tick circle at the end of a TouchRow. Decorative — the row is the control. */
function TouchCheck({ checked, className }: { checked: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "ml-auto flex size-9 shrink-0 items-center justify-center rounded-full border-2",
        checked
          ? "border-[var(--color-primary)] bg-[var(--color-primary)] text-[var(--color-primary-foreground)]"
          : "border-[var(--color-muted-foreground)]",
        className
      )}
    >
      {checked && (
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={3}>
          <path d="M5 12l5 5L20 7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </span>
  )
}

export { TouchRow, TouchCheck, touchRowVariants }
