// HR-8 compliance rollup. Everything here is computed live from existing
// records — no stored snapshots, so the numbers always reflect the current
// Neon branch and can never drift per-environment.
//
// Definitions (Gary, 2026-07-22 — see docs/DECISIONS.md):
// - Acknowledgment docs count against the CURRENT version only. All required
//   checkpoints acknowledged = compliant even before the signed PDF is
//   generated (generation is mechanical + idempotent). A record signed against
//   an older version is its own "needs-resign" status, not "not-started".
// - Agreement forms (FillableForm) stay OUT of the compliance percentage —
//   there is no assignment mechanism that says who is *supposed* to hold one.
//   They surface separately, with PendingSupervisor countersigns as the gap.
// - Training: assigned module is compliant when status = "Completed";
//   certification is a separate stricter badge. Past dueDate and not
//   Completed = "overdue", the loudest gap state.
// - Only ACTIVE staff count in rollups; terminated staff keep auditable
//   records but are excluded from every percentage.

import { prisma } from "@/lib/prisma"

export type ComplianceItemStatus =
  | "complete"
  | "in-progress"
  | "needs-resign"
  | "overdue"
  | "not-started"

export type ComplianceDocItem = {
  kind: "document"
  documentId: string
  title: string
  category: string
  status: ComplianceItemStatus
  currentVersionNumber: number
  ackedCount: number
  requiredCount: number
  /** Version a prior signed record was executed against, when needs-resign. */
  signedVersionNumber: number | null
  completedAt: string | null
}

export type ComplianceTrainingItem = {
  kind: "training"
  assignmentId: string
  moduleTitle: string
  status: ComplianceItemStatus
  dueDate: string | null
  certified: boolean
  lessonsDone: number
  lessonsTotal: number
}

export type ComplianceItem = ComplianceDocItem | ComplianceTrainingItem

export type StaffComplianceDetail = {
  staffId: string
  displayName: string
  fullName: string | null
  active: boolean
  primaryStoreId: string | null
  primaryStoreName: string | null
  storeIds: string[]
  items: ComplianceItem[]
  requiredTotal: number
  completedCount: number
  pct: number | null
  overdueCount: number
  needsResignCount: number
  inProgressCount: number
}

export type StaffComplianceSummary = {
  requiredTotal: number
  completed: number
  pct: number | null
}

export type StoreComplianceRollup = {
  storeId: string | null // null = staff with no store assignment
  storeName: string
  staffCount: number
  requiredTotal: number
  completedCount: number
  pct: number | null
  fullyCompliant: number
  overdueCount: number
  needsResignCount: number
}

export type AgreementFormRollup = {
  documentId: string
  title: string
  executedCount: number
  pendingCount: number
}

export type PendingCountersign = {
  submissionId: string
  formTitle: string
  staffId: string
  staffName: string
  employeeSignedAt: string
}

export type OrgComplianceRollup = {
  totals: {
    staffCount: number
    requiredTotal: number
    completedCount: number
    pct: number | null
    fullyCompliant: number
    overdueCount: number
    needsResignCount: number
  }
  stores: StoreComplianceRollup[]
  staff: StaffComplianceDetail[]
  agreements: {
    forms: AgreementFormRollup[]
    pending: PendingCountersign[]
  }
}

const pctOf = (completed: number, required: number): number | null =>
  required > 0 ? Math.round((completed / required) * 100) : null

// ─── Core: per-staff compliance details, computed in a fixed set of batched
// queries (never per-staff) ──────────────────────────────────────────────────
//
// The document-status derivation mirrors /staff/[id] (HR-4) exactly so the
// rollup and the profile page can never disagree:
//   signed record on current version → complete
//   all required checkpoints acked   → complete ("pending-record" upstream)
//   signed record on older version   → needs-resign
//   some checkpoints acked           → in-progress
//   otherwise                        → not-started

export async function computeStaffComplianceDetails(
  organizationId: string,
  staffIds?: string[]
): Promise<StaffComplianceDetail[]> {
  if (staffIds && staffIds.length === 0) return []

  const staff = await prisma.staffMember.findMany({
    where: { organizationId, ...(staffIds ? { id: { in: staffIds } } : { status: "ACTIVE" }) },
    include: {
      storeAssignments: {
        include: { store: { select: { id: true, name: true } } },
        orderBy: [{ isPrimary: "desc" }, { store: { name: "asc" } }],
      },
    },
    orderBy: { displayName: "asc" },
  })
  if (staff.length === 0) return []
  const allStaffIds = staff.map((s) => s.id)

  const [docs, assignments] = await Promise.all([
    prisma.hrDocument.findMany({
      where: {
        organizationId,
        kind: "Acknowledgment",
        isActive: true,
        requiresAcknowledgment: true,
      },
      include: {
        checkpoints: { where: { required: true }, select: { id: true } },
        storeAssignments: { select: { storeId: true } },
        versions: {
          orderBy: { versionNumber: "desc" },
          select: { id: true, versionNumber: true, isCurrent: true },
        },
      },
      orderBy: { title: "asc" },
    }),
    prisma.trainingAssignment.findMany({
      where: {
        staffMemberId: { in: allStaffIds },
        trainingModule: { organizationId },
      },
      include: {
        trainingModule: {
          select: { title: true, lessons: { select: { id: true } } },
        },
        lessonProgress: { select: { trainingLessonId: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
  ])

  const allVersionIds = docs.flatMap((d) => d.versions.map((v) => v.id))
  const currentVersionIds = docs
    .map((d) => d.versions.find((v) => v.isCurrent)?.id)
    .filter((id): id is string => !!id)

  const [signedRecords, acks] = await Promise.all([
    allVersionIds.length
      ? prisma.hrSignedRecord.findMany({
          where: { hrDocumentVersionId: { in: allVersionIds }, staffMemberId: { in: allStaffIds } },
          select: { hrDocumentVersionId: true, staffMemberId: true, completedAt: true },
        })
      : [],
    currentVersionIds.length
      ? prisma.hrDocumentAcknowledgment.findMany({
          where: {
            hrDocumentVersionId: { in: currentVersionIds },
            staffMemberId: { in: allStaffIds },
          },
          select: { hrDocumentVersionId: true, staffMemberId: true, checkpointId: true },
        })
      : [],
  ])

  // (versionId → staffId → record) and (versionId → staffId → Set<checkpointId>)
  const recordByVersionStaff = new Map<string, { completedAt: Date }>()
  for (const r of signedRecords) {
    recordByVersionStaff.set(`${r.hrDocumentVersionId}:${r.staffMemberId}`, {
      completedAt: r.completedAt,
    })
  }
  const ackedByVersionStaff = new Map<string, Set<string>>()
  for (const a of acks) {
    const key = `${a.hrDocumentVersionId}:${a.staffMemberId}`
    if (!ackedByVersionStaff.has(key)) ackedByVersionStaff.set(key, new Set())
    ackedByVersionStaff.get(key)!.add(a.checkpointId)
  }

  const assignmentsByStaff = new Map<string, typeof assignments>()
  for (const a of assignments) {
    if (!assignmentsByStaff.has(a.staffMemberId)) assignmentsByStaff.set(a.staffMemberId, [])
    assignmentsByStaff.get(a.staffMemberId)!.push(a)
  }

  const now = new Date()

  return staff.map((member) => {
    const memberStoreIds = member.storeAssignments.map((a) => a.storeId)
    const primary = member.storeAssignments[0] ?? null

    const docItems: ComplianceDocItem[] = docs.flatMap((d) => {
      const applies =
        d.appliesTo === "all" ||
        d.storeAssignments.some((sa) => memberStoreIds.includes(sa.storeId))
      if (!applies) return []
      const current = d.versions.find((v) => v.isCurrent)
      if (!current) return []

      const currentRecord = recordByVersionStaff.get(`${current.id}:${member.id}`)
      const ackedIds = ackedByVersionStaff.get(`${current.id}:${member.id}`) ?? new Set()
      const requiredCount = d.checkpoints.length
      const allAcked = requiredCount > 0 && d.checkpoints.every((c) => ackedIds.has(c.id))
      const priorSigned = d.versions.find(
        (v) => !v.isCurrent && recordByVersionStaff.has(`${v.id}:${member.id}`)
      )

      let status: ComplianceItemStatus
      if (currentRecord || allAcked) status = "complete"
      else if (priorSigned) status = "needs-resign"
      else if (ackedIds.size > 0) status = "in-progress"
      else status = "not-started"

      return [
        {
          kind: "document" as const,
          documentId: d.id,
          title: d.title,
          category: d.category,
          status,
          currentVersionNumber: current.versionNumber,
          ackedCount: ackedIds.size,
          requiredCount,
          signedVersionNumber:
            status === "needs-resign" ? (priorSigned?.versionNumber ?? null) : null,
          completedAt: currentRecord?.completedAt.toISOString() ?? null,
        },
      ]
    })

    const trainingItems: ComplianceTrainingItem[] = (
      assignmentsByStaff.get(member.id) ?? []
    ).map((a) => {
      const lessonIds = new Set(a.trainingModule.lessons.map((l) => l.id))
      const lessonsDone = a.lessonProgress.filter((p) => lessonIds.has(p.trainingLessonId)).length

      let status: ComplianceItemStatus
      if (a.status === "Completed") status = "complete"
      else if (a.dueDate && a.dueDate < now) status = "overdue"
      else if (a.status === "InProgress") status = "in-progress"
      else status = "not-started"

      return {
        kind: "training" as const,
        assignmentId: a.id,
        moduleTitle: a.trainingModule.title,
        status,
        dueDate: a.dueDate?.toISOString() ?? null,
        certified: !!a.certifiedAt,
        lessonsDone,
        lessonsTotal: a.trainingModule.lessons.length,
      }
    })

    const items: ComplianceItem[] = [...docItems, ...trainingItems]
    const requiredTotal = items.length
    const completedCount = items.filter((i) => i.status === "complete").length

    return {
      staffId: member.id,
      displayName: member.displayName,
      fullName: member.fullName,
      active: member.status === "ACTIVE",
      primaryStoreId: primary?.store.id ?? null,
      primaryStoreName: primary?.store.name ?? null,
      storeIds: memberStoreIds,
      items,
      requiredTotal,
      completedCount,
      pct: pctOf(completedCount, requiredTotal),
      overdueCount: items.filter((i) => i.status === "overdue").length,
      needsResignCount: items.filter((i) => i.status === "needs-resign").length,
      inProgressCount: items.filter((i) => i.status === "in-progress").length,
    }
  })
}

// ─── /staff list column: batched summaries. Terminated staff always get
// pct null (excluded from percentages; the profile still shows their
// records) ───────────────────────────────────────────────────────────────────

export async function getStaffComplianceSummaries(
  organizationId: string,
  staffIds: string[]
): Promise<Map<string, StaffComplianceSummary>> {
  const details = await computeStaffComplianceDetails(organizationId, staffIds)
  const map = new Map<string, StaffComplianceSummary>()
  for (const d of details) {
    map.set(
      d.staffId,
      d.active
        ? { requiredTotal: d.requiredTotal, completed: d.completedCount, pct: d.pct }
        : { requiredTotal: 0, completed: 0, pct: null }
    )
  }
  return map
}

// ─── /staff/[id] Compliance tab: one member, records shown even when
// terminated (auditable) — the caller renders the exclusion banner ───────────

export async function getStaffComplianceDetail(
  organizationId: string,
  staffId: string
): Promise<StaffComplianceDetail | null> {
  const details = await computeStaffComplianceDetails(organizationId, [staffId])
  return details[0] ?? null
}

// ─── /hr/compliance: the org/store rollup. storeIds null = whole org (ADMIN);
// a manager passes their assigned store ids and sees only staff assigned to
// those stores. Staff are grouped by primary store (same convention as the
// /staff directory) so nobody is double-counted ──────────────────────────────

export async function getOrgComplianceRollup(
  organizationId: string,
  opts: { storeIds: string[] | null }
): Promise<OrgComplianceRollup> {
  const scoped = opts.storeIds !== null

  const scopedStaff = await prisma.staffMember.findMany({
    where: {
      organizationId,
      status: "ACTIVE",
      ...(scoped
        ? { storeAssignments: { some: { storeId: { in: opts.storeIds! } } } }
        : {}),
    },
    select: { id: true },
  })
  const staff = await computeStaffComplianceDetails(
    organizationId,
    scopedStaff.map((s) => s.id)
  )

  const stores = await prisma.store.findMany({
    where: {
      organizationId,
      isActive: true,
      ...(scoped ? { id: { in: opts.storeIds! } } : {}),
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  })

  const byStore = new Map<string | null, StaffComplianceDetail[]>()
  for (const s of staff) {
    // A member whose primary store is outside a manager's scope still appears
    // under one of the manager's stores they're assigned to.
    const groupId =
      scoped && s.primaryStoreId && !opts.storeIds!.includes(s.primaryStoreId)
        ? (s.storeIds.find((id) => opts.storeIds!.includes(id)) ?? null)
        : s.primaryStoreId
    if (!byStore.has(groupId)) byStore.set(groupId, [])
    byStore.get(groupId)!.push(s)
  }

  const storeRollup = (storeId: string | null, storeName: string): StoreComplianceRollup => {
    const members = byStore.get(storeId) ?? []
    const requiredTotal = members.reduce((n, m) => n + m.requiredTotal, 0)
    const completedCount = members.reduce((n, m) => n + m.completedCount, 0)
    return {
      storeId,
      storeName,
      staffCount: members.length,
      requiredTotal,
      completedCount,
      pct: pctOf(completedCount, requiredTotal),
      fullyCompliant: members.filter((m) => m.requiredTotal > 0 && m.pct === 100).length,
      overdueCount: members.reduce((n, m) => n + m.overdueCount, 0),
      needsResignCount: members.reduce((n, m) => n + m.needsResignCount, 0),
    }
  }

  const storeRollups = [
    ...stores.map((s) => storeRollup(s.id, s.name)),
    ...(byStore.has(null) ? [storeRollup(null, "Unassigned")] : []),
  ].filter((r) => r.staffCount > 0)

  const requiredTotal = staff.reduce((n, m) => n + m.requiredTotal, 0)
  const completedCount = staff.reduce((n, m) => n + m.completedCount, 0)

  // Agreements panel — outside the percentage by design. Forms are org
  // resources; executed/pending counts are limited to the staff in scope.
  const staffIdSet = new Set(staff.map((s) => s.staffId))
  const [forms, submissions] = await Promise.all([
    prisma.hrDocument.findMany({
      where: { organizationId, kind: "FillableForm", isActive: true },
      select: { id: true, title: true },
      orderBy: { title: "asc" },
    }),
    staff.length
      ? prisma.formSubmission.findMany({
          where: {
            staffMemberId: { in: staff.map((s) => s.staffId) },
            version: { hrDocument: { organizationId, kind: "FillableForm" } },
          },
          select: {
            id: true,
            status: true,
            formTitle: true,
            staffMemberId: true,
            employeeSignedAt: true,
            signedAt: true,
            version: { select: { hrDocument: { select: { id: true, title: true } } } },
          },
          orderBy: { signedAt: "asc" },
        })
      : [],
  ])

  const staffNameById = new Map(staff.map((s) => [s.staffId, s.fullName ?? s.displayName]))
  const formRollups = new Map<string, AgreementFormRollup>(
    forms.map((f) => [f.id, { documentId: f.id, title: f.title, executedCount: 0, pendingCount: 0 }])
  )
  const pending: PendingCountersign[] = []
  for (const sub of submissions) {
    const doc = sub.version.hrDocument
    // Submissions on archived forms are records too — keep counting them.
    if (!formRollups.has(doc.id)) {
      formRollups.set(doc.id, {
        documentId: doc.id,
        title: sub.formTitle ?? doc.title,
        executedCount: 0,
        pendingCount: 0,
      })
    }
    const roll = formRollups.get(doc.id)!
    if (sub.status === "Completed") roll.executedCount++
    else if (sub.status === "PendingSupervisor") {
      roll.pendingCount++
      if (staffIdSet.has(sub.staffMemberId)) {
        pending.push({
          submissionId: sub.id,
          formTitle: sub.formTitle ?? doc.title,
          staffId: sub.staffMemberId,
          staffName: staffNameById.get(sub.staffMemberId) ?? "Unknown",
          employeeSignedAt: (sub.employeeSignedAt ?? sub.signedAt).toISOString(),
        })
      }
    }
  }

  return {
    totals: {
      staffCount: staff.length,
      requiredTotal,
      completedCount,
      pct: pctOf(completedCount, requiredTotal),
      fullyCompliant: staff.filter((m) => m.requiredTotal > 0 && m.pct === 100).length,
      overdueCount: staff.reduce((n, m) => n + m.overdueCount, 0),
      needsResignCount: staff.reduce((n, m) => n + m.needsResignCount, 0),
    },
    stores: storeRollups,
    staff,
    agreements: { forms: [...formRollups.values()], pending },
  }
}
