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
  })
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma
