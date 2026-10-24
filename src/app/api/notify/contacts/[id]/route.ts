import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { getOrganization, requireAdmin } from "@/lib/auth"
import { MAX_ACTIVE_CONTACTS, isStoreLoginEmail, normalizeEmail } from "@/lib/notifications/contacts"

// PATCH /api/notify/contacts/[id] — NOTIFY-12. Edit a contact's name or email,
// or archive / un-archive it. ADMIN only (F7), re-checked per PERM-2.
//
// NO DELETE (F5). Archived = in no pick list and receives nothing; its picks
// are kept so un-archiving restores them, and old send-log rows keep meaning.
// The FK from a pick to its contact is RESTRICT for the same reason.

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    email: z.string().trim().email().max(254).optional(),
    archived: z.boolean().optional(),
  })
  .refine((b) => b.name !== undefined || b.email !== undefined || b.archived !== undefined)

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin()
  } catch {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 })
  }
  const org = await getOrganization().catch(() => null)
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  const parsed = patchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 })

  const { id } = await params
  const contact = await prisma.notificationContact.findFirst({ where: { id, organizationId: org.id } })
  if (!contact) return NextResponse.json({ error: "Contact not found" }, { status: 404 })

  const { name, archived } = parsed.data
  const email = parsed.data.email !== undefined ? normalizeEmail(parsed.data.email) : undefined

  if (archived === false && contact.archivedAt !== null) {
    const active = await prisma.notificationContact.count({ where: { organizationId: org.id, archivedAt: null } })
    if (active >= MAX_ACTIVE_CONTACTS) {
      return NextResponse.json({ error: `At most ${MAX_ACTIVE_CONTACTS} active contacts.` }, { status: 400 })
    }
  }

  try {
    const updated = await prisma.notificationContact.update({
      where: { id: contact.id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(email !== undefined ? { email } : {}),
        ...(archived !== undefined ? { archivedAt: archived ? (contact.archivedAt ?? new Date()) : null } : {}),
      },
    })
    return NextResponse.json({
      contact: {
        id: updated.id,
        name: updated.name,
        email: updated.email,
        archived: updated.archivedAt !== null,
        matchesStoreLogin: await isStoreLoginEmail(org.id, updated.email),
      },
    })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json({ error: "Another contact already uses that address." }, { status: 409 })
    }
    throw e
  }
}
