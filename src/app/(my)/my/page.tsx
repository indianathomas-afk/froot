import Link from "next/link"
import { format } from "date-fns"
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  FileText,
  GraduationCap,
  Megaphone,
  MessageSquare,
} from "lucide-react"
import { prisma } from "@/lib/prisma"
import { getActiveStaffSelf } from "@/lib/auth"
import { getStaffComplianceDetail, type ComplianceItem } from "@/lib/hr-compliance"
import { messageInclude, serializeMessage } from "@/lib/messages"
import { MyShell } from "./my-shell"
import { MyDenied } from "./denied"
import { MyInstagramStrip } from "./instagram-strip"

// /my — the STAFF-1 staff home. Person-scoped, mobile-first: open compliance &
// training items (HR-8 engine, reused not duplicated), the primary store's
// message feed preview, the active corporate update, and the Instagram strip.
// Every card renders real content or an intentional empty state — never an
// empty placeholder. Messages/compliance are fetched server-side (no client
// permission round-trips to fail); Instagram is client-fetched with the BUG-1
// timeout/hide discipline.
export default async function MyPortalPage() {
  const self = await getActiveStaffSelf()
  if (!self.ok) return <MyDenied reason={self.reason} />
  const { staffMember, org, dbUser } = self

  // Primary store (staffSelfInclude orders isPrimary first).
  const primaryStore = staffMember.storeAssignments[0]?.store ?? null

  const now = new Date()
  const [detail, latestMessages, corporateUpdate] = await Promise.all([
    getStaffComplianceDetail(org.id, staffMember.id),
    primaryStore
      ? prisma.teamMessage.findMany({
          where: { storeId: primaryStore.id, deletedAt: null },
          include: messageInclude,
          orderBy: { createdAt: "desc" },
          take: 3,
        })
      : Promise.resolve([]),
    primaryStore
      ? prisma.corporateUpdate.findFirst({
          // Same criteria as /api/dashboard/comms: published, unexpired pin,
          // targeted at this store or all stores.
          where: {
            organizationId: org.id,
            deletedAt: null,
            publishedAt: { not: null },
            OR: [{ pinnedUntil: null }, { pinnedUntil: { gt: now } }],
            AND: [{ OR: [{ storeIds: { isEmpty: true } }, { storeIds: { has: primaryStore.id } }] }],
          },
          orderBy: { publishedAt: "desc" },
          select: { id: true, title: true, body: true, publishedAt: true },
        })
      : Promise.resolve(null),
  ])

  const openItems = (detail?.items ?? []).filter((i) => i.status !== "complete")
  const statusRank: Record<string, number> = { overdue: 0, "needs-resign": 1, "in-progress": 2, "not-started": 3 }
  openItems.sort((a, b) => (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9))

  const messages = latestMessages.map((m) => serializeMessage(m, dbUser.id))
  const showInstagram = !!org.instagramEnabled && !!org.instagramAccessToken

  return (
    <MyShell showInstagram={showInstagram}>
      <h1 className="text-2xl font-bold text-[var(--color-foreground)] mb-1">
        Hi, {staffMember.displayName}
      </h1>
      <p className="text-sm text-[var(--color-muted-foreground)] mb-6">
        {primaryStore ? primaryStore.name : "Your workplace hub"}
      </p>

      <div className="space-y-3 sm:grid sm:grid-cols-2 sm:gap-3 sm:space-y-0 sm:items-start">
        {/* ── My Compliance & Training ────────────────────────────────────── */}
        <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-4 sm:col-span-2">
          <h2 className="font-medium text-[var(--color-foreground)] mb-3">
            My Compliance &amp; Training
          </h2>
          {openItems.length === 0 ? (
            <div className="flex items-center gap-3 py-2">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-[var(--color-success,#25ba3b)]" />
              <p className="text-sm text-[var(--color-muted-foreground)]">
                {(detail?.requiredTotal ?? 0) === 0
                  ? "Nothing has been assigned to you yet — your documents and training will appear here."
                  : "You're all caught up. Nothing needs your attention."}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {openItems.map((item) => (
                <OpenItemRow key={itemKey(item)} item={item} />
              ))}
            </div>
          )}
        </div>

        {/* ── Team Messages preview ───────────────────────────────────────── */}
        <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-4">
          <Link href="/my/messages" className="flex items-center justify-between min-h-11 -my-1.5">
            <span className="inline-flex items-center gap-2 font-medium text-[var(--color-foreground)]">
              <MessageSquare className="h-4 w-4 text-[var(--color-primary)]" />
              Team Messages
            </span>
            <ChevronRight className="h-5 w-5 text-[var(--color-muted-foreground)]" />
          </Link>
          {!primaryStore ? (
            <p className="text-sm text-[var(--color-muted-foreground)] mt-2">
              You aren&apos;t assigned to a store yet — ask your manager to add you.
            </p>
          ) : messages.length === 0 ? (
            <p className="text-sm text-[var(--color-muted-foreground)] mt-2">
              No messages at {primaryStore.name} yet. Start the conversation.
            </p>
          ) : (
            <div className="mt-2 space-y-2.5">
              {messages.map((m) => (
                <div key={m.id} className="flex items-start gap-2.5">
                  <span className="w-6 h-6 shrink-0 rounded-full bg-[var(--color-muted)] flex items-center justify-center text-[10px] font-semibold text-[var(--color-muted-foreground)]">
                    {m.author.initial}
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs text-[var(--color-muted-foreground)]">
                      {m.author.name} · {format(new Date(m.createdAt), "MMM d, h:mm a")}
                    </p>
                    <p className="text-sm text-[var(--color-foreground)] truncate">{m.body}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Corporate update (absent when none is active) ───────────────── */}
        {corporateUpdate && (
          <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-4">
            <p className="inline-flex items-center gap-2 font-medium text-[var(--color-foreground)]">
              <Megaphone className="h-4 w-4 text-[var(--color-primary)]" />
              {corporateUpdate.title}
            </p>
            <p className="text-xs text-[var(--color-muted-foreground)] mt-0.5">
              {format(corporateUpdate.publishedAt!, "MMMM d, yyyy")}
            </p>
            <p className="text-sm text-[var(--color-foreground)] mt-2 whitespace-pre-wrap line-clamp-6">
              {corporateUpdate.body}
            </p>
          </div>
        )}

        {/* ── Instagram (hides itself when unavailable) ───────────────────── */}
        {showInstagram && (
          <div className="sm:col-span-2">
            <MyInstagramStrip />
          </div>
        )}
      </div>
    </MyShell>
  )
}

function itemKey(item: ComplianceItem): string {
  return item.kind === "document" ? `doc-${item.documentId}` : `training-${item.assignmentId}`
}

const ITEM_STATUS_LABELS: Record<string, { label: string; className: string }> = {
  overdue: { label: "Overdue", className: "bg-red-100 text-red-700 border border-red-200" },
  "needs-resign": { label: "New version to sign", className: "bg-amber-100 text-amber-700 border border-amber-200" },
  "in-progress": { label: "In progress", className: "bg-blue-100 text-blue-700 border border-blue-200" },
  "not-started": { label: "To do", className: "bg-gray-100 text-gray-600 border border-gray-200" },
}

function OpenItemRow({ item }: { item: ComplianceItem }) {
  const href =
    item.kind === "document" ? `/my/documents/${item.documentId}` : `/my/training/${item.assignmentId}`
  const title = item.kind === "document" ? item.title : item.moduleTitle
  const Icon = item.kind === "document" ? FileText : GraduationCap
  const badge = ITEM_STATUS_LABELS[item.status] ?? ITEM_STATUS_LABELS["not-started"]
  const detail =
    item.kind === "document"
      ? `${item.ackedCount}/${item.requiredCount} checkpoints`
      : item.dueDate
        ? `Due ${format(new Date(item.dueDate), "MMM d")}`
        : `${item.lessonsDone}/${item.lessonsTotal} lessons`

  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-lg border border-[var(--color-border)] p-3 min-h-11 hover:bg-[var(--color-accent)]/40 transition-colors"
    >
      {item.status === "overdue" ? (
        <AlertTriangle className="h-5 w-5 shrink-0 text-[var(--color-destructive)]" />
      ) : (
        <Icon className="h-5 w-5 shrink-0 text-[var(--color-primary)]" />
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[var(--color-foreground)] truncate">{title}</p>
        <p className="text-xs text-[var(--color-muted-foreground)] mt-0.5">{detail}</p>
      </div>
      <span className={`shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${badge.className}`}>
        {badge.label}
      </span>
      <ChevronRight className="h-5 w-5 shrink-0 text-[var(--color-muted-foreground)]" />
    </Link>
  )
}
