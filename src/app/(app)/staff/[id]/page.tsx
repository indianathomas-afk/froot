import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { format } from "date-fns"
import { ArrowLeft, FileText, GraduationCap, Gauge, Store } from "lucide-react"
import { getCurrentUser, getUserStoreScope, hrModuleAvailable, requireModule } from "@/lib/auth"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { ManagerNotes, type SerializedNote } from "./manager-notes"
import { StaffDocuments, type StaffDocumentRow } from "./staff-documents"
import { StaffFormDocuments, type StaffFormDocRow } from "./staff-form-documents"
import { StaffUploadedDocuments, type StaffUploadRow } from "./staff-uploaded-documents"
import { SelfServiceActions } from "./self-service-actions"
import { StaffEditActions } from "./staff-edit-actions"
import { StaffTraining, type StaffTrainingAssignment } from "./staff-training"
import { StaffCompliance } from "./staff-compliance"
import { getStaffComplianceDetail, type StaffComplianceDetail } from "@/lib/hr-compliance"

// HR-1 shell, progressively filled: Overview (HR-1), Notes (HR-2), Documents
// (HR-4), Training (HR-6/7), Compliance (HR-8).

async function getStaffMember(id: string, clerkOrgId: string) {
  const { isAdmin, storeIds } = await getUserStoreScope()

  const member = await prisma.staffMember.findFirst({
    where: { id, organization: { clerkOrgId } },
    include: {
      storeAssignments: {
        include: { store: true },
        orderBy: [{ isPrimary: "desc" }, { store: { name: "asc" } }],
      },
    },
  })
  if (!member) return null
  // Non-admins may only open staff assigned to one of their own stores.
  if (!isAdmin && !member.storeAssignments.some((a) => storeIds.includes(a.storeId))) return null
  return member
}

// Empty-state shell for a tab whose real content ships in a later phase.
function ShellTab({
  icon: Icon,
  title,
  copy,
  phase,
}: {
  icon: typeof FileText
  title: string
  copy: string
  phase: string
}) {
  return (
    <div className="border border-dashed border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-12 text-center">
      <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-[var(--color-muted)] flex items-center justify-center">
        <Icon className="h-6 w-6 text-[var(--color-muted-foreground)]" />
      </div>
      <p className="font-medium text-[var(--color-foreground)] mb-1">{title}</p>
      <p className="text-sm text-[var(--color-muted-foreground)] max-w-md mx-auto">{copy}</p>
      <p className="text-xs text-[var(--color-muted-foreground)] mt-3 uppercase tracking-wide">Coming in {phase}</p>
    </div>
  )
}

export default async function StaffDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { orgId } = await auth()
  if (!orgId) redirect("/dashboard")

  // Availability gate first, then the per-org add-on toggle — with either
  // off, this page must behave as though it does not exist.
  if (!hrModuleAvailable(orgId)) notFound()
  try {
    await requireModule("hr")
  } catch {
    notFound()
  }

  const { id } = await params
  const member = await getStaffMember(id, orgId)
  if (!member) notFound()

  // Manager notes and document statuses are ADMIN/MANAGER only — STORE/STAFF
  // never see the tabs' data and it is never fetched for them. The APIs
  // enforce the same gates.
  const { dbUser } = await getCurrentUser()
  const canSeeNotes = dbUser?.role === "ADMIN" || dbUser?.role === "MANAGER"

  // HR-7 self-service state: linked login / invite still pending. Same
  // ADMIN/MANAGER tier as the other management surfaces on this page.
  const invitePending = canSeeNotes
    ? (await prisma.pendingInvite.findFirst({
        where: { organizationId: member.organizationId, staffMemberId: member.id },
        select: { id: true },
      })) !== null
    : false

  // Stores available in the Edit dialog — scoped like the rest of the app:
  // ADMIN sees all org stores, MANAGER only their own.
  const { isAdmin, storeIds: viewerStoreIds } = await getUserStoreScope()
  const editStores = canSeeNotes
    ? await prisma.store.findMany({
        where: {
          organizationId: member.organizationId,
          isActive: true,
          ...(isAdmin ? {} : { id: { in: viewerStoreIds } }),
        },
        select: { id: true, name: true, storeNumber: true },
        orderBy: { name: "asc" },
      })
    : []

  // HR-4 Documents tab: every required Acknowledgment doc that applies to
  // this staff member's stores, with version-pinned status. Signed records
  // bind to the version they were signed against — a re-upload flips the
  // status to "needs-current" while the old record stays downloadable.
  let documentRows: StaffDocumentRow[] = []
  if (canSeeNotes) {
    const memberStoreIds = member.storeAssignments.map((a) => a.storeId)
    const docs = await prisma.hrDocument.findMany({
      where: {
        organizationId: member.organizationId,
        kind: "Acknowledgment",
        isActive: true,
        requiresAcknowledgment: true,
        OR: [
          { appliesTo: "all" },
          { storeAssignments: { some: { storeId: { in: memberStoreIds } } } },
        ],
      },
      include: {
        checkpoints: { where: { required: true }, select: { id: true } },
        versions: {
          orderBy: { versionNumber: "desc" },
          include: {
            signedRecords: { where: { staffMemberId: member.id } },
            acknowledgments: {
              where: { staffMemberId: member.id },
              select: { checkpointId: true, signingCycle: true },
            },
          },
        },
      },
      orderBy: { title: "asc" },
    })

    documentRows = docs.flatMap((d) => {
      const current = d.versions.find((v) => v.isCurrent)
      if (!current) return []
      // HR-15 Policy B: only current-cycle signatures satisfy this tenure. A
      // current-version record from a prior tenure reads "needs-current"
      // (same lever as a version bump) with the old record still on file.
      const currentRecord = current.signedRecords.find(
        (r) => r.signingCycle === member.signingCycle
      )
      const priorCycleRecord = currentRecord ? undefined : current.signedRecords[0]
      const ackedIds = new Set(
        current.acknowledgments
          .filter((a) => a.signingCycle === member.signingCycle)
          .map((a) => a.checkpointId)
      )
      const requiredCount = d.checkpoints.length
      const allAcked = requiredCount > 0 && d.checkpoints.every((c) => ackedIds.has(c.id))
      const priorSigned = d.versions.find((v) => !v.isCurrent && v.signedRecords.length > 0)

      let status: StaffDocumentRow["status"]
      if (currentRecord) status = "signed"
      else if (allAcked) status = "pending-record"
      else if (priorCycleRecord || priorSigned) status = "needs-current"
      else if (ackedIds.size > 0) status = "in-progress"
      else status = "not-started"

      return [
        {
          documentId: d.id,
          title: d.title,
          category: d.category,
          currentVersionNumber: current.versionNumber,
          status,
          signedVersionNumber: currentRecord
            ? current.versionNumber
            : allAcked
              ? current.versionNumber
              : priorCycleRecord
                ? current.versionNumber
                : priorSigned?.versionNumber ?? null,
          completedAt: currentRecord?.completedAt.toISOString() ?? null,
          signedRecordId:
            currentRecord?.id ??
            priorCycleRecord?.id ??
            priorSigned?.signedRecords[0]?.id ??
            null,
          ackedCount: ackedIds.size,
          requiredCount,
        },
      ]
    })
  }

  // HR-5 agreement forms: every applicable FillableForm with the staff
  // member's FULL submission history (re-execution is routine). Archived
  // forms with history stay visible so records never disappear; linked
  // Check-Out/Check-In pairs are grouped by the client component.
  let formDocRows: StaffFormDocRow[] = []
  if (canSeeNotes) {
    const memberStoreIds = member.storeAssignments.map((a) => a.storeId)
    const formDocs = await prisma.hrDocument.findMany({
      where: {
        organizationId: member.organizationId,
        kind: "FillableForm",
        isActive: true,
        OR: [
          { appliesTo: "all" },
          { storeAssignments: { some: { storeId: { in: memberStoreIds } } } },
        ],
      },
      select: { id: true, title: true, category: true, linkedFormId: true },
      orderBy: { title: "asc" },
    })
    const submissions = await prisma.formSubmission.findMany({
      where: {
        staffMemberId: member.id,
        version: { hrDocument: { organizationId: member.organizationId, kind: "FillableForm" } },
      },
      include: {
        version: {
          select: {
            versionNumber: true,
            hrDocument: {
              select: { id: true, title: true, category: true, linkedFormId: true, isActive: true },
            },
          },
        },
      },
      orderBy: { signedAt: "desc" },
    })

    const rowByDocId = new Map<string, StaffFormDocRow>(
      formDocs.map((d) => [
        d.id,
        {
          documentId: d.id,
          title: d.title,
          category: d.category,
          linkedFormId: d.linkedFormId,
          active: true,
          submissions: [],
        },
      ])
    )
    for (const sub of submissions) {
      const subDoc = sub.version.hrDocument
      // Submissions on archived (or store-unassigned) forms are records too —
      // surface them with execution disabled.
      if (!rowByDocId.has(subDoc.id)) {
        rowByDocId.set(subDoc.id, {
          documentId: subDoc.id,
          title: sub.formTitle ?? subDoc.title,
          category: subDoc.category,
          linkedFormId: subDoc.linkedFormId,
          active: false,
          submissions: [],
        })
      }
      rowByDocId.get(subDoc.id)!.submissions.push({
        id: sub.id,
        status: sub.status,
        versionNumber: sub.formVersionNumber ?? sub.version.versionNumber,
        employeeSignedAt: (sub.employeeSignedAt ?? sub.signedAt).toISOString(),
        supervisorSignedAt: sub.supervisorSignedAt?.toISOString() ?? null,
        hasPdf: !!sub.signedPdfPathname,
      })
    }
    formDocRows = [...rowByDocId.values()]
  }

  // HR-7.6 Uploaded Documents: manager-uploaded files for this member, with
  // the team-visibility flag. Uploader names are stitched via a second query
  // (uploadedByUserId has no FK — uploads survive the uploader's deletion).
  let uploadRows: StaffUploadRow[] = []
  if (canSeeNotes) {
    const uploads = await prisma.staffDocument.findMany({
      where: { staffMemberId: member.id, organizationId: member.organizationId },
      orderBy: { createdAt: "desc" },
    })
    const uploaderIds = [...new Set(uploads.map((u) => u.uploadedByUserId))]
    const uploaders = uploaderIds.length
      ? await prisma.user.findMany({
          where: { id: { in: uploaderIds } },
          select: { id: true, name: true, email: true },
        })
      : []
    const uploaderById = new Map(uploaders.map((u) => [u.id, u.name ?? u.email]))
    uploadRows = uploads.map((u) => ({
      id: u.id,
      title: u.title,
      category: u.category,
      fileName: u.fileName,
      sizeBytes: u.sizeBytes,
      visibleToStaff: u.visibleToStaff,
      uploadedByName: uploaderById.get(u.uploadedByUserId) ?? null,
      createdAt: u.createdAt.toISOString(),
    }))
  }

  // HR-7 Training tab: assignments with lesson progress, quiz attempts, and
  // certification state, plus the assignable-module and trainer lists for the
  // Assign dialog. Same ADMIN/MANAGER tier as the other management surfaces.
  let trainingAssignments: StaffTrainingAssignment[] = []
  let assignableModules: { id: string; title: string }[] = []
  let trainers: { id: string; name: string }[] = []
  if (canSeeNotes) {
    const memberStoreIds = member.storeAssignments.map((a) => a.storeId)
    const [assignments, modules, trainerUsers] = await Promise.all([
      prisma.trainingAssignment.findMany({
        where: { staffMemberId: member.id, trainingModule: { organizationId: member.organizationId } },
        include: {
          trainingModule: {
            select: {
              title: true,
              lessons: { orderBy: { orderIndex: "asc" }, select: { id: true, title: true } },
              quizzes: { select: { passThreshold: true, questions: true } },
            },
          },
          lessonProgress: { select: { trainingLessonId: true, completedAt: true, authMethod: true } },
          quizAttempts: {
            orderBy: { submittedAt: "desc" },
            select: {
              id: true,
              scorePct: true,
              status: true,
              submittedAt: true,
              authMethod: true,
              questionsSnapshot: true,
              answers: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.trainingModule.findMany({
        where: {
          organizationId: member.organizationId,
          isActive: true,
          isArchived: false,
          OR: [
            { appliesTo: "all" },
            { storeAssignments: { some: { storeId: { in: memberStoreIds } } } },
          ],
        },
        select: { id: true, title: true },
        orderBy: { title: "asc" },
      }),
      prisma.user.findMany({
        where: { organizationId: member.organizationId, role: { in: ["ADMIN", "MANAGER"] } },
        select: { id: true, name: true, email: true },
        orderBy: { name: "asc" },
      }),
    ])

    const trainerById = new Map(trainerUsers.map((t) => [t.id, t.name ?? t.email]))
    trainingAssignments = assignments.map((a) => {
      const progressByLesson = new Map(a.lessonProgress.map((p) => [p.trainingLessonId, p]))
      const quiz = a.trainingModule.quizzes[0]
      return {
        id: a.id,
        moduleTitle: a.trainingModule.title,
        dueDate: a.dueDate?.toISOString() ?? null,
        status: a.status,
        hoursLogged: a.hoursLogged,
        certifiedAt: a.certifiedAt?.toISOString() ?? null,
        hasCertPdf: !!a.certPdfPathname,
        trainerName: a.trainerUserId ? (trainerById.get(a.trainerUserId) ?? null) : null,
        assignedAt: a.createdAt.toISOString(),
        lessons: a.trainingModule.lessons.map((l) => ({
          id: l.id,
          title: l.title,
          completedAt: progressByLesson.get(l.id)?.completedAt.toISOString() ?? null,
          authMethod: progressByLesson.get(l.id)?.authMethod ?? null,
        })),
        quiz: quiz
          ? {
              passThreshold: quiz.passThreshold,
              questionCount: Array.isArray(quiz.questions) ? quiz.questions.length : 0,
            }
          : null,
        attempts: a.quizAttempts.map((t) => {
          // Written Q&A travels only for attempts a trainer still needs to
          // grade — the review dialog shows the prompt + the staff answer.
          let writtenItems: { questionId: string; prompt: string; answer: string }[] | undefined
          if (t.status === "PendingReview" && Array.isArray(t.questionsSnapshot)) {
            const answers = (t.answers ?? {}) as Record<string, string | string[]>
            writtenItems = (t.questionsSnapshot as { id?: string; type?: string; prompt?: string }[])
              .filter((q) => q.type === "written" && q.id)
              .map((q) => ({
                questionId: q.id as string,
                prompt: q.prompt ?? "",
                answer: typeof answers[q.id as string] === "string" ? (answers[q.id as string] as string) : "",
              }))
          }
          return {
            id: t.id,
            scorePct: t.scorePct,
            status: t.status,
            submittedAt: t.submittedAt.toISOString(),
            authMethod: t.authMethod,
            writtenItems,
          }
        }),
      }
    })
    const assignedModuleIds = new Set(assignments.map((a) => a.trainingModuleId))
    assignableModules = modules.filter((m) => !assignedModuleIds.has(m.id))
    trainers = trainerUsers.map((t) => ({ id: t.id, name: t.name ?? t.email }))
  }

  // HR-8 Compliance tab: this member's required items with statuses. Same
  // ADMIN/MANAGER tier as Documents/Training — the statuses here are derived
  // from the same records those tabs show. Terminated members still render
  // their records (auditable) behind an exclusion banner.
  let complianceDetail: StaffComplianceDetail | null = null
  if (canSeeNotes) {
    complianceDetail = await getStaffComplianceDetail(member.organizationId, member.id)
  }

  let notes: SerializedNote[] = []
  if (canSeeNotes) {
    // ManagerNote.authorUserId has no Prisma relation to User (deliberate — no
    // FK, so notes survive author deletion); stitch authors in a second query.
    const rows = await prisma.managerNote.findMany({
      where: { staffMemberId: member.id, organizationId: member.organizationId },
      orderBy: { createdAt: "desc" },
    })
    const authors = await prisma.user.findMany({
      where: { id: { in: [...new Set(rows.map((n) => n.authorUserId))] } },
      select: { id: true, name: true, email: true },
    })
    const authorById = new Map(authors.map((a) => [a.id, a]))
    notes = rows.map((n) => ({
      id: n.id,
      category: n.category,
      body: n.body,
      createdAt: n.createdAt.toISOString(),
      updatedAt: n.updatedAt.toISOString(),
      authorUserId: n.authorUserId,
      authorName: authorById.get(n.authorUserId)?.name ?? null,
      authorEmail: authorById.get(n.authorUserId)?.email ?? null,
    }))
  }

  return (
    <div>
      <Link
        href="/staff"
        className="inline-flex items-center gap-1.5 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] mb-4"
      >
        <ArrowLeft className="h-4 w-4" />
        Staff Members
      </Link>

      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-[var(--color-foreground)]">{member.displayName}</h1>
            {member.squareTeamMemberId && <Badge variant="info">Synced from Square</Badge>}
            {member.status === "TERMINATED" && <Badge variant="destructive">Terminated</Badge>}
            {member.status !== "TERMINATED" && member.userId && <Badge variant="success">Self-service login</Badge>}
            {member.status !== "TERMINATED" && !member.userId && invitePending && (
              <Badge variant="warning">Invite pending</Badge>
            )}
          </div>
          <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
            {member.fullName ?? member.displayName} · Member since {format(member.createdAt, "MMMM d, yyyy")}
          </p>
          {member.storeAssignments.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {member.storeAssignments.map((a) => (
                <span
                  key={a.id}
                  className={`inline-flex items-center gap-1 rounded-full text-xs font-medium px-2 py-0.5 ${
                    a.isPrimary
                      ? "bg-[var(--color-primary)] text-white"
                      : "bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
                  }`}
                  title={a.isPrimary ? "Primary store" : undefined}
                >
                  {a.isPrimary && <span aria-label="Primary store">★</span>}
                  {a.store.name}
                </span>
              ))}
            </div>
          )}
          {member.status === "TERMINATED" && member.terminatedAt && (
            <p className="text-sm text-[var(--color-destructive)] mt-2">
              Terminated {format(member.terminatedAt, "MMMM d, yyyy")} — records retained
            </p>
          )}
          {member.status === "ACTIVE" && member.rehiredAt && (
            <p className="text-sm text-[var(--color-muted-foreground)] mt-2">
              Rehired {format(member.rehiredAt, "MMMM d, yyyy")} — required documents need re-signing
            </p>
          )}
        </div>
        {canSeeNotes && (
          <div className="flex flex-col items-end gap-2">
            <StaffEditActions
              staffId={member.id}
              isSquareLinked={!!member.squareTeamMemberId}
              stores={editStores}
              current={{
                displayName: member.displayName,
                fullName: member.fullName,
                email: member.email,
                assignedStoreIds: member.storeAssignments.map((a) => a.storeId),
                primaryStoreId: member.storeAssignments.find((a) => a.isPrimary)?.storeId ?? null,
              }}
            />
            <SelfServiceActions
              staffId={member.id}
              displayName={member.displayName}
              email={member.email}
              hasLogin={!!member.userId}
              invitePending={invitePending}
              status={member.status}
            />
          </div>
        )}
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="training">Training</TabsTrigger>
          {canSeeNotes && <TabsTrigger value="notes">Notes</TabsTrigger>}
          <TabsTrigger value="compliance">Compliance</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4 space-y-4">
          <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-6">
            <h2 className="text-sm font-semibold text-[var(--color-foreground)] mb-4">Details</h2>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 text-sm">
              <div>
                <dt className="text-[var(--color-muted-foreground)]">Display Name</dt>
                <dd className="text-[var(--color-foreground)] font-medium">{member.displayName}</dd>
              </div>
              <div>
                <dt className="text-[var(--color-muted-foreground)]">Full Name</dt>
                <dd className="text-[var(--color-foreground)] font-medium">{member.fullName ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-[var(--color-muted-foreground)]">Email</dt>
                <dd className="text-[var(--color-foreground)] font-medium">{member.email ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-[var(--color-muted-foreground)]">Member Since</dt>
                <dd className="text-[var(--color-foreground)] font-medium">{format(member.createdAt, "MMMM d, yyyy")}</dd>
              </div>
              <div>
                <dt className="text-[var(--color-muted-foreground)]">Source</dt>
                <dd className="text-[var(--color-foreground)] font-medium">
                  {member.squareTeamMemberId ? "Synced from Square" : "Added manually"}
                </dd>
              </div>
            </dl>
          </div>

          <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-6">
            <h2 className="text-sm font-semibold text-[var(--color-foreground)] mb-4">Store Assignments</h2>
            {member.storeAssignments.length === 0 ? (
              <p className="text-sm text-[var(--color-muted-foreground)]">
                Not assigned to any store yet. Assign stores from the staff directory.
              </p>
            ) : (
              <ul className="space-y-2">
                {member.storeAssignments.map((a) => (
                  <li key={a.id} className="flex items-center gap-2 text-sm text-[var(--color-foreground)]">
                    <Store className="h-4 w-4 text-[var(--color-muted-foreground)]" />
                    {a.store.storeNumber ? `#${a.store.storeNumber} - ` : ""}
                    {a.store.name}
                    {a.isPrimary && (
                      <span className="text-xs font-medium text-[var(--color-primary)]">★ Primary</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </TabsContent>

        <TabsContent value="documents" className="mt-4">
          {canSeeNotes ? (
            <div className="space-y-6">
              <StaffDocuments staffId={member.id} rows={documentRows} />
              {formDocRows.length > 0 && (
                <StaffFormDocuments staffId={member.id} rows={formDocRows} />
              )}
              <StaffUploadedDocuments
                staffId={member.id}
                staffName={member.displayName}
                rows={uploadRows}
              />
            </div>
          ) : (
            <div className="border border-dashed border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-12 text-center">
              <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-[var(--color-muted)] flex items-center justify-center">
                <FileText className="h-6 w-6 text-[var(--color-muted-foreground)]" />
              </div>
              <p className="font-medium text-[var(--color-foreground)] mb-1">Restricted</p>
              <p className="text-sm text-[var(--color-muted-foreground)] max-w-md mx-auto">
                Document acknowledgment statuses and signed records are visible to managers and
                admins only.
              </p>
            </div>
          )}
        </TabsContent>

        <TabsContent value="training" className="mt-4">
          {canSeeNotes ? (
            <StaffTraining
              staffId={member.id}
              staffActive={member.status === "ACTIVE"}
              hasLogin={!!member.userId}
              assignments={trainingAssignments}
              assignableModules={assignableModules}
              trainers={trainers}
            />
          ) : (
            <ShellTab
              icon={GraduationCap}
              title="Training"
              copy="Training statuses are visible to managers and admins."
              phase="HR-7"
            />
          )}
        </TabsContent>

        {canSeeNotes && (
          <TabsContent value="notes" className="mt-4">
            <ManagerNotes
              staffId={member.id}
              notes={notes}
              viewerRole={dbUser?.role ?? "STAFF"}
              viewerUserId={dbUser?.id ?? ""}
            />
          </TabsContent>
        )}

        <TabsContent value="compliance" className="mt-4">
          {canSeeNotes && complianceDetail ? (
            <StaffCompliance detail={complianceDetail} />
          ) : (
            <div className="border border-dashed border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-12 text-center">
              <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-[var(--color-muted)] flex items-center justify-center">
                <Gauge className="h-6 w-6 text-[var(--color-muted-foreground)]" />
              </div>
              <p className="font-medium text-[var(--color-foreground)] mb-1">Restricted</p>
              <p className="text-sm text-[var(--color-muted-foreground)] max-w-md mx-auto">
                Compliance statuses are visible to managers and admins only.
              </p>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
