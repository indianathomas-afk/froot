import { auth, clerkClient } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { format } from "date-fns"
import { InviteUserButton, EditUserButton, RemoveUserButton, RevokeInviteButton } from "./user-actions"
import { requireAdmin } from "@/lib/auth"
import { getClerkPrimaryEmail, normalizeEmail } from "@/lib/clerk"
import { isAboveStore } from "@/lib/device-login"
import { ShieldAlert, Tablet } from "lucide-react"
import { redirect } from "next/navigation"

const ROLE_STYLES: Record<string, string> = {
  ADMIN: "bg-orange-100 text-orange-700 border border-orange-200",
  MANAGER: "bg-blue-100 text-blue-700 border border-blue-200",
  STORE: "bg-purple-100 text-purple-700 border border-purple-200",
  STAFF: "bg-gray-100 text-gray-600 border border-gray-200",
}

async function getData() {
  const { orgId } = await auth()
  if (!orgId) return { members: [], pendingInvites: [], stores: [] }

  const clerk = await clerkClient()
  const [memberships, pendingInvitations, org] = await Promise.all([
    clerk.organizations.getOrganizationMembershipList({ organizationId: orgId, limit: 100 }),
    clerk.organizations.getOrganizationInvitationList({ organizationId: orgId, status: ["pending"] }),
    prisma.organization.findUnique({ where: { clerkOrgId: orgId } }),
  ])

  if (!org) return { members: [], pendingInvites: [], stores: [] }

  const [dbUsers, stores, pendingInviteRecords, staffMembers] = await Promise.all([
    prisma.user.findMany({
      where: { organizationId: org.id },
      include: { storeAssignments: { include: { store: true } } },
    }),
    prisma.store.findMany({ where: { organizationId: org.id }, orderBy: { name: "asc" } }),
    prisma.pendingInvite.findMany({ where: { organizationId: org.id } }),
    // Names come from staff profiles when available — one org-scoped query,
    // never per-member Clerk API calls.
    prisma.staffMember.findMany({
      where: { organizationId: org.id },
      select: { id: true, displayName: true, fullName: true, email: true, userId: true },
    }),
  ])
  const storeById = new Map(stores.map((s) => [s.id, s]))

  // DEBT-46. Keyed on the NORMALISED email. This was keyed on the raw column
  // while BOTH of its consumers look up with a normalised address, so a row
  // written before 3c7d0a0 (2026-07-22) holding mixed case missed silently —
  // and one of those consumers writes a ROLE (see the create branch below), so
  // the miss was a privilege outcome rather than a render bug. The comment
  // there claims this page "mirrors resolvedRole so the two writers cannot
  // drift"; on case, they had.
  //
  // NEWEST createdAt WINS (Gary's ruling R1, 2026-08-03), and the tiebreak is
  // the point rather than a detail. The unique index is
  // ("organizationId", "email") on plain text — case-SENSITIVE — so
  // `Taylin@keva.com` and `taylin@keva.com` are DISTINCT rows in one org, and
  // normalising the key collapses them. Built with `new Map(...)` that
  // collision would resolve last-wins over an UNORDERED findMany: a role
  // decided by Postgres row order. Zero colliding rows exist on any branch
  // (measured 2026-08-03 across production, preview/main and preview/staging);
  // this keeps it deterministic if one ever appears. The webhook's consume path
  // carries the matching orderBy so the two role writers cannot resolve the
  // same collision differently.
  const pendingByEmail = new Map<string, (typeof pendingInviteRecords)[number]>()
  for (const p of pendingInviteRecords) {
    const key = normalizeEmail(p.email)
    if (!key) continue
    const existing = pendingByEmail.get(key)
    if (!existing) {
      pendingByEmail.set(key, p)
      continue
    }
    const [kept, ignored] = p.createdAt > existing.createdAt ? [p, existing] : [existing, p]
    // Named row ids on both sides: a collapsed collision is invisible in the
    // rendered page by construction, so the log line is the only trace.
    console.warn(
      `[users] PendingInvite collision on ${key} in org ${org.id}: kept ${kept.id} ` +
        `(${kept.role}, ${kept.createdAt.toISOString()}), ignored ${ignored.id} ` +
        `(${ignored.role}, ${ignored.createdAt.toISOString()})`
    )
    pendingByEmail.set(key, kept)
  }
  // PERM-7 Task 4: location contact address -> store, so a login signing in as
  // a location can be recognised as a device rather than a person.
  const storeByContactEmail = new Map<string, (typeof stores)[number]>()
  for (const s of stores) {
    const e = normalizeEmail(s.contactEmail)
    if (e && !storeByContactEmail.has(e)) storeByContactEmail.set(e, s)
  }

  const staffByUserId = new Map(staffMembers.filter((s) => s.userId).map((s) => [s.userId!, s]))
  const staffByEmail = new Map<string, (typeof staffMembers)[number]>()
  for (const s of staffMembers) {
    const e = normalizeEmail(s.email)
    if (e && !staffByEmail.has(e)) staffByEmail.set(e, s)
  }

  const dbByClerkId = new Map(dbUsers.map((u) => [u.clerkUserId, u]))

  // Auto-sync any Clerk member who has no DB User record yet
  const unsyncedMembers = memberships.data.filter((m) => {
    const uid = m.publicUserData?.userId
    return uid && !dbByClerkId.has(uid)
  })
  if (unsyncedMembers.length > 0) {
    await Promise.all(
      unsyncedMembers.map(async (m) => {
        const pub = m.publicUserData!
        // BUG-2: identifier may be a username — resolve the real email.
        const email =
          (await getClerkPrimaryEmail(pub.userId!).catch(() => null)) ??
          normalizeEmail(pub.identifier) ??
          ""
        return prisma.user.upsert({
          where: { clerkUserId: pub.userId! },
          create: {
            clerkUserId: pub.userId!,
            organizationId: org.id,
            email,
            name: [pub.firstName, pub.lastName].filter(Boolean).join(" ") || null,
            // DEBT-17 (direction B, Gary 2026-07-28). PendingInvite is the ONLY
            // record of the app role the admin picked: POST /api/users maps every
            // non-ADMIN role to the same Clerk role, org:member
            // (users/route.ts:106), so m.role cannot tell MANAGER from STORE from
            // STAFF. Whichever writer runs first wins and this page can win, so
            // without this an invited MANAGER persists as STAFF permanently — the
            // webhook's later upsert takes its UPDATE branch, which never writes
            // role. Mirrors resolvedRole (webhooks/clerk/route.ts:109) so the two
            // writers cannot drift. Does NOT remove the GET-that-writes smell;
            // that is option C, deliberately not taken.
            role: pendingByEmail.get(email)?.role ?? (m.role === "org:admin" ? "ADMIN" : "STAFF"),
          },
          update: { email },
        })
      })
    )
    // Re-fetch after sync
    const refreshed = await prisma.user.findMany({
      where: { organizationId: org.id },
      include: { storeAssignments: { include: { store: true } } },
    })
    refreshed.forEach((u) => dbByClerkId.set(u.clerkUserId, u))
  }

  const members = memberships.data.map((m) => {
    const pub = m.publicUserData
    const dbUser = pub?.userId ? dbByClerkId.get(pub.userId) : null

    // Display name: linked staff profile → email-matched staff profile →
    // Clerk first/last (already fetched) → nothing (email renders alone).
    let staff = dbUser ? staffByUserId.get(dbUser.id) : undefined
    if (!staff && dbUser) {
      const email = normalizeEmail(dbUser.email)
      const candidate = email ? staffByEmail.get(email) : undefined
      // An email match linked to a different login is someone else's profile.
      if (candidate && (candidate.userId === null || candidate.userId === dbUser.id)) {
        staff = candidate
      }
    }
    const clerkName = [pub?.firstName, pub?.lastName].filter(Boolean).join(" ") || null

    return {
      clerkMembershipId: m.id,
      clerkUserId: pub?.userId ?? "",
      // BUG-2: identifier may be a username — the self-healed DB email is the
      // trustworthy source; identifier is a display-only last resort.
      email: dbUser?.email || (pub?.identifier ?? ""),
      name: staff?.fullName || staff?.displayName || clerkName,
      clerkRole: m.role,
      dbUserId: dbUser?.id ?? null,
      role: dbUser?.role ?? "STAFF",
      storeAssignments: dbUser?.storeAssignments ?? [],
      defaultStoreId: dbUser?.defaultStoreId ?? null,
      createdAt: new Date(m.createdAt),
      // PERM-7 Task 4 — ambient, not a moment. A one-time warning at
      // provisioning is forgotten in a week; the next admin needs the fact
      // sitting on the page. This is the /users half of the badge.
      //
      // A device login has no schema flag (PERM-7 ships none), so it is
      // identified by the one CHECKABLE signal available: the account signs in
      // as a location's own contact address. Deliberately not a guess from role
      // + assignment count — an ADMIN device account has NO assignments at all
      // (the store picker is hidden for ADMIN), so counting would miss exactly
      // the case that matters most.
      deviceForStore: (() => {
        const e = normalizeEmail(dbUser?.email)
        return e ? (storeByContactEmail.get(e)?.name ?? null) : null
      })(),
    }
  })

  const pendingInvites = pendingInvitations.data.map((inv) => {
    // DEBT-46: normalised, matching the map's key. Clerk echoes the address as
    // it was invited, so a mixed-case invitation missed its own row here and
    // rendered with a defaulted role and no store chips.
    const pendingRecord = pendingByEmail.get(normalizeEmail(inv.emailAddress) ?? "")
    return {
      id: inv.id,
      email: inv.emailAddress,
      role: pendingRecord?.role ?? (inv.role === "org:admin" ? "ADMIN" : "STORE"),
      storeNames: (pendingRecord?.storeIds ?? []).map((id) => storeById.get(id)).filter((s): s is NonNullable<typeof s> => !!s),
      createdAt: new Date(inv.createdAt),
    }
  })

  return { members, pendingInvites, stores }
}

export default async function UsersPage() {
  try {
    await requireAdmin()
  } catch {
    redirect("/dashboard")
  }

  const { members, pendingInvites, stores } = await getData()

  const storeProps = stores.map((s) => ({ id: s.id, name: s.name, storeNumber: s.storeNumber }))
  const totalCount = members.length + pendingInvites.length

  return (
    <div>
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-foreground)]">User Management</h1>
          <p className="text-sm text-[var(--color-muted-foreground)] mt-1">Invite users and control which locations they can access</p>
        </div>
        <InviteUserButton stores={storeProps} />
      </div>

      <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] overflow-hidden">
        <div className="px-6 py-4 border-b border-[var(--color-border)]">
          <h2 className="font-medium text-[var(--color-foreground)]">Organization Members</h2>
          <p className="text-xs text-[var(--color-muted-foreground)] mt-0.5">{totalCount} member{totalCount !== 1 ? "s" : ""}{pendingInvites.length > 0 ? ` · ${pendingInvites.length} pending` : ""}</p>
        </div>

        {totalCount === 0 ? (
          <div className="p-16 text-center text-[var(--color-muted-foreground)]">
            <p className="text-sm">No users yet. Invite your team to get started.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[var(--color-border)]">
                  {["User", "Role", "Location Access", "Invited", "Actions"].map((h) => (
                    <th key={h} className="text-left text-xs font-medium text-[var(--color-muted-foreground)] px-6 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {members.map((member) => (
                  <tr key={member.clerkMembershipId} className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-accent)]/30 transition-colors">
                    <td className="px-6 py-4">
                      <p className="text-sm font-medium text-[var(--color-foreground)]">{member.name || member.email}</p>
                      {member.name && <p className="text-xs text-[var(--color-muted-foreground)]">{member.email}</p>}
                      {member.deviceForStore && (
                        <span
                          className={`mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium border ${
                            isAboveStore(member.role)
                              ? "text-[var(--color-warning-text)] bg-[var(--color-warning-bg)] border-[var(--color-warning-border)]"
                              : "text-[var(--color-muted-foreground)] bg-[var(--color-muted)] border-[var(--color-border)]"
                          }`}
                          title={
                            isAboveStore(member.role)
                              ? `Shared device at ${member.deviceForStore}, signed in at ${member.role.toLowerCase()} level — anything it can see is visible to whoever is standing at the counter, and nothing it does can be attributed to a person.`
                              : `Shared device at ${member.deviceForStore}.`
                          }
                        >
                          {isAboveStore(member.role) ? <ShieldAlert className="h-3 w-3" /> : <Tablet className="h-3 w-3" />}
                          {isAboveStore(member.role)
                            ? `Device at ${member.deviceForStore} — ${member.role.toLowerCase()} level`
                            : `Device at ${member.deviceForStore}`}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium border ${ROLE_STYLES[member.role] ?? ROLE_STYLES.STAFF}`}>
                        {member.role.charAt(0) + member.role.slice(1).toLowerCase()}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {member.role === "ADMIN" ? (
                        <span className="text-xs text-orange-600 font-medium">All locations</span>
                      ) : member.storeAssignments.length === 0 ? (
                        <span className="text-xs text-[var(--color-muted-foreground)]">No locations assigned</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {member.storeAssignments.slice(0, 5).map((a) => (
                            <span key={a.store.id} className="inline-flex items-center rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)] text-xs font-medium px-2 py-0.5">
                              {a.store.storeNumber ? `#${a.store.storeNumber} — ` : ""}{a.store.name}
                            </span>
                          ))}
                          {member.storeAssignments.length > 5 && (
                            <span className="text-xs text-[var(--color-muted-foreground)]">+{member.storeAssignments.length - 5} more</span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-[var(--color-muted-foreground)]">
                      {format(member.createdAt, "M/d/yyyy")}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1">
                        <EditUserButton
                          dbUserId={member.dbUserId}
                          currentRole={member.role}
                          currentStoreIds={member.storeAssignments.map((a) => a.storeId)}
                          currentDefaultStoreId={member.defaultStoreId}
                          stores={storeProps}
                          userName={member.name || member.email}
                        />
                        <RemoveUserButton clerkUserId={member.clerkUserId} userName={member.name || member.email} />
                      </div>
                    </td>
                  </tr>
                ))}
                {pendingInvites.map((inv) => (
                  <tr key={inv.id} className="border-b border-[var(--color-border)] last:border-0 bg-[var(--color-accent)]/10">
                    <td className="px-6 py-4">
                      <p className="text-sm font-medium text-[var(--color-foreground)]">{inv.email}</p>
                      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-yellow-100 text-yellow-700 border border-yellow-200 mt-1">
                        Pending
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium border ${ROLE_STYLES[inv.role] ?? ROLE_STYLES.STAFF}`}>
                        {inv.role.charAt(0) + inv.role.slice(1).toLowerCase()}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {inv.role === "ADMIN" ? (
                        <span className="text-xs text-orange-600 font-medium">All locations</span>
                      ) : inv.storeNames.length === 0 ? (
                        <span className="text-xs text-[var(--color-muted-foreground)]">No locations assigned</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {inv.storeNames.map((s) => (
                            <span key={s.id} className="inline-flex items-center rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)] text-xs font-medium px-2 py-0.5">
                              {s.storeNumber ? `#${s.storeNumber} — ` : ""}{s.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-[var(--color-muted-foreground)]">
                      {format(inv.createdAt, "M/d/yyyy")}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-[var(--color-muted-foreground)] italic">Awaiting acceptance</span>
                        <RevokeInviteButton invitationId={inv.id} email={inv.email} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mt-4 p-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)]">
        <p className="text-xs text-[var(--color-muted-foreground)]">
          <strong className="text-[var(--color-foreground)]">How location access works:</strong>{" "}
          Admins see all locations. Managers and Store users only see the locations you assign to them. Each invited user receives an email to set up their account.
        </p>
      </div>
    </div>
  )
}
