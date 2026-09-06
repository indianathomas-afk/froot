import { auth } from "@clerk/nextjs/server"
import { notFound, redirect } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { getCurrentUser, hrModuleAvailable } from "@/lib/auth"
import { TrainingForm, type QuizQuestion } from "../../training-form"

export default async function EditTrainingModulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { orgId } = await auth()
  if (!orgId) redirect("/dashboard")
  if (!hrModuleAvailable(orgId)) notFound()

  const { org, dbUser } = await getCurrentUser()
  if (!org.activeModules.includes("hr")) redirect("/hr")
  if (dbUser?.role !== "ADMIN") redirect("/hr")

  const [trainingModule, stores, categories] = await Promise.all([
    prisma.trainingModule.findFirst({
      where: { id, organizationId: org.id },
      include: {
        lessons: {
          orderBy: { orderIndex: "asc" },
          include: { resources: { orderBy: { orderIndex: "asc" } } },
        },
        // HR-32: the scalar id is on the lesson row itself; the picker resolves
        // it to a title from the list queried below.
        quizzes: true,
        storeAssignments: true,
      },
    }),
    prisma.store.findMany({
      where: { organizationId: org.id },
      select: { id: true, name: true, storeNumber: true },
      orderBy: { name: "asc" },
    }),
    prisma.trainingCategory.findMany({
      where: { organizationId: org.id },
      select: { id: true, name: true, colorKey: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
  ])
  if (!trainingModule) return notFound()

  // HR-32: queried AFTER the module rather than inside the Promise.all above,
  // because the widening below needs the module's own linked ids.
  //
  // A DOCUMENT DEACTIVATED SINCE A LESSON POINTED AT IT MUST STILL APPEAR, or
  // opening the editor would silently clear a link the admin never touched. The
  // OR keeps it in the list; the form marks it "(inactive)"; saving it is
  // refused by the write route, which is the loud outcome rather than the quiet
  // one. Active Links the module does not use are listed as normal.
  const linkedIds = trainingModule.lessons
    .map((l) => l.linkedHrDocumentId)
    .filter((v): v is string => !!v)
  const linkedDocuments = await prisma.hrDocument.findMany({
    where: {
      organizationId: org.id,
      kind: "Link",
      ...(linkedIds.length ? { OR: [{ isActive: true }, { id: { in: linkedIds } }] } : { isActive: true }),
    },
    select: { id: true, title: true, isActive: true },
    orderBy: { title: "asc" },
  })

  const quiz = trainingModule.quizzes[0]
  return (
    <TrainingForm
      stores={stores}
      categories={categories}
      linkedDocuments={linkedDocuments}
      initialData={{
        id: trainingModule.id,
        title: trainingModule.title,
        subject: trainingModule.subject,
        categoryId: trainingModule.categoryId,
        description: trainingModule.description,
        appliesTo: trainingModule.appliesTo,
        isActive: trainingModule.isActive,
        lessons: trainingModule.lessons.map((l) => ({
          id: l.id,
          title: l.title,
          info: l.info,
          videoUrl: l.videoUrl,
          linkedHrDocumentId: l.linkedHrDocumentId,
          resources: l.resources.map((r) => ({
            id: r.id,
            label: r.label,
            contentType: r.contentType,
            sizeBytes: r.sizeBytes,
          })),
        })),
        quiz: quiz
          ? { passThreshold: quiz.passThreshold, questions: quiz.questions as QuizQuestion[] }
          : null,
        storeAssignments: trainingModule.storeAssignments.map((a) => ({ storeId: a.storeId })),
      }}
    />
  )
}
