import Link from "next/link"
import { Award, CalendarPlus, Trophy } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { formatCivilDate } from "@/lib/display-time"
import { dayCountLabel, type TenureProgress } from "@/lib/milestones"

// MS-1 — the Milestones tab body on /staff/[id]. A SERVER component: it holds
// nothing interactive (the Copy button is MS-4), and `progress` arrives fully
// computed in the member's store-local date (src/lib/milestones.ts).
//
// THE GATE IS THE PAGE'S, NOT THIS FILE'S: the trigger and this content are
// only rendered for ADMIN / in-scope MANAGER with Milestones on (F1). Layout is
// stacked with no fixed widths so it reads at phone width — managers use Froot
// on phones.

function EmptyCard({ icon: Icon, title, children }: { icon: typeof Award; title: string; children: React.ReactNode }) {
  return (
    <div className="border border-dashed border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-8 text-center">
      <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-[var(--color-muted)] flex items-center justify-center">
        <Icon className="h-6 w-6 text-[var(--color-muted-foreground)]" />
      </div>
      <p className="font-medium text-[var(--color-foreground)] mb-1">{title}</p>
      <div className="text-sm text-[var(--color-muted-foreground)] max-w-md mx-auto">{children}</div>
    </div>
  )
}

/** A "YYYY-MM-DD" civil date, rendered without a zone shift. */
function civil(date: string): string {
  return formatCivilDate(`${date}T00:00:00.000Z`, "long")
}

export function StaffMilestones({
  progress,
  hasMilestones,
  viewerIsAdmin,
  canEditStartDate,
}: {
  progress: TenureProgress
  hasMilestones: boolean
  viewerIsAdmin: boolean
  canEditStartDate: boolean
}) {
  if (!hasMilestones) {
    return (
      <EmptyCard icon={Award} title="No milestones set up yet">
        {viewerIsAdmin ? (
          <>
            Add tenure milestones once and they appear here for every staff member.{" "}
            <Link href="/staff/milestones" className="font-medium text-[var(--color-primary)] hover:underline">
              Set up milestones →
            </Link>
          </>
        ) : (
          "Ask an admin to set up milestones."
        )}
      </EmptyCard>
    )
  }

  if (progress.state === "no-start-date") {
    return (
      <EmptyCard icon={CalendarPlus} title="No start date">
        No start date — add one to track milestones.
        {canEditStartDate && " Use Edit at the top of this page."}
      </EmptyCard>
    )
  }

  const { achieved, next, progressPct, daysEmployed, terminated, asOf } = progress

  return (
    <div className="space-y-4">
      <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-4 sm:p-6">
        {terminated ? (
          <>
            <h2 className="text-sm font-semibold text-[var(--color-foreground)]">Tenure</h2>
            <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
              Counted to their termination on {civil(asOf)} — {Math.max(0, daysEmployed)} days.
            </p>
          </>
        ) : next ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-[var(--color-foreground)]">Next milestone</h2>
              <Badge variant="secondary">{dayCountLabel(next.dayCount)}</Badge>
            </div>
            <p className="font-medium text-[var(--color-foreground)] mt-2">{next.title}</p>
            <p className="text-sm text-[var(--color-muted-foreground)] mt-0.5">
              {next.daysToGo} day{next.daysToGo === 1 ? "" : "s"} to go · {civil(next.dueOn)}
            </p>
            <div className="mt-3">
              <div className="h-2 rounded-full bg-[var(--color-muted)] overflow-hidden">
                <div
                  className="h-full bg-[var(--color-primary)] transition-all duration-300"
                  style={{ width: `${progressPct ?? 0}%` }}
                />
              </div>
              <p className="text-[10px] text-right text-[var(--color-muted-foreground)] mt-0.5">{progressPct ?? 0}%</p>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-sm font-semibold text-[var(--color-foreground)]">Tenure</h2>
            <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
              {daysEmployed} days — every milestone reached.
            </p>
          </>
        )}
      </div>

      <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-4 sm:p-6">
        <h2 className="text-sm font-semibold text-[var(--color-foreground)] mb-3">Achieved</h2>
        {achieved.length === 0 ? (
          <p className="text-sm text-[var(--color-muted-foreground)]">
            {next
              ? `Nothing yet — their first milestone is ${next.daysToGo} day${next.daysToGo === 1 ? "" : "s"} away.`
              : "No milestones were reached."}
          </p>
        ) : (
          <ul className="space-y-3">
            {[...achieved].reverse().map((m) => (
              <li key={m.id} className="border border-[var(--color-border)] rounded-lg p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Trophy className="h-4 w-4 text-[var(--color-primary)] shrink-0" />
                  <span className="font-medium text-[var(--color-foreground)]">{m.title}</span>
                  <Badge variant="secondary">{dayCountLabel(m.dayCount)}</Badge>
                  {/* Reached before the milestone was archived — kept as history
                      (Gary, 2026-10-15). */}
                  {m.archived && <Badge variant="outline">Archived milestone</Badge>}
                </div>
                <p className="text-xs text-[var(--color-muted-foreground)] mt-1">Reached {civil(m.achievedOn)}</p>
                {m.recognition && (
                  <p className="text-sm text-[var(--color-muted-foreground)] mt-2">
                    <span className="font-medium text-[var(--color-foreground)]">Recognition: </span>
                    {m.recognition}
                  </p>
                )}
                {m.employeeMessage && (
                  <p className="text-sm text-[var(--color-muted-foreground)] mt-1 whitespace-pre-line">
                    <span className="font-medium text-[var(--color-foreground)]">Message: </span>
                    {m.employeeMessage}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
