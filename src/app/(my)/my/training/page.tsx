import Link from "next/link"
import { format } from "date-fns"
import { ChevronRight, GraduationCap } from "lucide-react"
import { prisma } from "@/lib/prisma"
import { getActiveStaffSelf } from "@/lib/auth"
import { Badge } from "@/components/ui/badge"
import { MyShell } from "../my-shell"
import { MyDenied } from "../denied"

// /my/training — the staff member's own assigned modules with live progress.
// Rule 3: scoped to the session's staff profile, read + complete only.
export default async function MyTrainingPage() {
  const self = await getActiveStaffSelf()
  if (!self.ok) return <MyDenied reason={self.reason} />

  const assignments = await prisma.trainingAssignment.findMany({
    where: { staffMemberId: self.staffMember.id },
    include: {
      trainingModule: {
        select: {
          title: true,
          subject: true,
          lessons: { select: { id: true } },
          quizzes: { select: { id: true } },
        },
      },
      lessonProgress: { select: { trainingLessonId: true } },
      quizAttempts: { select: { status: true } },
    },
    orderBy: { createdAt: "desc" },
  })

  return (
    <MyShell>
      <h1 className="text-xl font-bold text-[var(--color-foreground)] mb-4">My Training</h1>

      {assignments.length === 0 ? (
        <div className="border border-dashed border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-10 text-center">
          <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-[var(--color-muted)] flex items-center justify-center">
            <GraduationCap className="h-6 w-6 text-[var(--color-muted-foreground)]" />
          </div>
          <p className="font-medium text-[var(--color-foreground)] mb-1">No training assigned yet</p>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            When a manager assigns you a module, it shows up here.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {assignments.map((a) => {
            const lessonIds = new Set(a.trainingModule.lessons.map((l) => l.id))
            const done = a.lessonProgress.filter((p) => lessonIds.has(p.trainingLessonId)).length
            const total = lessonIds.size
            const pct = total > 0 ? Math.round((done / total) * 100) : 0
            const certified = !!a.certifiedAt

            return (
              <Link
                key={a.id}
                href={`/my/training/${a.id}`}
                className="flex items-center gap-3 border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-4 min-h-11"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium text-[var(--color-foreground)]">{a.trainingModule.title}</p>
                    {certified ? (
                      <Badge variant="success">Certified</Badge>
                    ) : a.status === "Completed" ? (
                      <Badge variant="success">Completed</Badge>
                    ) : a.status === "InProgress" ? (
                      <Badge variant="info">In progress</Badge>
                    ) : (
                      <Badge variant="secondary">Not started</Badge>
                    )}
                  </div>
                  <p className="text-xs text-[var(--color-muted-foreground)] mt-1">
                    {done}/{total} lessons
                    {a.dueDate && ` · Due ${format(a.dueDate, "MMM d, yyyy")}`}
                  </p>
                  <div className="h-2 mt-2 rounded-full bg-[var(--color-muted)] overflow-hidden">
                    <div
                      className="h-full bg-[var(--color-primary)] transition-all duration-300"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
                <ChevronRight className="h-5 w-5 shrink-0 text-[var(--color-muted-foreground)]" />
              </Link>
            )
          })}
        </div>
      )}
    </MyShell>
  )
}
