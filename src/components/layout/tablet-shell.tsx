"use client"

import Link from "next/link"
import Image from "next/image"
import { usePathname } from "next/navigation"
import { CalendarDays, ClipboardCheck, Home, MessageSquare, Settings } from "lucide-react"
import { cn } from "@/lib/utils"
import { can, overridesFrom } from "@/lib/permissions"
import { resolveSingleStore, useSavedStoreId } from "@/lib/dashboard-store"
import { ContextHelpButton } from "@/components/help/context-help-button"
import { ViewSwitch } from "./view-switch"

// TAB-1 — the tablet shell: a slim icon rail in place of the sidebar, for the
// counter iPad. Rendered by the (app) layout when this device's `froot_view`
// cookie is "tablet" (src/lib/view-mode.ts).
//
// THE RAIL IS UX, NOT ENFORCEMENT — the same caveat sidebar.tsx carries. Each
// entry asks exactly what the sidebar's entry for the same destination asks,
// so the rail never shows a door the sidebar would hide:
//   Checklists — checklists.view, plus STAFF-1's store-proxy;
//   Messages   — messages.use;
//   Calendar   — calendar.view, plus the org's calendarEnabled (CAL-1 ruling 9);
//   Settings   — ADMIN only (Gary's ruling 8), and settings.access so a denial
//                still hides it.
// These are hand-written JSX, not NavItem literals, so
// scripts/verify-nav1-url-sets.ts (which parses sidebar.tsx only) is unaffected.

export const RAIL_WIDTH = "w-[88px]"

export function TabletShell({
  role,
  deniedCapabilities,
  calendarEnabled,
  staffHasChecklists,
  stores,
  children,
}: {
  role: string
  deniedCapabilities: string[]
  calendarEnabled: boolean
  staffHasChecklists: boolean
  stores: { id: string; name: string }[]
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const savedStoreId = useSavedStoreId()
  const store = resolveSingleStore(stores, savedStoreId)
  const actor = { role, overrides: overridesFrom(deniedCapabilities) }

  const items = [
    { href: "/dashboard", label: "Home", Icon: Home, show: true },
    {
      href: "/checklists",
      label: "Checklists",
      Icon: ClipboardCheck,
      show: can(actor, "checklists.view") && !(role === "STAFF" && !staffHasChecklists),
    },
    { href: "/messages", label: "Messages", Icon: MessageSquare, show: can(actor, "messages.use") },
    { href: "/calendar", label: "Calendar", Icon: CalendarDays, show: can(actor, "calendar.view") && calendarEnabled },
  ].filter((i) => i.show)

  const showSettings = role === "ADMIN" && can(actor, "settings.access")
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/")
  // The tablet home owns the whole viewport: two columns that scroll on their
  // own while the page does not. Every other route keeps its existing content
  // and container, unchanged, beside the rail.
  const isHome = pathname === "/dashboard"

  return (
    <div className="flex min-h-dvh bg-[var(--color-background)]">
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex flex-col items-center gap-2 border-r border-[var(--color-border)] bg-[var(--color-card)] py-4",
          RAIL_WIDTH
        )}
      >
        <div className="mb-3 h-11 w-11">
          <Image src="/logo.png" alt="Froot" width={44} height={44} />
        </div>
        <nav className="flex w-full flex-1 flex-col items-center gap-2 px-2">
          {items.map(({ href, label, Icon }) => (
            <RailLink key={href} href={href} label={label} active={isActive(href)}>
              <Icon className="h-6 w-6" />
            </RailLink>
          ))}
        </nav>
        <div className="flex w-full flex-col items-center gap-3 px-2">
          {showSettings && (
            <RailLink href="/settings" label="Settings" active={isActive("/settings")}>
              <Settings className="h-6 w-6" />
            </RailLink>
          )}
          {store && (
            <p className="w-full break-words text-center text-xs font-bold leading-tight text-[var(--color-foreground)]">
              {store.name}
            </p>
          )}
          <div className="w-full">
            <ViewSwitch current="tablet" layout="stack" />
          </div>
        </div>
      </aside>
      <main className="ml-[88px] flex-1 min-w-0">
        {isHome ? (
          <div className="h-dvh overflow-hidden p-4">{children}</div>
        ) : (
          <div className="max-w-6xl mx-auto px-8 py-8">{children}</div>
        )}
        <ContextHelpButton surface="app" />
      </main>
    </div>
  )
}

function RailLink({
  href,
  label,
  active,
  children,
}: {
  href: string
  label: string
  active: boolean
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-h-16 w-full flex-col items-center justify-center gap-1 rounded-xl text-xs font-semibold transition-colors",
        active
          ? "bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
          : "text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-foreground)]"
      )}
    >
      {children}
      {label}
    </Link>
  )
}
