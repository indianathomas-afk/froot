"use client"

import { Info } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

// L-3 shared explainer for the floor-first / sales-weighted daily split. Used in
// TWO places with identical copy: (1) next to the setting toggle in
// /settings/labor, and (2) next to the Coverage-card floor warning. Keep it a
// single source so the two never drift.
export const SPLIT_POLICY_EXPLAINER =
  "A slow day is open the same hours as a busy one, so it needs the same minimum staffing to keep one person on the floor — even though sales are lower. Floor-first guarantees those hours; sales-split warns so you can rebalance."

export function SplitPolicyInfo({ className }: { className?: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="About the daily split policy"
          className={className ?? "inline-flex items-center text-[var(--color-muted-foreground)] hover:text-[var(--color-primary)]"}
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 text-[12.5px] leading-relaxed text-[var(--color-foreground)]">
        {SPLIT_POLICY_EXPLAINER}
      </PopoverContent>
    </Popover>
  )
}
