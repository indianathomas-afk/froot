"use client"

import { Pencil, Trash2 } from "lucide-react"
import { useState } from "react"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { useRouter } from "next/navigation"

export function StoreActions({ storeId }: { storeId: string }) {
  const router = useRouter()
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    setDeleting(true)
    try {
      await fetch(`/api/stores/${storeId}`, { method: "DELETE" })
      router.refresh()
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="flex items-center gap-1">
      <button className="p-1.5 rounded hover:bg-[var(--color-accent)] transition-colors">
        <Pencil className="h-4 w-4 text-[var(--color-muted-foreground)]" />
      </button>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <button className="p-1.5 rounded hover:bg-[var(--color-accent)] transition-colors">
            <Trash2 className="h-4 w-4 text-[var(--color-muted-foreground)] hover:text-[var(--color-destructive)]" />
          </button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Store Location</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this store and all associated data. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-[var(--color-destructive)] text-[var(--color-destructive-foreground)] hover:opacity-90"
            >
              {deleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
