import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { NextResponse } from "next/server"
import { put, del } from "@vercel/blob"
import { getUserStoreScope, requireManagerOrAdmin, requireModule } from "@/lib/auth"

// I-7: attach an invoice photo/PDF to a purchase order (BevSpot's Invoice
// Upload — attachment only, no OCR). Same file rules as task attachments.

const ALLOWED_TYPES = ["application/pdf", "image/jpeg", "image/png"]
const MAX_BYTES = 10 * 1024 * 1024 // 10 MB

export async function POST(req: Request) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 })

  try {
    await requireModule("inventory")
  } catch {
    return NextResponse.json({ error: "MODULE_NOT_ACTIVE" }, { status: 403 })
  }
  try {
    await requireManagerOrAdmin()
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const form = await req.formData()
  const file = form.get("file") as File | null
  const purchaseOrderId = form.get("purchaseOrderId") as string | null

  if (!file || !purchaseOrderId) {
    return NextResponse.json({ error: "file and purchaseOrderId required" }, { status: 400 })
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json({ error: "Only PDF, JPG, and PNG files are allowed" }, { status: 400 })
  }
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "File must be 10 MB or smaller" }, { status: 413 })

  const { isAdmin, storeIds } = await getUserStoreScope()
  const po = await prisma.purchaseOrder.findFirst({
    where: { id: purchaseOrderId, organizationId: org.id, ...(isAdmin ? {} : { storeId: { in: storeIds } }) },
  })
  if (!po) return NextResponse.json({ error: "Purchase order not found" }, { status: 404 })

  // Replace any previous invoice file.
  if (po.invoiceFileUrl) await del(po.invoiceFileUrl).catch(() => {})

  const ext = file.name.split(".").pop() ?? "bin"
  const blob = await put(`po-invoices/${org.id}/${purchaseOrderId}/${Date.now()}.${ext}`, file, {
    access: "public",
    contentType: file.type,
  })

  const updated = await prisma.purchaseOrder.update({
    where: { id: purchaseOrderId },
    data: { invoiceFileUrl: blob.url },
  })

  return NextResponse.json({ invoiceFileUrl: updated.invoiceFileUrl }, { status: 201 })
}
