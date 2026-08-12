import Link from "next/link"
import { auth } from "@clerk/nextjs/server"
import { notFound, redirect } from "next/navigation"
import { ArrowLeft, Eye } from "lucide-react"
import { prisma } from "@/lib/prisma"
import { getCurrentUser, hrModuleAvailable } from "@/lib/auth"
import { STORE_LIBRARY_WHERE, canReadTrainingModule } from "@/lib/training"
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
//
// HR-24 added a THIRD viewer with a different purpose. ADMIN and MANAGER come
// here to PREVIEW — to see what a trainee will be sent. A STORE login comes
// here to READ — this is the library surface itself, the water-heater
// procedure on the shared iPad. Same page and same renderer (one module read
// path, so nothing can diverge), different mode: `read` drops the trainee
// furniture that only makes sense to someone judging a module (progress bar,
// disabled complete buttons, the quiz).
//
// TWO THINGS ARE DELIBERATELY NOT SHARED WITH THE PREVIEW TIERS:
// - SCOPE. R-h (i), org-wide: STORE is not narrowed by store applicability,
//   MANAGER still is. The narrowing STORE does get is lifecycle, and it comes
//   from canReadTrainingModule — the same rule the library list is built on.
// - FILES. R-g (c): resourcesAvailable is false for STORE. The download route
//   has no STORE tier and did not get one this session, so a rendered link
//   would 404 — the exact dead-affordance failure the training access audit
//   named at §3.3 and the reason HR-25 made this prop required.
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
  if (role !== "ADMIN" && role !== "MANAGER" && role !== "STORE") redirect("/hr")
  const isAdmin = role === "ADMIN"
  const isReader = role === "STORE"
  const storeIds = dbUser!.storeAssignments.map((a) => a.storeId)

  const trainingModule = await prisma.trainingModule.findFirst({
    where: {
      id,
      organizationId: org.id,
      // MANAGER keeps HR-17's store-applicability clause. STORE does not get
      // one (R-h i) and ADMIN never had one; STORE's narrowing is the
      // lifecycle test asserted just below.
      ...(isAdmin || isReader
        ? {}
        : { OR: [{ appliesTo: "all" }, { storeAssignments: { some: { storeId: { in: storeIds } } } }] }),
      ...(isReader ? STORE_LIBRARY_WHERE : {}),
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
  // The named policy function is the authority; the WHERE above is the same
  // rule expressed as a query. Asked here so a module reached by direct URL
  // passes the policy, not just the filter — and so the two cannot silently
  // disagree. Preview tiers are governed by their role test above.
  if (isReader && !canReadTrainingModule(trainingModule, { orgDbId: org.id, role })) {
    notFound()
  }

  const quiz = trainingModule.quizzes[0]
  const quizQuestions = quiz ? toClientQuizQuestions(quiz.questions) : []

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Link
          href={
            isAdmin
              ? `/hr/training/${trainingModule.id}/edit`
              : isReader
                ? "/hr/training"
                : "/hr"
          }
          className="p-1.5 rounded hover:bg-[var(--color-accent)] transition-colors"
        >
          <ArrowLeft className="h-5 w-5 text-[var(--color-muted-foreground)]" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-foreground)]">
            {isReader ? "Training" : "Preview"}
          </h1>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            {isAdmin
              ? "Back arrow returns to editing"
              : isReader
                ? "Back arrow returns to the training list"
                : "What staff see when this module is assigned"}
          </p>
        </div>
      </div>

      {/* Phone-ish width so the preview mirrors the mobile-first /my layout */}
      <div className="max-w-xl">
        {/* The preview banner is addressed to someone evaluating a module and
            would be a non-sequitur to a reader who is not previewing anything.
            Read mode carries no banner: nothing about the page needs
            explaining, and there is no write affordance to disclaim. */}
        {!isReader && (
          <div className="flex items-center gap-2 border border-[var(--color-info,#0081f2)]/40 bg-[var(--color-info,#0081f2)]/10 rounded-lg px-4 py-3 mb-6">
            <Eye className="h-4 w-4 shrink-0 text-[var(--color-info,#0081f2)]" />
            <p className="text-sm text-[var(--color-foreground)]">
              Previewing as staff — read-only. Nothing you do here is recorded or counts toward
              compliance.
            </p>
          </div>
        )}

        <TrainingModuleView
          title={trainingModule.title}
          description={trainingModule.description}
          lessons={trainingModule.lessons}
          quiz={quiz ? { passThreshold: quiz.passThreshold, questions: quizQuestions } : null}
          mode={isReader ? { kind: "read" } : { kind: "preview" }}
          // HR-25 made this prop required rather than defaulted so each tier
          // answers it explicitly, and HR-24 is the tier it was made required
          // for. ADMIN/MANAGER are served by the download route's manage tier,
          // so their links work exactly as before. STORE has no tier on that
          // route — R-g (c), ruled 2026-08-11 — so it answers false and the
          // renderer draws no link rather than one that 404s.
          resourcesAvailable={!isReader}
        />
      </div>
    </div>
  )
}
