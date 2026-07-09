import { auth } from "@clerk/nextjs/server"
import { NextResponse } from "next/server"
import { squareBaseUrl } from "@/lib/square"

// ORDERS_READ: sales sync (dashboard + inventory reports)
// EMPLOYEES_READ: team member import (removes the personal-token fallback)
const SCOPES = "MERCHANT_PROFILE_READ ITEMS_READ ORDERS_READ EMPLOYEES_READ"

export async function GET() {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const appId = process.env.NEXT_PUBLIC_SQUARE_APP_ID ?? ""
  const baseUrl = squareBaseUrl()
  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/square/callback`

  const url = `${baseUrl}/oauth2/authorize?client_id=${appId}&scope=${SCOPES}&state=${orgId}&session=false&redirect_uri=${encodeURIComponent(redirectUri)}`

  return NextResponse.redirect(url)
}
