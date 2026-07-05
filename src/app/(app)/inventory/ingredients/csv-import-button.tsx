"use client"

import { useRef, useState } from "react"
import Papa from "papaparse"
import { Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"

type RawRow = Record<string, string>

type PreviewRow = {
  rowNum: number
  data: {
    brand: string | null
    name: string
    category: string | null
    glCode: string | null
    purchaseUnitLabel: string
    packDescription: string | null
    purchaseCost: number
    reportingUnit: string
    unitsPerPurchase: number
  } | null
  error: string | null
}

function validateRow(raw: RawRow, rowNum: number): PreviewRow {
  const name = raw.name?.trim()
  const purchaseUnitLabel = raw.purchaseUnitLabel?.trim()
  const reportingUnit = raw.reportingUnit?.trim()
  const purchaseCost = Number(raw.purchaseCost)
  const unitsPerPurchase = Number(raw.unitsPerPurchase)

  if (!name) return { rowNum, data: null, error: "Missing name" }
  if (!purchaseUnitLabel) return { rowNum, data: null, error: "Missing purchaseUnitLabel" }
  if (!reportingUnit) return { rowNum, data: null, error: "Missing reportingUnit" }
  if (!Number.isFinite(purchaseCost) || purchaseCost < 0) return { rowNum, data: null, error: "Invalid purchaseCost" }
  if (!Number.isFinite(unitsPerPurchase) || unitsPerPurchase <= 0) return { rowNum, data: null, error: "Invalid unitsPerPurchase (must be > 0)" }

  return {
    rowNum,
    error: null,
    data: {
      brand: raw.brand?.trim() || null,
      name,
      category: raw.category?.trim() || null,
      glCode: raw.glCode?.trim() || null,
      purchaseUnitLabel,
      packDescription: raw.packDescription?.trim() || null,
      purchaseCost,
      reportingUnit,
      unitsPerPurchase,
    },
  }
}

export function CsvImportButton({ onImported }: { onImported: () => void }) {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<PreviewRow[]>([])
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<{ created: number; errors: { row: number; error: string }[] } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setResult(null)
    Papa.parse<RawRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        setRows(results.data.map((raw, i) => validateRow(raw, i + 2)))
      },
    })
  }

  const validRows = rows.filter((r) => r.data !== null)

  async function handleImport() {
    setImporting(true)
    try {
      const res = await fetch("/api/inventory/ingredients/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validRows.map((r) => r.data)),
      })
      const data = await res.json()
      if (res.ok) {
        setResult(data)
        onImported()
      }
    } finally {
      setImporting(false)
    }
  }

  function reset() {
    setRows([])
    setResult(null)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Upload className="h-4 w-4" />
        Import CSV
      </Button>
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset() }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Import Ingredients from CSV</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-[var(--color-muted-foreground)]">
              Columns: brand, name, category, glCode, purchaseUnitLabel, packDescription, purchaseCost, reportingUnit, unitsPerPurchase
            </p>
            <input ref={fileInputRef} type="file" accept=".csv" onChange={handleFile} className="text-sm" />

            {rows.length > 0 && !result && (
              <>
                <p className="text-sm text-[var(--color-foreground)]">
                  {validRows.length} of {rows.length} rows valid
                </p>
                <div className="max-h-72 overflow-y-auto border border-[var(--color-border)] rounded-md">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--color-border)]">
                        <th className="text-left px-3 py-1.5 text-xs text-[var(--color-muted-foreground)]">Row</th>
                        <th className="text-left px-3 py-1.5 text-xs text-[var(--color-muted-foreground)]">Name</th>
                        <th className="text-left px-3 py-1.5 text-xs text-[var(--color-muted-foreground)]">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.rowNum} className="border-b border-[var(--color-border)] last:border-0">
                          <td className="px-3 py-1.5">{r.rowNum}</td>
                          <td className="px-3 py-1.5">{r.data?.name ?? "—"}</td>
                          <td className="px-3 py-1.5">
                            {r.error ? (
                              <span className="text-[var(--color-destructive)]">{r.error}</span>
                            ) : (
                              <span className="text-[var(--color-success-text)]">OK</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {result && (
              <div className="text-sm">
                <p className="text-[var(--color-success-text)] font-medium">Created {result.created} ingredients.</p>
                {result.errors.length > 0 && (
                  <div className="mt-2">
                    <p className="text-[var(--color-destructive)]">{result.errors.length} rows failed:</p>
                    <ul className="list-disc list-inside text-xs text-[var(--color-muted-foreground)]">
                      {result.errors.map((e) => <li key={e.row}>Row {e.row}: {e.error}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>{result ? "Close" : "Cancel"}</Button>
            {!result && (
              <Button onClick={handleImport} disabled={importing || validRows.length === 0}>
                {importing ? "Importing..." : `Import ${validRows.length} Row${validRows.length !== 1 ? "s" : ""}`}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
