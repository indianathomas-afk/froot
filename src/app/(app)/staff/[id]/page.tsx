import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { formatInstant } from "@/lib/display-time"
import { ArrowLeft, FileText, GraduationCap, Gauge, Store } from "lucide-react"
import { getCurrentUser, getUserStoreScope, hrModuleAvailable, requireModule } from "@/lib/auth"
import { displayTimeZone } from "@/lib/hr"
import { can } from "@/lib/permissions"
import { staffAudienceWhere } from "@/lib/hr-documents-access"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { LegalNameControls } from "./legal-name-controls"
import { ManagerNotes, type SerializedNote } from "./manager-notes"
import { StaffDocuments, type StaffDocumentRow } from "./staff-documents"
import { StaffFormDocuments, type StaffFormDocRow } from "./staff-form-documents"
import { StaffUploadedDocuments, type StaffUploadRow } from "./staff-uploaded-documents"
import { SelfServiceActions } from "./self-service-actions"
import { StaffEditActions } from "./staff-edit-actions"
import { StaffTraining, type StaffTrainingAssignment } from "./staff-training"
import { StaffCompliance } from "./staff-compliance"
import { getStaffComplianceDetail, type StaffComplianceDetail } from "@/lib/hr-compliance"
import { documentCompletion } from "@/lib/hr-completion"

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
      // DEBT-70b: the org half of the display-zone chain, for corporate members
      // and anyone with no store assignment. `store: true` above already carries
      // `timezone`, so the store half needed no change.
      organization: { select: { timezone: true } },
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

  // PERM-5C. This page ran on ONE flag — `canSeeNotes`, an inline
  // ADMIN||MANAGER test — driving the edit buttons, the notes tab, the
  // documents tab, training and compliance alike. That is precisely why Gary's
  // example (b), "keeps /staff read access but cannot edit employees", was not
  // expressible: there was no seam between reading this page and acting on it.
  // The flag splits four ways below. Every capability named is MANAGE, and the
  // check replaced was ADMIN||MANAGER, so NO ROLE GAINS OR LOSES ANYTHING —
  // what changes is that four independent denials now exist where there was
  // one undifferentiated tier.
  const { dbUser, actor } = await getCurrentUser()

  // Writes: the edit dialog, the self-service invite, the legal-name
  // resolutions, and the integrity warnings that exist to prompt a fix.
  const canManage = can(actor, "staff.manage")
  // The Notes tab and its three routes.
  const canSeeNotes = can(actor, "staff.notes.use")
  // Manager-uploaded files and the five /api/staff/[id]/documents handlers.
  const canSeeUploads = can(actor, "staff.documents.manage")
  // HR-derived read tabs (acknowledgment statuses, agreement forms, training,
  // compliance). DELIBERATELY LEFT ON THE ROLE CHECK: these render HR records
  // and HR is its own migration phase, out of Session C's scope by ruling 5.
  // Migrating them onto hr.* capabilities here would start that phase in the
  // one file least likely to be reviewed as part of it.
  const canSeeHrTabs = dbUser?.role === "ADMIN" || dbUser?.role === "MANAGER"

  // HR-7 self-service state: linked login / invite still pending. Gated with
  // the write tier — it exists to drive the invite button.
  const invitePending = canManage
    ? (await prisma.pendingInvite.findFirst({
        where: { organizationId: member.organizationId, staffMemberId: member.id },
        select: { id: true },
      })) !== null
    : false

  // Signing-integrity flags (Full Name / store rulings). No store assignment is
  // an anomaly (documents stamp a blank store). A name-mismatch = a document
  // was executed under a typed name different from the legal name on record;
  // it's surfaced for an ADMIN/MANAGER to reconcile at the source — write-back
  // from the ceremony is never automatic (a mistyped signature must not rewrite
  // the roster). See DECISIONS.
  // DEBT-9: both store warnings are silenced for corporate staff, and the
  // reason differs for each. `noStore` claims signed documents "stamp a blank
  // store" — false for them, since primaryStoreName() returns "Corporate"
  // regardless of assignments. `noPrimary` names a fix that must not be applied
  // to them: setting a primary would write a store name that is not true, which
  // is the whole reason the designation exists.
  // DEBT-70b: this profile's display zone — the member's primary store, else
  // the org. Every date on the page renders through it, so the Overview and
  // Compliance tabs cannot disagree about the same instant again.
  const zone = displayTimeZone(member, member.organization)
  const noStore = !member.isCorporate && member.storeAssignments.length === 0
  const noPrimary =
    !member.isCorporate &&
    member.storeAssignments.length >= 2 &&
    !member.storeAssignments.some((a) => a.isPrimary)
  const nameMismatches = canManage
    ? (
        await prisma.hrDocumentAcknowledgment.findMany({
          where: {
            staffMemberId: member.id,
            checkpointType: { in: ["Signature", "Acknowledgment"] },
          },
          select: { typedName: true, staffName: true, documentTitle: true, signedAt: true },
          orderBy: { signedAt: "desc" },
        })
      ).filter((a) => a.typedName && a.typedName.trim() !== a.staffName.trim())
    : []

  // Stores available in the Edit dialog — scoped like the rest of the app:
  // ADMIN sees all org stores, MANAGER only their own.
  const { isAdmin, storeIds: viewerStoreIds } = await getUserStoreScope()
  const editStores = canManage
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
  if (canSeeHrTabs) {
    const docs = await prisma.hrDocument.findMany({
      where: {
        organizationId: member.organizationId,
        kind: "Acknowledgment",
        isActive: true,
        requiresAcknowledgment: true,
        // DOC-1 A: the hand-written OR clause became staffAudienceWhere. The
        // subject is the PROFILE'S OWNER, never the manager reading the page —
        // this tab has always answered "what does this person owe", and the
        // audience rule keeps that subject.
        ...staffAudienceWhere(member),
      },
      include: {
        // HR-11n: retired checkpoints leave the denominator (see hr-compliance.ts).
        checkpoints: { where: { required: true, retiredAt: null }, select: { id: true } },
        versions: {
          orderBy: { versionNumber: "desc" },
          include: {
            // R2: ORDERING ADDED, AND IT IS NOW LOAD-BEARING. This was
            // unordered and read as `[0]`, which was nearly harmless while the
            // value only fed a boolean and a download link. R2 makes a record
            // SELECT a version to display, and a rehire holds two records on one
            // version across two cycles, so `[0]` was about to become "whatever
            // Postgres returned". Newest tenure first, newest record first.
            signedRecords: {
              where: { staffMemberId: member.id },
              orderBy: [{ signingCycle: "desc" }, { completedAt: "desc" }],
            },
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
      // ── R2 (HR-11k Phase A, Gary 2026-08-15) ──────────────────────────────
      // `v.signedRecords.length > 0` asked "did they ever sign this older
      // version, in any tenure" — one question standing in for two, and R2
      // answers them oppositely. Split by CYCLE, not by version: versions are
      // already ordered versionNumber DESC above, so each find returns the
      // highest match, and for R2 that is this signer's master document.
      const priorSignedThisCycle = d.versions.find(
        (v) =>
          !v.isCurrent && v.signedRecords.some((r) => r.signingCycle === member.signingCycle)
      )
      const priorSignedPriorCycle = d.versions.find(
        (v) =>
          !v.isCurrent && v.signedRecords.some((r) => r.signingCycle !== member.signingCycle)
      )

      // R1: asked, not restated — the same predicate /my/documents and the
      // compliance rollup use, so this tab and the portal cannot disagree about
      // one person and one document by being edited apart.
      const completion = documentCompletion({
        hasCurrentCycleRecord: !!currentRecord,
        hasPriorCycleRecordOnCurrentVersion: !!priorCycleRecord,
        hasCurrentCycleRecordOnEarlierVersion: !!priorSignedThisCycle,
        hasPriorCycleRecordOnEarlierVersion: !!priorSignedPriorCycle,
        // Case A: read off the version IN FORCE, never off the version signed.
        currentVersionRequiresReacknowledgment: current.requiresReacknowledgment,
        requiredCount,
        ackedCount: ackedIds.size,
        allRequiredAcked: allAcked,
      })

      return [
        {
          documentId: d.id,
          title: d.title,
          category: d.category,
          currentVersionNumber: current.versionNumber,
          status: completion.status,
          recordMissing: completion.recordMissing,
          signedOnEarlierVersion: completion.signedOnEarlierVersion,
          reacknowledgmentRequired: completion.reacknowledgmentRequired,
          // ── R1 (Gary, 2026-08-15): A VERSION NUMBER ONLY EVER COMES FROM A
          // RECORD. The `allAcked` arm removed here returned
          // current.versionNumber when NO record existed, so the admin surface
          // printed "Signed v2" for a signature that was never executed — worse
          // than printing nothing, because a version number reads as having been
          // looked up rather than assumed. Each remaining branch names a record
          // that exists: this cycle's, a prior cycle's on the current version, or
          // one on an older version.
          //
          // R2 (2026-08-15) SPLITS THE LAST BRANCH IN TWO and preserves the
          // invariant unchanged — both new branches still name a record. This
          // cycle's older-version record is tried first because it is the one
          // that produces a GREEN label, and picking the rehire's number there
          // would print the wrong version under the right status.
          signedVersionNumber: currentRecord
            ? current.versionNumber
            : priorCycleRecord
              ? current.versionNumber
              : (priorSignedThisCycle?.versionNumber ??
                priorSignedPriorCycle?.versionNumber ??
                null),
          // Ruled 2026-08-16: the date comes from the record they actually
          // signed. Resolved from the SAME record object the version number and
          // the download link below resolve from, so all three name one record.
          completedAt:
            (
              currentRecord ??
              priorSignedThisCycle?.signedRecords.find(
                (r) => r.signingCycle === member.signingCycle
              )
            )?.completedAt.toISOString() ?? null,
          // The record behind the label, in the same precedence as the number
          // above — so the download link and the version it claims can never
          // name two different records.
          signedRecordId:
            currentRecord?.id ??
            priorCycleRecord?.id ??
            priorSignedThisCycle?.signedRecords.find(
              (r) => r.signingCycle === member.signingCycle
            )?.id ??
            priorSignedPriorCycle?.signedRecords[0]?.id ??
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
  if (canSeeHrTabs) {
    const formDocs = await prisma.hrDocument.findMany({
      where: {
        organizationId: member.organizationId,
        kind: "FillableForm",
        isActive: true,
        // DOC-1 A: same rule as the Documents tab above, per Gary's ruling 1
        // (2026-08-12) — two tabs on one page must follow one audience rule.
        // The /hr/forms surfaces are out of scope and keep their ADMIN /
        // store-scoped-MANAGER gates; this is the staff-facing view of which
        // agreements reach this person, which is an audience question.
        ...staffAudienceWhere(member),
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
  if (canSeeUploads) {
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
  if (canSeeHrTabs) {
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
  if (canSeeHrTabs) {
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
            {/* DEBT-9: READ-ONLY. The admin control that SETS this is deferred
                to DEBT-49; Phase 4 sets it by SQL. Without a badge the flag is
                invisible in the product, so nobody can confirm it landed
                without a database query. Display only — do not grow a write
                path here, that is DEBT-49's and it carries an unresolved rule
                about what happens to a stale isPrimary star. */}
            {member.isCorporate && <Badge variant="info">Corporate</Badge>}
            {member.squareTeamMemberId && <Badge variant="info">Synced from Square</Badge>}
            {member.status === "TERMINATED" && <Badge variant="destructive">Terminated</Badge>}
            {member.status !== "TERMINATED" && member.userId && <Badge variant="success">Self-service login</Badge>}
            {member.status !== "TERMINATED" && !member.userId && invitePending && (
              <Badge variant="warning">Invite pending</Badge>
            )}
          </div>
          <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
            {member.fullName ?? member.displayName} · Member since {formatInstant(member.createdAt, zone, "long")}
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
              Terminated {formatInstant(member.terminatedAt, zone, "long")} — records retained
            </p>
          )}
          {member.status === "ACTIVE" && member.rehiredAt && (
            <p className="text-sm text-[var(--color-muted-foreground)] mt-2">
              Rehired {formatInstant(member.rehiredAt, zone, "long")} — required documents need re-signing
            </p>
          )}
          {canManage && noStore && (
            <p className="text-sm text-[var(--color-warning,#efa201)] mt-2">
              No store assigned — signed documents stamp a blank store. Assign a store below.
            </p>
          )}
          {canManage && noPrimary && (
            <p className="text-sm text-[var(--color-warning,#efa201)] mt-2">
              No primary store — signed documents stamp whichever store sorts first. Set a primary
              below.
            </p>
          )}
          {canManage && nameMismatches.length > 0 && (
            <div className="mt-2 rounded-md border border-[var(--color-warning,#efa201)]/40 bg-[var(--color-warning,#efa201)]/10 px-3 py-2 text-xs">
              <p className="font-medium text-[var(--color-foreground)]">
                Signed under a name different from the record
              </p>
              <p className="mt-0.5 text-[var(--color-muted-foreground)]">
                {nameMismatches
                  .slice(0, 3)
                  .map((m) => `“${m.typedName}” on ${m.documentTitle}`)
                  .join("; ")}
                {nameMismatches.length > 3 ? ` +${nameMismatches.length - 3} more` : ""} — record says
                “{member.fullName ?? member.displayName}”. If the roster is wrong, correct the legal
                name here; the frozen signed records keep what was executed.
              </p>
            </div>
          )}
        </div>
        {canManage && (
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
              <LegalNameControls
                staffId={member.id}
                fullName={member.fullName}
                fullNameLocked={member.fullNameLocked}
                squareFullName={member.squareFullName}
                canManage={canManage}
              />
              <div>
                <dt className="text-[var(--color-muted-foreground)]">Email</dt>
                <dd className="text-[var(--color-foreground)] font-medium">{member.email ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-[var(--color-muted-foreground)]">Member Since</dt>
                <dd className="text-[var(--color-foreground)] font-medium">{formatInstant(member.createdAt, zone, "long")}</dd>
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
                    {a.store.storeNumber ? `#${a.store.storeNumber} — ` : ""}
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
          {canSeeHrTabs || canSeeUploads ? (
            <div className="space-y-6">
              {/* Two capabilities share this tab. The acknowledgment statuses and
                  agreement forms are HR records (still role-gated, HR's own
                  phase); the uploaded files are staff.documents.manage, whose
                  five API handlers this session migrated. Rendered separately so
                  denying the uploads does not blank the HR half, and vice
                  versa. */}
              {canSeeHrTabs && <StaffDocuments staffId={member.id} rows={documentRows} />}
              {canSeeHrTabs && formDocRows.length > 0 && (
                <StaffFormDocuments staffId={member.id} rows={formDocRows} />
              )}
              {canSeeUploads && (
                <StaffUploadedDocuments
                  staffId={member.id}
                  staffName={member.displayName}
                  rows={uploadRows}
                />
              )}
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
          {canSeeHrTabs ? (
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
          {canSeeHrTabs && complianceDetail ? (
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
