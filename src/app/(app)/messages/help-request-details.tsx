import { ClipboardCheck, Mail, MessageCircleQuestion } from "lucide-react"
import { cn } from "@/lib/utils"
import type { HelpRequestInfo } from "@/lib/help-request-shared"

// TAB-16 — a Help request's extras on a Messages card, READ-ONLY (prompt
// step 6): the task chip, the reason, and the one email line. The email line
// is helpEmailLabel()'s, so it never claims an email that did not go out (R10).
// Shared by the desktop feed, the tablet Team Messages page and the tablet
// home's Messages column; `size` follows each surface's type scale.

export const HELP_TYPE_META = {
  label: "Help request",
  icon: MessageCircleQuestion,
  className: "bg-[var(--color-primary)]/10 text-[var(--color-primary)]",
}

export function HelpRequestDetails({ info, size }: { info: HelpRequestInfo; size: "sm" | "lg" }) {
  const lg = size === "lg"
  return (
    <div className={cn("flex flex-col items-start", lg ? "mt-2 gap-1.5" : "mt-2 gap-1")}>
      <span
        className={cn(
          "inline-flex max-w-full items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-card)] font-semibold text-[var(--color-foreground)]",
          lg ? "min-h-[30px] px-3 text-[15px]" : "px-2.5 py-0.5 text-xs"
        )}
      >
        <ClipboardCheck className={cn("shrink-0", lg ? "h-4 w-4" : "h-3 w-3")} />
        <span className="truncate">
          {info.checklist ? `${info.checklist.replace(/\s+checklist\s*$/i, "")} · ` : ""}
          {info.task}
        </span>
      </span>
      {info.reason && (
        <span className={cn("font-semibold text-[var(--color-primary)]", lg ? "text-base" : "text-xs")}>{info.reason}</span>
      )}
      <span className={cn("inline-flex items-center gap-1.5 text-[var(--color-muted-foreground)]", lg ? "text-[15px]" : "text-xs")}>
        <Mail className={cn("shrink-0", lg ? "h-4 w-4" : "h-3 w-3")} />
        {info.emailed}
      </span>
    </div>
  )
}
