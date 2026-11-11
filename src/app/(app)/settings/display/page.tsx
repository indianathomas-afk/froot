import { redirect } from "next/navigation"
import Link from "next/link"
import { ChevronLeft } from "lucide-react"
import { getCurrentUser } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { resolveLayout } from "@/lib/display-layout"
import { DisplaySettingsClient } from "./display-settings-client"

// TAB-3 — Display settings (Gary, 2026-11-10, ruling 1): which cards the
// desktop dashboard and Tablet mode show, and in what order. One layout per
// org, ADMIN only. Two tabs: Dashboard and Tablet. No live preview in v1
// (ruling 8 — a ROADMAP row).
//
// SHAPE AND GATE COPIED FROM /settings/notifications: no layout file, a
// ChevronLeft back-link, an h1 and one line, then the content. The gate is
// settings.access — ADMIN_ONLY and held out of the override grid, so it cannot
// be granted down — and PUT /api/display/settings re-checks ADMIN itself.
//
// The org row is read through getCurrentUser() (never a bare clerkUserId
// lookup — CLAUDE.md § Page Conventions), and the two columns only ever pass
// through resolveLayout(), so the page shows exactly what the dashboard and
// the tablet will render: unknown keys dropped, new cards at their default
// place, locked tablet columns on.

export default async function DisplaySettingsPage() {
  let ctx: Awaited<ReturnType<typeof getCurrentUser>>
  try {
    ctx = await getCurrentUser()
  } catch {
    redirect("/dashboard")
  }
  const { org, actor } = ctx
  if (!can(actor, "settings.access")) redirect("/dashboard")

  return (
    <div>
      <div className="mb-6">
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 text-sm text-[var(--color-muted-foreground)] hover:text-[var(--color-primary)] mb-2"
        >
          <ChevronLeft className="h-4 w-4" /> Settings
        </Link>
        <h1 className="text-2xl font-bold text-[var(--color-foreground)]">Display Settings</h1>
        <p className="text-sm text-[var(--color-muted-foreground)] mt-1">
          Choose which cards each screen shows, and in what order. Changes apply to everyone in your
          organization the next time the screen loads. Nobody sees a card their role couldn&apos;t see already.
        </p>
      </div>
      <DisplaySettingsClient
        dashboard={resolveLayout("dashboard", org.dashboardLayout)}
        tablet={resolveLayout("tablet", org.tabletLayout)}
        dashboardIsDefault={org.dashboardLayout === null}
        tabletIsDefault={org.tabletLayout === null}
      />
    </div>
  )
}
