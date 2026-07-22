import * as dotenv from "dotenv"

dotenv.config()

// HR-5 example data: the Key Agreement as a paired Check-Out ↔ Check-In
// fillable form. Run against the dev DB with:
//   npx tsx scripts/seed-key-agreement.ts [--org=<organization id>]
// Idempotent — skips if either form already exists for the org. Goes through
// the real createFillableForm service (dynamically imported AFTER dotenv so
// the prisma singleton sees DATABASE_URL), so the definition snapshot + hash
// are byte-identical to what the /hr/forms builder would produce.

const DEFAULT_ORG_ID = "cf888f2d-f234-48c7-8097-fd5b44b5b3dd" // Keva Juice (dev)

const CHECK_OUT_TITLE = "Key Agreement — Check-Out"
const CHECK_IN_TITLE = "Key Agreement — Check-In"

const CHECK_OUT_BODY = `I acknowledge that I am being issued a key to my assigned store and that the key remains the property of the company at all times.

I understand and agree to the following:

1. I will not duplicate the key, nor allow anyone else to duplicate it.
2. I will not lend the key to any other person, including other employees.
3. I will report a lost, stolen, or damaged key to my supervisor immediately.
4. I will return the key upon request, upon transfer, or upon separation of employment.
5. If I fail to return the key, a fee of $50.00 per key will be deducted from my final paycheck to cover re-keying costs, to the extent permitted by law.`

const CHECK_IN_BODY = `I am returning the store key(s) previously issued to me under the Key Agreement.

I acknowledge that the supervisor named below has inspected and received the key(s) listed, and I understand that returning all issued keys in acceptable condition releases me from the $50.00 per key fee described in the Key Agreement Check-Out.`

const CHECK_OUT_FIELDS = [
  { label: "Date Issued", fieldType: "Date", required: true },
  { label: "Last Name", fieldType: "Text", required: true },
  { label: "First Name", fieldType: "Text", required: true },
  { label: "Phone", fieldType: "Phone", required: true },
  { label: "Email", fieldType: "Email", required: true },
  { label: "Employee ID", fieldType: "Text", required: true },
  { label: "Store / Location", fieldType: "Text", required: true },
  { label: "Key Number", fieldType: "Text", required: true },
  { label: "Supervisor", fieldType: "Text", required: true },
]

const CHECK_IN_FIELDS = [
  { label: "Date Returned", fieldType: "Date", required: true },
  { label: "Last Name", fieldType: "Text", required: true },
  { label: "First Name", fieldType: "Text", required: true },
  { label: "Employee ID", fieldType: "Text", required: true },
  { label: "Key Number", fieldType: "Text", required: true },
  { label: "Key Condition", fieldType: "Select", required: true, options: ["Good", "Damaged", "Lost"] },
  { label: "Supervisor", fieldType: "Text", required: true },
]

async function main() {
  const orgArg = process.argv.find((a) => a.startsWith("--org="))?.slice("--org=".length)
  const organizationId = orgArg || DEFAULT_ORG_ID

  const { prisma } = await import("../src/lib/prisma")
  const { createFillableForm } = await import("../src/lib/hr-forms")

  const org = await prisma.organization.findUnique({ where: { id: organizationId } })
  if (!org) throw new Error(`Organization ${organizationId} not found`)
  console.log(`Seeding Key Agreement pair for "${org.name}" (${org.id})`)

  const admin = await prisma.user.findFirst({
    where: { organizationId: org.id, role: "ADMIN" },
    orderBy: { createdAt: "asc" },
  })
  if (!admin) throw new Error("No ADMIN user in the org to attribute the versions to")

  const existing = await prisma.hrDocument.findFirst({
    where: {
      organizationId: org.id,
      kind: "FillableForm",
      title: { in: [CHECK_OUT_TITLE, CHECK_IN_TITLE] },
    },
  })
  if (existing) {
    console.log(`"${existing.title}" already exists (${existing.id}) — nothing to do.`)
    return
  }

  const checkOut = await createFillableForm({
    organizationId: org.id,
    createdByUserId: admin.id,
    title: CHECK_OUT_TITLE,
    category: "HRManagement",
    bodyText: CHECK_OUT_BODY,
    fields: CHECK_OUT_FIELDS,
  })
  console.log(`Created "${checkOut.title}" (${checkOut.id}) — v1 hash ${checkOut.versions[0].fileHash.slice(0, 12)}…`)

  const checkIn = await createFillableForm({
    organizationId: org.id,
    createdByUserId: admin.id,
    title: CHECK_IN_TITLE,
    category: "HRManagement",
    bodyText: CHECK_IN_BODY,
    fields: CHECK_IN_FIELDS,
  })
  console.log(`Created "${checkIn.title}" (${checkIn.id}) — v1 hash ${checkIn.versions[0].fileHash.slice(0, 12)}…`)

  // Pair them — symmetric, both directions, like POST /api/hr/forms/[id]/link.
  await prisma.$transaction([
    prisma.hrDocument.update({ where: { id: checkOut.id }, data: { linkedFormId: checkIn.id } }),
    prisma.hrDocument.update({ where: { id: checkIn.id }, data: { linkedFormId: checkOut.id } }),
  ])
  console.log("Paired Check-Out ↔ Check-In.")
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
