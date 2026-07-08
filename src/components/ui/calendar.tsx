"use client"

import * as React from "react"
import { DayPicker } from "react-day-picker"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

// shadcn-style wrapper around react-day-picker v10, styled with the project's
// design tokens. Supports single and range selection modes.

export type CalendarProps = React.ComponentProps<typeof DayPicker>

function Calendar({ className, classNames, showOutsideDays = true, ...props }: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("relative p-2", className)}
      classNames={{
        months: "flex flex-col sm:flex-row gap-2",
        month: "flex flex-col gap-2",
        month_caption: "flex justify-center items-center h-8",
        caption_label: "text-sm font-semibold text-[var(--color-foreground)]",
        nav: "absolute inset-x-2 top-2 flex justify-between items-center h-8 z-10 pointer-events-none",
        button_previous:
          "pointer-events-auto h-7 w-7 rounded-md border border-[var(--color-border)] flex items-center justify-center text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] disabled:opacity-40 disabled:pointer-events-none",
        button_next:
          "pointer-events-auto h-7 w-7 rounded-md border border-[var(--color-border)] flex items-center justify-center text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] disabled:opacity-40 disabled:pointer-events-none",
        chevron: "h-4 w-4",
        month_grid: "w-full border-collapse",
        weekdays: "flex",
        weekday: "w-8 h-8 flex items-center justify-center text-[11px] font-semibold text-[var(--color-muted-foreground)]",
        week: "flex w-full",
        day: "p-0",
        day_button:
          "h-8 w-8 flex items-center justify-center text-[13px] rounded-md hover:bg-[var(--color-accent)] aria-selected:hover:bg-transparent cursor-pointer",
        selected: "bg-[var(--color-primary)] text-white rounded-md",
        range_start: "bg-[var(--color-primary)] text-white rounded-md rounded-r-none",
        range_end: "bg-[var(--color-primary)] text-white rounded-md rounded-l-none",
        range_middle: "!bg-[var(--color-primary)]/15 !text-[var(--color-foreground)] rounded-none",
        today: "font-bold",
        outside: "text-[var(--color-muted-foreground)]/50",
        disabled: "text-[var(--color-muted-foreground)]/30 pointer-events-none",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, ...rest }) =>
          orientation === "left" ? <ChevronLeft {...rest} className="h-4 w-4" /> : <ChevronRight {...rest} className="h-4 w-4" />,
      }}
      {...props}
    />
  )
}

export { Calendar }
