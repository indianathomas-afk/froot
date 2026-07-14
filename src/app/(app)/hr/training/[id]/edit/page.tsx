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

  const [trainingModule, stores] = await Promise.all([
    prisma.trainingModule.findFirst({
      where: { id, organizationId: org.id },
      include: {
        lessons: {
          orderBy: { orderIndex: "asc" },
          include: { resources: { orderBy: { orderIndex: "asc" } } },
        },
        quizzes: true,
        storeAssignments: true,
      },
    }),
    prisma.store.findMany({
      where: { organizationId: org.id },
      select: { id: true, name: true, storeNumber: true },
      orderBy: { name: "asc" },
    }),
  ])
  if (!trainingModule) return notFound()

  const quiz = trainingModule.quizzes[0]
  return (
    <TrainingForm
      stores={stores}
      initialData={{
        id: trainingModule.id,
        title: trainingModule.title,
        subject: trainingModule.subject,
        description: trainingModule.description,
        appliesTo: trainingModule.appliesTo,
        isActive: trainingModule.isActive,
        lessons: trainingModule.lessons.map((l) => ({
          id: l.id,
          title: l.title,
          info: l.info,
          videoUrl: l.videoUrl,
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
