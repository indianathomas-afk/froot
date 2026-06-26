import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-[var(--color-primary)] text-[var(--color-primary-foreground)]",
        secondary: "border-transparent bg-[var(--color-secondary)] text-[var(--color-secondary-foreground)]",
        destructive: "border-transparent bg-[var(--color-destructive)] text-[var(--color-destructive-foreground)]",
        outline: "text-[var(--color-foreground)]",
        success: "border-transparent bg-[var(--color-success-bg)] text-[var(--color-success-text)] border-[var(--color-success-border)]",
        warning: "border-transparent bg-[var(--color-warning-bg)] text-[var(--color-warning-text)] border-[var(--color-warning-border)]",
        info: "border-transparent bg-[var(--color-info-bg)] text-[var(--color-info-text)] border-[var(--color-info-border)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
