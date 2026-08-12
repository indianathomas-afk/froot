import Link from "next/link"
import { auth } from "@clerk/nextjs/server"
import { notFound, redirect } from "next/navigation"
import { ArrowLeft, Eye } from "lucide-react"
import { prisma } from "@/lib/prisma"
import { getCurrentUser, hrModuleAvailable } from "@/lib/auth"
import { STORE_LIBRARY_WHERE, canReadTrainingModule, managerLibraryWhere } from "@/lib/training"
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
// HR-24 added a THIRD viewer with a different purpose. ADMIN comes here to
// PREVIEW — to see what a trainee will be sent. A STORE login comes here to
// READ — this is the library surface itself, the water-heater procedure on the
// shared iPad. Same page and same renderer (one module read path, so nothing
// can diverge), different mode: `read` drops the trainee furniture that only
// makes sense to someone judging a module (progress bar, disabled complete
// buttons, the quiz).
//
// HR-26 (Gary, 2026-08-12) MOVED MANAGER FROM THE PREVIEW SIDE TO THE READ SIDE,
// per its settled item 1 — extend the tier that exists, do not build a third
// variant. ADMIN is now the only previewer. Two consequences, both ruled at the
// stop rather than absorbed silently:
// - MANAGER LOSES THE QUIZ ON THIS PAGE, since read mode drops it. Nothing
//   anyone clicks changes: at HEAD there was no in-app link here for MANAGER at
//   all (the only two are training-client.tsx, ADMIN+STORE, and the ADMIN
//   save-and-preview in training-form.tsx), so this surface was URL-only for
//   managers. A module's quiz size and pass mark still show on the list row.
// - MANAGER'S URL REACH NARROWS TO LIVE MODULES. HR-17 let a manager URL-reach
//   an inactive or archived module here; canReadTrainingModule is now the
//   authority for all three read roles, and drafts and archives belong to the
//   builder. Ruled by Gary at the HR-26 stop.
//
// TWO THINGS ARE DELIBERATELY NOT UNIFORM ACROSS THE READERS:
// - SCOPE. R-h (i), org-wide, is STORE's: STORE is not narrowed by store
//   applicability. MANAGER still is, exactly as HR-17 left it — see the HR-26
//   note on managerLibraryWhere for why R-h does not transfer. Both narrowings
//   come from the same rule the library list is built on.
// - FILES. R-g (c): resourcesAvailable is false for STORE, whose reach on the
//   download route does not exist — a rendered link would 404, the exact
//   dead-affordance failure the training access audit named at §3.3 and the
//   reason HR-25 made this prop required. It is TRUE for MANAGER, who has held
//   manage-tier download access since HR-17 and keeps it unchanged: because the
//   scope above matches that route's own clause, every link a manager can see
//   here is one that route already serves.
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
  // HR-26: every non-ADMIN viewer of this page is now a READER. ADMIN is the
  // only tier still previewing.
  const isReader = !isAdmin
  // R-g (c) is STORE's alone — MANAGER keeps the file access HR-17 gave it.
  const filesServed = role !== "STORE"
  const storeIds = dbUser!.storeAssignments.map((a) => a.storeId)

  const trainingModule = await prisma.trainingModule.findFirst({
    where: {
      id,
      organizationId: org.id,
      // The policy function's rule as a query, per role — the same three
      // branches the library list uses, so a row in that list and this page can
      // never disagree about what a viewer may open.
      ...(isAdmin
        ? {}
        : role === "MANAGER"
          ? managerLibraryWhere(storeIds)
          : STORE_LIBRARY_WHERE),
    },
    include: {
      lessons: {
        orderBy: { orderIndex: "asc" },
        include: { resources: { orderBy: { orderIndex: "asc" } } },
      },
      quizzes: true,
      // HR-26: the MANAGER branch of the policy function reads these.
      storeAssignments: { select: { storeId: true } },
    },
  })
  if (!trainingModule) notFound()
  // The named policy function is the authority; the WHERE above is the same
  // rule expressed as a query. Asked here so a module reached by direct URL
  // passes the policy, not just the filter — and so the two cannot silently
  // disagree. ADMIN is governed by its role test above.
  if (isReader && !canReadTrainingModule(trainingModule, { orgDbId: org.id, role, storeIds })) {
    notFound()
  }

  const quiz = trainingModule.quizzes[0]
  const quizQuestions = quiz ? toClientQuizQuestions(quiz.questions) : []

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        {/* HR-26: the old third branch (a MANAGER previewer, sent back to /hr)
            is gone with the tier it served — every reader now comes from the
            training list and goes back to it. */}
        <Link
          href={isAdmin ? `/hr/training/${trainingModule.id}/edit` : "/hr/training"}
          className="p-1.5 rounded hover:bg-[var(--color-accent)] transition-colors"
        >
          <ArrowLeft className="h-5 w-5 text-[var(--color-muted-foreground)]" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-foreground)]">
            {isReader ? "Training" : "Preview"}
          </h1>
          <p className="text-sm text-[var(--color-muted-foreground)]">
            {isAdmin ? "Back arrow returns to editing" : "Back arrow returns to the training list"}
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
          // so their links work exactly as before — HR-26 changed MANAGER's
          // MODE, not its file reach. STORE has no tier on that route — R-g (c),
          // ruled 2026-08-11 — so it answers false and the renderer draws no
          // link rather than one that 404s.
          resourcesAvailable={filesServed}
        />
      </div>
    </div>
  )
}
