"use client"

import { useRef, useState } from "react"
import Papa from "papaparse"
import { Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"

type RawRow = Record<string, string>

const REQUIRED_COLUMNS = ["template_name"]

type ImportResult = {
  templatesCreated: number
  tasksCreated: number
  created: { name: string; tasks: number }[]
  errors: { row: number; error: string }[]
}

export function TemplateImportButton({ onImported }: { onImported: () => void }) {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<RawRow[]>([])
  const [parseError, setParseError] = useState<string | null>(null)
  const [replaceMode, setReplaceMode] = useState(false)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Preview: group parsed rows by template_name so the user sees N templates / M tasks.
  const grouped = new Map<string, number>()
  for (const r of rows) {
    const name = r.template_name?.trim()
    if (!name) continue
    const hasTask = (r.task_description ?? "").trim().length > 0
    grouped.set(name, (grouped.get(name) ?? 0) + (hasTask ? 1 : 0))
  }
  const templateCount = grouped.size
  const taskCount = [...grouped.values()].reduce((a, b) => a + b, 0)

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setResult(null)
    setParseError(null)
    Papa.parse<RawRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const fields = results.meta.fields ?? []
        const missing = REQUIRED_COLUMNS.filter((c) => !fields.includes(c))
        if (missing.length) {
          setParseError(`Missing required column(s): ${missing.join(", ")}`)
          setRows([])
          return
        }
        setRows(results.data.filter((r) => r.template_name?.trim()))
      },
      error: (err) => setParseError(err.message),
    })
  }

  async function handleImport() {
    setImporting(true)
    try {
      const res = await fetch("/api/templates/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows, mode: replaceMode ? "replace" : "append" }),
      })
      const data = await res.json()
      if (res.ok) {
        setResult(data)
        onImported()
      } else {
        setParseError(data.error ?? "Import failed")
      }
    } finally {
      setImporting(false)
    }
  }

  function reset() {
    setRows([])
    setResult(null)
    setParseError(null)
    setReplaceMode(false)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Upload className="h-4 w-4" />
        Import
      </Button>
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset() }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Import Templates from CSV</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-[var(--color-muted-foreground)]">
              One row per task. Rows are grouped into templates by <code>template_name</code>. Columns: template_name,
              template_description, template_type, template_frequency, template_availability_type,
              template_operational_phase, template_start_offset_hours, template_end_offset_hours, template_applies_to,
              task_section, task_description, task_estimated_minutes, task_requires_photo, task_requires_temp,
              task_is_critical, task_order_index, task_video_url
            </p>
            <input ref={fileInputRef} type="file" accept=".csv" onChange={handleFile} className="text-sm" />

            {parseError && <p className="text-sm text-[var(--color-destructive)]">{parseError}</p>}

            {rows.length > 0 && !result && (
              <>
                <p className="text-sm text-[var(--color-foreground)]">
                  {templateCount} template{templateCount !== 1 ? "s" : ""}, {taskCount} task{taskCount !== 1 ? "s" : ""} found.
                  Imported templates arrive <strong>inactive</strong> and apply to all stores — review before going live.
                </p>
                <div className="max-h-72 overflow-y-auto border border-[var(--color-border)] rounded-md">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--color-border)]">
                        <th className="text-left px-3 py-1.5 text-xs text-[var(--color-muted-foreground)]">Template</th>
                        <th className="text-left px-3 py-1.5 text-xs text-[var(--color-muted-foreground)]">Tasks</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...grouped.entries()].map(([name, count]) => (
                        <tr key={name} className="border-b border-[var(--color-border)] last:border-0">
                          <td className="px-3 py-1.5">{name}</td>
                          <td className="px-3 py-1.5">{count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <label className="flex items-center gap-2 text-sm text-[var(--color-foreground)]">
                  <input type="checkbox" checked={replaceMode} onChange={(e) => setReplaceMode(e.target.checked)} />
                  Replace mode — archive existing templates with the same name first
                </label>
              </>
            )}

            {result && (
              <div className="text-sm">
                <p className="text-[var(--color-success-text)] font-medium">
                  Created {result.templatesCreated} template{result.templatesCreated !== 1 ? "s" : ""} and {result.tasksCreated} task
                  {result.tasksCreated !== 1 ? "s" : ""}.
                </p>
                {result.errors.length > 0 && (
                  <div className="mt-2">
                    <p className="text-[var(--color-destructive)]">{result.errors.length} problem(s):</p>
                    <ul className="list-disc list-inside text-xs text-[var(--color-muted-foreground)]">
                      {result.errors.map((e, i) => (
                        <li key={i}>{e.row ? `Row ${e.row}: ` : ""}{e.error}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>{result ? "Close" : "Cancel"}</Button>
            {!result && (
              <Button onClick={handleImport} disabled={importing || templateCount === 0}>
                {importing ? "Importing..." : `Import ${templateCount} Template${templateCount !== 1 ? "s" : ""}`}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
