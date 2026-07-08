// Client-side CSV download helper (Phase I-7). Values are quoted when needed;
// numbers pass through unformatted so spreadsheets can sum them.

function escapeCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ""
  const s = String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function downloadCsv(filename: string, headers: string[], rows: (string | number | null | undefined)[][]) {
  const csv = [headers, ...rows].map((row) => row.map(escapeCell).join(",")).join("\n")
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
