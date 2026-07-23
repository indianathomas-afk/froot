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
    const pending = userEmail
      ? await prisma.pendingInvite.findFirst({
          where: { organizationId: org.id, email: { equals: userEmail, mode: "insensitive" } },
        })
      : null

    const resolvedRole = (pending?.role ?? roleMap[membership.role] ?? "STAFF") as "ADMIN" | "MANAGER" | "STAFF" | "STORE"

    const user = await prisma.user.upsert({
      where: { clerkUserId: membership.public_user_data.user_id },
      // Self-healing: refresh the email on rows that predate this fix.
      update: { email: userEmail },
      create: {
        clerkUserId: membership.public_user_data.user_id,
        organizationId: org.id,
        email: userEmail,
        name: [membership.public_user_data.first_name, membership.public_user_data.last_name].filter(Boolean).join(" ") || null,
        role: resolvedRole,
      },
    })

    if (pending) {
      if (pending.storeIds.length > 0) {
        await prisma.storeUserAssignment.createMany({
          data: pending.storeIds.map((storeId) => ({ userId: user.id, storeId })),
          skipDuplicates: true,
        })
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
