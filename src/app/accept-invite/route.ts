import { NextResponse, type NextRequest } from "next/server"

// Invitation landing router. Clerk's invitation email links back here with
// __clerk_ticket plus __clerk_status, which says which flow this invitee
// actually needs — previously every invite pointed straight at /sign-up,
// which dead-ends anyone whose email already has an account (the rehire
// case: "email already exists"). Routing on the status removes that fork
// from the user entirely; the prebuilt SignIn/SignUp components consume the
// forwarded ticket automatically, and signing in with a ticket both accepts
// the invitation and starts the session.
export function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const ticket = params.get("__clerk_ticket")
  const status = params.get("__clerk_status")

  // Already signed in when they clicked — Clerk accepted the invitation on
  // its own; the app layout takes it from here (staff logins land on /my).
  if (status === "complete") {
    return NextResponse.redirect(new URL("/dashboard", request.url))
  }

  // No ticket (link mangled or reused after acceptance): sign-in is the safe
  // landing — an accepted invitee can just log in.
  if (!ticket) {
    return NextResponse.redirect(new URL("/sign-in", request.url))
  }

  const dest = status === "sign_in" ? "/sign-in" : "/sign-up"
  const url = new URL(dest, request.url)
  url.searchParams.set("__clerk_ticket", ticket)
  return NextResponse.redirect(url)
}
