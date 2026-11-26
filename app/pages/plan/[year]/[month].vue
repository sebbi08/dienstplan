<script setup lang="ts">
import type {
  ApplyEntriesResultDto, ApplyMode, CalendarEventDto, CalendarEventSaveDto, CodeDto, EntryDto, EntryInput, EntryTimesInput, MonthPlanDto, NoteField,
  TemplateDto,
} from '#shared/types/api'
import { hasPlannedDuty } from '#shared/domain/balance'
import { cellKey } from '#shared/domain/cells'
import { todayIso } from '#shared/domain/dates'
import { fullShiftOptions } from '#shared/domain/suggest'
import { PLAN_EDITOR_QUERY } from '#shared/domain/tablet'
import { isTargetGapCode } from '#shared/domain/warnings'
import type { GapSuggestion } from '~/components/plan/PlanCellMenu.vue'
import type { SickLeaveTarget } from '~/components/sick/SickLeaveModal.vue'
import { de } from '~/locales/de'
import { entryApplyMode } from '~/utils/applyMode'
import { errorMessage } from '~/utils/errors'
import { isPlanEditorView } from '~/utils/routeAccess'
import { readGroupFilter, shownGroup, writeGroupFilter } from '~/utils/groups'
import { busyCellKeys, type CellScope, cellScope, isMarker } from '~/utils/helpOuts'
import { planWithoutHidden } from '~/utils/longAbsence'

const route = useRoute()
const year = computed(() => Number(route.params.year))
const month = computed(() => Number(route.params.month))
const { can } = useCan()
// At the tablet the person who unlocked it edits the plan („Dienstplan bearbeiten“) with their own account's rights.
const { onTablet, planEdit, editingPlan, lock } = useChildRights()
const toast = useToast()
const confirm = useConfirm()
/**
 * At the tablet: the plan editor's view (opened by „Dienstplan bearbeiten“ with `?editor=1`) while a person edits the
 * plan. The „Dienstplan“ tile's view has no `?editor=1` and stays read-only, also after a reload.
 */
const editorView = computed(() => onTablet.value && editingPlan.value && isPlanEditorView(route.path, route.query))

// At the tablet only the editor's view asks for the editing person's plan (`?editor=1` to the server too); without it
// the server always answers the released plan, whatever unlock may be left on the server.
const { data: plan, error, refresh } = await useFetch<MonthPlanDto>(() => `/api/plan/${year.value}/${month.value}`, {
  query: computed(() => (editorView.value ? { [PLAN_EDITOR_QUERY]: '1' } : {})),
})
// The editor (draft, templates, help-outs, warnings: plan.edit, as the server sends the draft); otherwise read-only. At
// the tablet only in the editor's view and when the server sent the editor's data.
const isAdmin = computed(() => (onTablet.value ? editorView.value && plan.value?.admin != null : can('plan.edit')))
// The tile's view needs no unlock: whatever is left of one (a lock the server has not confirmed) is ended again.
onMounted(() => {
  if (onTablet.value && !isPlanEditorView(route.path, route.query)) void lock()
})
/** „Freigeben“ and „Änderungen verwerfen“: plan.release (at the tablet the editing person's). */
const canRelease = computed(() => (onTablet.value ? planEdit.value?.canRelease === true : can('plan.release')))
/** The employees' personal data (which child is sick): employees.personal (at the tablet the editing person's). */
const seesPersonal = computed(() => (onTablet.value ? planEdit.value?.seesPersonal === true : can('employees.personal')))
/** The sick days right: „Im Dienst erkrankt“ is offered only with it (the server refuses it otherwise). */
const seesSickness = computed(() => (onTablet.value ? planEdit.value?.seesSickness === true : can('employees.sickness')))

/**
 * At the tablet, editing ends with the lock (lock time, „Sperren“, another person, rights gone): the draft goes off the
 * screen at once and the tablet returns to its start page (nothing typed in a dialog is kept; every change already went
 * to the server when it was made).
 */
const lockedOut = ref(false)
/** When the editing session ends however much it is used (from the last status while editing). */
let editEndsAt: number | null = null
watch(() => planEdit.value?.endsAt, (endsAt) => {
  if (endsAt) editEndsAt = Date.parse(endsAt)
}, { immediate: true })
watch(editingPlan, (now, before) => {
  if (!onTablet.value || now || !before || !isPlanEditorView(route.path, route.query)) return
  // Ended by the time limit (not by „Sperren“ or the lock time): say so, the start page follows.
  if (editEndsAt !== null && Date.now() >= editEndsAt - 2_000) {
    toast.add({ title: de.plan.tabletEditTimeUp, color: 'warning', icon: 'i-lucide-clock', duration: 15_000 })
  }
  lockedOut.value = true
  plan.value = undefined
  void navigateTo('/terminal')
})
const run = useAction(refresh)

// --- appointments (the same dialog as in the year calendar; whoever manages the calendar, not at the tablet) ------
const canEditEvents = computed(() => !onTablet.value && can('calendar.edit'))
const eventDialog = reactive<{ open: boolean; event: CalendarEventDto | null; date: string }>({ open: false, event: null, date: '' })
function openNewEvent(date: string) {
  Object.assign(eventDialog, { open: true, event: null, date })
}
function openEvent(event: CalendarEventDto) {
  Object.assign(eventDialog, { open: true, event, date: event.date })
}
async function saveEvent(value: CalendarEventSaveDto) {
  const event = eventDialog.event
  const ok = await run(() => event
    ? $fetch<unknown>(`/api/calendar-events/${event.id}`, { method: 'PUT', body: value })
    : $fetch<unknown>('/api/calendar-events', { method: 'POST', body: value }), de.common.saved)
  if (ok) eventDialog.open = false
}
async function removeEvent(event: CalendarEventDto) {
  if (!await confirm(de.calendar.confirmDelete)) return
  if (await run(() => $fetch<unknown>(`/api/calendar-events/${event.id}`, { method: 'DELETE' }), de.common.deleted)) eventDialog.open = false
}

const selection = usePlanSelection()
const selectedDate = ref<string | null>(null)
const modalOpen = ref(false)
const modalCode = ref<CodeDto | null>(null)
const discardOpen = ref(false)
const helperOpen = ref(false)
const editOpen = ref(false)
const editEntry = ref<EntryDto | null>(null)
const cellMenu = reactive<{ open: boolean; reference: HTMLElement | null }>({ open: false, reference: null })
/** The quick time entry at a cell (see onQuickEntry). */
const quickEntry = reactive<{ open: boolean; reference: HTMLElement | null }>({ open: false, reference: null })
const breakOpen = ref(false)
const releaseStatusKey = ref(0) // reloads the message status after a release
const weekTemplate = reactive<{ open: boolean; mode: 'save' | 'apply'; weekStart: string }>({ open: false, mode: 'save', weekStart: '' })

/**
 * „im Plan zeigen“ in the line below the plan: persons taken out of the plan for a long absence whose columns are shown
 * again in this view (a plan editor gets them sent); another month starts without them.
 */
const revealed = ref<Set<number>>(new Set())
function toggleRevealed(employeeId: number) {
  const next = new Set(revealed.value)
  if (!next.delete(employeeId)) next.add(employeeId)
  revealed.value = next
}
/** The plan as the grid and the day overview show it (planWithoutHidden). */
const gridPlan = computed(() => (plan.value ? planWithoutHidden(plan.value, revealed.value) : null))

watch([year, month], () => {
  selection.clear()
  cellMenu.open = false
  quickEntry.open = false
  selectedDate.value = null
  revealed.value = new Set()
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
    quickEntry.open = false
  },
})

const dates = computed(() => plan.value?.days.map(day => day.date) ?? [])
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
 * Only for whoever may see the sick days (employees.sickness), as the server requires.
 */
const today = todayIso()
function canMarkSick(employeeId: number, date: string): boolean {
  const current = plan.value
  if (!current?.admin || !seesSickness.value) return false
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
  run(async () => {
    const result = await $fetch<ApplyEntriesResultDto>('/api/entries', { method: 'POST', body })
    // „Krank melden“ left days alone that were already „abwesend“ (which ones is not told).
    if (result.skippedAbsent) toast.add({ title: de.plan.reportSickSkipped, color: 'warning' })
  })
}

/** „Krank melden“ (an editor without the sick days right): afterwards only the Leitung or the Träger can change the day. */
async function onReportSick() {
  const codeId = plan.value?.reportSickCodeId
  if (codeId == null || !hasSelection()) return
  if (await confirm(de.plan.reportSickConfirm, { confirmLabel: de.plan.reportSick, danger: false })) {
    apply('replace', { kind: 'code', codeId })
  }
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

/** A duty is added to what the cells hold; a full-day code or a code without times replaces it (see entryApplyMode). */
function onEntry(entry: EntryInput) {
  apply(entryApplyMode(entry, plan.value?.codes ?? []), entry)
}

function onTemplate(template: TemplateDto) {
  onEntry({ kind: 'shift', templateId: template.id })
}

/** Per selected cell the entries it holds: the entry dialog hints at more than 10 hours on the day (§ 3 ArbZG). */
const selectedDayEntries = computed(() => selection.cells.value.map(cell => (plan.value?.entries ?? [])
  .filter(entry => entry.employeeId === cell.employeeId && entry.date === cell.date)))

function openModal(code: CodeDto | null) {
  if (!hasSelection()) return
  modalCode.value = code
  modalOpen.value = true
}

/**
 * „Kind krank“ for one person, with the right to see the children: the dialog asks which child (optional);
 * „Sonderurlaub“ always asks for the reason (optional, „Sonstiges“ with a text).
 */
const codeDetails = reactive<{ open: boolean; code: CodeDto | null; employeeId: number | null; date: string | null }>({
  open: false, code: null, employeeId: null, date: null,
})
function needsDetails(code: CodeDto): boolean {
  const employeeIds = new Set(selection.cells.value.map(cell => cell.employeeId))
  return code.key === 'special_leave' || (code.key === 'child_sick' && employeeIds.size === 1 && seesPersonal.value)
}

function onCode(code: CodeDto) {
  if (code.requiresTimes) openModal(code)
  else if (needsDetails(code)) {
    const first = [...selection.cells.value].sort((a, b) => a.date.localeCompare(b.date))[0]!
    Object.assign(codeDetails, { open: true, code, employeeId: first.employeeId, date: first.date })
  }
  else onEntry({ kind: 'code', codeId: code.id })
}

function onAddBreak() {
  if (hasSelection()) breakOpen.value = true
}

function onBreakSubmit(value: { start: number; end: number }) {
  apply('add', { kind: 'break', start: value.start, end: value.end })
}

function onDiscard(keys: string[]) {
  run(async () => {
    const result = await $fetch<{ reverted: number; notPaired: string[] }>(`/api/plan/${year.value}/${month.value}/revert`, { method: 'POST', body: { keys } })
    // Helper cells of a facility without the Träger's permission stay as they are.
    if (result.notPaired.length) toast.add({ title: de.plan.discardNotPaired(result.notPaired), color: 'warning' })
  }, de.plan.discarded)
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

/**
 * Double click, long press, Enter or F2 on a cell: the quick time entry opens at it, for the cell or the selection it
 * belongs to. What is typed goes the „Sonderdienst“ dialog's way (onEntry: added to the cells, the server names a cell
 * that overlaps).
 */
function onQuickEntry(employeeId: number, date: string, cell: HTMLElement, afterDoubleClick: boolean) {
  if (!isAdmin.value) return
  selection.selectForQuickEntry(employeeId, date, afterDoubleClick)
  cellMenu.open = false
  Object.assign(quickEntry, { open: true, reference: cell })
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
  fillGap: fromMenu(onFillGap), addBreak: fromMenu(onAddBreak), reportSick: fromMenu(onReportSick),
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

/** New times (when changed, or with a changed home-office mark) and the group the duty counts for (when changed; null = the home group). */
function onEditSubmit(id: number, times: EntryTimesInput | null, groupId: number | null | undefined) {
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

/** Another month; the plan editor at the tablet stays the editor there. */
function navigate(nextYear: number, nextMonth: number) {
  return navigateTo({ path: `/plan/${nextYear}/${nextMonth}`, query: editorView.value ? { [PLAN_EDITOR_QUERY]: '1' } : {} })
}
</script>

<template>
  <div class="space-y-3">
    <template v-if="plan && !error && !lockedOut">
      <PlanSetupNotice v-if="isAdmin && !onTablet" />
      <!-- The Leitung's own to-dos (with a linked employee), as on „Mein Dienstplan“; hidden while nothing is open. -->
      <OpenItemsCard v-if="isAdmin && !onTablet" />
      <PlanHeader
        :plan="plan" :is-admin="isAdmin" :can-release="canRelease" :printable="!(onTablet && isAdmin)" :group-filter="activeGroup"
        @navigate="navigate" @release="release" @discard="discardOpen = true"
      />
      <PlanReleaseNotifications v-if="isAdmin && plan.release.releasedAt" :key="`${year}-${month}-${releaseStatusKey}`" :year="year" :month="month" />
      <PlanDiscardModal v-if="isAdmin" v-model:open="discardOpen" :plan="plan" @submit="onDiscard" />
      <PlanToolbar
        v-if="isAdmin"
        :templates="plan.templates" :codes="plan.codes"
        :selected-count="selection.cells.value.length" :scope="scope" :several-facilities="plan.facilityName !== null"
        :report-sick="plan.reportSickCodeId !== null"
        @template="onTemplate" @code="onCode" @special="openModal(null)" @clear="onClear" @add-helper="helperOpen = true"
        @report-sick="onReportSick"
      />
      <PlanHelperModal v-if="isAdmin && plan.facilityName !== null" v-model:open="helperOpen" :year="year" :month="month" @done="refresh" />
      <div class="flex flex-col gap-3 xl:flex-row xl:items-start">
        <div class="min-w-0 flex-1 space-y-3">
          <div v-if="plan.groups.length" class="flex items-center gap-2 print:hidden">
            <span class="text-sm text-gray-600">{{ de.groups.filter }}:</span>
            <USelect v-model="groupSelect" :items="groupItems" class="w-48" :aria-label="de.groups.filter" />
          </div>
          <PlanGrid
            :plan="gridPlan ?? plan" :group-filter="activeGroup" :plain-actuals="onTablet"
            :selected="selection.selected.value" :editable="isAdmin" :selected-date="selectedDate" :events-editable="canEditEvents"
            @event-click="openEvent" @cell-click="onCellClick" @date-click="selectedDate = $event" @note-save="onNoteSave" @remove-entry="onRemoveEntry"
            @edit-entry="onEditEntry" @save-week="openWeekTemplate('save', $event)" @apply-week="openWeekTemplate('apply', $event)"
            @remove-helper="onRemoveHelper" @sick-leave="openSickLeave" @warnings-changed="refresh" @quick-entry="onQuickEntry"
          />
          <PlanLongAbsences :plan="plan" :group-filter="activeGroup" :revealed="revealed" @toggle="toggleRevealed" />
          <PlanDayOverviewPanel
            v-if="selectedDate" :plan="gridPlan ?? plan" :date="selectedDate" :group-id="activeGroup" :can-edit-events="canEditEvents"
            @close="selectedDate = null" @add-event="openNewEvent" @event-click="openEvent"
          />
        </div>
      </div>
      <PlanTimeEntryModal v-model:open="modalOpen" :code="modalCode" :day-entries="selectedDayEntries" @submit="onEntry" />
      <PlanQuickTimeEntry
        v-if="isAdmin" v-model:open="quickEntry.open" :reference="quickEntry.reference" :day-entries="selectedDayEntries"
        @submit="onEntry"
      />
      <PlanBreakModal v-model:open="breakOpen" @submit="onBreakSubmit" />
      <PlanCodeDetailsModal
        v-model:open="codeDetails.open" :code="codeDetails.code" :employee-id="codeDetails.employeeId" :date="codeDetails.date"
        @submit="onEntry"
      />
      <PlanEntryEditModal
        v-model:open="editOpen" :entry="editEntry" :plan="plan"
        :can-mark-sick="editEntry !== null && canMarkSick(editEntry.employeeId, editEntry.date)"
        @submit="onEditSubmit" @sick-leave="openSickLeave($event.employeeId, $event.date)"
      />
      <CalendarEventDialog
        v-if="canEditEvents" v-model:open="eventDialog.open" :event="eventDialog.event" :date="eventDialog.date"
        @save="saveEvent" @remove="eventDialog.event && removeEvent(eventDialog.event)"
      />
      <SickLeaveModal v-if="isAdmin" v-model:open="sickLeave.open" :target="sickLeave.target" @done="refresh" />
      <PlanWeekTemplateModal
        v-if="isAdmin" v-model:open="weekTemplate.open" :mode="weekTemplate.mode" :week-start="weekTemplate.weekStart"
        :groups="plan.groups" @done="refresh"
      />
      <PlanCellMenu
        v-if="isAdmin" v-model:open="cellMenu.open" :reference="cellMenu.reference"
        :templates="plan.templates" :codes="plan.codes"
        :selected-count="selection.cells.value.length" :gap-suggestions="gapSuggestions" :scope="scope"
        :can-mark-sick="sickLeaveCell !== null" :report-sick="plan.reportSickCodeId !== null" @sick-leave="menuActions.sickLeave"
        @template="menuActions.template" @code="menuActions.code" @special="menuActions.special" @clear="menuActions.clear"
        @fill-gap="menuActions.fillGap" @add-break="menuActions.addBreak" @report-sick="menuActions.reportSick"
      />
    </template>
    <template v-else-if="!lockedOut">
      <MonthNav :year="year" :month="month" @change="navigate" />
      <UAlert color="warning" variant="soft" :title="errorMessage(error)" />
    </template>
  </div>
</template>
