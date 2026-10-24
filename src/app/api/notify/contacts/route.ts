import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { getOrganization, requireAdmin } from "@/lib/auth"
import {
  MAX_ACTIVE_CONTACTS,
  isStoreLoginEmail,
  listContacts,
  normalizeEmail,
} from "@/lib/notifications/contacts"

// GET/POST /api/notify/contacts — NOTIFY-12, the org address book: named
// outside addresses any email type can pick (corporate@, an accountant, an
// owner who never logs in).
//
// ADMIN ONLY (F7), re-checked here per PERM-2 — the card lives on
// /settings/notifications, which is settings.access. NOT HR-gated: pace alerts
// use contacts too.
//
// ADDING AN ARCHIVED ADDRESS UN-ARCHIVES IT (F5): one row per address per org,
// so its old picks come back with it. Adding an active address is a 409.

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254),
})

async function adminOrg() {
  try {
    await requireAdmin()
  } catch {
    return null
  }
  return getOrganization()
}

export async function GET() {
  const org = await adminOrg().catch(() => null)
  if (!org) return NextResponse.json({ error: "Admin access required" }, { status: 403 })
  return NextResponse.json({ contacts: await listContacts(org.id) })
}

export async function POST(req: Request) {
  const org = await adminOrg().catch(() => null)
  if (!org) return NextResponse.json({ error: "Admin access required" }, { status: 403 })

  const parsed = createSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter a name and a valid email address." }, { status: 400 })
  }
  const name = parsed.data.name
  const email = normalizeEmail(parsed.data.email)

  const existing = await prisma.notificationContact.findUnique({
    where: { organizationId_email: { organizationId: org.id, email } },
  })
  if (existing && existing.archivedAt === null) {
    return NextResponse.json({ error: "That address is already in your contacts." }, { status: 409 })
  }
  const active = await prisma.notificationContact.count({ where: { organizationId: org.id, archivedAt: null } })
  if (active >= MAX_ACTIVE_CONTACTS) {
    return NextResponse.json({ error: `At most ${MAX_ACTIVE_CONTACTS} active contacts.` }, { status: 400 })
  }

  const contact = existing
    ? await prisma.notificationContact.update({ where: { id: existing.id }, data: { name, archivedAt: null } })
    : await prisma.notificationContact.create({ data: { organizationId: org.id, name, email } })

  return NextResponse.json(
    {
      contact: {
        id: contact.id,
        name: contact.name,
        email: contact.email,
        archived: false,
        matchesStoreLogin: await isStoreLoginEmail(org.id, email),
      },
      restored: Boolean(existing),
    },
    { status: 201 }
  )
}
