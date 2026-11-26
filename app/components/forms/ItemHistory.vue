<script setup lang="ts">
import type { AnswerDiff, ItemChange, TableRowRef } from '#shared/domain/formHistory'
import { RATING_LEGEND, type AnswerableItem, type RatingValue, type TableCell, type TableColumnType } from '#shared/domain/forms'
import { nowInBerlin } from '#shared/domain/timeRecords'
import { de } from '~/locales/de'
import { formatDate } from '~/utils/format'

/**
 * Under an item of a form: „geändert am … von …“ (only when it was ever changed), else `origin` (a copied staff talk
 * form: „übernommen aus dem Gespräch vom …“), the marker „neu seit deinem letzten Öffnen“, and in a stored state with „Änderungen zeigen“ how the item differs from today (texts word by word as
 * plain text — never as HTML —, options added and dropped, rating, milestone, date and Kästchen as „damals → heute“, a
 * table cell by cell with its row and column, rows added and removed).
 */
const props = defineProps<{ item: AnswerableItem; change?: ItemChange; origin?: string; marked?: boolean; diff?: AnswerDiff }>()
const h = de.formHistory

const rating = (value: RatingValue | null) => (value === null ? h.noRating : RATING_LEGEND.entries.find(entry => entry.value === value)?.symbol ?? value)
const reached = (value: boolean) => (value ? h.reached : h.notReached)
const day = (value: string | null) => (value ? formatDate(value) : h.noDate)
const checked = (value: boolean) => (value ? h.checked : h.notChecked)
const rowName = (row: TableRowRef) => row.label ?? de.forms.table.rowNumber(row.number)
/** A table cell as plain text: the text (or „(leer)“), angekreuzt / nicht angekreuzt, the date (or „kein Datum“). */
function cellText(type: TableColumnType, cell: TableCell): string {
  if (type === 'checkbox') return checked(cell === true)
  if (type === 'date') return day(typeof cell === 'string' ? cell : null)
  return typeof cell === 'string' && cell.trim() ? cell : h.empty
}
const statusClass = { new: 'bg-green-100 text-green-800', changed: 'bg-amber-100 text-amber-900', removed: 'bg-red-100 text-red-800' } as const
</script>

<template>
  <div v-if="props.change || props.origin || props.marked || (props.diff && props.diff.status !== 'same')" class="space-y-1">
    <p v-if="props.change || props.origin || props.marked" class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-500">
      <span v-if="props.change">{{ h.changedAt(formatDate(nowInBerlin(new Date(props.change.changedAt)).date), props.change.changedBy) }}</span>
      <span v-else-if="props.origin">{{ props.origin }}</span>
      <span v-if="props.marked" class="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-900">{{ h.changedSinceSeen }}</span>
    </p>
    <div v-if="props.diff && props.diff.status !== 'same'" class="space-y-1 rounded-md bg-amber-50/60 p-2 text-sm ring-1 ring-amber-200">
      <span class="inline-block rounded px-1.5 py-0.5 text-xs font-semibold" :class="statusClass[props.diff.status]">{{ h.status[props.diff.status] }}</span>
      <p v-if="props.diff.detail.kind === 'text'" class="break-words whitespace-pre-wrap">
        <template v-for="(segment, index) in props.diff.detail.segments" :key="index">
          <ins v-if="segment.op === 'add'" class="bg-green-100 text-green-900 no-underline">{{ segment.text }}</ins>
          <del v-else-if="segment.op === 'del'" class="bg-red-100 text-red-800">{{ segment.text }}</del>
          <span v-else>{{ segment.text }}</span>
        </template>
      </p>
      <div v-else-if="props.diff.detail.kind === 'choices'" class="space-y-0.5">
        <p v-if="props.diff.detail.added.length"><span class="font-medium text-green-800">{{ h.added }}:</span> {{ props.diff.detail.added.join(', ') }}</p>
        <p v-if="props.diff.detail.removed.length"><span class="font-medium text-red-800">{{ h.dropped }}:</span> {{ props.diff.detail.removed.join(', ') }}</p>
        <p v-if="props.diff.detail.kept.length" class="text-gray-600">{{ h.kept }}: {{ props.diff.detail.kept.join(', ') }}</p>
      </div>
      <div v-else-if="props.diff.detail.kind === 'rating' || props.diff.detail.kind === 'milestone'" class="space-y-0.5">
        <p>
          <span class="text-gray-600">{{ h.then }}</span>
          <strong class="mx-1">{{ props.diff.detail.kind === 'rating' ? rating(props.diff.detail.from) : reached(props.diff.detail.from) }}</strong>
          → <span class="text-gray-600">{{ h.now }}</span>
          <strong class="ml-1">{{ props.diff.detail.kind === 'rating' ? rating(props.diff.detail.to) : reached(props.diff.detail.to) }}</strong>
        </p>
        <p v-if="props.diff.detail.remarkFrom !== props.diff.detail.remarkTo" class="break-words">
          {{ h.remark }}: <del class="bg-red-100 text-red-800">{{ props.diff.detail.remarkFrom || h.empty }}</del>
          → <ins class="bg-green-100 text-green-900 no-underline">{{ props.diff.detail.remarkTo || h.empty }}</ins>
        </p>
      </div>
      <p v-else-if="props.diff.detail.kind === 'date'">
        <span class="text-gray-600">{{ h.then }}</span> <strong>{{ day(props.diff.detail.from) }}</strong>
        → <span class="text-gray-600">{{ h.now }}</span> <strong>{{ day(props.diff.detail.to) }}</strong>
      </p>
      <p v-else-if="props.diff.detail.kind === 'checkbox'">
        <span class="text-gray-600">{{ h.then }}</span> <strong>{{ checked(props.diff.detail.from) }}</strong>
        → <span class="text-gray-600">{{ h.now }}</span> <strong>{{ checked(props.diff.detail.to) }}</strong>
      </p>
      <ul v-else-if="props.diff.detail.kind === 'table'" class="space-y-0.5">
        <li v-for="(change, index) in props.diff.detail.cells" :key="`c${index}`" class="break-words whitespace-pre-line">
          <span class="font-medium">{{ rowName(change.row) }} · {{ change.column }}:</span>
          <del class="ml-1 bg-red-100 text-red-800">{{ cellText(change.type, change.from) }}</del>
          → <ins class="bg-green-100 text-green-900 no-underline">{{ cellText(change.type, change.to) }}</ins>
        </li>
        <li v-for="(row, index) in props.diff.detail.addedRows" :key="`a${index}`" class="break-words whitespace-pre-line">
          <span class="font-medium text-green-800">{{ h.rowAdded }} ({{ rowName(row.row) }}):</span>
          {{ row.cells.map(cell => `${cell.column}: ${cellText(cell.type, cell.value)}`).join(' · ') }}
        </li>
        <li v-for="(row, index) in props.diff.detail.removedRows" :key="`r${index}`" class="break-words whitespace-pre-line">
          <span class="font-medium text-red-800">{{ h.rowRemoved }} ({{ rowName(row.row) }}):</span>
          <del class="ml-1 bg-red-100 text-red-800">{{ row.cells.map(cell => `${cell.column}: ${cellText(cell.type, cell.value)}`).join(' · ') }}</del>
        </li>
      </ul>
    </div>
  </div>
</template>
