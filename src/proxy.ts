import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server"

const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/accept-invite(.*)", // invitation landing router — invitees have no session yet

  "/api/webhooks(.*)",
  "/api/cron(.*)", // authenticates itself via CRON_SECRET (Vercel cron has no session)
  "/menu/(.*)", // N-3 public nutrition menu — no session; tightened from /menu(.*), which also matched /menus etc.
])

export default clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) {
    await auth.protect()
  }
})

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
}
