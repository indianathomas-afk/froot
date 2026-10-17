"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { taskCountLabel } from "@/lib/milestones"
import { MilestoneListCard, type MilestoneKind, type MilestoneRow } from "./milestone-list"

// MS-4a — the Checklist milestones section of /staff/milestones, replacing the
// "Coming soon" card.
//
// F13 (Gary, 2026-10-17): "a separate ADMIN on/off switch "Checklist
// milestones" in the Milestones settings, OFF by default, independent of the
// main Milestones toggle. Off = no checklist milestones on the tab [...] and
// the setup section shows only the switch." Reason (Gary): "just in case the
// data sucks and we don't want to confuse people."
//
// F0: a threshold is N tasks the person is NAMED on. The copy says so, because
// "Team Member" ticks count for nobody and an ADMIN must know that before
// setting numbers.

const KIND: MilestoneKind = {
  countKey: "taskCount",
  apiBase: "/api/milestones/checklist",
  cardTitle: "Checklist milestones",
  noun: "checklist milestone",
  countLabel: taskCountLabel,
  countField: "Tasks completed",
  countPlaceholder: "e.g. 100 or 500",
  countError: "Tasks must be a whole number of 1 or more.",
  titlePlaceholder: "e.g. 500 tasks done",
  emptyTitle: "No checklist milestones yet",
  emptyCopy: "Add one — for example 100 or 500 tasks — and it appears on every staff member's Milestones tab.",
}

export function ChecklistMilestones({ enabled, rows }: { enabled: boolean; rows: MilestoneRow[] }) {
  const router = useRouter()
  const [on, setOn] = useState(enabled)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function toggle(next: boolean) {
    setSaving(true)
    setError(null)
    setOn(next)
    const res = await fetch("/api/milestones/checklist/switch", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: next }),
    }).catch(() => null)
    setSaving(false)
    if (!res?.ok) {
      setOn(!next)
      setError("Could not change the setting.")
      return
    }
    router.refresh()
  }

  return (
    <div className="mt-4 space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Checklists</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Label htmlFor="checklist-milestones-switch">Checklist milestones</Label>
              <p className="text-xs text-[var(--color-muted-foreground)] mt-0.5">
                Count the checklist tasks each person is named on when a task is ticked. Ticks saved as &quot;Team
                Member&quot; count for nobody. Off by default; turning it off hides these milestones and deletes nothing.
              </p>
            </div>
            <Switch id="checklist-milestones-switch" checked={on} disabled={saving} onCheckedChange={toggle} />
          </div>
          {error && <p className="text-sm text-[var(--color-destructive)]">{error}</p>}
        </CardContent>
      </Card>

      {/* Off = the switch only (F13). The server also passes no rows then. */}
      {on && enabled && <MilestoneListCard kind={KIND} rows={rows} />}
    </div>
  )
}
