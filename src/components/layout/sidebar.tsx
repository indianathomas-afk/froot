"use client"

import Link from "next/link"
import Image from "next/image"
import { useEffect, useRef, useState } from "react"
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
  HelpCircle,
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

type IconComponent = React.ComponentType<{ className?: string }>

type NavItem = {
  href: string
  label: string
  // Optional ONLY because the inventory children have never had one — they
  // render the group's Package icon when the rail is collapsed. Every
  // top-level and grouped item added since NAV-1 carries its own.
  icon?: IconComponent
  // PERM-1 pilot: each item's former roles: [...] array is now a capability
  // (docs/PERMISSIONS_INVENTORY.md §5); the capability's role grant is
  // identical to the array it replaced. The requires* feature gates and the
  // STAFF checklists store-proxy below are unchanged.
  capability: Capability
  requiresInstagram?: boolean
  requiresHr?: boolean
  requiresLabor?: boolean
  // NAV-1: the Messages treatment approved in mockup review — a persistent
  // soft-primary tint with a hairline primary border, deliberately lighter
  // than the active-page state so the two remain distinguishable.
  highlight?: boolean
}

// NAV-1. A group header is a BUTTON AND NEVER A LINK — it expands and collapses
// and has no destination of its own, which is why the first child of a group
// repeats the group's label (Checklists → /checklists, Stores → /stores,
// Forecasting → /forecasting). Clicking "Stores" must not navigate to /stores;
// clicking the "Stores" child under it must.
type NavGroup = {
  key: string
  label: string
  icon: IconComponent
  // The localStorage key holding this group's open/closed preference.
  // INVENTORY keeps "froot-inventory-nav-open" verbatim — renaming it would
  // silently reset the stored preference of every user who has one.
  storageKey: string
  requiresModule?: string
  items: NavItem[]
}

type NavEntry = NavItem | NavGroup

function isGroup(entry: NavEntry): entry is NavGroup {
  return "items" in entry
}

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
//
// NAV-1 DID NOT TOUCH THIS LIST. Same eleven entries, same order, same
// capabilities; only the enclosing group's rendering became shared.
const inventoryNavItems: NavItem[] = [
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

// NAV-1 — the sidebar, top to bottom. EVERY href HERE ALREADY EXISTED as a flat
// nav entry before this phase; nothing was created, renamed or removed at the
// route level. Grouping is presentational. The done criterion for the phase is
// that the set of destination URLs a role can reach is byte-identical before and
// after (docs/prompts/NAV-1_sidebar_restructure.md § Evidence), so an item added
// or dropped here is a defect, not a preference.
//
// PERMISSION FILTERING IS PER ITEM, NEVER PER GROUP. Each entry keeps the exact
// capability it carried in the flat list. A group has no capability of its own —
// it renders when at least one child survives filtering and hides when none do,
// so an empty accordion cannot appear.
// HELP-1a — the pinned Help destination.
//
// DELIBERATELY A LITERAL OF THE SAME SHAPE the items in navStructure use, and
// deliberately on ONE LINE, because scripts/verify-nav1-url-sets.ts parses this
// file as TEXT with a line-oriented regex. Reformatting this declaration across
// several lines would make the fixture stop seeing it — silently, and with a
// GREEN run, which is the failure mode the fixture's own parser guard
// (`before.length < 20 || after.length < 20`) exists to prevent. If you split
// it, the fixture no longer governs the one nav entry every role has.
//
// It is NOT a member of navStructure: it renders pinned below the nav rather
// than inside the accordion (audit §D.1). The parser does not care where a
// literal is used, only that it is here to be read — which is what lets Help be
// both pinned and governed.
const HELP_ITEM: NavItem = { href: "/help", label: "Help", icon: HelpCircle, capability: "help.view" }

const navStructure: NavEntry[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, capability: "dashboard.view" },
  {
    key: "checklists",
    label: "Checklists",
    icon: CheckSquare,
    storageKey: "froot-nav-checklists-open",
    items: [
      { href: "/checklists", label: "Checklists", icon: CheckSquare, capability: "checklists.view" },
      // STAFF-1: Store View is an operational floor surface — not for STAFF
      // logins. NAV-1 relabelled it "Start Daily Checklist"; the capability and
      // the destination are unchanged.
      { href: "/store-view", label: "Start Daily Checklist", icon: Eye, capability: "storeview.access" },
      { href: "/templates", label: "Templates", icon: FileText, capability: "templates.manage" },
    ],
  },
  { href: "/messages", label: "Messages", icon: MessageSquare, capability: "messages.use", highlight: true },
  {
    key: "stores",
    label: "Stores",
    icon: Store,
    storageKey: "froot-nav-stores-open",
    items: [
      { href: "/stores", label: "Stores", icon: Store, capability: "stores.view" },
      { href: "/users", label: "Users", icon: Users, capability: "users.manage" },
      { href: "/staff", label: "Staff", icon: UserSquare, capability: "staff.view" },
    ],
  },
  { href: "/reports", label: "Reports", icon: BarChart2, capability: "reports.view" },
  {
    key: "forecasting",
    label: "Forecasting",
    icon: TrendingUp,
    storageKey: "froot-nav-forecasting-open",
    items: [
      { href: "/forecasting", label: "Forecasting", icon: TrendingUp, capability: "forecasting.view" },
      // Weekly Plan (L-3) — the schedule-writing view, gated on both Labor flags.
      // Read-only for viewers; ADMIN/MANAGER can rebalance. PERM-2 §3 #8: shown to
      // all roles — staff seeing their own schedule is intended, and labor.view is
      // now ALL to match the guard that always served them.
      { href: "/labor", label: "Weekly Plan", icon: CalendarRange, capability: "labor.view", requiresLabor: true },
      // Config hub for the Weekly Labor Model — ADMIN/MANAGER only, gated on both
      // Labor feature flags (available in this env AND org toggle on).
      //
      // COMP-1 — labor.access, NOT labor.manage. Both are MANAGE so no role's nav
      // changes, but only labor.access is in the override grid AND enforced on the
      // page and the routes. Pointing the link at labor.manage would leave a denied
      // user still seeing the entry, and pointing it at a capability the server does
      // not check would hide the link over a page that still answers — the two
      // halves of the defect this row exists to avoid.
      //
      // NAV-1 RULING (docs/DECISIONS.md): hidden ENTIRELY without labor.access —
      // no lock badge, no disabled state. A visible lock on a compensation page
      // advertises what COMP-1 exists to keep confidential.
      { href: "/settings/labor", label: "Labor", icon: Clock, capability: "labor.access", requiresLabor: true },
    ],
  },
  // Only rendered when the org has Instagram connected + enabled (see filter below).
  //
  // NAV-1: ABSENT FROM THE PROMPT'S STRUCTURE BLOCK AND KEPT ANYWAY. It is a
  // real entry that is simply invisible until an org connects Instagram, which
  // is why it did not appear in the mockup the structure was written from.
  // Dropping it would have been a lost URL and a failure of this phase's own
  // done criterion. Position preserved: it sat between /store-view and /hr.
  { href: "/instagram", label: "Instagram", icon: InstagramIcon, capability: "instagram.view", requiresInstagram: true },
  // Only rendered when HR is available in this environment AND the org toggle
  // is on (hidden while off — the admin controls the toggle in Settings).
  { href: "/hr", label: "HR", icon: BriefcaseBusiness, capability: "hr.access", requiresHr: true },
  {
    key: "inventory",
    label: "Inventory",
    icon: Package,
    storageKey: "froot-inventory-nav-open",
    requiresModule: "inventory",
    items: inventoryNavItems,
  },
]

const navGroups = navStructure.filter(isGroup)

function matchesPath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + "/")
}

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

  // The one filter every entry passes through, group child and top-level item
  // alike — NAV-1's rule that permission filtering is per item and never per
  // group is enforced by there being exactly one place it can happen.
  function isVisible(item: NavItem) {
    return (
      can(actor, item.capability) &&
      (!item.requiresInstagram || instagramEnabled) &&
      (!item.requiresHr || hrEnabled) &&
      (!item.requiresLabor || laborEnabled) &&
      // STAFF-1: Checklists only surface for STAFF when their stores have one.
      !(role === "STAFF" && item.href === "/checklists" && !staffHasChecklists)
    )
  }

  // STAFF-1: the HR entry reads "My Documents" for STAFF and points at the
  // staff portal's own-documents surface (ADMIN/MANAGER keep "HR" → /hr).
  function relabel(item: NavItem): NavItem {
    return role === "STAFF" && item.href === "/hr"
      ? { ...item, label: "My Documents", href: "/my/documents" }
      : item
  }

  const visibleStructure = navStructure
    .map((entry): NavEntry | null => {
      if (!isGroup(entry)) return isVisible(entry) ? relabel(entry) : null
      if (entry.requiresModule && !activeModules.includes(entry.requiresModule)) return null
      const items = entry.items.filter(isVisible)
      // A group header hides itself when every child is filtered out — no
      // empty accordions, and no header that expands into nothing.
      return items.length > 0 ? { ...entry, items } : null
    })
    .filter((entry): entry is NavEntry => entry !== null)

  // Flattened for the two consumers that need every reachable destination
  // regardless of nesting: the /settings precedence test below, and nothing
  // else. Keep it derived rather than hand-maintained.
  const allVisibleItems = visibleStructure.flatMap((entry) => (isGroup(entry) ? entry.items : [entry]))

  const canSeeHelp = can(actor, "help.view")
  const helpActive = pathname === "/help" || pathname.startsWith("/help/")
  const canSeeSettings = can(actor, "settings.access")
  // Settings owns /settings, but a more specific nav item (e.g. Labor at
  // /settings/labor) takes precedence — otherwise both would highlight.
  const settingsActive =
    pathname.startsWith("/settings") && !allVisibleItems.some((item) => matchesPath(pathname, item.href))

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

  // Group collapse — persisted per user so a long child list stays out of the
  // way across visits. Default open; the stored preference is read AFTER mount
  // to avoid a hydration mismatch (the server has no localStorage), which is
  // the same shape the INVENTORY section used before NAV-1 generalised it.
  const [groupOpen, setGroupOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(navGroups.map((g) => [g.key, true]))
  )
  // ONE effect and ONE setState call, deliberately: the seed-from-storage pass
  // and the auto-open pass write the same piece of state, and splitting them
  // would add a second cascading-render site for no behavioural gain.
  const seeded = useRef(false)
  useEffect(() => {
    setGroupOpen((prev) => {
      const next = { ...prev }
      if (!seeded.current) {
        seeded.current = true
        for (const g of navGroups) {
          const stored = localStorage.getItem(g.storageKey)
          if (stored !== null) next[g.key] = stored === "true"
        }
      }
      // Auto-open: the group containing the current route is expanded on load
      // and on every navigation into it. ONE-WAY — it only ever opens, so a
      // user who collapses the group they are standing in keeps it collapsed
      // until they navigate again, and no stored preference is overwritten.
      const owner = navGroups.find((g) => g.items.some((i) => matchesPath(pathname, i.href)))
      if (owner) next[owner.key] = true
      return next
    })
  }, [pathname])

  function toggleGroup(group: NavGroup) {
    setGroupOpen((prev) => {
      const open = !(prev[group.key] ?? true)
      localStorage.setItem(group.storageKey, String(open))
      return { ...prev, [group.key]: open }
    })
  }

  function toggle() {
    setSidebarCollapsed(!collapsed)
  }

  const w = collapsed ? "w-[60px]" : "w-[190px]"

  // Shared box for every destination link, nested or not. The transparent
  // border is load-bearing: Messages carries a real 1px border, and without a
  // matching one here every other row would sit 2px shorter than it.
  const linkBase = "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors border border-transparent"

  function renderItem(item: NavItem, group?: NavGroup) {
    const { href, label, highlight } = item
    // An item with no icon of its own — the inventory children, and only them —
    // renders WITHOUT one while the rail is expanded and borrows the group's
    // icon while it is collapsed, because a 60px rail with no glyph is a blank
    // row. That is exactly what the INVENTORY section did before NAV-1
    // generalised it, and "do not touch its children" includes not giving them
    // eleven identical Package icons they never had.
    const Icon = item.icon ?? (collapsed ? group?.icon : undefined)
    const isActive = matchesPath(pathname, href)
    return (
      <Link
        key={href}
        href={href}
        title={collapsed ? label : undefined}
        className={cn(
          linkBase,
          collapsed ? "justify-center px-2" : group ? "pl-6" : "",
          highlight
            ? isActive
              ? "bg-[var(--color-primary)]/10 border-[var(--color-primary)]/40 text-[var(--color-primary)] font-semibold"
              : "bg-[var(--color-primary)]/5 border-[var(--color-primary)]/30 text-[var(--color-foreground)] font-semibold hover:bg-[var(--color-primary)]/10"
            : isActive
              ? "bg-[var(--color-primary)]/10 text-[var(--color-primary)] font-medium"
              : "text-[var(--color-foreground)] hover:bg-[var(--color-accent)]"
        )}
      >
        {Icon && (
          <Icon
            className={cn(
              "h-4 w-4 shrink-0",
              isActive || highlight ? "text-[var(--color-primary)]" : "text-[var(--color-muted-foreground)]"
            )}
          />
        )}
        {!collapsed && (
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
  }

  function renderGroup(group: NavGroup) {
    const open = groupOpen[group.key] ?? true
    const Icon = group.icon
    const holdsActiveRoute = group.items.some((i) => matchesPath(pathname, i.href))
    // The alerts count rolls up onto the header while INVENTORY is closed, so a
    // low-stock warning is not hidden by a collapsed section.
    const rolledUpAlerts = group.key === "inventory" && !open && alertCount > 0
    return (
      <div key={group.key} className="pt-3">
        {collapsed ? (
          <button
            onClick={() => toggleGroup(group)}
            title={open ? `Collapse ${group.label}` : `Expand ${group.label}`}
            className={cn(
              "flex items-center justify-center w-full px-2 py-2 rounded-md transition-colors",
              holdsActiveRoute
                ? "bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
                : "text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)]"
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
          </button>
        ) : (
          <button
            onClick={() => toggleGroup(group)}
            className={cn(
              "w-full flex items-center gap-1.5 px-3 py-1 pb-1 rounded-md text-xs font-semibold uppercase tracking-wide transition-colors hover:bg-[var(--color-accent)]",
              !open && holdsActiveRoute ? "text-[var(--color-primary)]" : "text-[var(--color-muted-foreground)]"
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {group.label}
            {rolledUpAlerts && (
              <span className="inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-[var(--color-warning)] text-white text-[10px] font-semibold normal-case tracking-normal">
                {alertCount > 99 ? "99+" : alertCount}
              </span>
            )}
            <ChevronDown
              className={cn("h-3.5 w-3.5 ml-auto transition-transform duration-200", !open && "-rotate-90")}
            />
          </button>
        )}
        {open && group.items.map((item) => renderItem(item, group))}
      </div>
    )
  }

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
        {visibleStructure.map((entry) => (isGroup(entry) ? renderGroup(entry) : renderItem(entry)))}
      </nav>

      {/* HELP-1a — the pinned Help entry.
          POSITION: between the nav's close and Settings, per audit §D.1. It is
          outside the accordion groups so it cannot be collapsed away, above
          Settings, and above the user block. It is the only position that is
          pinned and always visible.

          SHAPE: the destination is declared as HELP_ITEM — a PARSEABLE NavItem
          LITERAL — and this JSX consumes it. That is deliberate and it is the
          whole of audit §E.3. Settings below is hand-written JSX with no
          literal, so scripts/verify-nav1-url-sets.ts is BLIND to it and has to
          hard-code it. Writing Help the same way would have been the tempting
          move, because it dodges the red fixture run entirely — and that is
          precisely the reason to refuse it. A nav entry the URL-set fixture
          cannot see is one that can silently lose a role later with nothing
          reporting it, and Help is pinned for EVERY role, so it has the widest
          blast radius of any entry if it regresses. Settings is hand-written
          for a reason that does not apply here: its bespoke active-state
          precedence over /settings/labor. Help has no sub-routes.

          The literal is therefore parsed by the fixture, which reports it as a
          GAIN FOR ALL FOUR ROLES — and that gain is sanctioned explicitly in
          SANCTIONED_ADDITIONS rather than hidden by choosing a shape the
          parser cannot read. */}
      {canSeeHelp && (
        <div className="px-2 py-2">
          <Link
            href={HELP_ITEM.href}
            title={collapsed ? HELP_ITEM.label : undefined}
            className={cn(
              linkBase,
              collapsed ? "justify-center px-2" : "",
              helpActive
                ? "bg-[var(--color-primary)]/10 text-[var(--color-primary)] font-medium"
                : "text-[var(--color-foreground)] hover:bg-[var(--color-accent)]"
            )}
          >
            {/* The rail collapses to 60px and suppresses every label, so a
                pinned item MUST carry its own glyph — a 60px rail with no
                glyph is a blank. Only the inventory children may omit `icon`,
                because they fall back to their group's. */}
            <HelpCircle className={cn("h-4 w-4 shrink-0", helpActive ? "text-[var(--color-primary)]" : "text-[var(--color-muted-foreground)]")} />
            {!collapsed && HELP_ITEM.label}
          </Link>
        </div>
      )}

      {/* Settings */}
      {canSeeSettings && (
        <div className="px-2 py-2">
          <Link
            href="/settings"
            title={collapsed ? "Settings" : undefined}
            className={cn(
              linkBase,
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
