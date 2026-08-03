import { Webhook } from "svix"
import { headers } from "next/headers"
import { WebhookEvent } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { slugify } from "@/lib/utils"
import { getClerkPrimaryEmail, normalizeEmail } from "@/lib/clerk"

export async function POST(req: Request) {
  const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET
  if (!WEBHOOK_SECRET) {
    return new Response("Webhook secret not configured", { status: 500 })
  }

  const headerPayload = await headers()
  const svix_id = headerPayload.get("svix-id")
  const svix_timestamp = headerPayload.get("svix-timestamp")
  const svix_signature = headerPayload.get("svix-signature")

  if (!svix_id || !svix_timestamp || !svix_signature) {
    return new Response("Missing svix headers", { status: 400 })
  }

  const payload = await req.json()
  const body = JSON.stringify(payload)

  const wh = new Webhook(WEBHOOK_SECRET)
  let evt: WebhookEvent

  try {
    evt = wh.verify(body, {
      "svix-id": svix_id,
      "svix-timestamp": svix_timestamp,
      "svix-signature": svix_signature,
    }) as WebhookEvent
  } catch {
    return new Response("Invalid webhook signature", { status: 400 })
  }

  const { type, data } = evt

  if (type === "organization.created") {
    const org = data as { id: string; name: string; slug?: string }
    await prisma.organization.upsert({
      where: { clerkOrgId: org.id },
      update: { name: org.name },
      create: {
        clerkOrgId: org.id,
        name: org.name,
        slug: org.slug ?? slugify(org.name),
      },
    })
  }

  if (type === "organization.updated") {
    const org = data as { id: string; name: string; slug?: string }
    await prisma.organization.update({
      where: { clerkOrgId: org.id },
      data: { name: org.name },
    })
  }

  if (type === "organizationMembership.created") {
    const membership = data as {
      organization: { id: string; name: string; slug?: string }
      public_user_data: { user_id: string; identifier: string; first_name?: string; last_name?: string }
      role: string
    }

    // Don't assume organization.created has already been processed - Clerk does not
    // guarantee webhook delivery order, so create the org here too if it's missing yet.
    const org = await prisma.organization.upsert({
      where: { clerkOrgId: membership.organization.id },
      update: {},
      create: {
        clerkOrgId: membership.organization.id,
        name: membership.organization.name,
        slug: membership.organization.slug ?? slugify(membership.organization.name),
      },
    })

    // "org:manager" IS UNREACHABLE ON THE PRODUCTION CLERK INSTANCE and is a
    // forward-compatible fallback, not the manager path. Verified 2026-08-03:
    // Configure → Roles & Permissions reads 2/2 used — the Hobby plan's cap on
    // custom roles — and holds exactly org:admin and org:member. Clerk cannot
    // send org:manager, so this entry never fires.
    //
    // MANAGERS ARE PROVISIONED FROM PendingInvite.role, which takes precedence
    // over this map at :109 (`pending?.role ?? roleMap[...] ?? "STAFF"`).
    // POST /api/users writes the intended app role onto the PendingInvite and
    // invites Clerk as org:admin/org:member only (users/route.ts), and an admin
    // can set the role directly afterwards via PATCH /api/users/[id], whose
    // clerkRoleFor() likewise only ever returns those two keys. The app role
    // and the Clerk role are deliberately not the same vocabulary.
    //
    // THE ONE REAL CONSEQUENCE, so it is not discovered as a bug: a member
    // added to the org DIRECTLY in the Clerk dashboard has no PendingInvite,
    // so this map is all there is — and they land as STAFF whatever was
    // intended. Provision through /users, or fix the role afterwards.
    const roleMap: Record<string, string> = {
      "org:admin": "ADMIN",
      "org:manager": "MANAGER",
      "org:member": "STAFF",
    }

    // BUG-2: public_user_data.identifier is the USERNAME on username-enabled
    // accounts — resolve the real primary email from the Backend API, or the
    // PendingInvite lookup misses and User.email is corrupted. Fail the
    // webhook on API errors so Svix retries instead of persisting garbage.
    let email: string | null
    try {
      email = await getClerkPrimaryEmail(membership.public_user_data.user_id)
    } catch {
      return new Response("Failed to resolve member email", { status: 500 })
    }
    // Email-less accounts (phone/username only): keep the identifier as a
    // display fallback — no email match could succeed for them anyway.
    const userEmail = email ?? normalizeEmail(membership.public_user_data.identifier) ?? ""

    // Check for a pending invite to recover the originally intended app role +
    // store assignment. Case-insensitive: older rows may hold mixed-case emails.
    //
    // DEBT-46: orderBy is load-bearing, not cosmetic. The unique index is
    // ("organizationId", "email") on plain text, so an insensitive match can
    // hit TWO rows — a pre-3c7d0a0 mixed-case row and a lowercase re-invite of
    // the same address — and findFirst without an order picks arbitrarily.
    // That made the role grant nondeterministic. Newest wins (Gary's ruling R1,
    // 2026-08-03); /users resolves the same collision the same way.
    const pending = userEmail
      ? await prisma.pendingInvite.findFirst({
          where: { organizationId: org.id, email: { equals: userEmail, mode: "insensitive" } },
          orderBy: { createdAt: "desc" },
        })
      : null

    const resolvedRole = (pending?.role ?? roleMap[membership.role] ?? "STAFF") as "ADMIN" | "MANAGER" | "STAFF" | "STORE"

    // PERM-7 Task 7 — "STORE is a device, not a person" (DECISIONS.md
    // 2026-07-27), enforced by the flow rather than by whoever fills in the
    // form. A device account provisioned from /stores should be named for its
    // STORE, but the invite carries only email + role: Clerk owns the name, and
    // it is whatever a human types at sign-up. PendingInvite has no name column
    // and PERM-7 ships no schema change, so the name is DERIVED here instead,
    // at the one moment both the invite and the store are in hand.
    //
    // Conditions are deliberately narrow (Gary's Ruling 4, 2026-07-28): the
    // invite must be role STORE and carry EXACTLY ONE store. A multi-store or
    // higher-role invite is a person, and keeps the name they typed.
    //
    // It OVERRIDES the typed name rather than filling a blank one — that is the
    // enforcement. The live counterexample the ruling was written against was a
    // device login called "Tommy Thomas".
    let deviceName: string | null = null
    if (pending?.role === "STORE" && pending.storeIds.length === 1) {
      const deviceStore = await prisma.store.findFirst({
        where: { id: pending.storeIds[0], organizationId: org.id },
        select: { name: true, storeNumber: true },
      })
      if (deviceStore) {
        deviceName = deviceStore.storeNumber
          ? `#${deviceStore.storeNumber} — ${deviceStore.name}`
          : deviceStore.name
      }
    }

    const user = await prisma.user.upsert({
      where: { clerkUserId: membership.public_user_data.user_id },
      // Self-healing: refresh the email on rows that predate this fix.
      // CREATE-ONLY for the name (Ruling 4): deviceName is deliberately ABSENT
      // from this update branch. Every later Clerk event for this user hits it,
      // so deriving the name here would reset a name an admin has since
      // corrected — silently, and forever.
      update: { email: userEmail },
      create: {
        clerkUserId: membership.public_user_data.user_id,
        organizationId: org.id,
        email: userEmail,
        name:
          deviceName ??
          ([membership.public_user_data.first_name, membership.public_user_data.last_name].filter(Boolean).join(" ") || null),
        role: resolvedRole,
      },
    })

    if (pending) {
      if (pending.storeIds.length > 0) {
        // PERM-6 Task 2, webhook half. POST /api/users now validates ownership
        // at invite time, which is where an admin can actually see the error.
        // This is the second half: a PendingInvite row can sit for days, a
        // store can be deleted or moved between orgs in the meantime, and a
        // future writer of PendingInvite may not go through that route at all.
        // This is the LAST writer before real assignments exist, so it
        // re-filters rather than trusts. Filter, never throw — a 500 here is
        // retried by Clerk and would block the whole acceptance (user upsert,
        // staff binding) over a stale store id.
        const owned = await prisma.store.findMany({
          where: { id: { in: pending.storeIds }, organizationId: org.id },
          select: { id: true },
        })
        if (owned.length !== pending.storeIds.length) {
          console.warn(
            `[clerk-webhook] PendingInvite ${pending.id}: dropped ${pending.storeIds.length - owned.length} storeId(s) not owned by org ${org.id}`
          )
        }
        if (owned.length > 0) {
          await prisma.storeUserAssignment.createMany({
            data: owned.map((s) => ({ userId: user.id, storeId: s.id })),
            skipDuplicates: true,
          })
          // BUILD-2 / PERM-7: a login provisioned with exactly ONE store gets
          // that store as its default. This is where it has to happen — POST
          // /api/users only creates a Clerk invitation plus a PendingInvite
          // row, so no User row exists yet at provisioning time; the row is
          // born here on acceptance.
          //
          // Safe to write unconditionally rather than create-only (contrast the
          // deviceName Ruling 4 note on the upsert above): this whole block is
          // guarded by `pending`, and the PendingInvite is DELETED at the end of
          // it, so it runs exactly once per invitation. A re-invited user gets a
          // fresh PendingInvite and a fresh default, which is correct — that is
          // re-provisioning, not overwriting a preference.
          //
          // Multi-store invitees are left null on purpose: there is no basis to
          // guess which of several stores they want, and null already means
          // alphabetically-first.
          if (owned.length === 1) {
            await prisma.user.update({
              where: { id: user.id },
              data: { defaultStoreId: owned[0].id },
            })
          }
        }
      }
      // HR-7 self-service invite: bind the new login to its staff profile.
      // updateMany (not update) so a staff member deleted between invite and
      // acceptance is a no-op instead of a webhook failure; userId: null
      // guard so an existing link is never stolen.
      if (pending.staffMemberId) {
        await prisma.staffMember.updateMany({
          where: { id: pending.staffMemberId, organizationId: org.id, userId: null },
          data: { userId: user.id },
        })
      }
      await prisma.pendingInvite.delete({ where: { id: pending.id } })
    }
  }

  // BUG-2 follow-through: a changed primary email must flow into User.email,
  // or staff resolution drifts. The event payload carries the addresses.
  if (type === "user.updated") {
    const u = data as {
      id: string
      primary_email_address_id?: string | null
      email_addresses?: { id: string; email_address: string }[]
    }
    const primary =
      u.email_addresses?.find((e) => e.id === u.primary_email_address_id) ?? u.email_addresses?.[0]
    const email = normalizeEmail(primary?.email_address)
    if (email) {
      await prisma.user.updateMany({ where: { clerkUserId: u.id }, data: { email } })
    }
  }

  // HR-7 rule 1: keep app state consistent when an org membership goes away —
  // whether from terminateStaffMember's revocation or a manual removal in the
  // Clerk dashboard. Unlink the staff profile (no membership = no /my login)
  // and drop the user's store assignments. Deliberately does NOT terminate
  // the staff member: losing a login is not leaving the company — termination
  // stays an explicit manager/Square-driven action.
  if (type === "organizationMembership.deleted") {
    const membership = data as {
      organization: { id: string }
      public_user_data: { user_id: string }
    }
    const org = await prisma.organization.findUnique({
      where: { clerkOrgId: membership.organization.id },
    })
    const user = await prisma.user.findUnique({
      where: { clerkUserId: membership.public_user_data.user_id },
    })
    if (org && user && user.organizationId === org.id) {
      await prisma.staffMember.updateMany({ where: { userId: user.id }, data: { userId: null } })
      await prisma.storeUserAssignment.deleteMany({ where: { userId: user.id } })
    }
  }

  return new Response("OK", { status: 200 })
}
