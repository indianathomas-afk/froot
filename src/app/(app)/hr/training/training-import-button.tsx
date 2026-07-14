"use client"

import { useRef, useState } from "react"
import Papa from "papaparse"
import { FileDown, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"

type RawRow = Record<string, string>

const REQUIRED_COLUMNS = ["module_title"]

type ImportResult = {
  modulesCreated: number
  lessonsCreated: number
  questionsCreated: number
  created: { title: string; lessons: number; questions: number }[]
  errors: { row: number; error: string }[]
}

// Downloadable example showing the row_type contract: module columns repeat
// on every row; lesson rows fill lesson_*, question rows fill question_*.
const EXAMPLE_CSV = [
  "module_title,module_subject,module_description,quiz_pass_threshold,row_type,lesson_title,lesson_info,lesson_video_url,lesson_order_index,question_type,question_prompt,question_options,question_correct,question_order_index",
  `Food Safety Basics,Food Safety,New-hire food safety training,71,lesson,Handwashing & Hygiene,"Wash hands for 20 seconds before every shift, after breaks, and after handling raw product.",https://youtu.be/your-video-id,0,,,,,`,
  `Food Safety Basics,Food Safety,New-hire food safety training,71,lesson,Cold Holding,Keep all cold product at or below 41F. Check temperatures every 2 hours and log them.,,1,,,,,`,
  `Food Safety Basics,Food Safety,New-hire food safety training,71,question,,,,,boolean,Cut fruit can sit out for 4 hours.,,false,0`,
  `Food Safety Basics,Food Safety,New-hire food safety training,71,question,,,,,single,What is the maximum cold-holding temperature?,41F|45F|50F,41F,1`,
  `Food Safety Basics,Food Safety,New-hire food safety training,71,question,,,,,multi,When must you wash your hands?,Before your shift|After breaks|Only when visibly dirty,Before your shift|After breaks,2`,
  `Food Safety Basics,Food Safety,New-hire food safety training,71,question,,,,,written,Describe the three-sink dishwashing process.,,,3`,
  `Register Basics,Operations,How to open and close a register,80,lesson,Opening the Register,Count the drawer and verify the starting float before the first sale.,,0,,,,,`,
  `Register Basics,Operations,How to open and close a register,80,question,,,,,boolean,The drawer must be counted before the first sale.,,true,0`,
].join("\r\n")

function downloadExample() {
  const blob = new Blob(["﻿" + EXAMPLE_CSV], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = "froot-training-example.csv"
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function TrainingImportButton({ onImported }: { onImported: () => void }) {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<RawRow[]>([])
  const [parseError, setParseError] = useState<string | null>(null)
  const [replaceMode, setReplaceMode] = useState(false)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Preview: group parsed rows by module_title → lesson / question counts.
  const grouped = new Map<string, { lessons: number; questions: number }>()
  for (const r of rows) {
    const title = r.module_title?.trim()
    if (!title) continue
    if (!grouped.has(title)) grouped.set(title, { lessons: 0, questions: 0 })
    const g = grouped.get(title)!
    const type = r.row_type?.trim().toLowerCase() || (r.question_prompt?.trim() ? "question" : r.lesson_title?.trim() ? "lesson" : "")
    if (type === "lesson") g.lessons++
    else if (type === "question") g.questions++
  }
  const moduleCount = grouped.size
  const lessonCount = [...grouped.values()].reduce((a, g) => a + g.lessons, 0)
  const questionCount = [...grouped.values()].reduce((a, g) => a + g.questions, 0)

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
        setRows(results.data.filter((r) => r.module_title?.trim()))
      },
      error: (err) => setParseError(err.message),
    })
  }

  async function handleImport() {
    setImporting(true)
    try {
      const res = await fetch("/api/hr/training/import", {
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
            <DialogTitle>Import Training Modules from CSV</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-[var(--color-muted-foreground)]">
              Rows are grouped into modules by <code>module_title</code>. Each row is a <code>lesson</code> or a{" "}
              <code>question</code> (set <code>row_type</code>). Lesson rows use lesson_title, lesson_info,
              lesson_video_url, lesson_order_index. Question rows use question_type (boolean / single / multi /
              written), question_prompt, question_options and question_correct (pipe-separated, e.g.{" "}
              <code>41F|45F|50F</code>), question_order_index. Attached files don&apos;t travel through CSV — add them
              in the builder after importing.
            </p>
            <button
              type="button"
              onClick={downloadExample}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-primary)] hover:underline"
            >
              <FileDown className="h-3.5 w-3.5" />
              Download example CSV
            </button>
            <input ref={fileInputRef} type="file" accept=".csv" onChange={handleFile} className="block text-sm" />

            {parseError && <p className="text-sm text-[var(--color-destructive)]">{parseError}</p>}

            {rows.length > 0 && !result && (
              <>
                <p className="text-sm text-[var(--color-foreground)]">
                  {moduleCount} module{moduleCount !== 1 ? "s" : ""}, {lessonCount} lesson{lessonCount !== 1 ? "s" : ""},{" "}
                  {questionCount} question{questionCount !== 1 ? "s" : ""} found. Imported modules arrive{" "}
                  <strong>inactive</strong> and apply to all stores — review before going live.
                </p>
                <div className="max-h-72 overflow-y-auto border border-[var(--color-border)] rounded-md">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--color-border)]">
                        <th className="text-left px-3 py-1.5 text-xs text-[var(--color-muted-foreground)]">Module</th>
                        <th className="text-left px-3 py-1.5 text-xs text-[var(--color-muted-foreground)]">Lessons</th>
                        <th className="text-left px-3 py-1.5 text-xs text-[var(--color-muted-foreground)]">Questions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...grouped.entries()].map(([title, g]) => (
                        <tr key={title} className="border-b border-[var(--color-border)] last:border-0">
                          <td className="px-3 py-1.5">{title}</td>
                          <td className="px-3 py-1.5">{g.lessons}</td>
                          <td className="px-3 py-1.5">{g.questions}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <label className="flex items-center gap-2 text-sm text-[var(--color-foreground)]">
                  <input type="checkbox" checked={replaceMode} onChange={(e) => setReplaceMode(e.target.checked)} />
                  Replace mode — archive existing modules with the same title first
                </label>
              </>
            )}

            {result && (
              <div className="text-sm">
                <p className="text-[var(--color-success-text)] font-medium">
                  Created {result.modulesCreated} module{result.modulesCreated !== 1 ? "s" : ""} with{" "}
                  {result.lessonsCreated} lesson{result.lessonsCreated !== 1 ? "s" : ""} and {result.questionsCreated}{" "}
                  question{result.questionsCreated !== 1 ? "s" : ""}.
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
              <Button onClick={handleImport} disabled={importing || moduleCount === 0}>
                {importing ? "Importing..." : `Import ${moduleCount} Module${moduleCount !== 1 ? "s" : ""}`}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
