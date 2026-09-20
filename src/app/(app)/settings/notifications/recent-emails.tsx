import type { EmailLogEntry, EmailLogStatus } from "@/lib/notification-log"

// NOTIFY-2b — "Recent emails", the read half of this page. A SERVER COMPONENT
// with no route behind it: the page it renders into is already a server
// component behind settings.access (ADMIN_ONLY, held out of the override grid),
// so the data is fetched in the same pass and there is no second surface to
// gate. An endpoint here would be a new place to get the gate wrong, in
// exchange for nothing — nothing on this card refreshes or paginates.
//
// F2 (Gary, 2026-09-20): the newest 50, not the last 30 days. It is a glance
// surface; a window shows an empty card to any org that had a quiet month.

// Tinted backgrounds come from the -bg/-text token pairs in globals.css, and
// the red states from `bg-red-50`, which is the tint the rest of /settings
// already uses for a destructive surface (settings/page.tsx:127). An opacity
// modifier on a var() colour — `bg-[var(--color-success)]/12` — is NOT used:
// Tailwind cannot parse a CSS variable to apply alpha to it, so that form
// silently renders no background at all.
const STATUS_STYLE: Record<EmailLogStatus, { label: string; className: string }> = {
  delivered: { label: "Delivered", className: "bg-[var(--color-success-bg)] text-[var(--color-success-text)]" },
  sent: { label: "Sent", className: "bg-[var(--color-muted)] text-[var(--color-foreground)]" },
  delayed: { label: "Delayed", className: "bg-[var(--color-warning-bg)] text-[var(--color-warning-text)]" },
  bounced: { label: "Bounced", className: "bg-red-50 text-[var(--color-destructive)]" },
  complained: { label: "Spam report", className: "bg-red-50 text-[var(--color-destructive)]" },
  failed: { label: "Failed", className: "bg-red-50 text-[var(--color-destructive)]" },
  // NOT AN ERROR STATE, AND THE STYLING SAYS SO. Console mode is the default
  // in any environment that has not set NOTIFY_EMAIL_PROVIDER, and "the email
  // was composed and logged, nothing left the building" is the correct
  // behaviour there rather than a fault to fix.
  "logged only": { label: "Logged only", className: "bg-[var(--color-muted)] text-[var(--color-muted-foreground)]" },
  unknown: { label: "Unknown", className: "bg-[var(--color-muted)] text-[var(--color-muted-foreground)]" },
}

/** Truncate after three, then "+N" — a full list would wrap the row. */
function recipientSummary(recipients: string[]): string {
  if (recipients.length === 0) return "—"
  if (recipients.length <= 3) return recipients.join(", ")
  return `${recipients.slice(0, 3).join(", ")} +${recipients.length - 3}`
}

/**
 * ORG-LOCAL, NOT UTC AND NOT THE READER'S BROWSER. Every DateTime column in
 * this schema is TIMESTAMP(3) with no zone, so Prisma hands back UTC
 * (CLAUDE.md § Database Evidence). Rendering that raw would put a 7am send at
 * 2pm for a west-coast admin, which is the exact class of misreading that rule
 * exists to stop. Organization.timezone is the zone the rest of the app already
 * resolves org-level days in.
 */
function formatAt(at: Date, timeZone: string): string {
  return at.toLocaleString("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

export function RecentEmails({
  entries,
  timeZone,
}: {
  entries: EmailLogEntry[]
  timeZone: string
}) {
  if (entries.length === 0) {
    return (
      <div className="p-4 border border-[var(--color-border)] rounded-lg">
        <p className="text-sm text-[var(--color-muted-foreground)]">No emails sent yet.</p>
      </div>
    )
  }

  return (
    // overflow-x-auto + a min-width on the TABLE, not just the wrapper. With
    // `w-full` alone the table compresses to the container instead of
    // scrolling, and the columns then hyphenate email addresses and subjects
    // mid-word — which is how "Tommy Tester" renders as "To mmy Tester".
    <div className="border border-[var(--color-border)] rounded-lg overflow-x-auto">
      <table className="w-full min-w-[46rem] text-sm">
        <thead>
          <tr className="bg-[var(--color-muted)] text-left">
            {/* Explicit widths on the two prose columns. Left to auto-layout
                the subject column collapses to whatever the status column does
                not want, and a one-line subject wraps to five. */}
            <th className="px-4 py-2 font-medium text-[var(--color-muted-foreground)] whitespace-nowrap">When</th>
            <th className="px-4 py-2 font-medium text-[var(--color-muted-foreground)] w-[34%]">Email</th>
            <th className="px-4 py-2 font-medium text-[var(--color-muted-foreground)] w-[24%]">Recipients</th>
            <th className="px-4 py-2 font-medium text-[var(--color-muted-foreground)] whitespace-nowrap">Status</th>
            <th className="px-4 py-2 font-medium text-[var(--color-muted-foreground)] whitespace-nowrap">Provider</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => {
            const style = STATUS_STYLE[e.status]
            return (
              <tr key={e.id} className="border-t border-[var(--color-border)] align-top">
                <td className="px-4 py-2.5 text-[var(--color-muted-foreground)] whitespace-nowrap">
                  {formatAt(e.at, timeZone)}
                </td>
                <td className="px-4 py-2.5 text-[var(--color-foreground)]">
                  <div className="font-medium">{e.kindLabel}</div>
                  {e.subject && (
                    <div className="text-xs text-[var(--color-muted-foreground)] mt-0.5 break-words">{e.subject}</div>
                  )}
                </td>
                <td className="px-4 py-2.5 text-[var(--color-muted-foreground)] break-words">
                  {recipientSummary(e.recipients)}
                </td>
                <td className="px-4 py-2.5 whitespace-nowrap">
                  <span
                    className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${style.className}`}
                  >
                    {style.label}
                  </span>
                  {/* The failure reason, expanded rather than on hover — a
                      title attribute is invisible on a phone, and this is the
                      one line an admin came to the card to read. */}
                  {e.detail && (
                    <div className="text-xs text-[var(--color-muted-foreground)] mt-1 max-w-[18rem] break-words">
                      {e.detail}
                    </div>
                  )}
                </td>
                <td className="px-4 py-2.5 text-[var(--color-muted-foreground)] whitespace-nowrap">
                  {e.provider ?? "—"}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
