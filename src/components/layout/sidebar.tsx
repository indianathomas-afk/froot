"use client"

import Link from "next/link"
import Image from "next/image"
import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"
import {
  LayoutDashboard,
  CheckSquare,
  ChevronDown,
  FileText,
  Store,
  Users,
  UserSquare,
  BarChart2,
  Eye,
  MessageSquare,
  Settings,
  LogOut,
  TrendingUp,
  PanelLeftClose,
  PanelLeftOpen,
  Package,
  BriefcaseBusiness,
  Clock,
  CalendarRange,
} from "lucide-react"
import { InstagramIcon } from "@/components/instagram-icon"
import { cn } from "@/lib/utils"
import { can, overridesFrom, type Capability } from "@/lib/permissions"
import { useClerk, useUser } from "@clerk/nextjs"
import { setSidebarCollapsed, useSidebarCollapsed } from "./use-sidebar-collapsed"

type NavItem = {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  // PERM-1 pilot: each item's former roles: [...] array is now a capability
  // (docs/PERMISSIONS_INVENTORY.md §5); the capability's role grant is
  // identical to the array it replaced. The requires* feature gates and the
  // STAFF checklists store-proxy below are unchanged.
  capability: Capability
  requiresInstagram?: boolean
  requiresHr?: boolean
  requiresLabor?: boolean
}

const navItems: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, capability: "dashboard.view" },
  { href: "/checklists", label: "Checklists", icon: CheckSquare, capability: "checklists.view" },
  { href: "/messages", label: "Messages", icon: MessageSquare, capability: "messages.use" },
  { href: "/templates", label: "Templates", icon: FileText, capability: "templates.manage" },
  { href: "/stores", label: "Stores", icon: Store, capability: "stores.view" },
  { href: "/users", label: "Users", icon: Users, capability: "users.manage" },
  { href: "/staff", label: "Staff", icon: UserSquare, capability: "staff.view" },
  { href: "/reports", label: "Reports", icon: BarChart2, capability: "reports.view" },
  { href: "/forecasting", label: "Forecasting", icon: TrendingUp, capability: "forecasting.view" },
  // STAFF-1: Store View is an operational floor surface — not for STAFF logins.
  { href: "/store-view", label: "Store View", icon: Eye, capability: "storeview.access" },
  // Only rendered when the org has Instagram connected + enabled (see filter below).
  { href: "/instagram", label: "Instagram", icon: InstagramIcon, capability: "instagram.view", requiresInstagram: true },
  // Only rendered when HR is available in this environment AND the org toggle
  // is on (hidden while off — the admin controls the toggle in Settings).
  { href: "/hr", label: "HR", icon: BriefcaseBusiness, capability: "hr.access", requiresHr: true },
  // Weekly Plan (L-3) — the schedule-writing view, gated on both Labor flags.
  // Read-only for viewers; ADMIN/MANAGER can rebalance. PERM-2 §3 #8: shown to
  // all roles — staff seeing their own schedule is intended, and labor.view is
  // now ALL to match the guard that always served them.
  { href: "/labor", label: "Weekly Plan", icon: CalendarRange, capability: "labor.view", requiresLabor: true },
  // Config hub for the Weekly Labor Model — ADMIN/MANAGER only, gated on both
  // Labor feature flags (available in this env AND org toggle on).
  { href: "/settings/labor", label: "Labor", icon: Clock, capability: "labor.manage", requiresLabor: true },
]

// STAFF-1: inventory is not part of the staff experience — STAFF removed from
// every item (STORE keeps its operational subset). The Recipes/Vendors and
// Storage Areas entries map to the manage-tier capabilities because those
// capabilities' role grants (ADMIN+MANAGER) match the arrays they replaced —
// their pages have no server role guard, so the nav tier IS the enforcement
// (PERMISSIONS_INVENTORY.md §2 #12).
//
// PERM-2 §3 #5: the operational entries ask inventory.nav.view, NOT the
// operational capabilities their routes enforce. Those grants went to ALL
// because that is who the APIs serve — pointing the nav at them would have put
// Counts and Adjustments in the STAFF sidebar and quietly reversed STAFF-1.
// Nav visibility and API access are separate on purpose; see permissions.ts.
const inventoryNavItems: { href: string; label: string; capability: Capability }[] = [
  { href: "/inventory/ingredients", label: "Ingredients", capability: "inventory.nav.view" },
  { href: "/inventory/sales-items", label: "Sales Items", capability: "inventory.nav.view" },
  { href: "/inventory/recipes", label: "Recipes", capability: "inventory.assets.manage" },
  { href: "/inventory/storage-areas", label: "Storage Areas", capability: "inventory.storage.manage" },
  { href: "/inventory/counts", label: "Counts", capability: "inventory.nav.view" },
  { href: "/inventory/adjustments", label: "Adjustments", capability: "inventory.nav.view" },
  { href: "/inventory/vendors", label: "Vendors", capability: "inventory.assets.manage" },
  { href: "/inventory/purchase-orders", label: "Purchase Orders", capability: "inventory.po.view" },
  { href: "/inventory/expected", label: "Expected Stock", capability: "inventory.analytics.view" },
  { href: "/inventory/alerts", label: "Alerts", capability: "inventory.analytics.view" },
  { href: "/inventory/reports", label: "Reports", capability: "inventory.analytics.view" },
]

export function Sidebar({
  role,
  deniedCapabilities,
  activeModules = [],
  instagramEnabled = false,
  hrAvailable = false,
  laborAvailable = false,
  staffHasChecklists = false,
}: {
  role: string
  // PERM-5. REQUIRED, deliberately undefaulted: a default of [] would let a
  // caller that forgets to pass it render the full role baseline and look
  // correct. Missing is a build error instead.
  //
  // THIS FILTERING IS UX, NOT ENFORCEMENT — the same caveat the whole nav
  // layer carries. Hiding a link protects nobody; the server checks the
  // destination pages and APIs run are the enforcement. The nav asks the
  // override anyway so that a denied user is not shown a door that 403s.
  deniedCapabilities: string[]
  activeModules?: string[]
  instagramEnabled?: boolean
  hrAvailable?: boolean
  laborAvailable?: boolean
  // STAFF-1 (F3 store-proxy): whether any open checklist exists for the staff
  // user's assigned stores — computed server-side in the layout.
  staffHasChecklists?: boolean
}) {
  const pathname = usePathname()
  const { signOut } = useClerk()
  const { user } = useUser()
  const collapsed = useSidebarCollapsed()
  const hrEnabled = hrAvailable && activeModules.includes("hr")
  const laborEnabled = laborAvailable && activeModules.includes("labor")
  // PERM-5: the server-provided prop path, rebuilt into the same shape the
  // server-side guards use so the sidebar and the pages it links to cannot
  // disagree about what this user was denied.
  const actor = { role, overrides: overridesFrom(deniedCapabilities) }
  const visibleNavItems = navItems
    .filter(
      (item) =>
        can(actor, item.capability) &&
        (!item.requiresInstagram || instagramEnabled) &&
        (!item.requiresHr || hrEnabled) &&
        (!item.requiresLabor || laborEnabled) &&
        // STAFF-1: Checklists only surface for STAFF when their stores have one.
        !(role === "STAFF" && item.href === "/checklists" && !staffHasChecklists)
    )
    // STAFF-1: the HR entry reads "My Documents" for STAFF and points at the
    // staff portal's own-documents surface (ADMIN/MANAGER keep "HR" → /hr).
    .map((item) =>
      role === "STAFF" && item.href === "/hr"
        ? { ...item, label: "My Documents", href: "/my/documents" }
        : item
    )
  const visibleInventoryItems = activeModules.includes("inventory")
    ? inventoryNavItems.filter((item) => can(actor, item.capability))
    : []
  const canSeeSettings = can(actor, "settings.access")
  // Settings owns /settings, but a more specific nav item (e.g. Labor at
  // /settings/labor) takes precedence — otherwise both would highlight.
  const settingsActive =
    pathname.startsWith("/settings") &&
    !visibleNavItems.some((item) => pathname === item.href || pathname.startsWith(item.href + "/"))

  // Low-stock alert count for the Alerts badge — fetched once per mount (the
  // count runs the expected-inventory engine server-side, so no polling).
  const [alertCount, setAlertCount] = useState(0)
  // PERM-2 §3 #5: same capability /api/inventory/alerts/count now enforces —
  // the badge must not fire a request it will be 403'd for.
  const showAlertBadge = activeModules.includes("inventory") && can(actor, "inventory.analytics.view")
  useEffect(() => {
    if (!showAlertBadge) return
    let cancelled = false
    fetch("/api/inventory/alerts/count")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d && typeof d.count === "number") setAlertCount(d.count)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [showAlertBadge])

  // Inventory section collapse — persisted so the (long) asset list stays out
  // of the way across visits. Read after mount to avoid a hydration mismatch.
  const [inventoryOpen, setInventoryOpen] = useState(true)
  useEffect(() => {
    const stored = localStorage.getItem("froot-inventory-nav-open")
    if (stored !== null) setInventoryOpen(stored === "true")
  }, [])

  function toggleInventory() {
    setInventoryOpen((open) => {
      localStorage.setItem("froot-inventory-nav-open", String(!open))
      return !open
    })
  }

  function toggle() {
    setSidebarCollapsed(!collapsed)
  }

  const w = collapsed ? "w-[60px]" : "w-[190px]"

  return (
    <aside className={cn("fixed left-0 top-0 h-screen flex flex-col border-r border-[var(--color-border)] bg-[var(--color-card)] z-40 transition-all duration-200", w)}>
      {/* Logo + toggle */}
      <div className="flex items-center gap-2 px-3 py-4 border-b border-[var(--color-border)]">
        <div className="w-8 h-8 shrink-0">
          <Image src="/logo.png" alt="Froot" width={32} height={32} />
        </div>
        {!collapsed && <span className="flex-1" />}
        <button
          onClick={toggle}
          className="p-1 rounded hover:bg-[var(--color-accent)] text-[var(--color-muted-foreground)] transition-colors shrink-0"
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto overflow-x-hidden">
        {visibleNavItems.map(({ href, label, icon: Icon }) => {
          const isActive = pathname === href || pathname.startsWith(href + "/")
          return (
            <Link
              key={href}
              href={href}
              title={collapsed ? label : undefined}
              className={cn(
                "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors",
                collapsed ? "justify-center px-2" : "",
                isActive
                  ? "bg-[var(--color-primary)]/10 text-[var(--color-primary)] font-medium"
                  : "text-[var(--color-foreground)] hover:bg-[var(--color-accent)]"
              )}
            >
              <Icon className={cn("h-4 w-4 shrink-0", isActive ? "text-[var(--color-primary)]" : "text-[var(--color-muted-foreground)]")} />
              {!collapsed && label}
            </Link>
          )
        })}

        {visibleInventoryItems.length > 0 && (
          <div className="pt-3">
            {collapsed ? (
              <button
                onClick={toggleInventory}
                title={inventoryOpen ? "Collapse inventory" : "Expand inventory"}
                className={cn(
                  "flex items-center justify-center w-full px-2 py-2 rounded-md transition-colors",
                  pathname.startsWith("/inventory")
                    ? "bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
                    : "text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]"
                )}
              >
                <Package className="h-4 w-4 shrink-0" />
              </button>
            ) : (
              <button
                onClick={toggleInventory}
                className={cn(
                  "w-full flex items-center gap-1.5 px-3 py-1 pb-1 rounded-md text-xs font-medium uppercase tracking-wide transition-colors hover:bg-[var(--color-accent)]",
                  !inventoryOpen && pathname.startsWith("/inventory")
                    ? "text-[var(--color-primary)]"
                    : "text-[var(--color-muted-foreground)]"
                )}
              >
                <Package className="h-3.5 w-3.5" />
                Inventory
                {!inventoryOpen && alertCount > 0 && (
                  <span className="inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-[var(--color-warning)] text-white text-[10px] font-semibold normal-case tracking-normal">
                    {alertCount > 99 ? "99+" : alertCount}
                  </span>
                )}
                <ChevronDown
                  className={cn("h-3.5 w-3.5 ml-auto transition-transform duration-200", !inventoryOpen && "-rotate-90")}
                />
              </button>
            )}
            {inventoryOpen && visibleInventoryItems.map(({ href, label }) => {
              const isActive = pathname === href || pathname.startsWith(href + "/")
              return (
                <Link
                  key={href}
                  href={href}
                  title={collapsed ? label : undefined}
                  className={cn(
                    "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors",
                    collapsed ? "justify-center px-2" : "pl-6",
                    isActive
                      ? "bg-[var(--color-primary)]/10 text-[var(--color-primary)] font-medium"
                      : "text-[var(--color-foreground)] hover:bg-[var(--color-accent)]"
                  )}
                >
                  {collapsed ? (
                    <Package className={cn("h-4 w-4 shrink-0", isActive ? "text-[var(--color-primary)]" : "text-[var(--color-muted-foreground)]")} />
                  ) : (
                    <>
                      <span className="flex-1">{label}</span>
                      {href === "/inventory/alerts" && alertCount > 0 && (
                        <span className="ml-auto inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-[var(--color-warning)] text-white text-xs font-semibold">
                          {alertCount > 99 ? "99+" : alertCount}
                        </span>
                      )}
                    </>
                  )}
                </Link>
              )
            })}
          </div>
        )}
      </nav>

      {/* Settings */}
      {canSeeSettings && (
        <div className="px-2 py-2">
          <Link
            href="/settings"
            title={collapsed ? "Settings" : undefined}
            className={cn(
              "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors",
              collapsed ? "justify-center px-2" : "",
              settingsActive
                ? "bg-[var(--color-primary)]/10 text-[var(--color-primary)] font-medium"
                : "text-[var(--color-foreground)] hover:bg-[var(--color-accent)]"
            )}
          >
            <Settings className={cn("h-4 w-4 shrink-0", settingsActive ? "text-[var(--color-primary)]" : "text-[var(--color-muted-foreground)]")} />
            {!collapsed && "Settings"}
          </Link>
        </div>
      )}

      {/* User info */}
      <div className="border-t border-[var(--color-border)] px-3 py-3">
        {collapsed ? (
          <button
            onClick={() => signOut({ redirectUrl: "/sign-in" })}
            title="Sign out"
            className="flex items-center justify-center w-full text-[var(--color-muted-foreground)] hover:text-[var(--color-destructive)] transition-colors"
          >
            <LogOut className="h-4 w-4" />
          </button>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-2">
              <div className="w-7 h-7 rounded-full bg-[var(--color-muted)] flex items-center justify-center text-xs font-semibold text-[var(--color-muted-foreground)] shrink-0">
                {user?.firstName?.[0] ?? user?.emailAddresses?.[0]?.emailAddress?.[0]?.toUpperCase() ?? "U"}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{user?.firstName ?? user?.emailAddresses?.[0]?.emailAddress?.split("@")[0]}</p>
                <p className="text-xs text-[var(--color-muted-foreground)] truncate">{user?.emailAddresses?.[0]?.emailAddress}</p>
              </div>
            </div>
            <button
              onClick={() => signOut({ redirectUrl: "/sign-in" })}
              className="flex items-center gap-2 text-xs text-[var(--color-muted-foreground)] hover:text-[var(--color-destructive)] transition-colors"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sign out
            </button>
          </>
        )}
      </div>
    </aside>
  )
}
