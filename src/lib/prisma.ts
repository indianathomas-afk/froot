import { PrismaClient } from "@prisma/client"
import { PrismaNeon } from "@prisma/adapter-neon"
import { neonConfig } from "@neondatabase/serverless"
import ws from "ws"

// Use WebSockets for Neon serverless
if (typeof globalThis.WebSocket === "undefined") {
  neonConfig.webSocketConstructor = ws
}

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL!
  const adapter = new PrismaNeon({ connectionString })
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    // TAB-4 (Gary, Q5 iv: "no screen or API ever returns an existing PIN or its
    // hash"). OMITTED FROM EVERY READ, including nested includes, so none of
    // the unselected staffMember reads under src/app/api can hand it to
    // NextResponse.json by accident. The ONLY opt-back-in is the explicit
    // `select: { pinHash: true }` in src/lib/tablet-pin-attempt.ts, which only
    // api/tablet-pin/verify/route.ts imports. Raw SQL is
    // not covered by this; as of TAB-4 no $queryRaw touches "StaffMember".
    omit: { staffMember: { pinHash: true } },
  })
}

const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof createPrismaClient> | undefined
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

/** TAB-4. The client OR a transaction client of THIS app's Prisma client —
 *  what `Prisma.TransactionClient` used to mean before the global `omit`
 *  above gave this client its own type. Use it for a helper that is handed
 *  either `prisma` or a `$transaction` callback's `tx`. Same deny list as
 *  Prisma's own TransactionClient. */
export type Db = Omit<typeof prisma, "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends">

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma
