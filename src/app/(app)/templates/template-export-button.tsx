"use client"

import { useState } from "react"
import { Download } from "lucide-react"
import { Button } from "@/components/ui/button"

// Downloads all templates as CSV from /api/templates/export. Because the route
// sets Content-Disposition, we just navigate to it in a hidden way that keeps
// the current page intact.
export function TemplateExportButton() {
  const [busy, setBusy] = useState(false)

  async function handleExport() {
    setBusy(true)
    try {
      const res = await fetch("/api/templates/export")
      if (!res.ok) return
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      const stamp = new Date().toISOString().slice(0, 10)
      a.download = `froot-templates-${stamp}.csv`
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
