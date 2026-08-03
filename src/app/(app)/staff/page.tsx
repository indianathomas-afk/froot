import { auth } from "@clerk/nextjs/server"
import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { AddStaffButton, ImportStaffButton, SyncStaffButton, DeleteStaffButton, StaffLocationChips } from "./staff-buttons"
import { getUserStoreScope, hrModuleAvailable } from "@/lib/auth"
import { getStaffComplianceSummaries, type StaffComplianceSummary } from "@/lib/hr-compliance"
import { Badge } from "@/components/ui/badge"

const NO_SUMMARIES = new Map<string, StaffComplianceSummary>()

async function getStaffData() {
  const { orgId } = await auth()
  if (!orgId) return { staff: [], stores: [], isAdmin: false, hrActive: false, summaries: NO_SUMMARIES }
  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return { staff: [], stores: [], isAdmin: false, hrActive: false, summaries: NO_SUMMARIES }

  // HR surfaces on this page only exist when the module is available in this
  // environment AND the org has the add-on on — otherwise render as before.
  const hrActive = hrModuleAvailable(orgId) && org.activeModules.includes("hr")

  const { isAdmin, storeIds } = await getUserStoreScope()
  const storeFilter = isAdmin ? {} : { id: { in: storeIds } }

  const [staff, stores] = await Promise.all([
    prisma.staffMember.findMany({
      where: {
        organizationId: org.id,
        ...(isAdmin ? {} : { storeAssignments: { some: { storeId: { in: storeIds } } } }),
      },
      include: {
        storeAssignments: {
          include: { store: true },
          orderBy: [{ isPrimary: "desc" }, { store: { name: "asc" } }],
        },
      },
      orderBy: { displayName: "asc" },
    }),
    prisma.store.findMany({ where: { organizationId: org.id, ...storeFilter }, orderBy: { name: "asc" } }),
  ])

  // HR-8: one batched rollup for the whole roster — never a query per row.
  // Terminated members come back with pct null (excluded from percentages).
  const summaries = hrActive
    ? await getStaffComplianceSummaries(org.id, staff.map((s) => s.id))
    : NO_SUMMARIES

  return { staff, stores, isAdmin, hrActive, summaries }
}

type RosterMember = Awaited<ReturnType<typeof getStaffData>>["staff"][number]

// Compliance % cell. pct is null until requirements exist for the member —
// rendered as a muted em dash, not 0%.
function CompliancePct({ pct }: { pct: number | null }) {
  if (pct === null) {
    return (
      <span
        className="text-sm text-[var(--color-muted-foreground)] cursor-help"
        title="Compliance tracking activates once documents or training are assigned."
      >
        —
      </span>
    )
  }
  return <span className="text-sm font-medium text-[var(--color-foreground)]">{pct}%</span>
}

// One roster row, shared by all three places a member is listed: a store's own
// roster, the "Also works here" block (DEBT-13), and Unassigned. Extracted so
// the three cannot drift — the markup was previously duplicated for Unassigned.
// homeStoreName is set only on an "Also works here" row and names the store the
// member is based at, which by construction is NOT this group's store.
function StaffRow({
  member,
  hrActive,
  canEdit,
  pct,
  homeStoreName,
}: {
  member: RosterMember
  hrActive: boolean
  canEdit: boolean
  pct: number | null
  homeStoreName?: string
}) {
  return (
    <tr className="border-b border-[var(--color-border)] last:border-0">
      <td className="px-6 py-3 text-sm font-medium text-[var(--color-foreground)]">
        {hrActive ? (
          <Link href={`/staff/${member.id}`} className="hover:text-[var(--color-primary)] hover:underline">
            {member.displayName}
          </Link>
        ) : (
          member.displayName
        )}
        {/* HR-15: rehire candidates must be findable in the directory */}
        {member.status === "TERMINATED" && (
          <Badge variant="destructive" className="ml-2">Terminated</Badge>
        )}
        {homeStoreName && (
          <span className="block text-xs font-normal text-[var(--color-muted-foreground)]">
            Home store: {homeStoreName}
          </span>
        )}
      </td>
      <td className="px-6 py-3 text-sm text-[var(--color-muted-foreground)]">{member.fullName ?? (
        <span className="text-[var(--color-warning,#efa201)]" title="No legal name — can't sign documents">
          No legal name
        </span>
      )}</td>
      <td className="px-6 py-3">
        {/* Chips truncate at 8, so a member with 9+ stores on an "Also works
            here" row may not show a chip for the very store whose card they are
            on. Costs nothing: the card's own heading already names that store. */}
        {member.storeAssignments.length === 0 ? (
          <span className="text-sm text-[var(--color-muted-foreground)]">—</span>
        ) : (
          <StaffLocationChips
            staffId={member.id}
            canEdit={canEdit}
            isCorporate={member.isCorporate}
            assignments={member.storeAssignments.map((a) => ({
              storeId: a.store.id,
              storeName: a.store.name,
              isPrimary: a.isPrimary,
            }))}
          />
        )}
      </td>
      {hrActive && (
        <td className="px-6 py-3 text-right">
          <CompliancePct pct={pct} />
        </td>
      )}
      <td className="px-6 py-3 text-right">
        <DeleteStaffButton staffId={member.id} />
      </td>
    </tr>
  )
}

export default async function StaffPage() {
  const { staff, stores, isAdmin, hrActive, summaries } = await getStaffData()

  // The stores this page actually renders: every org store for an ADMIN, the
  // caller's assigned stores otherwise.
  const visibleStoreIds = new Set(stores.map((s) => s.id))

  const byStore = new Map<string, RosterMember[]>()
  // DEBT-13: members who work at a visible store but are BASED at one that is
  // not on this page. Grouping on the home store alone fetched them and then
  // dropped them at render, with nothing to signal the roster was incomplete.
  const visitingByStore = new Map<string, RosterMember[]>()
  // Unassigned is reachable for an ADMIN only: a non-admin's query requires
  // `some` assignment in their scope, so a member with zero assignments is
  // never fetched for them.
  const unassigned: RosterMember[] = []
  // DEBT-9: corporate staff get their own group. They are shown to MANAGERS as
  // well as ADMINs (Gary, 2026-08-02) — NOT because a manager is responsible for
  // them (ruling 4 removes them from every store-scoped compliance surface) but
  // because ruling 5 preserves manager ATTESTATION reach, and a manager who
  // cannot find someone in the directory cannot attest a document for them.
  // Without this bucket they would fall through to the homeStore branch below
  // and be listed under whichever store sorts first — the exact claim this
  // phase exists to stop making.
  const corporate: RosterMember[] = []

  const push = (map: Map<string, RosterMember[]>, storeId: string, member: RosterMember) => {
    if (!map.has(storeId)) map.set(storeId, [])
    map.get(storeId)!.push(member)
  }

  for (const member of staff) {
    if (member.isCorporate) {
      corporate.push(member)
      continue
    }
    if (member.storeAssignments.length === 0) {
      unassigned.push(member)
      continue
    }
    // Assignments are ordered primary-first, so [0] is the member's home
    // store when one is set, else their first store alphabetically.
    const homeStore = member.storeAssignments[0].store
    if (visibleStoreIds.has(homeStore.id)) {
      push(byStore, homeStore.id, member)
      continue
    }
    // The home store is out of scope, so list the member under every store of
    // theirs that IS on this page. An ADMIN sees every store in the org, so
    // their home store is always visible and this branch never runs for them —
    // that is what keeps an admin's page byte-identical and duplicate-free,
    // rather than an isAdmin special case that could be got wrong.
    for (const a of member.storeAssignments) {
      if (visibleStoreIds.has(a.storeId)) push(visitingByStore, a.storeId, member)
    }
  }

  const storeProps = stores.map((s) => ({ id: s.id, name: s.name, storeNumber: s.storeNumber }))

  return (
    <div>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-foreground)]">Staff Members</h1>
          {/* A non-admin gets a standing claim of what this list contains, on a
              quiet day too — the absence of an "Also works here" block teaches
              nothing on its own, and is what DEBT-13 looked like. */}
          <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
            {isAdmin || stores.length === 0
              ? "Manage team members for each store location"
              : `Everyone assigned to your ${stores.length} store${stores.length !== 1 ? "s" : ""}, including staff based at another location.`}
          </p>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            <SyncStaffButton />
            <ImportStaffButton stores={storeProps} />
            <AddStaffButton stores={storeProps} />
          </div>
        )}
      </div>

      {staff.length === 0 ? (
        <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-16 text-center">
          <div className="flex justify-center mb-3">
            <div className="w-12 h-12 rounded-full bg-[var(--color-muted)] flex items-center justify-center text-2xl">👥</div>
          </div>
          <p className="font-medium text-[var(--color-foreground)] mb-1">No Staff Members</p>
          <p className="text-sm text-[var(--color-muted-foreground)] mb-4">Add team members to track who completes each task.</p>
          {isAdmin && (
            <div className="flex gap-2 justify-center">
              <ImportStaffButton stores={storeProps} />
              <AddStaffButton stores={storeProps} />
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {stores.filter((s) => byStore.has(s.id) || visitingByStore.has(s.id)).map((store) => {
            const members = byStore.get(store.id) ?? []
            const visiting = visitingByStore.get(store.id) ?? []
            const colSpan = hrActive ? 5 : 4
            return (
              <div key={store.id} className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] overflow-hidden">
                <div className="px-6 py-4 border-b border-[var(--color-border)]">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">🏪</span>
                    <div>
                      <h3 className="font-semibold text-[var(--color-foreground)]">
                        {store.storeNumber ? `#${store.storeNumber} - ` : ""}{store.name}
                      </h3>
                      {/* Two counts, never one merged number: a member listed here
                          but based elsewhere is not part of this store's roster. */}
                      <p className="text-xs text-[var(--color-muted-foreground)]">
                        {members.length} team member{members.length !== 1 ? "s" : ""}
                        {visiting.length > 0 && ` · ${visiting.length} also work${visiting.length === 1 ? "s" : ""} here`}
                      </p>
                    </div>
                  </div>
                </div>
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[var(--color-border)]">
                      <th className="text-left text-xs font-medium text-[var(--color-muted-foreground)] px-6 py-3">Display Name</th>
                      <th className="text-left text-xs font-medium text-[var(--color-muted-foreground)] px-6 py-3">Full Name</th>
                      <th className="text-left text-xs font-medium text-[var(--color-muted-foreground)] px-6 py-3">Locations</th>
                      {hrActive && (
                        <th className="text-right text-xs font-medium text-[var(--color-muted-foreground)] px-6 py-3">Compliance</th>
                      )}
                      <th className="text-right text-xs font-medium text-[var(--color-muted-foreground)] px-6 py-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((member) => (
                      <StaffRow
                        key={member.id}
                        member={member}
                        hrActive={hrActive}
                        canEdit={isAdmin}
                        pct={summaries.get(member.id)?.pct ?? null}
                      />
                    ))}
                    {visiting.length > 0 && (
                      <tr className="border-b border-[var(--color-border)] bg-[var(--color-muted)]">
                        <td colSpan={colSpan} className="px-6 py-2">
                          <p className="text-xs font-medium text-[var(--color-foreground)]">
                            Also works here — {visiting.length} member{visiting.length !== 1 ? "s" : ""} based at another store
                          </p>
                        </td>
                      </tr>
                    )}
                    {visiting.map((member) => (
                      <StaffRow
                        key={`visiting-${member.id}`}
                        member={member}
                        hrActive={hrActive}
                        canEdit={isAdmin}
                        pct={summaries.get(member.id)?.pct ?? null}
                        homeStoreName={member.storeAssignments[0].store.name}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )
          })}
          {corporate.length > 0 && (
            <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] overflow-hidden">
              <div className="px-6 py-4 border-b border-[var(--color-border)]">
                <div className="flex items-center gap-2">
                  <span className="text-lg">🏢</span>
                  <div>
                    <h3 className="font-semibold text-[var(--color-foreground)]">Corporate</h3>
                    <p className="text-xs text-[var(--color-muted-foreground)]">
                      {corporate.length} team member{corporate.length !== 1 ? "s" : ""} · available at every
                      location, based at none
                    </p>
                  </div>
                </div>
              </div>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[var(--color-border)]">
                    <th className="text-left text-xs font-medium text-[var(--color-muted-foreground)] px-6 py-3">Display Name</th>
                    <th className="text-left text-xs font-medium text-[var(--color-muted-foreground)] px-6 py-3">Full Name</th>
                    <th className="text-left text-xs font-medium text-[var(--color-muted-foreground)] px-6 py-3">Locations</th>
                    {hrActive && (
                      <th className="text-right text-xs font-medium text-[var(--color-muted-foreground)] px-6 py-3">Compliance</th>
                    )}
                    <th className="text-right text-xs font-medium text-[var(--color-muted-foreground)] px-6 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {corporate.map((member) => (
                    <StaffRow
                      key={member.id}
                      member={member}
                      hrActive={hrActive}
                      canEdit={isAdmin}
                      pct={summaries.get(member.id)?.pct ?? null}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {unassigned.length > 0 && (
            <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] overflow-hidden">
              <div className="px-6 py-4 border-b border-[var(--color-border)]">
                <p className="font-semibold text-[var(--color-foreground)]">Unassigned</p>
                <p className="text-xs text-[var(--color-muted-foreground)]">{unassigned.length} member{unassigned.length !== 1 ? "s" : ""}</p>
              </div>
              <table className="w-full">
                <tbody>
                  {unassigned.map((member) => (
                    <StaffRow
                      key={member.id}
                      member={member}
                      hrActive={hrActive}
                      canEdit={isAdmin}
                      pct={summaries.get(member.id)?.pct ?? null}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
