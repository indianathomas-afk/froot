"use client"

import { useRouter } from "next/navigation"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

export function StoreFilter({ stores, selected }: { stores: { id: string; name: string }[]; selected: string }) {
  const router = useRouter()

  function handleChange(value: string) {
    router.push(value === "all" ? "/checklists" : `/checklists?store=${value}`)
  }

  return (
    <Select defaultValue={selected} onValueChange={handleChange}>
      <SelectTrigger className="w-48">
        <SelectValue placeholder="All Stores" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All My Stores</SelectItem>
        {stores.map((s) => (
          <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
