<script setup lang="ts">
import { DISTRICT_SIDES, SCHOOL_DISTRICT_LIMITS, streetKey, type DistrictRow, type DistrictSide } from '#shared/domain/schoolDistricts'
import type { SchoolOptionDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorCode, errorMessage } from '~/utils/errors'
import { inputOfDraft, numbersLabel, rowIssues, syncDistricts, type DistrictDraft, type RowIssue } from '~/utils/schoolDistricts'

/**
 * The preview of an uploaded street list, or a stored list being edited: rows to check (yellow: unclear source,
 * reversed range, overlap with another district; red: incomplete), edited one at a time, deleted or added; the
 * districts with the school's name and the school of the address book; name and „Stand“. Saving replaces the stored
 * list of the scope (after a confirmation when there is one).
 */
const props = defineProps<{
  scope: 'facility' | 'global'
  initial: DistrictDraft
  fresh: boolean
  legend: boolean
  skipped: string[]
  skippedCount: number
  truncated: boolean
  replacing: boolean
  schoolOptions: SchoolOptionDto[]
}>()
const emit = defineEmits<{ saved: []; cancel: [] }>()

const t = de.schoolDistricts
const e = t.editor
const toast = useToast()
const confirm = useConfirm()
const { busy, guard } = useBusy()

const draft = reactive<DistrictDraft>(JSON.parse(JSON.stringify(props.initial)) as DistrictDraft)
const initialJson = JSON.stringify(props.initial)
// Saved: the section closes this editor; nothing is unsaved any more.
const initialSaved = ref(false)
const dirty = useDirty(() => !initialSaved.value && (props.fresh || JSON.stringify(draft) !== initialJson))

// The districts follow the codes the rows use (names and schools stay with their code).
watch(() => draft.rows.map(row => row.district).join('|'), () => {
  draft.districts = syncDistricts(draft.rows, draft.districts)
}, { immediate: true })

const issues = computed(() => rowIssues(draft.rows))
const invalidCount = computed(() => issues.value.filter(list => list.includes('invalid')).length)
const flaggedCount = computed(() => issues.value.filter(list => list.length > 0).length)

const search = ref('')
const onlyFlagged = ref(false)
const PAGE = 100
const shown = ref(PAGE)
watch([search, onlyFlagged], () => { shown.value = PAGE })
const matching = computed(() => {
  const needle = streetKey(search.value)
  return draft.rows.map((row, index) => index)
    .filter(index => (!needle || streetKey(draft.rows[index]!.street).includes(needle)) && (!onlyFlagged.value || issues.value[index]!.length > 0))
})
const visible = computed(() => matching.value.slice(0, shown.value))

const ISSUE_LABEL: Record<RowIssue, string> = e.flags
const rowClass = (index: number) => {
  const list = issues.value[index]!
  if (list.includes('invalid')) return 'bg-red-50'
  return list.length > 0 ? 'bg-amber-50' : ''
}

// One row is edited at a time; „Fertig“ after a change counts as checked (its doubts go).
const editIndex = ref<number | null>(null)
let editBefore = ''
function startEdit(index: number) {
  editIndex.value = index
  editBefore = JSON.stringify(draft.rows[index])
}
function finishEdit() {
  const index = editIndex.value
  editIndex.value = null
  if (index === null) return
  const row = draft.rows[index]
  if (row && JSON.stringify(row) !== editBefore) row.flags = []
}
function markChecked(index: number) {
  draft.rows[index]!.flags = []
}
function removeRow(index: number) {
  if (editIndex.value === index) editIndex.value = null
  else if (editIndex.value !== null && editIndex.value > index) editIndex.value--
  draft.rows.splice(index, 1)
}
function addRow() {
  draft.rows.unshift({ street: '', fromNo: null, fromSuffix: '', toNo: null, toSuffix: '', side: 'all', district: '', flags: [], note: '' })
  search.value = ''
  onlyFlagged.value = false
  startEdit(0)
}

/** A typed house number (empty = none). */
function setNumber(row: DistrictRow, field: 'fromNo' | 'toNo', value: string | number) {
  const text = String(value).trim()
  row[field] = text === '' ? null : Math.trunc(Number(text))
  if (row.fromNo !== null && row.toNo !== null && Number.isFinite(row.fromNo) && Number.isFinite(row.toNo)) {
    row.side = row.fromNo % 2 !== row.toNo % 2 ? 'all' : row.fromNo % 2 === 1 ? 'odd' : 'even'
  }
  else if (row.fromNo === null && row.toNo === null) row.side = 'all'
}
const sideItems = DISTRICT_SIDES.map(side => ({ label: e.sides[side], value: side }))
const contactItems = computed(() => [{ label: e.noContact, value: 0 }, ...props.schoolOptions.map(option => ({ label: option.name, value: option.id }))])

const numberText = (value: number | null) => (value === null || Number.isNaN(value) ? '' : String(value))

const url = props.scope === 'global' ? '/api/school-districts/global' : '/api/school-districts'
async function save() {
  finishEdit()
  if (invalidCount.value > 0) {
    onlyFlagged.value = true
    toast.add({ title: e.invalidRows(invalidCount.value), color: 'error' })
    return
  }
  if (props.replacing && !await confirm(t.confirmReplace, { confirmLabel: t.replace, danger: false })) return
  await guard(async () => {
    try {
      await $fetch<{ ok: boolean }>(url, { method: 'PUT', body: inputOfDraft(draft) })
      toast.add({ title: de.common.saved, color: 'success' })
      initialSaved.value = true
      emit('saved')
      return true
    }
    catch (error) {
      const row = (error as { data?: { data?: { details?: { row?: unknown } } } }).data?.data?.details?.row
      toast.add({ title: errorCode(error) === 'school_district_row_invalid' && typeof row === 'number' ? e.rowRefused(row) : errorMessage(error), color: 'error' })
      return false
    }
  })
}
async function discard() {
  if (dirty.value && !await confirm(e.confirmDiscard, { confirmLabel: e.discard })) return
  emit('cancel')
}

const cell = 'px-1.5 py-1 align-top'
const sideOf = (side: DistrictSide) => e.sides[side]
</script>

<template>
  <div class="space-y-3">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h3 class="text-sm font-semibold">{{ fresh ? e.titleNew : e.titleEdit }} – {{ scope === 'global' ? t.global : t.own }}</h3>
      <div class="flex gap-2">
        <UButton size="sm" icon="i-lucide-save" :label="e.save" :loading="busy" :disabled="busy" @click="save" />
        <UButton size="sm" color="neutral" variant="ghost" :label="e.discard" :disabled="busy" @click="discard" />
      </div>
    </div>

    <div class="grid gap-3 sm:grid-cols-2">
      <UFormField :label="e.name"><UInput v-model="draft.name" :maxlength="SCHOOL_DISTRICT_LIMITS.maxListName" class="w-full" /></UFormField>
      <UFormField :label="e.asOf"><UInput v-model="draft.asOf" :maxlength="SCHOOL_DISTRICT_LIMITS.maxAsOf" :placeholder="e.asOfPlaceholder" class="w-full" /></UFormField>
    </div>

    <p v-if="truncated" class="rounded bg-red-50 p-2 text-sm text-red-900">{{ e.truncated }}</p>
    <div v-if="skippedCount > 0" class="rounded bg-amber-50 p-2 text-sm text-amber-900">
      <p>{{ e.skipped(skippedCount) }}</p>
      <ul class="max-h-32 list-disc overflow-y-auto pl-5 text-xs">
        <li v-for="(line, index) in skipped" :key="index">{{ line }}</li>
      </ul>
      <p class="text-xs">{{ e.skippedHint }}</p>
    </div>

    <!-- Districts and their schools -->
    <div class="space-y-1">
      <h4 class="text-sm font-medium">{{ e.districts }}</h4>
      <p class="text-xs text-gray-500">{{ e.districtsHint }}</p>
      <p v-if="legend" class="text-xs text-amber-800">{{ e.legendFound }}</p>
      <p v-if="schoolOptions.length === 0" class="text-xs text-gray-500">{{ e.noSchoolContacts }}</p>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="text-left text-xs text-gray-500">
            <tr><th :class="cell">{{ e.district }}</th><th :class="cell">{{ e.districtName }}</th><th :class="cell">{{ e.contact }}</th></tr>
          </thead>
          <tbody>
            <tr v-for="district in draft.districts" :key="district.code" class="border-t border-gray-100">
              <td :class="cell" class="font-medium whitespace-nowrap">{{ district.code }}</td>
              <td :class="cell"><UInput v-model="district.name" :maxlength="SCHOOL_DISTRICT_LIMITS.maxName" size="sm" class="w-full min-w-40" :aria-label="`${e.districtName} ${district.code}`" /></td>
              <td :class="cell">
                <USelect
                  :model-value="district.contactId ?? 0" :items="contactItems" size="sm" class="w-full min-w-40" :aria-label="`${e.contact} ${district.code}`"
                  @update:model-value="(value: unknown) => { district.contactId = Number(value) || null }"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Rows -->
    <div class="space-y-2">
      <p class="text-xs text-gray-500">{{ e.flagsHint }}</p>
      <div class="flex flex-wrap items-center gap-3">
        <UInput v-model="search" icon="i-lucide-search" :placeholder="e.search" size="sm" class="w-56" :aria-label="e.search" />
        <UCheckbox v-model="onlyFlagged" :label="`${e.onlyFlagged} (${flaggedCount})`" />
        <span class="text-xs text-gray-500">{{ e.rowCount(matching.length, draft.rows.length) }}</span>
        <UButton size="xs" color="neutral" variant="outline" icon="i-lucide-plus" :label="e.addRow" @click="addRow" />
      </div>
      <p v-if="invalidCount" class="text-sm text-red-700">{{ e.invalidRows(invalidCount) }}</p>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="text-left text-xs text-gray-500">
            <tr>
              <th :class="cell">{{ e.street }}</th><th :class="cell">{{ e.numbers }}</th><th :class="cell">{{ e.side }}</th>
              <th :class="cell">{{ e.district }}</th><th :class="cell">{{ e.note }}</th><th :class="cell"><span class="sr-only">{{ e.actions }}</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="index in visible" :key="index" class="border-t border-gray-100" :class="rowClass(index)">
              <template v-if="editIndex === index">
                <td :class="cell"><UInput v-model="draft.rows[index]!.street" :maxlength="SCHOOL_DISTRICT_LIMITS.maxStreet" size="sm" class="w-full min-w-40" :aria-label="e.street" /></td>
                <td :class="cell">
                  <div class="flex flex-wrap items-center gap-1">
                    <UInput :model-value="numberText(draft.rows[index]!.fromNo)" inputmode="numeric" maxlength="4" size="sm" class="w-20" :aria-label="e.from" @update:model-value="(value: string | number) => setNumber(draft.rows[index]!, 'fromNo', value)" />
                    <UInput v-model="draft.rows[index]!.fromSuffix" maxlength="1" size="sm" class="w-10" :aria-label="e.fromSuffix" />
                    <span>–</span>
                    <UInput :model-value="numberText(draft.rows[index]!.toNo)" inputmode="numeric" maxlength="4" size="sm" class="w-20" :aria-label="e.to" @update:model-value="(value: string | number) => setNumber(draft.rows[index]!, 'toNo', value)" />
                    <UInput v-model="draft.rows[index]!.toSuffix" maxlength="1" size="sm" class="w-10" :aria-label="e.toSuffix" />
                  </div>
                </td>
                <td :class="cell"><USelect v-model="draft.rows[index]!.side" :items="sideItems" size="sm" class="w-28" :aria-label="e.side" /></td>
                <td :class="cell"><UInput v-model="draft.rows[index]!.district" :maxlength="SCHOOL_DISTRICT_LIMITS.maxCode" size="sm" class="w-16" :aria-label="e.district" /></td>
                <td :class="cell"><UInput v-model="draft.rows[index]!.note" :maxlength="SCHOOL_DISTRICT_LIMITS.maxNote" size="sm" class="w-full min-w-32" :aria-label="e.note" /></td>
                <td :class="cell" class="whitespace-nowrap"><UButton size="xs" icon="i-lucide-check" :label="e.done" @click="finishEdit" /></td>
              </template>
              <template v-else>
                <td :class="cell">
                  {{ draft.rows[index]!.street || '—' }}
                  <span v-for="issue in issues[index]" :key="issue" class="ml-1 inline-block rounded px-1 text-xs" :class="issue === 'invalid' ? 'bg-red-100 text-red-900' : 'bg-amber-100 text-amber-900'">{{ ISSUE_LABEL[issue] }}</span>
                </td>
                <td :class="cell" class="whitespace-nowrap">{{ numbersLabel(draft.rows[index]!) }}</td>
                <td :class="cell">{{ sideOf(draft.rows[index]!.side) }}</td>
                <td :class="cell">{{ draft.rows[index]!.district }}</td>
                <td :class="cell" class="text-xs text-gray-600">{{ draft.rows[index]!.note }}</td>
                <td :class="cell" class="whitespace-nowrap">
                  <UButton v-if="draft.rows[index]!.flags.length" size="xs" color="neutral" variant="ghost" icon="i-lucide-check-check" :label="e.checked" @click="markChecked(index)" />
                  <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-pencil" :aria-label="e.editRow" @click="startEdit(index)" />
                  <UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" :aria-label="e.deleteRow" @click="removeRow(index)" />
                </td>
              </template>
            </tr>
          </tbody>
        </table>
      </div>
      <UButton v-if="matching.length > visible.length" size="xs" color="neutral" variant="outline" :label="e.more(Math.min(PAGE, matching.length - visible.length))" @click="shown += PAGE" />
    </div>

    <div class="flex gap-2 border-t border-gray-100 pt-3">
      <UButton icon="i-lucide-save" :label="e.save" :loading="busy" :disabled="busy" @click="save" />
      <UButton color="neutral" variant="ghost" :label="e.discard" :disabled="busy" @click="discard" />
    </div>
  </div>
</template>
