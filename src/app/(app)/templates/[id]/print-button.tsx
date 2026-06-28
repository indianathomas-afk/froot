"use client"

interface Task {
  description: string
  sectionName: string
  isCritical: boolean
  requiresPhoto: boolean
  requiresTemp: boolean
  estimatedTimeMinutes: number | null
  orderIndex: number
}

interface PrintButtonProps {
  templateName: string
  templateDescription: string | null
  templateType: string
  templateFrequency: string
  totalMinutes: number
  tasks: Task[]
}

export function PrintButton({ templateName, templateDescription, templateType, templateFrequency, totalMinutes, tasks }: PrintButtonProps) {
  function handlePrint() {
    const hours = Math.floor(totalMinutes / 60)
    const mins = totalMinutes % 60
    const timeStr = totalMinutes > 0 ? (hours > 0 ? `${hours}h ` : "") + (mins > 0 ? `${mins}m` : "") : ""

    // Group tasks by section preserving order
    const sections: Record<string, Task[]> = {}
    for (const task of tasks) {
      const key = task.sectionName || "General"
      if (!sections[key]) sections[key] = []
      sections[key].push(task)
    }

    const sectionsHtml = Object.entries(sections).map(([section, sectionTasks]) => `
      <div class="section">
        <h2>${escHtml(section)}</h2>
        ${sectionTasks.map((t) => `
          <div class="task${t.isCritical ? " critical" : ""}">
            <div class="checkbox"></div>
            <div class="task-body">
              <div class="task-desc">${escHtml(t.description)}</div>
              <div class="task-meta">
                ${t.isCritical ? '<span class="badge-critical">⚠ CRITICAL</span>' : ""}
                ${t.requiresPhoto ? '<span class="badge">📷 Photo required</span>' : ""}
                ${t.requiresTemp ? '<span class="badge">🌡 Temp required</span>' : ""}
                ${t.estimatedTimeMinutes ? `<span class="badge">~${t.estimatedTimeMinutes} min</span>` : ""}
              </div>
            </div>
          </div>
        `).join("")}
      </div>
    `).join("")

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>${escHtml(templateName)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, Arial, sans-serif; font-size: 11pt; color: #111; background: #fff; padding: 24px 32px; }
    .header { border-bottom: 2px solid #111; padding-bottom: 10px; margin-bottom: 18px; }
    .header h1 { font-size: 18pt; font-weight: 700; }
    .header .desc { color: #555; font-size: 10pt; margin-top: 4px; }
    .header .meta { display: flex; gap: 20px; margin-top: 8px; font-size: 9pt; color: #444; }
    .header .meta strong { color: #111; }
    .section { margin-bottom: 16px; }
    .section h2 { font-size: 9pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #555; border-bottom: 1px solid #ddd; padding-bottom: 3px; margin-bottom: 6px; }
    .task { display: flex; align-items: flex-start; gap: 8px; padding: 5px 0; border-bottom: 1px solid #f0f0f0; }
    .task:last-child { border-bottom: none; }
    .task.critical { background: #fff5f5; padding: 5px 6px; border-radius: 3px; border-bottom: 1px solid #fecaca; }
    .checkbox { width: 14px; height: 14px; border: 2px solid #888; border-radius: 2px; flex-shrink: 0; margin-top: 2px; }
    .task.critical .checkbox { border-color: #dc2626; }
    .task-body { flex: 1; }
    .task-desc { font-size: 10.5pt; }
    .task.critical .task-desc { color: #dc2626; font-weight: 600; }
    .task-meta { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 2px; }
    .badge { font-size: 8pt; color: #666; }
    .badge-critical { font-size: 8pt; color: #dc2626; font-weight: 600; }
    .footer { margin-top: 24px; padding-top: 10px; border-top: 1px solid #ccc; display: flex; justify-content: space-between; font-size: 9pt; color: #888; }
    @media print {
      body { padding: 0; }
      @page { margin: 1.5cm 2cm; size: letter; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>${escHtml(templateName)}</h1>
    ${templateDescription ? `<div class="desc">${escHtml(templateDescription)}</div>` : ""}
    <div class="meta">
      <span>Type: <strong>${escHtml(templateType)}</strong></span>
      <span>Frequency: <strong>${escHtml(templateFrequency)}</strong></span>
      ${timeStr ? `<span>Est. Time: <strong>${timeStr}</strong></span>` : ""}
      <span>Tasks: <strong>${tasks.length}</strong></span>
    </div>
  </div>
  ${sectionsHtml}
  <div class="footer">
    <span>${escHtml(templateName)}</span>
    <span>Completed by: _____________________________  Date: _________________</span>
  </div>
  <script>window.onload = function() { window.print(); }<\/script>
</body>
</html>`

    const win = window.open("", "_blank", "width=900,height=700")
    if (!win) { alert("Please allow pop-ups to print."); return }
    win.document.write(html)
    win.document.close()
  }

  return (
    <button
      onClick={handlePrint}
      className="text-sm bg-[var(--color-primary)] text-white rounded px-3 py-1.5 hover:opacity-90 transition-opacity"
    >
      Print / Save PDF
    </button>
  )
}

function escHtml(str: string) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}
