<script setup lang="ts">
import { cellFillColor } from '#shared/domain/cells'
import { formatDuration } from '#shared/domain/time'
import { isTargetGapCode } from '#shared/domain/warnings'
import type {
  CodeDto, EntryInput, GroupDto, TemplateDto, WeekTemplateDetailDto, WeekTemplateEntryDto, WeekTemplateStaffDto,
} from '#shared/types/api'
import { de } from '~/locales/de'
import { cellFillClasses } from '~/utils/colors'
import {
  clearTemplateCells, enterIntoTemplateCells, hiddenTemplateEntries, removeTemplateEntry, staffInScope, templateCellOf, templateDayKind,
  templateEntryInputs, templateWeekdays, templateWeeklyMinutes, type TemplateCell,
} from '~/utils/weekTemplateEditor'

/**
 * Creates or edits a week template directly: name, scope („Für“) and a grid Monday–Sunday × the employees in scope,
 * entered like the plan (select cells, then a service, VZ/Büro, Sonderdienst, Pause or „Leeren“). Everything stays on
 * the page until „Speichern“ sends the whole template; leaving with unsaved changes asks first (useDirty).
 */
const props = defineProps<{
  /** The template to edit; null for a new one. */
  template: WeekTemplateDetailDto | null
  staff: WeekTemplateStaffDto[]
  templates: TemplateDto[]
  codes: CodeDto[]
  groups: GroupDto[]
}>()
const emit = defineEmits<{ done: [] }>()
const toast = useToast()
const run = useAction()
const t = de.weekTemplates
const e = de.weekTemplates.editor

const form = reactive({ name: props.template?.name ?? '', groupId: props.template?.groupId ?? null as number | null })
const entries = ref<WeekTemplateEntryDto[]>(props.template?.entries ?? [])
const context = computed(() => ({ templates: props.templates, codes: props.codes }))
/** Only VZ and Büro: one-off absences (Urlaub, Krank, Schließtag …) never go into a template. */
const templateCodes = computed(() => props.codes.filter(code => isTargetGapCode(code.key)))
/** Everyone's name: the staff, and people with entries who left meanwhile. */
const names = computed(() => new Map([...(props.template?.people ?? []), ...props.staff].map(person => [person.id, person.name])))

const selection = usePlanSelection()
const columns = computed(() => staffInScope(props.staff, form.groupId))
const shown = computed(() => new Set(columns.value.map(person => person.id)))
/** Entries of people not shown (another group, or no longer in the facility): not saved. */
const hidden = computed(() => hiddenTemplateEntries(entries.value, shown.value, names.value))
const scopeItems = computed(() => [
  { label: t.wholeFacility, value: 0 },
  ...props.groups.map(group => ({ label: group.name, value: group.id })),
])
/** 0 = the whole facility (the select needs a non-null value). */
const scope = computed({
  get: () => form.groupId ?? 0,
  set: (value: number) => {
    form.groupId = value || null
    selection.clear()
  },
})

const payloadOf = () => ({ name: form.name.trim(), groupId: form.groupId, entries: templateEntryInputs(entries.value, shown.value) })
const loaded = payloadOf()
const saved = ref(false)
const dirty = useDirty(() => !saved.value && !sameValue(payloadOf(), loaded))

const byCell = computed(() => Map.groupBy(entries.value, templateCellOf))
const cellEntries = (cell: TemplateCell) => byCell.value.get(templateCellOf(cell)) ?? []
const weekdays = templateWeekdays()
const WEEKDAY_KEYS = weekdays.map((_, weekday) => String(weekday))

const selectedCells = computed<TemplateCell[]>(() => selection.cells.value.map(cell => ({ employeeId: cell.employeeId, weekday: Number(cell.date) })))
/** Like the plan; a tap on a touch screen adds the cell to the selection (there is no Ctrl key). */
function onCellClick(employeeId: number, weekday: number, event: MouseEvent) {
  const touch = 'pointerType' in event && event.pointerType === 'touch'
  selection.click(employeeId, String(weekday), touch ? new MouseEvent('click', { ctrlKey: true }) : event, WEEKDAY_KEYS)
}
const isSelected = (cell: TemplateCell) => selection.selected.value.has(templateCellOf(cell))
function cellClass(person: WeekTemplateStaffDto, weekday: number): string {
  const cell = { employeeId: person.id, weekday }
  if (isSelected(cell)) return 'bg-sky-100'
  const fill = cellFillColor(cellEntries(cell))
  const kind = templateDayKind(person, weekday)
  if (kind === 'day_off' || (kind === 'weekend' && !fill)) return 'bg-gray-100'
  return fill ? cellFillClasses[fill] : ''
}
/** Why a day off is grey: a weekday off is skipped, Saturday/Sunday take only what has times. */
function dayOffTitle(person: WeekTemplateStaffDto, weekday: number): string | undefined {
  return { workday: undefined, weekend: e.weekendOff, day_off: e.dayOff }[templateDayKind(person, weekday)]
}

function hasSelection(): boolean {
  if (selectedCells.value.length > 0) return true
  toast.add({ title: de.plan.selectFirst, color: 'warning' })
  return false
}

function enter(input: EntryInput) {
  if (!hasSelection()) return
  const result = enterIntoTemplateCells(entries.value, selectedCells.value, input, context.value, names.value)
  if ('error' in result) toast.add({ title: result.message, color: 'error' })
  else entries.value = result.entries
}

const timeModal = reactive<{ open: boolean; code: CodeDto | null }>({ open: false, code: null })
const breakOpen = ref(false)
function openTimeModal(code: CodeDto | null) {
  if (hasSelection()) Object.assign(timeModal, { open: true, code })
}
function onCode(code: CodeDto) {
  if (code.requiresTimes) openTimeModal(code)
  else enter({ kind: 'code', codeId: code.id })
}
function onAddBreak() {
  if (hasSelection()) breakOpen.value = true
}
function onClear() {
  if (hasSelection()) entries.value = clearTemplateCells(entries.value, selectedCells.value)
}
function onRemove(id: number) {
  const result = removeTemplateEntry(entries.value, id, names.value)
  if ('error' in result) toast.add({ title: result.message, color: 'error' })
  else entries.value = result.entries
}

/** The weekly hours each person shown gets from the template, with the contract hours when known. */
const hours = computed(() => columns.value.map(person => ({
  id: person.id, name: person.name, planned: templateWeeklyMinutes(entries.value, person), contract: person.weeklyMinutes,
})))

async function save() {
  if (!form.name.trim()) {
    toast.add({ title: de.errors.name_required, color: 'warning' })
    return
  }
  const body = payloadOf()
  const id = props.template?.id
  const ok = await run(() => (id
    ? $fetch<WeekTemplateDetailDto>(`/api/week-templates/${id}/entries`, { method: 'PUT', body })
    : $fetch<WeekTemplateDetailDto>('/api/week-templates/entries', { method: 'POST', body })), t.saved)
  if (!ok) return
  saved.value = true
  emit('done')
}
</script>

<template>
  <div class="space-y-4">
    <h2 class="text-xl font-semibold">{{ template ? e.editTitle(template.name) : e.newTitle }}</h2>
    <form class="space-y-4" @submit.prevent="save">
      <div class="flex flex-wrap items-end gap-3 rounded-lg bg-white p-4 ring-1 ring-gray-200">
        <UFormField :label="t.name" required class="w-full sm:w-72">
          <UInput v-model="form.name" maxlength="100" required class="w-full" />
        </UFormField>
        <UFormField v-if="groups.length" :label="t.scope" class="w-full sm:w-72">
          <USelect v-model="scope" :items="scopeItems" class="w-full" />
        </UFormField>
      </div>

      <div class="space-y-2">
        <p class="text-xs text-gray-500">{{ e.hint }}</p>
        <PlanToolbar
          :templates="templates" :codes="templateCodes" :selected-count="selectedCells.length"
          @template="enter({ kind: 'shift', templateId: $event.id })" @code="onCode" @special="openTimeModal(null)" @clear="onClear"
        />
        <UButton size="xs" color="neutral" variant="soft" icon="i-lucide-coffee" :label="e.addBreak" @click="onAddBreak" />
      </div>

      <p v-if="!columns.length" class="rounded-lg bg-white p-4 text-sm text-gray-500 ring-1 ring-gray-200">{{ e.noStaff }}</p>
      <div v-else class="overflow-x-auto rounded-lg bg-white ring-1 ring-gray-200">
        <table class="w-full border-collapse text-xs">
          <thead class="bg-gray-100 text-gray-600">
            <tr>
              <th class="sticky left-0 z-10 w-24 border border-gray-200 bg-gray-100 px-2 py-1 text-left">{{ e.weekday }}</th>
              <th v-for="person in columns" :key="person.id" class="min-w-28 border border-gray-200 px-2 py-1">{{ person.name }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(day, weekday) in weekdays" :key="day">
              <td class="sticky left-0 z-10 border border-gray-200 bg-gray-50 px-2 py-1 font-medium">{{ day }}</td>
              <td
                v-for="person in columns" :key="person.id"
                class="cursor-pointer border border-gray-200 px-1 py-1 align-top hover:bg-sky-50" :class="cellClass(person, weekday)"
                :title="dayOffTitle(person, weekday)"
                @click="onCellClick(person.id, weekday, $event)"
              >
                <div class="flex min-h-6 flex-col items-start gap-0.5">
                  <PlanEntryChip
                    v-for="entry in cellEntries({ employeeId: person.id, weekday })" :key="entry.id" :entry="entry" removable
                    @remove="onRemove"
                  />
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <section v-if="hours.length" class="space-y-2 rounded-lg bg-white p-4 ring-1 ring-gray-200">
        <h3 class="text-sm font-semibold">{{ e.hours }}</h3>
        <ul class="grid gap-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <li v-for="row in hours" :key="row.id">
            {{ e.hoursLine(row.name, formatDuration(row.planned)) }}
            <span v-if="row.contract !== null" :class="row.planned === row.contract ? 'text-gray-500' : 'font-medium text-red-600'">
              {{ e.contract(formatDuration(row.contract)) }}
            </span>
          </li>
        </ul>
        <p class="text-xs text-gray-500">{{ e.contractHint }}</p>
      </section>

      <!-- Right above „Speichern“, so it is seen before saving, also on a phone below the wide grid. -->
      <UAlert
        v-if="hidden.count" color="warning" variant="subtle" icon="i-lucide-user-x"
        :title="e.hiddenEntries(hidden.names.join(', '), hidden.count)"
      />
      <div class="flex flex-wrap justify-end gap-2">
        <UButton color="neutral" variant="ghost" :label="de.common.cancel" @click="emit('done')" />
        <UButton type="submit" :label="de.common.save" :disabled="!dirty" />
      </div>
    </form>

    <PlanTimeEntryModal v-model:open="timeModal.open" :code="timeModal.code" @submit="enter" />
    <PlanBreakModal v-model:open="breakOpen" @submit="enter({ kind: 'break', start: $event.start, end: $event.end })" />
  </div>
</template>
