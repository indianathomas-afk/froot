/**
 * Reset an IN-PROGRESS document signing so a staff member can start fresh.
 * Staging test utility — NOT part of the app. Deletes only incomplete
 * acknowledgment rows for the current signing cycle; it NEVER touches a version
 * that already has a completed HrSignedRecord (those are the defensible,
 * append-only records and stay inviolate).
 *
 * Point it at the STAGING database explicitly (its URL is a Sensitive Vercel
 * var — copy it from the Neon console / Vercel dashboard). Dry-run by default:
 *
 *   # dry run — shows exactly what WOULD be deleted, deletes nothing:
 *   DATABASE_URL='<staging-url>' npx tsx scripts/reset-signing.ts
 *
 *   # actually delete:
 *   DATABASE_URL='<staging-url>' CONFIRM=1 npx tsx scripts/reset-signing.ts
 *
 * Optional overrides:
 *   STAFF_EMAIL=corporate@keva.com   (default)   or   STAFF_ID=<id>
 *   DOC_TITLE='Employee Handbook'    (default, case-insensitive contains)
 */
import "dotenv/config"
import { prisma } from "../src/lib/prisma"

const STAFF_EMAIL = process.env.STAFF_EMAIL ?? "corporate@keva.com"
const STAFF_ID = process.env.STAFF_ID ?? null
const DOC_TITLE = process.env.DOC_TITLE ?? "Employee Handbook"
const CONFIRM = process.env.CONFIRM === "1"

async function main() {
  // ── Safety: show exactly which database we are about to touch ──────────────
  const host = (() => {
    try {
      return new URL(process.env.DATABASE_URL ?? "").host
    } catch {
      return "(unparseable)"
    }
  })()
  console.log(`DATABASE host: ${host}`)
  console.log(`Mode: ${CONFIRM ? "!! DELETE (CONFIRM=1) !!" : "dry run (no writes)"}\n`)

  // ── Resolve the staff member ───────────────────────────────────────────────
  const staffMatches = STAFF_ID
    ? await prisma.staffMember.findMany({ where: { id: STAFF_ID } })
    : await prisma.staffMember.findMany({
        where: {
          OR: [
            { email: { equals: STAFF_EMAIL, mode: "insensitive" } },
            { fullName: { contains: "Tommy", mode: "insensitive" } },
            { displayName: { contains: "Tommy", mode: "insensitive" } },
          ],
        },
      })
  if (staffMatches.length === 0) {
    console.error(`No staff match (email=${STAFF_EMAIL}, name~Tommy). Set STAFF_ID=<id>.`)
    process.exit(1)
  }
  if (staffMatches.length > 1) {
    console.error("Multiple staff matched — re-run with STAFF_ID set to one of:")
    for (const s of staffMatches) console.error(`  ${s.id}  ${s.fullName ?? s.displayName}  <${s.email ?? "no-email"}>  cycle=${s.signingCycle}  ${s.status}`)
    process.exit(1)
  }
  const staff = staffMatches[0]
  console.log(`Staff: ${staff.fullName ?? staff.displayName} <${staff.email ?? "no-email"}>`)
  console.log(`  id=${staff.id}  signingCycle=${staff.signingCycle}  status=${staff.status}\n`)

  // ── Resolve the document + its versions ─────────────────────────────────────
  const docs = await prisma.hrDocument.findMany({
    where: { title: { contains: DOC_TITLE, mode: "insensitive" }, kind: "Acknowledgment" },
    include: { versions: { orderBy: { versionNumber: "asc" } } },
  })
  if (docs.length === 0) {
    console.error(`No Acknowledgment document titled ~"${DOC_TITLE}".`)
    process.exit(1)
  }
  if (docs.length > 1) {
    console.error(`Multiple documents matched "${DOC_TITLE}": ${docs.map((d) => `${d.title}(${d.id})`).join(", ")}`)
    process.exit(1)
  }
  const doc = docs[0]
  console.log(`Document: ${doc.title} (${doc.id}) — ${doc.versions.length} version(s)\n`)

  // ── Per version: protect completed records, plan deletion of in-progress ────
  const cycle = staff.signingCycle
  let toDelete = 0
  const plan: { versionNumber: number; versionId: string; acks: number; protected: boolean }[] = []

  for (const v of doc.versions) {
    const signed = await prisma.hrSignedRecord.findUnique({
      where: {
        hrDocumentVersionId_staffMemberId_signingCycle: {
          hrDocumentVersionId: v.id,
          staffMemberId: staff.id,
          signingCycle: cycle,
        },
      },
    })
    const ackCount = await prisma.hrDocumentAcknowledgment.count({
      where: { hrDocumentVersionId: v.id, staffMemberId: staff.id, signingCycle: cycle },
    })
    const isProtected = !!signed
    plan.push({ versionNumber: v.versionNumber, versionId: v.id, acks: ackCount, protected: isProtected })
    if (!isProtected) toDelete += ackCount
  }

  console.log(`In-progress acknowledgments for cycle ${cycle}:`)
  for (const p of plan) {
    const tag = p.protected ? "PROTECTED (completed signed record — untouched)" : p.acks > 0 ? "will delete" : "nothing"
    console.log(`  v${p.versionNumber}: ${p.acks} ack(s) — ${tag}`)
  }
  console.log(`\nTotal acknowledgments to delete: ${toDelete}`)

  if (toDelete === 0) {
    console.log("Nothing to reset.")
    return
  }
  if (!CONFIRM) {
    console.log("\nDry run only. Re-run with CONFIRM=1 to delete the above.")
    return
  }

  let deleted = 0
  for (const p of plan) {
    if (p.protected || p.acks === 0) continue
    const res = await prisma.hrDocumentAcknowledgment.deleteMany({
      where: { hrDocumentVersionId: p.versionId, staffMemberId: staff.id, signingCycle: cycle },
    })
    deleted += res.count
    console.log(`  v${p.versionNumber}: deleted ${res.count}`)
  }
  console.log(`\n✅ Reset complete — deleted ${deleted} in-progress acknowledgment(s). ${staff.fullName ?? staff.displayName} can sign the handbook fresh.`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
