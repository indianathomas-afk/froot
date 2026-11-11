"use client"

import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-[var(--color-primary)] text-[var(--color-primary-foreground)] hover:opacity-90",
        destructive: "bg-[var(--color-destructive)] text-[var(--color-destructive-foreground)] hover:opacity-90",
        outline: "border border-[var(--color-border)] bg-transparent hover:bg-[var(--color-accent)]",
        secondary: "bg-[var(--color-secondary)] text-[var(--color-secondary-foreground)] hover:opacity-80",
        ghost: "hover:bg-[var(--color-accent)] hover:text-[var(--color-accent-foreground)]",
        link: "text-[var(--color-primary)] underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-8",
        icon: "h-9 w-9",
        // TAB-1 — touch sizes for the tablet shell, read from arm's length on a
        // counter iPad. `touch` is the floor for any tablet control (56px,
        // 18px text); `touch-lg` is the hero Start button from the design
        // (~96px). The colours still come from `variant`, so the large
        // controls are the library's, not a hand-built copy of it.
        touch: "h-14 min-w-14 rounded-xl px-6 text-lg font-semibold [&_svg]:size-6",
        "touch-lg": "h-24 w-full rounded-2xl px-8 text-3xl font-bold [&_svg]:size-8",
        "touch-icon": "h-14 w-14 rounded-xl [&_svg]:size-6",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
