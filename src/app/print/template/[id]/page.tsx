import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { notFound } from "next/navigation"
import { AlertTriangle } from "lucide-react"
import { PrintControls } from "./print-controls"

export default async function TemplatePrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { orgId } = await auth()
  if (!orgId) return notFound()

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return notFound()

  const template = await prisma.template.findFirst({
    where: { id, organizationId: org.id },
    include: { tasks: { orderBy: { orderIndex: "asc" } } },
  })
  if (!template) return notFound()

  const sections = template.tasks.reduce<Record<string, typeof template.tasks>>((acc, task) => {
    const key = task.sectionName || "General"
    if (!acc[key]) acc[key] = []
    acc[key].push(task)
    return acc
  }, {})

  const totalMinutes = template.tasks.reduce((sum, t) => sum + (t.estimatedTimeMinutes ?? 0), 0)
  const hours = Math.floor(totalMinutes / 60)
  const mins = totalMinutes % 60
  const timeStr = totalMinutes > 0 ? (hours > 0 ? `${hours}h ` : "") + (mins > 0 ? `${mins}m` : "") : ""

  return (
    <>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: -apple-system, Arial, sans-serif; background: #f0f0f0; }
        .print-page { max-width: 780px; margin: 32px auto; background: white; padding: 40px 48px; box-shadow: 0 2px 8px rgba(0,0,0,0.12); }
        .header { border-bottom: 2px solid #111; padding-bottom: 12px; margin-bottom: 20px; }
        .header h1 { font-size: 20pt; font-weight: 700; color: #111; }
        .header .desc { color: #555; font-size: 10pt; margin-top: 4px; }
        .header .meta { display: flex; gap: 24px; margin-top: 10px; font-size: 9.5pt; color: #555; }
        .header .meta strong { color: #111; }
        .section { margin-bottom: 18px; }
        .section-title {
          font-size: 8.5pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em;
          color: #666; border-bottom: 1px solid #e0e0e0; padding-bottom: 4px; margin-bottom: 8px;
        }
        .task {
          display: flex; align-items: flex-start; gap: 10px;
          padding: 5px 0; border-bottom: 1px solid #f2f2f2;
        }
        .task:last-child { border-bottom: none; }
        .task-critical { background: #fff8f8; padding: 5px 8px; border-radius: 4px; border-bottom: 1px solid #fecaca; margin-bottom: 2px; }
        .checkbox { width: 15px; height: 15px; border: 2px solid #999; border-radius: 2px; flex-shrink: 0; margin-top: 2px; }
        .checkbox-critical { border-color: #dc2626; }
        .task-body { flex: 1; }
        .task-desc { font-size: 10.5pt; color: #111; line-height: 1.4; }
        .task-desc-critical { color: #dc2626; font-weight: 600; }
        .task-badges { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 2px; }
        .badge { font-size: 8pt; color: #888; }
        .badge-critical { font-size: 8pt; color: #dc2626; font-weight: 700; }
        .print-footer {
          margin-top: 32px; padding-top: 12px; border-top: 1px solid #ccc;
          display: flex; justify-content: space-between; font-size: 9pt; color: #888;
        }
        @media print {
          body { background: white; }
          .print-page { max-width: 100%; margin: 0; padding: 0; box-shadow: none; }
          @page { margin: 1.5cm 2cm; size: letter portrait; }
        }
      `}</style>

      <div className="print-page">
        <PrintControls templateName={template.name} />

        {/* Header */}
        <div className="header">
          <h1>{template.name}</h1>
          {template.description && <p className="desc">{template.description}</p>}
          <div className="meta">
            <span>Type: <strong>{template.type}</strong></span>
            <span>Frequency: <strong>{template.frequency}</strong></span>
            {timeStr && <span>Est. Time: <strong>{timeStr}</strong></span>}
            <span>Tasks: <strong>{template.tasks.length}</strong></span>
          </div>
        </div>

        {/* Sections */}
        {Object.entries(sections).map(([section, tasks]) => (
          <div key={section} className="section">
            <div className="section-title">{section}</div>
            {tasks.map((task) => (
              <div key={task.id} className={`task${task.isCritical ? " task-critical" : ""}`}>
                <div className={`checkbox${task.isCritical ? " checkbox-critical" : ""}`} />
                <div className="task-body">
                  <div className={`task-desc${task.isCritical ? " task-desc-critical" : ""}`}>
                    {task.description}
                  </div>
                  <div className="task-badges">
                    {task.isCritical && (
                      <span className="badge-critical">
                        <AlertTriangle style={{ display: "inline", width: 10, height: 10, verticalAlign: "middle" }} /> CRITICAL
                      </span>
                    )}
                    {task.requiresPhoto && <span className="badge">📷 Photo required</span>}
                    {task.requiresTemp && <span className="badge">🌡 Temp required</span>}
                    {task.videoUrl && <span className="badge">▶ Training video in app</span>}
                    {task.estimatedTimeMinutes && (
                      <span className="badge">~{task.estimatedTimeMinutes} min</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ))}

        {/* Footer */}
        <div className="print-footer">
          <span>{template.name}</span>
          <span>Completed by: _____________________________&nbsp;&nbsp; Date: _______________</span>
        </div>
      </div>
    </>
  )
}
