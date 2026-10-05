<script setup lang="ts">
import type { ApplyMode, CodeDto, EntryDto, EntryInput, MonthPlanDto, NoteField, TemplateDto } from '#shared/types/api'
import { isManager } from '#shared/domain/roles'
import { fullShiftOptions } from '#shared/domain/suggest'
import type { TimeSpan } from '#shared/domain/time'
import { isTargetGapCode } from '#shared/domain/warnings'
import type { GapSuggestion } from '~/components/plan/PlanCellMenu.vue'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'

const route = useRoute()
const year = computed(() => Number(route.params.year))
const month = computed(() => Number(route.params.month))
const { user } = useUserSession()
const isAdmin = computed(() => isManager(user.value?.role))
const toast = useToast()
const confirm = useConfirm()

const { data: plan, error, refresh } = await useFetch<MonthPlanDto>(() => `/api/plan/${year.value}/${month.value}`)
const run = useAction(refresh)
const selection = usePlanSelection()
const addMode = ref(false)
const selectedDate = ref<string | null>(null)
const modalOpen = ref(false)
const modalCode = ref<CodeDto | null>(null)
const discardOpen = ref(false)
const editOpen = ref(false)
const editEntry = ref<EntryDto | null>(null)
const cellMenu = reactive<{ open: boolean; reference: HTMLElement | null }>({ open: false, reference: null })
const breakOpen = ref(false)
const weekTemplate = reactive<{ open: boolean; mode: 'save' | 'apply'; weekStart: string }>({ open: false, mode: 'save', weekStart: '' })

watch([year, month], () => {
  selection.clear()
  cellMenu.open = false
  selectedDate.value = null
})

const dates = computed(() => plan.value?.days.map(day => day.date) ?? [])
const insertMode = (): ApplyMode => (addMode.value ? 'add' : 'replace')

/**
 * One selected cell with a target gap: with only VZ/Büro, offer every full shift (F2, M, S) around them;
 * otherwise (or without such a shift) a special shift of exactly the missing time after the last entry.
 */
const gapSuggestions = computed((): GapSuggestion[] => {
  const current = plan.value
  const cell = selection.cells.value.length === 1 ? selection.cells.value[0] : undefined
  if (!current?.admin || !cell) return []
  const gap = current.admin.warnings.find(w => w.type === 'target_gap' && w.employeeId === cell.employeeId && w.date === cell.date)
  if (gap?.type !== 'target_gap') return []
  const dayEntries = current.entries.filter(entry => entry.employeeId === cell.employeeId && entry.date === cell.date)
  if (dayEntries.every(entry => entry.kind === 'break' || isTargetGapCode(entry.codeKey))) {
    const options = fullShiftOptions(dayEntries, current.templates)
    if (options.length > 0) {
      return options.map(template => ({ templateId: template.id, start: template.start, end: template.end, shortLabel: template.shortLabel }))
    }
  }
  const ends = dayEntries.filter(entry => entry.end !== null).map(entry => entry.end!)
  if (ends.length === 0) return []
  const start = Math.max(...ends)
  const end = Math.ceil((start + gap.missingMinutes) / 5) * 5
  return end <= 24 * 60 ? [{ templateId: null, start, end, shortLabel: '' }] : []
})

function hasSelection(): boolean {
  if (selection.cells.value.length > 0) return true
  toast.add({ title: de.plan.selectFirst, color: 'warning' })
  return false
}

function apply(mode: ApplyMode, entry: EntryInput | null) {
  if (!hasSelection()) return
  run(() => $fetch<unknown>('/api/entries', { method: 'POST', body: { cells: selection.cells.value, mode, entry } }))
}

async function onClear() {
  if (hasSelection() && await confirm(de.plan.clearConfirm, { confirmLabel: de.plan.clear })) apply('clear', null)
}

function onTemplate(template: TemplateDto) {
  apply(insertMode(), { kind: 'shift', templateId: template.id })
}

function openModal(code: CodeDto | null) {
  if (!hasSelection()) return
  modalCode.value = code
  modalOpen.value = true
}

function onCode(code: CodeDto) {
  if (code.requiresTimes) openModal(code)
  else apply(insertMode(), { kind: 'code', codeId: code.id })
}

function onAddBreak() {
  if (hasSelection()) breakOpen.value = true
}

function onBreakSubmit(value: { start: number; end: number }) {
  apply('add', { kind: 'break', start: value.start, end: value.end })
}

function onDiscard(keys: string[]) {
  run(() => $fetch<unknown>(`/api/plan/${year.value}/${month.value}/revert`, { method: 'POST', body: { keys } }), de.plan.discarded)
}

function onFillGap(gap: GapSuggestion) {
  if (gap.templateId !== null) apply('add', { kind: 'shift', templateId: gap.templateId })
  else apply('add', { kind: 'special', start: gap.start, end: gap.end })
}

function onCellClick(employeeId: number, date: string, event: MouseEvent) {
  if (!isAdmin.value) return
  selection.click(employeeId, date, event, dates.value)
  cellMenu.reference = (event.target as HTMLElement).closest('td')
  cellMenu.open = selection.cells.value.length > 0
}

/** Runs an action of the cell menu after closing it, so a dialog it opens gets the focus. */
function fromMenu<A extends unknown[]>(action: (...args: A) => unknown) {
  return (...args: A) => {
    cellMenu.open = false
    action(...args)
  }
}
const menuActions = {
  template: fromMenu(onTemplate), code: fromMenu(onCode), special: fromMenu(() => openModal(null)), clear: fromMenu(onClear),
  fillGap: fromMenu(onFillGap), addBreak: fromMenu(onAddBreak),
}

function onNoteSave(date: string, field: NoteField, value: string) {
  run(() => $fetch<unknown>(`/api/day-notes/${date}`, { method: 'PUT', body: { field, value } }))
}

function onRemoveEntry(id: number) {
  run(() => $fetch<unknown>(`/api/entries/${id}`, { method: 'DELETE' }))
}

function onEditEntry(entry: EntryDto) {
  editEntry.value = entry
  editOpen.value = true
}

function onEditSubmit(id: number, times: TimeSpan) {
  run(() => $fetch<unknown>(`/api/entries/${id}`, { method: 'PUT', body: times }))
}

function openWeekTemplate(mode: 'save' | 'apply', weekStart: string) {
  Object.assign(weekTemplate, { open: true, mode, weekStart })
}

async function release() {
  if (!await confirm(de.plan.releaseConfirm, { confirmLabel: de.plan.release, danger: false })) return
  run(() => $fetch<unknown>(`/api/plan/${year.value}/${month.value}/release`, { method: 'POST' }), de.plan.releasedToast)
}

function navigate(nextYear: number, nextMonth: number) {
  return navigateTo(`/plan/${nextYear}/${nextMonth}`)
}
</script>

<template>
  <div class="space-y-3">
    <template v-if="plan && !error">
      <PlanHeader :plan="plan" :is-admin="isAdmin" @navigate="navigate" @release="release" @discard="discardOpen = true" />
      <PlanDiscardModal v-if="isAdmin" v-model:open="discardOpen" :plan="plan" @submit="onDiscard" />
      <PlanToolbar
        v-if="isAdmin" v-model:add-mode="addMode"
        :templates="plan.templates" :codes="plan.codes"
        :selected-count="selection.cells.value.length"
        @template="onTemplate" @code="onCode" @special="openModal(null)" @clear="onClear"
      />
      <div class="flex flex-col gap-3 xl:flex-row xl:items-start">
        <div class="min-w-0 flex-1 space-y-3">
          <PlanGrid
            :plan="plan" :selected="selection.selected.value" :editable="isAdmin" :selected-date="selectedDate"
            @cell-click="onCellClick" @date-click="selectedDate = $event" @note-save="onNoteSave" @remove-entry="onRemoveEntry"
            @edit-entry="onEditEntry" @save-week="openWeekTemplate('save', $event)" @apply-week="openWeekTemplate('apply', $event)"
          />
          <PlanDayOverviewPanel v-if="selectedDate" :plan="plan" :date="selectedDate" @close="selectedDate = null" />
        </div>
        <PlanSidebar v-if="plan.admin" :plan="plan" class="xl:sticky xl:top-2 xl:w-80" @select-date="selectedDate = $event" />
      </div>
      <PlanTimeEntryModal v-model:open="modalOpen" :code="modalCode" @submit="apply(insertMode(), $event)" />
      <PlanBreakModal v-model:open="breakOpen" @submit="onBreakSubmit" />
      <PlanEntryEditModal v-model:open="editOpen" :entry="editEntry" @submit="onEditSubmit" />
      <PlanWeekTemplateModal
        v-if="isAdmin" v-model:open="weekTemplate.open" :mode="weekTemplate.mode" :week-start="weekTemplate.weekStart" @done="refresh"
      />
      <PlanCellMenu
        v-if="isAdmin" v-model:open="cellMenu.open" v-model:add-mode="addMode" :reference="cellMenu.reference"
        :templates="plan.templates" :codes="plan.codes"
        :selected-count="selection.cells.value.length" :gap-suggestions="gapSuggestions"
        @template="menuActions.template" @code="menuActions.code" @special="menuActions.special" @clear="menuActions.clear"
        @fill-gap="menuActions.fillGap" @add-break="menuActions.addBreak"
      />
    </template>
    <template v-else>
      <MonthNav :year="year" :month="month" @change="navigate" />
      <UAlert color="warning" variant="soft" :title="errorMessage(error)" />
    </template>
  </div>
</template>
