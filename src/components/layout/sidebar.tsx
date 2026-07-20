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
} from "lucide-react"
import { InstagramIcon } from "@/components/instagram-icon"
import { cn } from "@/lib/utils"
import { useClerk, useUser } from "@clerk/nextjs"
import { setSidebarCollapsed, useSidebarCollapsed } from "./use-sidebar-collapsed"

type NavItem = {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  roles: string[]
  requiresInstagram?: boolean
  requiresHr?: boolean
  requiresLabor?: boolean
}

const navItems: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ["ADMIN", "MANAGER", "STORE", "STAFF"] },
  { href: "/checklists", label: "Checklists", icon: CheckSquare, roles: ["ADMIN", "MANAGER", "STORE", "STAFF"] },
  { href: "/messages", label: "Messages", icon: MessageSquare, roles: ["ADMIN", "MANAGER", "STORE", "STAFF"] },
  { href: "/templates", label: "Templates", icon: FileText, roles: ["ADMIN"] },
  { href: "/stores", label: "Stores", icon: Store, roles: ["ADMIN", "MANAGER"] },
  { href: "/users", label: "Users", icon: Users, roles: ["ADMIN"] },
  { href: "/staff", label: "Staff", icon: UserSquare, roles: ["ADMIN", "MANAGER"] },
  { href: "/reports", label: "Reports", icon: BarChart2, roles: ["ADMIN", "MANAGER"] },
  { href: "/forecasting", label: "Forecasting", icon: TrendingUp, roles: ["ADMIN", "MANAGER"] },
  { href: "/store-view", label: "Store View", icon: Eye, roles: ["ADMIN", "MANAGER", "STORE", "STAFF"] },
  // Only rendered when the org has Instagram connected + enabled (see filter below).
  { href: "/instagram", label: "Instagram", icon: InstagramIcon, roles: ["ADMIN", "MANAGER", "STORE", "STAFF"], requiresInstagram: true },
  // Only rendered when HR is available in this environment AND the org toggle
  // is on (hidden while off — the admin controls the toggle in Settings).
  { href: "/hr", label: "HR", icon: BriefcaseBusiness, roles: ["ADMIN", "MANAGER", "STORE", "STAFF"], requiresHr: true },
  // Config hub for the Weekly Labor Model — ADMIN/MANAGER only, gated on both
  // Labor feature flags (available in this env AND org toggle on).
  { href: "/settings/labor", label: "Labor", icon: Clock, roles: ["ADMIN", "MANAGER"], requiresLabor: true },
]

const inventoryNavItems = [
  { href: "/inventory/ingredients", label: "Ingredients", roles: ["ADMIN", "MANAGER", "STORE", "STAFF"] },
  { href: "/inventory/sales-items", label: "Sales Items", roles: ["ADMIN", "MANAGER", "STORE", "STAFF"] },
  { href: "/inventory/recipes", label: "Recipes", roles: ["ADMIN", "MANAGER"] },
  { href: "/inventory/storage-areas", label: "Storage Areas", roles: ["ADMIN", "MANAGER"] },
  { href: "/inventory/counts", label: "Counts", roles: ["ADMIN", "MANAGER", "STORE", "STAFF"] },
  { href: "/inventory/adjustments", label: "Adjustments", roles: ["ADMIN", "MANAGER", "STORE", "STAFF"] },
  { href: "/inventory/vendors", label: "Vendors", roles: ["ADMIN", "MANAGER"] },
  { href: "/inventory/purchase-orders", label: "Purchase Orders", roles: ["ADMIN", "MANAGER", "STORE", "STAFF"] },
  { href: "/inventory/expected", label: "Expected Stock", roles: ["ADMIN", "MANAGER"] },
  { href: "/inventory/alerts", label: "Alerts", roles: ["ADMIN", "MANAGER"] },
  { href: "/inventory/reports", label: "Reports", roles: ["ADMIN", "MANAGER"] },
]

export function Sidebar({
  role,
  activeModules = [],
  instagramEnabled = false,
  hrAvailable = false,
  laborAvailable = false,
}: {
  role: string
  activeModules?: string[]
  instagramEnabled?: boolean
  hrAvailable?: boolean
  laborAvailable?: boolean
}) {
  const pathname = usePathname()
  const { signOut } = useClerk()
  const { user } = useUser()
  const collapsed = useSidebarCollapsed()
  const hrEnabled = hrAvailable && activeModules.includes("hr")
  const laborEnabled = laborAvailable && activeModules.includes("labor")
  const visibleNavItems = navItems.filter(
    (item) =>
      item.roles.includes(role) &&
      (!item.requiresInstagram || instagramEnabled) &&
      (!item.requiresHr || hrEnabled) &&
      (!item.requiresLabor || laborEnabled)
  )
  const visibleInventoryItems = activeModules.includes("inventory")
    ? inventoryNavItems.filter((item) => item.roles.includes(role))
    : []
  const canSeeSettings = role === "ADMIN"
  // Settings owns /settings, but a more specific nav item (e.g. Labor at
  // /settings/labor) takes precedence — otherwise both would highlight.
  const settingsActive =
    pathname.startsWith("/settings") &&
    !visibleNavItems.some((item) => pathname === item.href || pathname.startsWith(item.href + "/"))

  // Low-stock alert count for the Alerts badge — fetched once per mount (the
  // count runs the expected-inventory engine server-side, so no polling).
  const [alertCount, setAlertCount] = useState(0)
  const showAlertBadge = activeModules.includes("inventory") && (role === "ADMIN" || role === "MANAGER")
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
