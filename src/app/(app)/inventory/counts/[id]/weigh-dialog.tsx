"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { CountLine } from "./count-client"

// Scale-entry units → oz (dry). Container weights are stored in oz.
const WEIGHT_UNITS: { value: string; label: string; toOz: number }[] = [
  { value: "lbs", label: "lbs", toOz: 16 },
  { value: "oz", label: "oz", toOz: 1 },
  { value: "g", label: "g", toOz: 1 / 28.3495 },
  { value: "kg", label: "kg", toOz: 35.274 },
]

function toOz(amount: number, unit: string) {
  return amount * (WEIGHT_UNITS.find((u) => u.value === unit)?.toOz ?? 1)
}

function isWeightReportingUnit(unit: string) {
  return unit === "lbs" || unit === "oz (dry)"
}

// Count-by-weighing: enter the gross scale weight and get a quantity in the
// line's reporting unit. Weight-type items: net = gross − tare. Volume/count
// items: fraction remaining ((gross − tare) / (full − tare), clamped 0–1) ×
// units per container. The result saves as a normal quantityCounted.
export function WeighDialog({
  line,
  onApply,
  onWeightsSaved,
  onClose,
}: {
  line: CountLine
  onApply: (qty: number) => void
  onWeightsSaved: () => void
  onClose: () => void
}) {
  const weightType = isWeightReportingUnit(line.reportingUnit)
  const needsSetup = line.tareWeightOz === null || (!weightType && line.fullWeightOz === null)

  const [gross, setGross] = useState("")
  const [grossUnit, setGrossUnit] = useState("lbs")
  const [tare, setTare] = useState("")
  const [full, setFull] = useState("")
  const [setupUnit, setSetupUnit] = useState("lbs")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const grossNum = parseFloat(gross)
  let computed: number | null = null
  if (!needsSetup && !isNaN(grossNum) && grossNum >= 0 && line.tareWeightOz !== null) {
    const grossOz = toOz(grossNum, grossUnit)
    if (weightType) {
      const netOz = Math.max(0, grossOz - line.tareWeightOz)
      computed = line.reportingUnit === "lbs" ? netOz / 16 : netOz
    } else if (line.fullWeightOz !== null) {
      const fraction = Math.min(1, Math.max(0, (grossOz - line.tareWeightOz) / (line.fullWeightOz - line.tareWeightOz)))
      computed = fraction * line.unitsPerPurchase
    }
  }

  async function saveWeights() {
    const tareNum = parseFloat(tare)
    const fullNum = parseFloat(full)
    if (isNaN(tareNum) || tareNum < 0) {
      setError("Enter the empty container weight")
      return
    }
    if (!weightType && (isNaN(fullNum) || fullNum <= tareNum)) {
      setError("Full container weight must be greater than the empty weight")
      return
    }
    setSaving(true)
    setError("")
    const res = await fetch(`/api/inventory/ingredients/${line.ingredientId}/weights`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tareWeightOz: toOz(tareNum, setupUnit),
        ...(weightType ? {} : { fullWeightOz: toOz(fullNum, setupUnit) }),
      }),
    })
    setSaving(false)
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      setError(body?.error ?? "Could not save container weights")
      return
    }
    onWeightsSaved()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Weigh {line.ingredientName}</DialogTitle>
          <DialogDescription>
            {needsSetup
              ? "Save the container weights once — then counting is just one reading off the scale."
              : weightType
                ? "Gross weight minus the container, converted to the reporting unit."
                : `Fraction of a full container × ${line.unitsPerPurchase} ${line.reportingUnit} per ${line.purchaseUnitLabel}.`}
          </DialogDescription>
        </DialogHeader>

        {needsSetup ? (
          <div className="space-y-3">
            <div className="flex gap-2">
              <div className="flex-1">
                <Label htmlFor="tare" className="text-xs">
                  Empty container
                </Label>
                <Input
                  id="tare"
                  type="text"
                  inputMode="decimal"
                  value={tare}
                  onChange={(e) => setTare(e.target.value)}
                  placeholder="0"
                  className="min-h-11"
                />
              </div>
              {!weightType && (
                <div className="flex-1">
                  <Label htmlFor="full" className="text-xs">
                    Full container
                  </Label>
                  <Input
                    id="full"
                    type="text"
                    inputMode="decimal"
                    value={full}
                    onChange={(e) => setFull(e.target.value)}
                    placeholder="0"
                    className="min-h-11"
                  />
                </div>
              )}
              <div className="w-20">
                <Label className="text-xs">Unit</Label>
                <Select value={setupUnit} onValueChange={setSetupUnit}>
                  <SelectTrigger className="min-h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WEIGHT_UNITS.map((u) => (
                      <SelectItem key={u.value} value={u.value}>
                        {u.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {error && <p className="text-sm text-[var(--color-destructive)]">{error}</p>}
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={saveWeights} disabled={saving}>
                {saving ? "Saving…" : "Save weights"}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex gap-2">
              <div className="flex-1">
                <Label htmlFor="gross" className="text-xs">
                  Gross weight (container included)
                </Label>
                <Input
                  id="gross"
                  type="text"
                  inputMode="decimal"
                  autoFocus
                  value={gross}
                  onChange={(e) => setGross(e.target.value)}
                  placeholder="0"
                  className="min-h-11 text-lg"
                />
              </div>
              <div className="w-20">
                <Label className="text-xs">Unit</Label>
                <Select value={grossUnit} onValueChange={setGrossUnit}>
                  <SelectTrigger className="min-h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WEIGHT_UNITS.map((u) => (
                      <SelectItem key={u.value} value={u.value}>
                        {u.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p className="text-sm text-[var(--color-muted-foreground)]">
              {computed !== null ? (
                <>
                  = <span className="font-semibold text-[var(--color-foreground)]">{Math.round(computed * 100) / 100}</span>{" "}
                  {line.reportingUnit}
                </>
              ) : (
                "Enter the scale reading"
              )}
            </p>
            {error && <p className="text-sm text-[var(--color-destructive)]">{error}</p>}
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                disabled={computed === null}
                onClick={() => {
                  if (computed !== null) onApply(Math.round(computed * 100) / 100)
                }}
              >
                Use this count
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
