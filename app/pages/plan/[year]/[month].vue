<script setup lang="ts">
import type { ApplyMode, CodeDto, EntryInput, MonthPlanDto, NoteField, TemplateDto } from '#shared/types/api'
import { suggestFullShift } from '#shared/domain/suggest'
import { isTargetGapCode } from '#shared/domain/warnings'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'

const route = useRoute()
const year = computed(() => Number(route.params.year))
const month = computed(() => Number(route.params.month))
const { user } = useUserSession()
const isAdmin = computed(() => user.value?.role === 'admin')
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
const breakModal = reactive<{ open: boolean; mode: 'change' | 'add'; entryId: number | null; initial: { start: number; end: number } | null }>({
  open: false, mode: 'add', entryId: null, initial: null,
})

watch([year, month], () => {
  selection.clear()
  selectedDate.value = null
})

const dates = computed(() => plan.value?.days.map(day => day.date) ?? [])
const insertMode = (): ApplyMode => (addMode.value ? 'add' : 'replace')

/**
 * One selected cell with a target gap: with only VZ/Büro, suggest the full shift (F2, M, S) around them;
 * otherwise (or without such a shift) a special shift of exactly the missing time after the last entry.
 */
const gapSuggestion = computed(() => {
  const current = plan.value
  const cell = selection.cells.value.length === 1 ? selection.cells.value[0] : undefined
  if (!current?.admin || !cell) return null
  const gap = current.admin.warnings.find(w => w.type === 'target_gap' && w.employeeId === cell.employeeId && w.date === cell.date)
  if (gap?.type !== 'target_gap') return null
  const dayEntries = current.entries.filter(entry => entry.employeeId === cell.employeeId && entry.date === cell.date)
  if (dayEntries.every(entry => entry.kind === 'break' || isTargetGapCode(entry.codeKey))) {
    const template = suggestFullShift(dayEntries, gap.missingMinutes, current.templates)
    if (template) return { templateId: template.id, start: template.start, end: template.end, shortLabel: template.shortLabel }
  }
  const ends = dayEntries.filter(entry => entry.end !== null).map(entry => entry.end!)
  if (ends.length === 0) return null
  const start = Math.max(...ends)
  const end = Math.ceil((start + gap.missingMinutes) / 5) * 5
  return end <= 24 * 60 ? { templateId: null, start, end, shortLabel: '' } : null
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

function onChangeBreak() {
  const cell = selection.cells.value.length === 1 ? selection.cells.value[0] : undefined
  const work = plan.value?.entries.filter(entry => cell && entry.employeeId === cell.employeeId && entry.date === cell.date
    && entry.kind !== 'break' && entry.start !== null) ?? []
  const entry = work.length === 1 ? work[0]! : null
  if (!entry) {
    toast.add({ title: de.plan.changeBreakHint, color: 'warning' })
    return
  }
  Object.assign(breakModal, {
    open: true, mode: 'change', entryId: entry.id,
    initial: entry.breakStart !== null && entry.breakEnd !== null ? { start: entry.breakStart, end: entry.breakEnd } : null,
  })
}

function onAddBreak() {
  if (!hasSelection()) return
  Object.assign(breakModal, { open: true, mode: 'add', entryId: null, initial: null })
}

function onBreakSubmit(value: { start: number; end: number } | null) {
  if (breakModal.mode === 'change' && breakModal.entryId !== null) {
    const body = { breakStart: value?.start ?? null, breakEnd: value?.end ?? null }
    run(() => $fetch<unknown>(`/api/entries/${breakModal.entryId}/break`, { method: 'PUT', body }))
  }
  else if (value) {
    apply('add', { kind: 'break', start: value.start, end: value.end })
  }
}

function onDiscard(keys: string[]) {
  run(() => $fetch<unknown>(`/api/plan/${year.value}/${month.value}/revert`, { method: 'POST', body: { keys } }), de.plan.discarded)
}

function onFillGap() {
  const gap = gapSuggestion.value
  if (!gap) return
  if (gap.templateId !== null) apply('add', { kind: 'shift', templateId: gap.templateId })
  else apply('add', { kind: 'special', start: gap.start, end: gap.end })
}

function onCellClick(employeeId: number, date: string, event: MouseEvent) {
  if (isAdmin.value) selection.click(employeeId, date, event, dates.value)
}

function onNoteSave(date: string, field: NoteField, value: string) {
  run(() => $fetch<unknown>(`/api/day-notes/${date}`, { method: 'PUT', body: { field, value } }))
}

function onRemoveEntry(id: number) {
  run(() => $fetch<unknown>(`/api/entries/${id}`, { method: 'DELETE' }))
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
        :selected-count="selection.cells.value.length" :gap-suggestion="gapSuggestion"
        @template="onTemplate" @code="onCode" @special="openModal(null)" @clear="onClear" @fill-gap="onFillGap"
        @change-break="onChangeBreak" @add-break="onAddBreak"
      />
      <div class="flex flex-col gap-3 xl:flex-row xl:items-start">
        <div class="min-w-0 flex-1 space-y-3">
          <PlanGrid
            :plan="plan" :selected="selection.selected.value" :editable="isAdmin" :selected-date="selectedDate"
            @cell-click="onCellClick" @date-click="selectedDate = $event" @note-save="onNoteSave" @remove-entry="onRemoveEntry"
          />
          <PlanDayOverviewPanel v-if="selectedDate" :plan="plan" :date="selectedDate" @close="selectedDate = null" />
        </div>
        <PlanSidebar v-if="plan.admin" :plan="plan" class="xl:sticky xl:top-2 xl:w-80" @select-date="selectedDate = $event" />
      </div>
      <PlanTimeEntryModal v-model:open="modalOpen" :code="modalCode" @submit="apply(insertMode(), $event)" />
      <PlanBreakModal v-model:open="breakModal.open" :mode="breakModal.mode" :initial="breakModal.initial" @submit="onBreakSubmit" />
    </template>
    <template v-else>
      <MonthNav :year="year" :month="month" @change="navigate" />
      <UAlert color="warning" variant="soft" :title="errorMessage(error)" />
    </template>
  </div>
</template>
