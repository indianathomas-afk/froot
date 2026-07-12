import { auth } from "@clerk/nextjs/server"
import { prisma } from "@/lib/prisma"
import { notFound } from "next/navigation"
import { AlertTriangle } from "lucide-react"
import { ChecklistPrintControls } from "./checklist-print-controls"

export default async function ChecklistPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ blank?: string }>
}) {
  const { id } = await params
  const { blank } = await searchParams
  const isBlank = blank === "true"

  const { orgId } = await auth()
  if (!orgId) return notFound()

  const org = await prisma.organization.findUnique({ where: { clerkOrgId: orgId } })
  if (!org) return notFound()

  const checklist = await prisma.checklist.findFirst({
    where: { id, organizationId: org.id },
    include: {
      store: true,
      template: {
        include: {
          tasks: { orderBy: { orderIndex: "asc" } },
        },
      },
      taskLogs: true,
    },
  })
  if (!checklist) return notFound()

  const completedTaskIds = new Set(checklist.taskLogs.map((l) => l.taskId))

  const sections = checklist.template.tasks.reduce<Record<string, typeof checklist.template.tasks>>(
    (acc, task) => {
      const key = task.sectionName || "General"
      if (!acc[key]) acc[key] = []
      acc[key].push(task)
      return acc
    },
    {}
  )

  const totalMinutes = Math.round(
    checklist.template.tasks.reduce((sum, t) => sum + (t.estimatedTimeMinutes ?? 0), 0)
  )
  const hours = Math.floor(totalMinutes / 60)
  const mins = totalMinutes % 60
  const timeStr =
    totalMinutes > 0 ? (hours > 0 ? `${hours}h ` : "") + (mins > 0 ? `${mins}m` : "") : ""

  const dateStr = checklist.date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  })

  const completedCount = completedTaskIds.size
  const totalCount = checklist.template.tasks.length

  return (
    <>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: -apple-system, Arial, sans-serif; background: #f0f0f0; }
        .print-page { max-width: 780px; margin: 32px auto; background: white; padding: 40px 48px; box-shadow: 0 2px 8px rgba(0,0,0,0.12); }
        .header { border-bottom: 2px solid #111; padding-bottom: 12px; margin-bottom: 20px; }
        .header h1 { font-size: 20pt; font-weight: 700; color: #111; }
        .header .desc { color: #555; font-size: 10pt; margin-top: 4px; }
        .header .meta { display: flex; gap: 24px; margin-top: 10px; font-size: 9.5pt; color: #555; flex-wrap: wrap; }
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
        .task-done { opacity: 0.65; }
        .checkbox { width: 15px; height: 15px; border: 2px solid #999; border-radius: 2px; flex-shrink: 0; margin-top: 2px; }
        .checkbox-critical { border-color: #dc2626; }
        .checkbox-filled { background: #111; border-color: #111; position: relative; }
        .checkbox-filled-critical { background: #dc2626; border-color: #dc2626; position: relative; }
        .checkbox-filled::after,
        .checkbox-filled-critical::after {
          content: '✓'; position: absolute; color: white;
          font-size: 10px; top: -1px; left: 1px;
        }
        .task-body { flex: 1; }
        .task-desc { font-size: 10.5pt; color: #111; line-height: 1.4; }
        .task-desc-critical { color: #dc2626; font-weight: 600; }
        .task-desc-done { text-decoration: line-through; color: #888; }
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
        <ChecklistPrintControls
          checklistName={checklist.template.name}
          isBlank={isBlank}
        />

        {/* Header */}
        <div className="header">
          <h1>{checklist.template.name}</h1>
          <p className="desc">{checklist.store.name} &bull; {checklist.template.type}</p>
          <div className="meta">
            <span>Date: <strong>{dateStr}</strong></span>
            {timeStr && <span>Est. Time: <strong>{timeStr}</strong></span>}
            <span>Tasks: <strong>{totalCount}</strong></span>
            {!isBlank && (
              <span>Completed: <strong>{completedCount} / {totalCount}</strong></span>
            )}
          </div>
        </div>

        {/* Sections */}
        {Object.entries(sections).map(([section, tasks]) => (
          <div key={section} className="section">
            <div className="section-title">{section}</div>
            {tasks.map((task) => {
              const isDone = !isBlank && completedTaskIds.has(task.id)
              const checkboxClass = isDone
                ? task.isCritical
                  ? "checkbox-filled-critical"
                  : "checkbox-filled"
                : task.isCritical
                ? "checkbox checkbox-critical"
                : "checkbox"

              return (
                <div
                  key={task.id}
                  className={[
                    "task",
                    task.isCritical ? "task-critical" : "",
                    isDone ? "task-done" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <div className={checkboxClass.startsWith("checkbox-filled") ? checkboxClass : checkboxClass} />
                  <div className="task-body">
                    <div
                      className={[
                        "task-desc",
                        task.isCritical && !isDone ? "task-desc-critical" : "",
                        isDone ? "task-desc-done" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      {task.description}
                    </div>
                    <div className="task-badges">
                      {task.isCritical && (
                        <span className="badge-critical">
                          <AlertTriangle
                            style={{ display: "inline", width: 10, height: 10, verticalAlign: "middle" }}
                          />{" "}
                          CRITICAL
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
              )
            })}
          </div>
        ))}

        {/* Footer */}
        <div className="print-footer">
          <span>{checklist.store.name} &bull; {dateStr}</span>
          {isBlank ? (
            <span>Completed by: _____________________________&nbsp;&nbsp; Date: _______________</span>
          ) : (
            <span>{checklist.template.name} &bull; {completedCount}/{totalCount} tasks completed</span>
          )}
        </div>
      </div>
    </>
  )
}
