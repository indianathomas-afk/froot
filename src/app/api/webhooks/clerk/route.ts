import { Webhook } from "svix"
import { headers } from "next/headers"
import { WebhookEvent } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { slugify } from "@/lib/utils"

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
      organization: { id: string }
      public_user_data: { user_id: string; identifier: string; first_name?: string; last_name?: string }
      role: string
    }
    const org = await prisma.organization.findUnique({
      where: { clerkOrgId: membership.organization.id },
    })
    if (org) {
      const roleMap: Record<string, string> = {
        "org:admin": "ADMIN",
        "org:manager": "MANAGER",
        "org:member": "STAFF",
      }
      await prisma.user.upsert({
        where: { clerkUserId: membership.public_user_data.user_id },
        update: {},
        create: {
          clerkUserId: membership.public_user_data.user_id,
          organizationId: org.id,
          email: membership.public_user_data.identifier,
          name: [membership.public_user_data.first_name, membership.public_user_data.last_name].filter(Boolean).join(" ") || null,
          role: (roleMap[membership.role] ?? "STAFF") as "ADMIN" | "MANAGER" | "STAFF" | "STORE",
        },
      })
    }
  }

  return new Response("OK", { status: 200 })
}
