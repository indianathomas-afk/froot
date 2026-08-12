import Link from "next/link"
import { auth } from "@clerk/nextjs/server"
import { notFound, redirect } from "next/navigation"
import { ArrowLeft, Eye } from "lucide-react"
import { prisma } from "@/lib/prisma"
import { getCurrentUser, hrModuleAvailable } from "@/lib/auth"
import {
  TrainingModuleView,
  toClientQuizQuestions,
} from "@/components/hr/training-module-view"

// HR-17 read-only preview: renders the module through TrainingModuleView —
// the exact component /my/training/[assignmentId] uses — as a fresh trainee
// would see it (zero progress, quiz unlocked but unsubmittable). No
// assignment exists here, so no completion/attempt write is reachable and
// nothing counts toward compliance. ADMIN previews any module in the org;
// MANAGER only modules that apply to one of their stores.
export default async function TrainingPreviewPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const { orgId } = await auth()
  if (!orgId) redirect("/dashboard")
  if (!hrModuleAvailable(orgId)) notFound()

  const { org, dbUser } = await getCurrentUser()
  if (!org.activeModules.includes("hr")) redirect("/hr")
  const role = dbUser?.role
  if (role !== "ADMIN" && role !== "MANAGER") redirect("/hr")
  const isAdmin = role === "ADMIN"
  const storeIds = dbUser!.storeAssignments.map((a) => a.storeId)

  const trainingModule = await prisma.trainingModule.findFirst({
    where: {
      id,
      organizationId: org.id,
      ...(isAdmin
        ? {}
        : { OR: [{ appliesTo: "all" }, { storeAssignments: { some: { storeId: { in: storeIds } } } }] }),
    },
    include: {
      lessons: {
        orderBy: { orderIndex: "asc" },
        include: { resources: { orderBy: { orderIndex: "asc" } } },
      },
      quizzes: true,
    },
  })
  if (!trainingModule) notFound()

  const quiz = trainingModule.quizzes[0]
  const quizQuestions = quiz ? toClientQuizQuestions(quiz.questions) : []

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Link
          href={isAdmin ? `/hr/training/${trainingModule.id}/edit` : "/hr"}
          className="p-1.5 rounded hover:bg-[var(--color-accent)] transition-colors"
        >
          <ArrowLeft className="h-5 w-5 text-[var(--color-muted-foreground)]" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-foreground)]">Preview</h1>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            {isAdmin ? "Back arrow returns to editing" : "What staff see when this module is assigned"}
          </p>
        </div>
      </div>

      {/* Phone-ish width so the preview mirrors the mobile-first /my layout */}
      <div className="max-w-xl">
        <div className="flex items-center gap-2 border border-[var(--color-info,#0081f2)]/40 bg-[var(--color-info,#0081f2)]/10 rounded-lg px-4 py-3 mb-6">
          <Eye className="h-4 w-4 shrink-0 text-[var(--color-info,#0081f2)]" />
          <p className="text-sm text-[var(--color-foreground)]">
            Previewing as staff — read-only. Nothing you do here is recorded or counts toward
            compliance.
          </p>
        </div>

        <TrainingModuleView
          title={trainingModule.title}
          description={trainingModule.description}
          lessons={trainingModule.lessons}
          quiz={quiz ? { passThreshold: quiz.passThreshold, questions: quizQuestions } : null}
          mode={{ kind: "preview" }}
          // HR-25 made this prop required rather than defaulted so each tier
          // answers it explicitly. Unchanged for the preview: this page is
          // ADMIN/MANAGER only and the download route's manage tier serves
          // them, so the links work here exactly as they did before.
          resourcesAvailable
        />
      </div>
    </div>
  )
}
