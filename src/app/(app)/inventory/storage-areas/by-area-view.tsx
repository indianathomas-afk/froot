"use client"

import { useMemo, useState, useSyncExternalStore } from "react"
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core"
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { ChevronDown, ChevronRight, GripVertical, Pencil, Plus, Search, Trash2, Warehouse, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  ingredientDisplayName,
  type AreaIngredient,
  type AreasResponse,
  type StorageAreaData,
  type UnassignedIngredient,
} from "./storage-areas-client"

type PickerIngredient = UnassignedIngredient

function subscribeToViewport(callback: () => void) {
  const mq = window.matchMedia("(max-width: 640px)")
  mq.addEventListener("change", callback)
  return () => mq.removeEventListener("change", callback)
}

export function ByAreaView({
  storeId,
  data,
  canManage,
  refresh,
}: {
  storeId: string
  data: AreasResponse
  canManage: boolean
  refresh: () => void
}) {
  const [areas, setAreas] = useState<StorageAreaData[]>(data.areas)
  const [newAreaName, setNewAreaName] = useState("")
  const [creating, setCreating] = useState(false)

  // Local optimistic copy of the server data; re-adopt whenever a refresh lands.
  const [prevServerAreas, setPrevServerAreas] = useState(data.areas)
  if (prevServerAreas !== data.areas) {
    setPrevServerAreas(data.areas)
    setAreas(data.areas)
  }

  // Standing in a walk-in on a phone: areas default collapsed so the accordion
  // is scannable; on desktop default expanded. User toggles override per area.
  const isPhone = useSyncExternalStore(
    subscribeToViewport,
    () => window.matchMedia("(max-width: 640px)").matches,
    () => false
  )
  const [expandedOverrides, setExpandedOverrides] = useState<Map<string, boolean>>(new Map())
  const isExpanded = (areaId: string) => expandedOverrides.get(areaId) ?? !isPhone

  // Everything assignable at this store: the org's active ingredients (the GET
  // returns them split into assigned-per-area and unassigned).
  const allIngredients = useMemo(() => {
    const byId = new Map<string, PickerIngredient>()
    for (const area of data.areas) {
      for (const ing of area.ingredients) {
        byId.set(ing.ingredientId, {
          ingredientId: ing.ingredientId,
          brand: ing.brand,
          name: ing.name,
          categoryName: ing.categoryName,
          reportingUnit: ing.reportingUnit,
          costPerReportingUnit: ing.costPerReportingUnit,
        })
      }
    }
    for (const ing of data.unassigned) byId.set(ing.ingredientId, ing)
    return [...byId.values()].sort((a, b) => ingredientDisplayName(a).localeCompare(ingredientDisplayName(b)))
  }, [data])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  function toggleExpanded(areaId: string) {
    setExpandedOverrides((prev) => new Map(prev).set(areaId, !isExpanded(areaId)))
  }

  async function handleAreaDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = areas.findIndex((a) => a.id === active.id)
    const newIndex = areas.findIndex((a) => a.id === over.id)
    const next = arrayMove(areas, oldIndex, newIndex)
    setAreas(next)
    const res = await fetch("/api/inventory/storage-areas/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storeId, areaIds: next.map((a) => a.id) }),
    })
    if (!res.ok) refresh()
  }

  async function saveAreaIngredients(areaId: string, ingredients: AreaIngredient[]) {
    const res = await fetch(`/api/inventory/storage-areas/${areaId}/ingredients`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ingredients: ingredients.map((ing, index) => ({ ingredientId: ing.ingredientId, sortOrder: index })),
      }),
    })
    if (!res.ok) refresh()
    return res.ok
  }

  function reorderIngredients(areaId: string, next: AreaIngredient[]) {
    setAreas((prev) => prev.map((a) => (a.id === areaId ? { ...a, ingredients: next } : a)))
    saveAreaIngredients(areaId, next)
  }

  async function addIngredient(areaId: string, ingredient: PickerIngredient) {
    const area = areas.find((a) => a.id === areaId)
    if (!area) return
    const next = [
      ...area.ingredients,
      {
        mappingId: `pending-${ingredient.ingredientId}`,
        ingredientId: ingredient.ingredientId,
        sortOrder: area.ingredients.length,
        brand: ingredient.brand,
        name: ingredient.name,
        categoryName: ingredient.categoryName,
        reportingUnit: ingredient.reportingUnit,
        costPerReportingUnit: ingredient.costPerReportingUnit,
      },
    ]
    setAreas((prev) => prev.map((a) => (a.id === areaId ? { ...a, ingredients: next } : a)))
    const ok = await saveAreaIngredients(areaId, next)
    if (ok) refresh() // unassigned banner count may have dropped
  }

  async function removeIngredient(areaId: string, ingredientId: string) {
    const area = areas.find((a) => a.id === areaId)
    if (!area) return
    const next = area.ingredients.filter((ing) => ing.ingredientId !== ingredientId)
    setAreas((prev) => prev.map((a) => (a.id === areaId ? { ...a, ingredients: next } : a)))
    const ok = await saveAreaIngredients(areaId, next)
    if (ok) refresh()
  }

  async function createArea() {
    const name = newAreaName.trim()
    if (!name) return
    setCreating(true)
    const res = await fetch("/api/inventory/storage-areas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storeId, name }),
    })
    setCreating(false)
    if (res.ok) {
      const area = await res.json()
      setNewAreaName("")
      setExpandedOverrides((prev) => new Map(prev).set(area.id, true))
      refresh()
    }
  }

  async function renameArea(areaId: string, name: string) {
    setAreas((prev) => prev.map((a) => (a.id === areaId ? { ...a, name } : a)))
    const res = await fetch(`/api/inventory/storage-areas/${areaId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    })
    if (!res.ok) refresh()
  }

  async function deleteArea(areaId: string) {
    const res = await fetch(`/api/inventory/storage-areas/${areaId}`, { method: "DELETE" })
    if (res.ok) refresh()
  }

  if (areas.length === 0) {
    return (
      <div className="border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] p-16 text-center">
        <Warehouse className="h-8 w-8 mx-auto mb-3 text-[var(--color-muted-foreground)]" />
        <p className="text-sm font-medium text-[var(--color-foreground)] mb-1">No storage areas yet</p>
        <p className="text-sm text-[var(--color-muted-foreground)] mb-6">
          Create the physical areas of this store — Walk-in, Freezer, Front Counter, Dry Storage — then assign
          ingredients so counts can walk the room.
        </p>
        {canManage && (
          <div className="flex items-center justify-center gap-2">
            <Input
              value={newAreaName}
              onChange={(e) => setNewAreaName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && createArea()}
              placeholder="e.g. Walk-in"
              className="w-56 min-h-11"
            />
            <Button onClick={createArea} disabled={!newAreaName.trim() || creating} className="min-h-11">
              <Plus className="h-4 w-4" />
              Add area
            </Button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleAreaDragEnd}>
        <SortableContext items={areas.map((a) => a.id)} strategy={verticalListSortingStrategy}>
          {areas.map((area) => (
            <SortableAreaCard
              key={area.id}
              area={area}
              canManage={canManage}
              expanded={isExpanded(area.id)}
              onToggle={() => toggleExpanded(area.id)}
              allIngredients={allIngredients}
              onReorder={(next) => reorderIngredients(area.id, next)}
              onAdd={(ing) => addIngredient(area.id, ing)}
              onRemove={(ingredientId) => removeIngredient(area.id, ingredientId)}
              onRename={(name) => renameArea(area.id, name)}
              onDelete={() => deleteArea(area.id)}
            />
          ))}
        </SortableContext>
      </DndContext>

      {canManage && (
        <div className="flex items-center gap-2 pt-1">
          <Input
            value={newAreaName}
            onChange={(e) => setNewAreaName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createArea()}
            placeholder="New area name (e.g. Dry Storage)"
            className="w-64 min-h-11"
          />
          <Button onClick={createArea} disabled={!newAreaName.trim() || creating} variant="outline" className="min-h-11">
            <Plus className="h-4 w-4" />
            Add area
          </Button>
        </div>
      )}
    </div>
  )
}

function SortableAreaCard({
  area,
  canManage,
  expanded,
  onToggle,
  allIngredients,
  onReorder,
  onAdd,
  onRemove,
  onRename,
  onDelete,
}: {
  area: StorageAreaData
  canManage: boolean
  expanded: boolean
  onToggle: () => void
  allIngredients: PickerIngredient[]
  onReorder: (next: AreaIngredient[]) => void
  onAdd: (ingredient: PickerIngredient) => void
  onRemove: (ingredientId: string) => void
  onRename: (name: string) => void
  onDelete: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: area.id })
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(area.name)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [pickerQuery, setPickerQuery] = useState("")

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  const inAreaIds = useMemo(() => new Set(area.ingredients.map((i) => i.ingredientId)), [area.ingredients])
  const pickerMatches = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase()
    if (!q) return []
    return allIngredients
      .filter((i) => !inAreaIds.has(i.ingredientId) && ingredientDisplayName(i).toLowerCase().includes(q))
      .slice(0, 8)
  }, [pickerQuery, allIngredients, inAreaIds])

  function handleIngredientDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = area.ingredients.findIndex((i) => i.ingredientId === active.id)
    const newIndex = area.ingredients.findIndex((i) => i.ingredientId === over.id)
    onReorder(arrayMove(area.ingredients, oldIndex, newIndex))
  }

  function submitRename() {
    const name = renameValue.trim()
    setRenaming(false)
    if (name && name !== area.name) onRename(name)
    else setRenameValue(area.name)
  }

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`border border-[var(--color-border)] rounded-lg bg-[var(--color-card)] ${isDragging ? "opacity-60 shadow-lg z-10 relative" : ""}`}
    >
      <div className="flex items-center gap-1.5 px-3 py-2.5">
        {canManage && (
          <button
            {...attributes}
            {...listeners}
            className="p-2 -m-1 cursor-grab text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] touch-none"
            title="Drag to reorder areas (the order the count walks the store)"
          >
            <GripVertical className="h-4 w-4" />
          </button>
        )}
        <button onClick={onToggle} className="flex items-center gap-2 flex-1 min-w-0 min-h-11 text-left">
          {expanded ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-[var(--color-muted-foreground)]" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-[var(--color-muted-foreground)]" />
          )}
          {renaming ? (
            <Input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={submitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitRename()
                if (e.key === "Escape") {
                  setRenameValue(area.name)
                  setRenaming(false)
                }
              }}
              onClick={(e) => e.stopPropagation()}
              autoFocus
              className="h-8 w-48"
            />
          ) : (
            <span className="text-sm font-semibold text-[var(--color-foreground)] truncate">{area.name}</span>
          )}
          <span className="text-xs text-[var(--color-muted-foreground)] shrink-0">
            {area.ingredients.length} ingredient{area.ingredients.length === 1 ? "" : "s"}
          </span>
        </button>
        {canManage && !renaming && (
          <>
            <button
              onClick={() => {
                setRenameValue(area.name)
                setRenaming(true)
              }}
              className="p-2.5 rounded-md text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-accent)] transition-colors"
              title="Rename area"
            >
              <Pencil className="h-4 w-4" />
            </button>
            <button
              onClick={() => setConfirmDelete(true)}
              className="p-2.5 rounded-md text-[var(--color-muted-foreground)] hover:text-[var(--color-destructive)] hover:bg-[var(--color-accent)] transition-colors"
              title="Delete area"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </>
        )}
      </div>

      {expanded && (
        <div className="border-t border-[var(--color-border)] px-3 pb-3">
          {area.ingredients.length === 0 ? (
            <p className="text-sm text-[var(--color-muted-foreground)] py-3 px-1">
              No ingredients in this area yet{canManage ? " — search below to add some." : "."}
            </p>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleIngredientDragEnd}>
              <SortableContext
                items={area.ingredients.map((i) => i.ingredientId)}
                strategy={verticalListSortingStrategy}
              >
                <div className="divide-y divide-[var(--color-border)]">
                  {area.ingredients.map((ing) => (
                    <SortableIngredientRow
                      key={ing.ingredientId}
                      ingredient={ing}
                      canManage={canManage}
                      onRemove={() => onRemove(ing.ingredientId)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}

          {canManage && (
            <div className="relative mt-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--color-muted-foreground)]" />
                <Input
                  value={pickerQuery}
                  onChange={(e) => setPickerQuery(e.target.value)}
                  placeholder="Add ingredient to this area…"
                  className="pl-9 min-h-11"
                />
              </div>
              {pickerMatches.length > 0 && (
                <div className="absolute left-0 right-0 mt-1 z-20 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] shadow-md max-h-64 overflow-y-auto">
                  {pickerMatches.map((ing) => (
                    <button
                      key={ing.ingredientId}
                      onClick={() => {
                        onAdd(ing)
                        setPickerQuery("")
                      }}
                      className="w-full flex items-center justify-between px-3 py-2.5 min-h-11 text-left text-sm hover:bg-[var(--color-accent)] transition-colors"
                    >
                      <span className="truncate">{ingredientDisplayName(ing)}</span>
                      <span className="text-xs text-[var(--color-muted-foreground)] shrink-0 ml-2">
                        {ing.categoryName ?? "Uncategorized"}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {pickerQuery.trim() && pickerMatches.length === 0 && (
                <div className="absolute left-0 right-0 mt-1 z-20 rounded-md border border-[var(--color-border)] bg-[var(--color-card)] shadow-md px-3 py-2.5 text-sm text-[var(--color-muted-foreground)]">
                  No matching active ingredients outside this area.
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{area.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {area.ingredients.length > 0
                ? `Its ${area.ingredients.length} ingredient${area.ingredients.length === 1 ? "" : "s"} return${area.ingredients.length === 1 ? "s" : ""} to unassigned for this store — no ingredients are deleted.`
                : "This area is empty; no ingredients are affected."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={onDelete}
              className="bg-[var(--color-destructive)] text-[var(--color-destructive-foreground)] hover:bg-[var(--color-destructive)]/90"
            >
              Delete area
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function SortableIngredientRow({
  ingredient,
  canManage,
  onRemove,
}: {
  ingredient: AreaIngredient
  canManage: boolean
  onRemove: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: ingredient.ingredientId,
  })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-2 py-1.5 min-h-11 ${isDragging ? "opacity-60 bg-[var(--color-accent)] rounded-md" : ""}`}
    >
      {canManage && (
        <button
          {...attributes}
          {...listeners}
          className="p-2 -m-1 cursor-grab text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)] touch-none"
          title="Drag to reorder (shelf-to-sheet order)"
        >
          <GripVertical className="h-4 w-4" />
        </button>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm text-[var(--color-foreground)] truncate">{ingredientDisplayName(ingredient)}</p>
      </div>
      <span className="text-xs text-[var(--color-muted-foreground)] shrink-0">
        ${ingredient.costPerReportingUnit.toFixed(2)}/{ingredient.reportingUnit}
      </span>
      {canManage && (
        <button
          onClick={onRemove}
          className="p-2.5 rounded-md text-[var(--color-muted-foreground)] hover:text-[var(--color-destructive)] hover:bg-[var(--color-accent)] transition-colors"
          title="Remove from this area (the ingredient itself is kept)"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}
