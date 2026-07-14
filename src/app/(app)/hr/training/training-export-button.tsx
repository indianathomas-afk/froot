"use client"

import { useState } from "react"
import { Download } from "lucide-react"
import { Button } from "@/components/ui/button"

// Downloads all training modules as CSV from /api/hr/training/export
// (template-export pattern). Resource files stay in the private store — the
// CSV carries lessons, video links, and the quiz.
export function TrainingExportButton() {
  const [busy, setBusy] = useState(false)

  async function handleExport() {
    setBusy(true)
    try {
      const res = await fetch("/api/hr/training/export")
      if (!res.ok) return
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      const stamp = new Date().toISOString().slice(0, 10)
      a.download = `froot-training-${stamp}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button variant="outline" onClick={handleExport} disabled={busy}>
      <Download className="h-4 w-4" />
      {busy ? "Exporting..." : "Export"}
    </Button>
  )
}
