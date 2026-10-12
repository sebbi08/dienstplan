<script setup lang="ts">
import type { ApplyMode, CodeDto, EntryDto, EntryInput, MonthPlanDto, NoteField, TemplateDto } from '#shared/types/api'
import { hasPlannedDuty } from '#shared/domain/balance'
import { cellKey } from '#shared/domain/cells'
import { todayIso } from '#shared/domain/dates'
import { isManager } from '#shared/domain/roles'
import { fullShiftOptions } from '#shared/domain/suggest'
import type { TimeSpan } from '#shared/domain/time'
import { isTargetGapCode } from '#shared/domain/warnings'
import type { GapSuggestion } from '~/components/plan/PlanCellMenu.vue'
import type { SickLeaveTarget } from '~/components/sick/SickLeaveModal.vue'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'
import { readGroupFilter, shownGroup, writeGroupFilter } from '~/utils/groups'
import { busyCellKeys, type CellScope, cellScope, isMarker } from '~/utils/helpOuts'

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
const helperOpen = ref(false)
const editOpen = ref(false)
const editEntry = ref<EntryDto | null>(null)
const cellMenu = reactive<{ open: boolean; reference: HTMLElement | null }>({ open: false, reference: null })
const breakOpen = ref(false)
const releaseStatusKey = ref(0) // reloads the message status after a release
const weekTemplate = reactive<{ open: boolean; mode: 'save' | 'apply'; weekStart: string }>({ open: false, mode: 'save', weekStart: '' })

watch([year, month], () => {
  selection.clear()
  cellMenu.open = false
  selectedDate.value = null
})

/**
 * "Gruppe: alle / …" above the plan (only with groups): shows one group's block, the Springer and the helpers.
 * Remembered per browser; read after mounting, so the server-rendered page and the browser agree.
 */
const groupFilter = ref<number | null>(null)
onMounted(() => {
  groupFilter.value = readGroupFilter()
})
const activeGroup = computed(() => (plan.value ? shownGroup(plan.value, groupFilter.value) : null))
const groupItems = computed(() => [
  { label: de.groups.filterAll, value: 0 },
  ...(plan.value?.groups ?? []).map(group => ({ label: group.name, value: group.id })),
])
const groupSelect = computed({
  get: () => activeGroup.value ?? 0,
  set: (value: number) => {
    groupFilter.value = value || null
    writeGroupFilter(groupFilter.value)
    // Cells of a hidden block must not stay selected.
    selection.clear()
    cellMenu.open = false
  },
})

const dates = computed(() => plan.value?.days.map(day => day.date) ?? [])
const insertMode = (): ApplyMode => (addMode.value ? 'add' : 'replace')
/** What fits the selection: helper cells take no absences, help-out days elsewhere only absences. */
const scope = computed((): CellScope => (plan.value ? cellScope(plan.value, selection.cells.value) : 'normal'))
const busy = computed(() => (plan.value ? busyCellKeys(plan.value) : new Set<string>()))

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

/**
 * "Im Dienst erkrankt" fits a cell of the own staff (never a helper's: their home facility marks it) whose day, today or
 * earlier, has a duty and no full-day absence; a help-out elsewhere counts as duty. A marked cell can always be opened.
 */
const today = todayIso()
function canMarkSick(employeeId: number, date: string): boolean {
  const current = plan.value
  if (!current?.admin) return false
  if (current.admin.sickLeaves[cellKey(employeeId, date)]) return true
  const employee = current.employees.find(candidate => candidate.id === employeeId)
  if (date > today || !employee || employee.helpFrom) return false
  return hasPlannedDuty(current.entries.filter(entry => entry.employeeId === employeeId && entry.date === date))
}
const sickLeave = reactive<{ open: boolean; target: SickLeaveTarget | null }>({ open: false, target: null })
function openSickLeave(employeeId: number, date: string) {
  const current = plan.value
  const employee = current?.employees.find(candidate => candidate.id === employeeId)
  if (!current?.admin || !employee) return
  const mark = current.admin.sickLeaves[cellKey(employeeId, date)] ?? null
  Object.assign(sickLeave, { open: true, target: { employeeId, name: employee.name, date, mark } })
}
/** The single selected cell, when it can be marked. */
const sickLeaveCell = computed(() => {
  const cell = selection.cells.value.length === 1 ? selection.cells.value[0] : undefined
  return cell && canMarkSick(cell.employeeId, cell.date) ? cell : null
})

function hasSelection(): boolean {
  if (selection.cells.value.length > 0) return true
  toast.add({ title: de.plan.selectFirst, color: 'warning' })
  return false
}

function apply(mode: ApplyMode, entry: EntryInput | null) {
  if (!hasSelection()) return
  const groupId = entry ? keptGroup() : undefined
  const body = { cells: selection.cells.value, mode, entry: entry && groupId !== undefined ? { ...entry, groupId } : entry }
  run(() => $fetch<unknown>('/api/entries', { method: 'POST', body }))
}

/**
 * Writing one cell keeps the group its duty counts for ("→ Mäuse"), so changing the shift does not move it back to the
 * home group; a range always gets the home group. The server leaves absences and breaks without a group.
 */
function keptGroup(): number | undefined {
  const cells = selection.cells.value
  const current = plan.value
  if (cells.length !== 1 || !current?.groups.length) return undefined
  const cell = cells[0]!
  const groupId = current.entries.find(entry => entry.employeeId === cell.employeeId && entry.date === cell.date
    && entry.groupId !== null && !isMarker(entry, current.facilityId))?.groupId
  // Only a group of this plan: an id left over from another facility would be refused by the server.
  return current.groups.find(group => group.id === groupId)?.id
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
  selection.click(employeeId, date, event, dates.value, key => !busy.value.has(key))
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
  sickLeave: fromMenu(() => {
    if (sickLeaveCell.value) openSickLeave(sickLeaveCell.value.employeeId, sickLeaveCell.value.date)
  }),
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

/** New times (when changed) and the group the duty counts for (when changed; null = the home group). */
function onEditSubmit(id: number, times: TimeSpan | null, groupId: number | null | undefined) {
  run(async () => {
    if (times) await $fetch<unknown>(`/api/entries/${id}`, { method: 'PUT', body: times })
    if (groupId !== undefined) await $fetch<unknown>(`/api/entries/${id}/group`, { method: 'PUT', body: { groupId } })
  })
}

async function onRemoveHelper(helpOutId: number, name: string) {
  if (!await confirm(de.plan.removeHelperConfirm(name), { confirmLabel: de.plan.removeHelperAction })) return
  selection.clear()
  cellMenu.open = false
  run(() => $fetch<unknown>(`/api/help-outs/${helpOutId}`, { method: 'DELETE' }), de.plan.helperRemoved)
}

function openWeekTemplate(mode: 'save' | 'apply', weekStart: string) {
  Object.assign(weekTemplate, { open: true, mode, weekStart })
}

async function release() {
  if (!await confirm(de.plan.releaseConfirm, { confirmLabel: de.plan.release, danger: false })) return
  let result: { notified: string[] } | undefined
  const ok = await run(async () => {
    result = await $fetch<{ notified: string[] }>(`/api/plan/${year.value}/${month.value}/release`, { method: 'POST' })
  })
  if (ok) toast.add({ title: de.notifications.released(result?.notified ?? []), color: 'success' })
  releaseStatusKey.value += 1
}

function navigate(nextYear: number, nextMonth: number) {
  return navigateTo(`/plan/${nextYear}/${nextMonth}`)
}
</script>

<template>
  <div class="space-y-3">
    <template v-if="plan && !error">
      <LevelUpNotice v-if="isAdmin" />
      <RequirementNotice v-if="isAdmin" compact />
      <PlanHeader
        :plan="plan" :is-admin="isAdmin" :group-filter="activeGroup"
        @navigate="navigate" @release="release" @discard="discardOpen = true"
      />
      <PlanReleaseNotifications v-if="isAdmin && plan.release.releasedAt" :key="`${year}-${month}-${releaseStatusKey}`" :year="year" :month="month" />
      <PlanDiscardModal v-if="isAdmin" v-model:open="discardOpen" :plan="plan" @submit="onDiscard" />
      <PlanToolbar
        v-if="isAdmin" v-model:add-mode="addMode"
        :templates="plan.templates" :codes="plan.codes"
        :selected-count="selection.cells.value.length" :scope="scope" :several-facilities="plan.facilityName !== null"
        @template="onTemplate" @code="onCode" @special="openModal(null)" @clear="onClear" @add-helper="helperOpen = true"
      />
      <PlanHelperModal v-if="isAdmin && plan.facilityName !== null" v-model:open="helperOpen" :year="year" :month="month" @done="refresh" />
      <div class="flex flex-col gap-3 xl:flex-row xl:items-start">
        <div class="min-w-0 flex-1 space-y-3">
          <div v-if="plan.groups.length" class="flex items-center gap-2 print:hidden">
            <span class="text-sm text-gray-600">{{ de.groups.filter }}:</span>
            <USelect v-model="groupSelect" :items="groupItems" class="w-48" :aria-label="de.groups.filter" />
          </div>
          <PlanGrid
            :plan="plan" :group-filter="activeGroup"
            :selected="selection.selected.value" :editable="isAdmin" :selected-date="selectedDate"
            @cell-click="onCellClick" @date-click="selectedDate = $event" @note-save="onNoteSave" @remove-entry="onRemoveEntry"
            @edit-entry="onEditEntry" @save-week="openWeekTemplate('save', $event)" @apply-week="openWeekTemplate('apply', $event)"
            @remove-helper="onRemoveHelper" @sick-leave="openSickLeave"
          />
          <PlanDayOverviewPanel v-if="selectedDate" :plan="plan" :date="selectedDate" :group-id="activeGroup" @close="selectedDate = null" />
        </div>
        <PlanSidebar v-if="plan.admin" :plan="plan" class="xl:sticky xl:top-2 xl:w-80" @select-date="selectedDate = $event" />
      </div>
      <PlanTimeEntryModal v-model:open="modalOpen" :code="modalCode" @submit="apply(insertMode(), $event)" />
      <PlanBreakModal v-model:open="breakOpen" @submit="onBreakSubmit" />
      <PlanEntryEditModal
        v-model:open="editOpen" :entry="editEntry" :plan="plan"
        :can-mark-sick="editEntry !== null && canMarkSick(editEntry.employeeId, editEntry.date)"
        @submit="onEditSubmit" @sick-leave="openSickLeave($event.employeeId, $event.date)"
      />
      <SickLeaveModal v-if="isAdmin" v-model:open="sickLeave.open" :target="sickLeave.target" @done="refresh" />
      <PlanWeekTemplateModal
        v-if="isAdmin" v-model:open="weekTemplate.open" :mode="weekTemplate.mode" :week-start="weekTemplate.weekStart"
        :groups="plan.groups" @done="refresh"
      />
      <PlanCellMenu
        v-if="isAdmin" v-model:open="cellMenu.open" v-model:add-mode="addMode" :reference="cellMenu.reference"
        :templates="plan.templates" :codes="plan.codes"
        :selected-count="selection.cells.value.length" :gap-suggestions="gapSuggestions" :scope="scope"
        :can-mark-sick="sickLeaveCell !== null" @sick-leave="menuActions.sickLeave"
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
