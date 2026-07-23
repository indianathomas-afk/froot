import { format } from "date-fns"
import { Gauge, FileText, GraduationCap } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import type {
  ComplianceDocItem,
  ComplianceItemStatus,
  ComplianceTrainingItem,
  StaffComplianceDetail,
} from "@/lib/hr-compliance"

// HR-8: per-employee compliance detail — the drill-down target from the
// /staff list column and the /hr/compliance rollup. Server-rendered, no
// interactivity. Same definitions as the rollup (see docs/DECISIONS.md).

const STATUS_LABELS: Record<ComplianceItemStatus, string> = {
  complete: "Complete",
  "in-progress": "In progress",
  "needs-resign": "Needs re-sign",
  overdue: "Overdue",
  "not-started": "Not started",
}

function StatusBadge({ status }: { status: ComplianceItemStatus }) {
  const variant =
    status === "complete"
      ? "success"
      : status === "overdue"
        ? "destructive"
        : status === "needs-resign"
          ? "warning"
          : status === "in-progress"
            ? "info"
            : "secondary"
  return <Badge variant={variant}>{STATUS_LABELS[status]}</Badge>
}

function docDetail(item: ComplianceDocItem): string {
  switch (item.status) {
    case "complete":
      return item.completedAt
        ? `Signed v${item.currentVersionNumber} · ${format(new Date(item.completedAt), "MMM d, yyyy")}`
        : `All ${item.requiredCount} checkpoints acknowledged (v${item.currentVersionNumber}) · record pending`
    case "needs-resign":
      return `Signed v${item.signedVersionNumber} — v${item.currentVersionNumber} is now current`
    case "in-progress":
      return `${item.ackedCount} of ${item.requiredCount} checkpoints`
    default:
      return `v${item.currentVersionNumber} · ${item.requiredCount} checkpoint${item.requiredCount === 1 ? "" : "s"}`
  }
}

function trainingDetail(item: ComplianceTrainingItem): string {
  const lessons = `${item.lessonsDone} of ${item.lessonsTotal} lesson${item.lessonsTotal === 1 ? "" : "s"}`
  if (item.status === "overdue" && item.dueDate)
    return `${lessons} · was due ${format(new Date(item.dueDate), "MMM d, yyyy")}`
  if (item.dueDate) return `${lessons} · due ${format(new Date(item.dueDate), "MMM d, yyyy")}`
  return lessons
}

export function StaffCompliance({ detail }: { detail: StaffComplianceDetail }) {
  const docs = detail.items.filter((i): i is ComplianceDocItem => i.kind === "document")
  const training = detail.items.filter((i): i is ComplianceTrainingItem => i.kind === "training")

  if (detail.requiredTotal === 0) {
    return (
      <div className="border border-dashed border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-12 text-center">
        <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-[var(--color-muted)] flex items-center justify-center">
          <Gauge className="h-6 w-6 text-[var(--color-muted-foreground)]" />
        </div>
        <p className="font-medium text-[var(--color-foreground)] mb-1">Nothing required yet</p>
        <p className="text-sm text-[var(--color-muted-foreground)] max-w-md mx-auto">
          Compliance tracking activates once acknowledgment documents apply to this team member or
          training is assigned.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {!detail.active && (
        <div className="rounded-lg border border-[var(--color-warning-border)] bg-[var(--color-warning-bg)] px-4 py-3 text-sm text-[var(--color-warning-text)]">
          Terminated — excluded from compliance rollups and percentages. Records are retained below
          for audit.
        </div>
      )}

      {/* Summary */}
      <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-6">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div>
            <p className="text-[28px] leading-tight font-extrabold text-[var(--color-foreground)]">
              {detail.active && detail.pct !== null ? `${detail.pct}%` : "—"}
            </p>
            <p className="text-xs text-[var(--color-muted-foreground)]">
              {detail.completedCount} of {detail.requiredTotal} required item
              {detail.requiredTotal === 1 ? "" : "s"} complete
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {detail.overdueCount > 0 && (
              <Badge variant="destructive">
                {detail.overdueCount} overdue
              </Badge>
            )}
            {detail.needsResignCount > 0 && (
              <Badge variant="warning">
                {detail.needsResignCount} needs re-sign
              </Badge>
            )}
            {detail.inProgressCount > 0 && (
              <Badge variant="info">
                {detail.inProgressCount} in progress
              </Badge>
            )}
            {detail.active && detail.pct === 100 && <Badge variant="success">Fully compliant</Badge>}
          </div>
        </div>
      </div>

      {/* Documents */}
      {docs.length > 0 && (
        <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] overflow-hidden">
          <div className="px-6 py-4 border-b border-[var(--color-border)] flex items-center gap-2">
            <FileText className="h-4 w-4 text-[var(--color-muted-foreground)]" />
            <h2 className="text-sm font-semibold text-[var(--color-foreground)]">
              Acknowledgment Documents
            </h2>
          </div>
          <table className="w-full">
            <tbody>
              {docs.map((item) => (
                <tr
                  key={item.documentId}
                  className="border-b border-[var(--color-border)] last:border-0"
                >
                  <td className="px-6 py-3">
                    <p className="text-sm font-medium text-[var(--color-foreground)]">{item.title}</p>
                    <p className="text-xs text-[var(--color-muted-foreground)] mt-0.5">
                      {docDetail(item)}
                    </p>
                  </td>
                  <td className="px-6 py-3 text-right">
                    <StatusBadge status={item.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Training */}
      {training.length > 0 && (
        <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] overflow-hidden">
          <div className="px-6 py-4 border-b border-[var(--color-border)] flex items-center gap-2">
            <GraduationCap className="h-4 w-4 text-[var(--color-muted-foreground)]" />
            <h2 className="text-sm font-semibold text-[var(--color-foreground)]">Training</h2>
          </div>
          <table className="w-full">
            <tbody>
              {training.map((item) => (
                <tr
                  key={item.assignmentId}
                  className="border-b border-[var(--color-border)] last:border-0"
                >
                  <td className="px-6 py-3">
                    <p className="text-sm font-medium text-[var(--color-foreground)]">
                      {item.moduleTitle}
                    </p>
                    <p className="text-xs text-[var(--color-muted-foreground)] mt-0.5">
                      {trainingDetail(item)}
                    </p>
                  </td>
                  <td className="px-6 py-3 text-right space-x-1.5">
                    {item.certified && <Badge variant="success">Certified</Badge>}
                    <StatusBadge status={item.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
