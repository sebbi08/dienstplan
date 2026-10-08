import { cellKey, parseCellKey } from '#shared/domain/cells'
import type { CellRef } from '#shared/types/api'

/**
 * Click: single cell · Shift+click: date range in the same column · Ctrl/Cmd+click: toggle a cell.
 * `selectable` leaves cells out of a range (a helper's days in another plan).
 */
export function usePlanSelection() {
  const selected = ref(new Set<string>())
  const anchor = ref<CellRef | null>(null)
  const cells = computed<CellRef[]>(() => [...selected.value].map(parseCellKey))

  function click(employeeId: number, date: string, event: MouseEvent, dates: string[], selectable?: (key: string) => boolean) {
    const key = cellKey(employeeId, date)
    if (event.shiftKey && anchor.value?.employeeId === employeeId) {
      const [from, to] = [anchor.value.date, date].sort() as [string, string]
      const next = new Set(selected.value)
      for (const day of dates) {
        const dayKey = cellKey(employeeId, day)
        if (day >= from && day <= to && (selectable?.(dayKey) ?? true)) next.add(dayKey)
      }
      selected.value = next
      return
    }
    if (event.ctrlKey || event.metaKey) {
      const next = new Set(selected.value)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      selected.value = next
    }
    else {
      selected.value = new Set([key])
    }
    anchor.value = { employeeId, date }
  }

  function clear() {
    selected.value = new Set()
    anchor.value = null
  }

  return { selected, cells, click, clear }
}
