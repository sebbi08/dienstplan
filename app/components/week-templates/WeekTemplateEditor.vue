<script setup lang="ts">
import { cellFillColor } from '#shared/domain/cells'
import { formatDuration } from '#shared/domain/time'
import { isTargetGapCode } from '#shared/domain/warnings'
import { TEMPLATE_INFO_MAX } from '#shared/domain/weekTemplates'
import type {
  CodeDto, EntryInput, GroupDto, TemplateDto, WeekTemplateCoverageDto, WeekTemplateDetailDto, WeekTemplateDto,
  WeekTemplateEntryDto, WeekTemplateStaffDto,
} from '#shared/types/api'
import WeekTemplateEntryModal from '~/components/week-templates/WeekTemplateEntryModal.vue'
import { de } from '~/locales/de'
import { cellFillClasses } from '~/utils/colors'
import { gridStep, quickEntryHandlers, rovingStop, touchTapAsToggle } from '~/utils/quickEntry'
import {
  clearTemplateCells, copyTemplateDay, dayHasEntries, editTemplateEntry, enterIntoTemplateCells, hiddenTemplateEntries, readTemplateCompare,
  removeTemplateEntry, staffInScope, templateCellOf, templateCoverage, templateDayKind, templateEntryInputs, templateInfoDraft,
  takeFieldOnEnter, templateInfoInputs, templateWeekdays,
  templateWeeklyMinutes, writeTemplateCompare, type TemplateCell, type TemplateEntryTimes,
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
  /** Pflichtdienste and opening hours for the coverage warnings (null: not loaded, no warnings). */
  coverage?: WeekTemplateCoverageDto | null
}>()
const emit = defineEmits<{ done: [] }>()
const toast = useToast()
const run = useAction()
const t = de.weekTemplates
const e = de.weekTemplates.editor

const form = reactive({ name: props.template?.name ?? '', groupId: props.template?.groupId ?? null as number | null })
const entries = ref<WeekTemplateEntryDto[]>(props.template?.entries ?? [])
/** Info 1 / Info 2 per weekday, sent with „Speichern“ like the entries. */
const infos = ref(templateInfoDraft(props.template?.infos ?? []))
const INFO_FIELDS = ['info1', 'info2'] as const
/** Info 1 / Info 2 are the facility's day notes: only a template for the whole facility has them (none for a group). */
const infoFields = computed(() => (form.groupId === null ? INFO_FIELDS : []))
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

const payloadOf = () => ({
  name: form.name.trim(), groupId: form.groupId, entries: templateEntryInputs(entries.value, shown.value),
  infos: form.groupId === null ? templateInfoInputs(infos.value) : [],
})
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
  // The click after a long press opened the quick time entry; it does not toggle the cell.
  if (quick.consumeClick()) return
  selection.click(employeeId, String(weekday), touchTapAsToggle(event), WEEKDAY_KEYS)
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

/**
 * Double click, long press, Enter or F2 on a cell: the quick time entry opens at it, for the cell or the selection it
 * belongs to; what is typed goes the „Sonderdienst“ dialog's way (enter).
 */
const quickEntry = reactive<{ open: boolean; reference: HTMLElement | null }>({ open: false, reference: null })
const quick = quickEntryHandlers<TemplateCell>(
  ({ employeeId, weekday }, element, afterDoubleClick) => {
    selection.selectForQuickEntry(employeeId, String(weekday), afterDoubleClick)
    Object.assign(quickEntry, { open: true, reference: element })
  },
  (cell, key) => {
    const next = gridStep(cellGrid.value, templateCellOf(cell), key)
    if (next) grid.value?.querySelector<HTMLElement>(`[data-cell="${next}"]`)?.focus()
  },
)
/** Weekdays × people: the arrow keys move between them; the cell focused last is the grid's one tab stop. */
const grid = ref<HTMLElement | null>(null)
const cellGrid = computed(() => weekdays.map((_, weekday) => columns.value.map(person => templateCellOf({ employeeId: person.id, weekday }))))
const focusedCell = ref<string | null>(null)
const tabStop = computed(() => rovingStop(cellGrid.value, focusedCell.value))
const quickTitle = (person: WeekTemplateStaffDto, weekday: number) =>
  [dayOffTitle(person, weekday), de.quickEntry.hint].filter(Boolean).join('\n')

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

/** Changing an entry's times: like the plan, a timed chip of a selected cell opens the dialog. */
const editing = reactive<{ open: boolean; entry: WeekTemplateEntryDto | null }>({ open: false, entry: null })
const editOthers = computed(() => (editing.entry ? cellEntries(editing.entry).filter(other => other.id !== editing.entry!.id) : []))
const isEntryEditable = (entry: WeekTemplateEntryDto) => entry.start !== null && isSelected(entry)
function onEntryClick(entry: WeekTemplateEntryDto, event: MouseEvent) {
  if (!isEntryEditable(entry) || event.shiftKey || event.ctrlKey || event.metaKey) return
  event.stopPropagation()
  Object.assign(editing, { open: true, entry })
}
function onEdit(id: number, times: TemplateEntryTimes) {
  const result = editTemplateEntry(entries.value, id, times, context.value, names.value)
  if ('error' in result) toast.add({ title: result.message, color: 'error' })
  else entries.value = result.entries
}

/** What the template leaves uncovered (Pflichtdienste, opening/closing), live from the draft; saving is never blocked. */
const coverageWarnings = computed(() => templateCoverage(entries.value, columns.value, form.groupId, props.coverage ?? null))
const coverageOf = (weekday: number) => coverageWarnings.value.filter(item => item.weekday === weekday).map(item => item.text)

/**
 * „Andere Vorlagen anzeigen“ (remembered on the device): another template of the facility, read-only below the grid
 * with the same people and days; „Tag übernehmen“ copies one of its days into the draft.
 */
const confirm = useConfirm()
const compare = reactive({
  on: false, list: null as WeekTemplateDto[] | null, id: undefined as number | undefined, template: null as WeekTemplateDetailDto | null,
})
const compareItems = computed(() => (compare.list ?? []).filter(other => other.id !== props.template?.id)
  .map(other => ({ label: other.name, value: other.id })))
const compareNames = computed(() => new Map([...(compare.template?.people ?? []), ...props.staff].map(person => [person.id, person.name])))
const compareByCell = computed(() => Map.groupBy(compare.template?.entries ?? [], templateCellOf))
const compareEntries = (cell: TemplateCell) => compareByCell.value.get(templateCellOf(cell)) ?? []
const compareHidden = computed(() => hiddenTemplateEntries(compare.template?.entries ?? [], shown.value, compareNames.value))
onMounted(() => {
  if (readTemplateCompare()) void setCompare(true)
})
async function setCompare(on: boolean) {
  compare.on = on
  writeTemplateCompare(on)
  if (on && compare.list === null) {
    await run(async () => {
      compare.list = await $fetch<WeekTemplateDto[]>('/api/week-templates')
    })
  }
}
async function pickCompare(id: number | undefined) {
  compare.id = id
  compare.template = null
  if (id === undefined) return
  await run(async () => {
    const loaded = await $fetch<WeekTemplateDetailDto>(`/api/week-templates/${id}`)
    // A later pick wins over a slower earlier one.
    if (compare.id === id) compare.template = loaded
  })
}
async function takeDay(weekday: number) {
  const source = compare.template
  if (!source) return
  // Checked first, so the question comes only for a day that can be taken (an empty one is refused, not emptied).
  const result = copyTemplateDay(entries.value, source.entries, weekday, shown.value, context.value, names.value)
  if ('error' in result) {
    toast.add({ title: result.message, color: result.error === 'template_day_empty' ? 'warning' : 'error' })
    return
  }
  if (dayHasEntries(entries.value, weekday, shown.value)
    && !(await confirm(e.takeDayConfirm(weekdays[weekday]!), { confirmLabel: e.replace }))) return
  entries.value = result.entries
  toast.add({ title: e.takenDay(weekdays[weekday]!), color: 'success' })
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
        <table ref="grid" class="w-full border-collapse text-xs">
          <thead class="bg-gray-100 text-gray-600">
            <tr>
              <th class="sticky left-0 z-10 w-24 border border-gray-200 bg-gray-100 px-2 py-1 text-left">{{ e.weekday }}</th>
              <th v-for="person in columns" :key="person.id" class="min-w-28 border border-gray-200 px-2 py-1">{{ person.name }}</th>
              <th v-for="field in infoFields" :key="field" class="border border-gray-200 px-2 py-1">{{ de.plan[field] }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(day, weekday) in weekdays" :key="day">
              <td class="sticky left-0 z-10 border border-gray-200 bg-gray-50 px-2 py-1 font-medium">
                <span class="inline-flex items-center gap-1">
                  {{ day }}
                  <!-- One warning per line: UTooltip's text is a single line (its content is h-6), so a list in the slot. -->
                  <UTooltip v-if="coverageOf(weekday).length" :ui="{ content: 'h-auto' }">
                    <UIcon
                      name="i-lucide-triangle-alert" class="size-3.5 shrink-0 text-amber-600" role="img"
                      :aria-label="coverageOf(weekday).join('\n')"
                    />
                    <template #content>
                      <ul class="space-y-0.5 py-0.5">
                        <li v-for="(line, index) in coverageOf(weekday)" :key="index">{{ line }}</li>
                      </ul>
                    </template>
                  </UTooltip>
                </span>
              </td>
              <td
                v-for="person in columns" :key="person.id"
                class="cursor-pointer border border-gray-200 px-1 py-1 align-top [-webkit-touch-callout:none] hover:bg-sky-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sky-600"
                :class="cellClass(person, weekday)" :title="quickTitle(person, weekday)"
                :data-cell="templateCellOf({ employeeId: person.id, weekday })"
                :tabindex="templateCellOf({ employeeId: person.id, weekday }) === tabStop ? 0 : -1"
                @focus="focusedCell = templateCellOf({ employeeId: person.id, weekday })"
                @click="onCellClick(person.id, weekday, $event)" @mousedown="quick.mousedown"
                @dblclick="quick.dblclick($event, { employeeId: person.id, weekday })"
                @keydown="quick.keydown($event, { employeeId: person.id, weekday })"
                @pointerdown="quick.pointerdown($event, { employeeId: person.id, weekday })"
                @pointermove="quick.pointermove" @pointerup="quick.pointerup" @pointercancel="quick.pointercancel"
                @contextmenu="quick.contextmenu" @selectstart="quick.selectstart"
              >
                <div class="flex min-h-6 flex-col items-start gap-0.5">
                  <!-- As in the plan: a chip of a selected cell with times opens its dialog (data-quick-skip keeps a double click there). -->
                  <PlanEntryChip
                    v-for="entry in cellEntries({ employeeId: person.id, weekday })" :key="entry.id" :entry="entry" removable
                    :editable="isEntryEditable(entry)" :data-quick-skip="isEntryEditable(entry) || undefined"
                    @remove="onRemove" @click="onEntryClick(entry, $event)"
                  />
                </div>
              </td>
              <!-- Info 1 / Info 2 of the weekday: taken like the plan's info fields (on leaving the field or Enter). -->
              <td v-for="field in infoFields" :key="field" class="min-w-32 border border-gray-200 px-1 py-1 align-top">
                <input
                  :value="infos[weekday]![field]" :maxlength="TEMPLATE_INFO_MAX" :aria-label="`${de.plan[field]} ${day}`"
                  class="w-full rounded border border-transparent bg-transparent px-1 text-xs hover:border-gray-300 focus:border-sky-500 focus:outline-none"
                  @change="infos[weekday]![field] = ($event.target as HTMLInputElement).value.trim()" @keydown="takeFieldOnEnter"
                >
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <section v-if="coverageWarnings.length" class="space-y-2 rounded-lg bg-amber-50 p-4 ring-1 ring-amber-200" aria-live="polite">
        <h3 class="flex items-center gap-1 text-sm font-semibold text-amber-800">
          <UIcon name="i-lucide-triangle-alert" class="size-4" aria-hidden="true" /> {{ e.coverageTitle }}
        </h3>
        <ul class="space-y-0.5 text-sm text-amber-900">
          <li v-for="(item, index) in coverageWarnings" :key="index">{{ item.text }}</li>
        </ul>
        <p class="text-xs text-amber-800">{{ e.coverageHint }}</p>
      </section>

      <section v-if="columns.length" class="space-y-3 rounded-lg bg-white p-4 ring-1 ring-gray-200">
        <USwitch :model-value="compare.on" :label="e.compareToggle" @update:model-value="setCompare($event)" />
        <template v-if="compare.on">
          <p v-if="compare.list && !compareItems.length" class="text-sm text-gray-500">{{ e.compareNone }}</p>
          <UFormField v-else-if="compareItems.length" :label="e.compareSelect" class="w-full sm:w-72">
            <USelect
              :model-value="compare.id" :items="compareItems" :placeholder="e.comparePlaceholder" class="w-full"
              @update:model-value="pickCompare($event as number | undefined)"
            />
          </UFormField>
          <template v-if="compare.template">
            <h3 class="text-sm font-semibold">{{ e.compareTitle(compare.template.name) }}</h3>
            <p class="text-xs text-gray-500">{{ e.compareHint }}</p>
            <div class="overflow-x-auto rounded-lg ring-1 ring-gray-200">
              <table class="w-full border-collapse text-xs">
                <thead class="bg-gray-100 text-gray-600">
                  <tr>
                    <th class="sticky left-0 z-10 w-24 border border-gray-200 bg-gray-100 px-2 py-1 text-left">{{ e.weekday }}</th>
                    <th v-for="person in columns" :key="person.id" class="min-w-28 border border-gray-200 px-2 py-1">{{ person.name }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(day, weekday) in weekdays" :key="day">
                    <td class="sticky left-0 z-10 border border-gray-200 bg-gray-50 px-2 py-1 align-top font-medium">
                      <div class="flex flex-col items-start gap-1">
                        {{ day }}
                        <UButton size="xs" color="neutral" variant="soft" icon="i-lucide-copy-plus" :label="e.takeDay" @click="takeDay(weekday)" />
                      </div>
                    </td>
                    <td v-for="person in columns" :key="person.id" class="border border-gray-200 px-1 py-1 align-top">
                      <div class="flex min-h-6 flex-col items-start gap-0.5">
                        <PlanEntryChip v-for="entry in compareEntries({ employeeId: person.id, weekday })" :key="entry.id" :entry="entry" />
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <UAlert
              v-if="compareHidden.count" color="neutral" variant="subtle" icon="i-lucide-user-x"
              :title="e.compareHidden(compareHidden.names.join(', '), compareHidden.count)"
            />
          </template>
        </template>
      </section>

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
    <PlanQuickTimeEntry v-model:open="quickEntry.open" :reference="quickEntry.reference" @submit="enter" />
    <WeekTemplateEntryModal v-model:open="editing.open" :entry="editing.entry" :others="editOthers" @submit="onEdit" />
    <PlanBreakModal v-model:open="breakOpen" @submit="enter({ kind: 'break', start: $event.start, end: $event.end })" />
  </div>
</template>
