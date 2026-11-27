<script setup lang="ts">
import { FORM_LIMITS, isEmptyTableRow, tableRowsOf, type TableAnswer, type TableAnswerRow, type TableCell, type TableColumn, type TableItem } from '#shared/domain/forms'
import { de } from '~/locales/de'
import { formatDate } from '~/utils/format'
import { withTableCell, withTableRow, withoutTableRow } from '~/utils/forms'

/**
 * A „Tabelle“ of a form, to fill in (`readonly` false) or to read: from 900 px a real table (the row labels of a fixed
 * table in the first column), below (phones, a tablet held upright) each row as a card with the column headings as
 * labels. A free table has „Zeile hinzufügen“ (up to 50) and per row „Zeile entfernen“ (asked first when the row holds
 * something). Text cells are plain text (at most 500 characters), date cells the same field as a date item.
 */
const props = defineProps<{ item: TableItem; value: unknown; readonly?: boolean }>()
const emit = defineEmits<{ update: [value: TableAnswer] }>()
const confirm = useConfirm()
const t = de.forms.table

const rows = computed(() => tableRowsOf(props.item, props.value))
const full = computed(() => rows.value.length >= FORM_LIMITS.tableFreeRows)
const rowName = (index: number) => (props.item.freeRows ? t.rowNumber(index + 1) : props.item.rows[index]?.label ?? '')
const cellOf = (row: TableAnswerRow, column: TableColumn): TableCell => row.cells[column.id] ?? null
const textOf = (row: TableAnswerRow, column: TableColumn) => {
  const cell = cellOf(row, column)
  return typeof cell === 'string' ? cell : ''
}
const label = (column: TableColumn, index: number) => t.cellLabel(column.heading, rowName(index))
/** A cell as text to read: the text, ☒/☐ for a tick, the date (or nothing). */
const shown = (row: TableAnswerRow, column: TableColumn) => {
  const cell = cellOf(row, column)
  if (column.type === 'checkbox') return cell === true ? '☒' : '☐'
  if (column.type === 'date') return typeof cell === 'string' && cell ? formatDate(cell) : ''
  return typeof cell === 'string' ? cell : ''
}

/** Ids for new rows (the history follows a row by it); without a secure context a random fallback. */
const newId = () => globalThis.crypto?.randomUUID?.() ?? `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
const setCell = (rowId: string, columnId: string, cell: TableCell) => emit('update', withTableCell(props.item, props.value, rowId, columnId, cell))
const addRow = () => emit('update', withTableRow(props.item, props.value, newId()))
async function removeRow(row: TableAnswerRow, index: number) {
  if (!isEmptyTableRow(row) && !await confirm(t.removeRowConfirm(rowName(index)), { confirmLabel: t.removeRow })) return
  emit('update', withoutTableRow(props.item, props.value, row.id))
}
const cell = 'border border-gray-200 px-1.5 py-1 align-top'

/**
 * Table from 900 px, cards below (phones and tablets held upright). Only one layout is mounted once the width is known
 * (in the browser); before that (server render, first paint) both are, switched by CSS, so nothing jumps.
 */
const WIDE = '(min-width: 900px)'
const wide = ref<boolean | null>(null)
let query: MediaQueryList | null = null
const onWidth = () => { wide.value = query?.matches ?? null }
onMounted(() => {
  query = window.matchMedia(WIDE)
  onWidth()
  query.addEventListener('change', onWidth)
})
onBeforeUnmount(() => query?.removeEventListener('change', onWidth))
</script>

<template>
  <div class="min-w-0 space-y-2">
    <p v-if="props.item.freeRows && !rows.length" class="text-sm text-gray-500">{{ t.noRows }}</p>

    <!-- From 900 px: a table -->
    <div v-if="rows.length && wide !== false" class="overflow-x-auto" :class="wide === null ? 'hidden min-[900px]:block' : ''">
      <table class="w-full border-collapse text-sm">
        <thead>
          <tr class="bg-gray-50">
            <th v-if="!props.item.freeRows" :class="cell" />
            <th v-for="column in props.item.columns" :key="column.id" :class="[cell, 'text-left font-medium break-words']">{{ column.heading }}</th>
            <th v-if="props.item.freeRows && !props.readonly" :class="cell"><span class="sr-only">{{ t.removeRow }}</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, index) in rows" :key="row.id">
            <th v-if="!props.item.freeRows" scope="row" :class="[cell, 'bg-gray-50 text-left font-medium break-words']">{{ rowName(index) }}</th>
            <td
              v-for="column in props.item.columns" :key="column.id" :class="[cell, column.type === 'checkbox' ? 'w-16 text-center' : '', column.type === 'date' && !props.readonly ? 'w-44' : '']"
            >
              <span v-if="props.readonly" class="break-words whitespace-pre-line">{{ shown(row, column) }}</span>
              <UInput
                v-else-if="column.type === 'text'" :model-value="textOf(row, column)" :maxlength="FORM_LIMITS.tableCell" size="sm"
                class="w-full min-w-24" :aria-label="label(column, index)" @update:model-value="setCell(row.id, column.id, String($event ?? ''))"
              />
              <UCheckbox
                v-else-if="column.type === 'checkbox'" :model-value="cellOf(row, column) === true" :aria-label="label(column, index)"
                class="inline-flex justify-center" @update:model-value="setCell(row.id, column.id, $event === true)"
              />
              <DateTextInput
                v-else :model-value="textOf(row, column)" :aria-label="label(column, index)" :label="label(column, index)" size="sm" class="w-40"
                @update:model-value="setCell(row.id, column.id, $event || null)"
              />
            </td>
            <td v-if="props.item.freeRows && !props.readonly" :class="[cell, 'w-10 text-center']">
              <UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" :aria-label="`${t.removeRow}: ${rowName(index)}`" @click="removeRow(row, index)" />
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Below 900 px: one card per row -->
    <ul v-if="rows.length && wide !== true" class="space-y-2" :class="wide === null ? 'min-[900px]:hidden' : ''">
      <li v-for="(row, index) in rows" :key="row.id" class="min-w-0 space-y-1.5 rounded-md p-2 ring-1 ring-gray-200">
        <div class="flex items-center gap-1">
          <p class="min-w-0 flex-1 text-sm font-semibold break-words">{{ rowName(index) }}</p>
          <UButton
            v-if="props.item.freeRows && !props.readonly" size="xs" color="error" variant="ghost" icon="i-lucide-trash-2"
            :aria-label="`${t.removeRow}: ${rowName(index)}`" @click="removeRow(row, index)"
          />
        </div>
        <template v-for="column in props.item.columns" :key="column.id">
          <p v-if="props.readonly" class="text-sm break-words">
            <span class="text-gray-600">{{ column.heading }}:</span> <span class="whitespace-pre-line">{{ shown(row, column) || de.forms.noAnswer }}</span>
          </p>
          <UCheckbox
            v-else-if="column.type === 'checkbox'" :model-value="cellOf(row, column) === true" :label="column.heading"
            :ui="{ label: 'break-words' }" @update:model-value="setCell(row.id, column.id, $event === true)"
          />
          <UFormField v-else :label="column.heading" :ui="{ label: 'break-words' }">
            <UInput
              v-if="column.type === 'text'" :model-value="textOf(row, column)" :maxlength="FORM_LIMITS.tableCell" class="w-full"
              :aria-label="label(column, index)" @update:model-value="setCell(row.id, column.id, String($event ?? ''))"
            />
            <DateTextInput
              v-else :model-value="textOf(row, column)" :aria-label="label(column, index)" :label="label(column, index)" class="w-48"
              @update:model-value="setCell(row.id, column.id, $event || null)"
            />
          </UFormField>
        </template>
      </li>
    </ul>

    <div v-if="props.item.freeRows && !props.readonly" class="flex flex-wrap items-center gap-2">
      <UButton size="sm" color="neutral" variant="outline" icon="i-lucide-plus" :label="t.addRow" :disabled="full" @click="addRow" />
      <span v-if="full" class="text-xs text-gray-500">{{ t.rowsFull(FORM_LIMITS.tableFreeRows) }}</span>
    </div>
  </div>
</template>
