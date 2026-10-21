<script setup lang="ts">
import { todayIso } from '#shared/domain/dates'
import { ALL_WEEKDAYS } from '#shared/domain/openingHours'
import { formatDuration, formatTime, parseTime } from '#shared/domain/time'
import { shiftBreakCheck } from '#shared/domain/timeRecords'
import type { CreditMode } from '#shared/domain/types'
import {
  COLOR_KEYS, type AppSettingsDto, type CodeDto, type CoverageRuleDto, type GroupColor, type SettingsDto, type ShiftChangeResult,
  type TemplateDto,
} from '#shared/types/api'
import { de } from '~/locales/de'
import { coverageRuleSections } from '~/utils/coverageRuleSections'
import { groupColorClasses } from '~/utils/groups'
import { weekdaysText } from '~/utils/openingHours'

interface TemplateForm {
  id: number | null; shortLabel: string; label: string; start: string; end: string
  breakStart: string; breakEnd: string; countsAsStaff: boolean; pairsWithPrepTime: boolean; sortOrder: number
}
/** groupId 0 = the whole facility (the select needs a non-null value). */
interface RuleForm {
  id: number | null; label: string; start: string; end: string; minCount: number; active: boolean; groupId: number
  /** Weekday mask Mo = 1 … Fr = 16. */
  weekdays: number
}

const { data: settings, refresh } = await useFetch<SettingsDto>('/api/settings')
const run = useAction(refresh)
const toast = useToast()
const confirm = useConfirm()
const { user } = useUserSession()
// The database download contains contract data and password hashes, so only the Träger gets it.
const isProvider = computed(() => user.value?.role === 'provider')

const { data: appSettings, refresh: refreshApp } = await useFetch<AppSettingsDto>('/api/app-settings')
const trackingFrom = ref('')
watch(appSettings, value => (trackingFrom.value = value?.timeTrackingFrom ?? ''), { immediate: true })
const runApp = useAction(refreshApp)
async function saveTracking() {
  // A start date in the past turns all workdays since then into "stamped time only" (0 h without stamps).
  const date = trackingFrom.value
  if (date && date < todayIso() && date !== appSettings.value?.timeTrackingFrom
    && !await confirm(de.settings.timeTrackingPastConfirm, { confirmLabel: de.common.save, danger: false })) return
  runApp(() => $fetch<unknown>('/api/app-settings', { method: 'PUT', body: { timeTrackingFrom: trackingFrom.value || null } }), de.common.saved)
}

const timeText = (minutes: number | null) => (minutes === null ? '' : formatTime(minutes))
/** Empty = no time; undefined = typed but not a valid time. */
const optionalTime = (value: string) => (value.trim() ? parseTime(value) ?? undefined : null)

const emptyTemplate = (): TemplateForm => ({ id: null, shortLabel: '', label: '', start: '', end: '', breakStart: '', breakEnd: '', countsAsStaff: true, pairsWithPrepTime: false, sortOrder: 99 })
const emptyRule = (): RuleForm => ({ id: null, label: '', start: '', end: '', minCount: 1, active: true, groupId: 0, weekdays: ALL_WEEKDAYS })

// Required duties may apply to one group; the choice appears only when the facility has groups.
// Shared with the Träger's group list below, which refreshes it after a change.
const { data: groups, hasGroups } = useGroups()
const groupItems = computed(() => [
  { label: de.settings.ruleWholeFacility, value: 0 },
  ...(groups.value ?? []).map(group => ({ label: group.name, value: group.id })),
])

const templates = ref<TemplateForm[]>([])
const codes = ref<CodeDto[]>([])
const rules = ref<RuleForm[]>([])
const newTemplate = ref(emptyTemplate())
const newRule = ref(emptyRule())

watch(settings, (value) => {
  templates.value = (value?.templates ?? []).map((t: TemplateDto) => ({
    id: t.id, shortLabel: t.shortLabel, label: t.label, start: timeText(t.start), end: timeText(t.end),
    breakStart: timeText(t.breakStart), breakEnd: timeText(t.breakEnd), countsAsStaff: t.countsAsStaff,
    pairsWithPrepTime: t.pairsWithPrepTime, sortOrder: t.sortOrder,
  }))
  codes.value = (value?.codes ?? []).map(code => ({ ...code }))
  rules.value = (value?.coverageRules ?? []).map((r: CoverageRuleDto) => ({
    id: r.id, label: r.label, start: timeText(r.start), end: timeText(r.end), minCount: r.minCount, active: r.active,
    groupId: r.groupId ?? 0, weekdays: r.weekdays,
  }))
}, { immediate: true })

/**
 * The rule table: the whole facility first, then one block per group (with its colour), each sorted by the saved times
 * (so a row does not jump while it is being edited), the new rule last. Without groups there are no block headings.
 */
interface RuleRow { key: string; heading: string | null; color: GroupColor | null; form: RuleForm | null }
const ruleRows = computed<RuleRow[]>(() => {
  const forms = new Map(rules.value.map(form => [form.id, form]))
  const sections = coverageRuleSections(settings.value?.coverageRules ?? [], groups.value ?? [])
  const headed = hasGroups.value || sections.some(section => section.key !== 'facility')
  const title = (key: string, name: string | null) =>
    name ?? (key === 'facility' ? de.settings.ruleSectionFacility : de.settings.ruleSectionUnknown)
  const rows: RuleRow[] = sections.flatMap(section => [
    ...(headed ? [{ key: section.key, heading: title(section.key, section.name), color: section.color, form: null }] : []),
    ...section.rules.flatMap((rule) => {
      const form = forms.get(rule.id)
      return form ? [{ key: `rule-${rule.id}`, heading: null, color: null, form }] : []
    }),
  ])
  if (headed) rows.push({ key: 'new-heading', heading: de.settings.ruleSectionNew, color: null, form: null })
  rows.push({ key: 'new', heading: null, color: null, form: newRule.value })
  return rows
})

const colorItems = COLOR_KEYS.map(color => ({ label: de.colors[color], value: color }))
const creditItems = (['daily_target', 'timed', 'none'] as CreditMode[]).map(mode => ({ label: de.creditModes[mode], value: mode }))

function invalidTime() {
  toast.add({ title: de.settings.invalidTime, color: 'error' })
}

/** Working time of the (possibly unsaved) shift and the break § 4 ArbZG requires for it; '–' while times are incomplete. */
function breakInfo(form: TemplateForm): { worked: string; text: string; ok: boolean } {
  const start = parseTime(form.start)
  const end = parseTime(form.end)
  const breakStart = optionalTime(form.breakStart)
  const breakEnd = optionalTime(form.breakEnd)
  if (start === null || end === null || end <= start || breakStart === undefined || breakEnd === undefined) {
    return { worked: '–', text: '', ok: true }
  }
  const check = shiftBreakCheck({ start, end, breakStart: breakEnd === null ? null : breakStart, breakEnd: breakStart === null ? null : breakEnd })
  return { worked: `${formatDuration(check.worked)} h`, text: de.settings.legalBreakText(check.required, check.ok), ok: check.ok }
}

async function saveTemplate(form: TemplateForm) {
  const start = parseTime(form.start)
  const end = parseTime(form.end)
  const breakStart = optionalTime(form.breakStart)
  const breakEnd = optionalTime(form.breakEnd)
  if (start === null || end === null || breakStart === undefined || breakEnd === undefined) return invalidTime()
  const body = {
    shortLabel: form.shortLabel, label: form.label, start, end, breakStart, breakEnd,
    countsAsStaff: form.countsAsStaff, pairsWithPrepTime: form.pairsWithPrepTime, sortOrder: form.sortOrder,
  }
  if (!form.id) {
    if (await run(() => $fetch<unknown>('/api/shift-templates', { method: 'POST', body }), de.common.saved)) newTemplate.value = emptyTemplate()
    return
  }
  // Changed times: ask whether existing shifts (from a date on) and templates get them too.
  const saved = settings.value?.templates.find(template => template.id === form.id)
  const timesChanged = saved && [saved.start, saved.end, saved.breakStart, saved.breakEnd].join() !== [start, end, breakStart, breakEnd].join()
  const applyFrom = timesChanged ? await askShiftChange(form.shortLabel || form.label) : null
  if (applyFrom === undefined) return
  let result: ShiftChangeResult | undefined
  await run(async () => {
    result = await $fetch<ShiftChangeResult>(`/api/shift-templates/${form.id}`, { method: 'PUT', body: { ...body, applyFrom } })
  })
  if (result) {
    toast.add({
      title: applyFrom ? de.settings.shiftChangeResult(result.updated, result.skipped, result.inTemplates) : de.common.saved,
      color: 'success',
    })
  }
}

const shiftChange = reactive<{ open: boolean; name: string; resolve: ((value: string | null | undefined) => void) | null }>({
  open: false, name: '', resolve: null,
})
/** Resolves with the date to adjust existing shifts from, null for "new entries only", undefined when cancelled. */
function askShiftChange(name: string): Promise<string | null | undefined> {
  return new Promise((resolve) => {
    Object.assign(shiftChange, { open: true, name, resolve })
  })
}
function settleShiftChange(value: string | null | undefined) {
  shiftChange.resolve?.(value)
  shiftChange.resolve = null
}
watch(() => shiftChange.open, (isOpen) => {
  if (!isOpen) settleShiftChange(undefined) // closed without a choice = cancel (no-op after a choice)
})

async function deleteTemplate(form: TemplateForm) {
  if (form.id && await confirm(de.common.confirmDelete)) run(() => $fetch<unknown>(`/api/shift-templates/${form.id}`, { method: 'DELETE' }), de.common.deleted)
}

async function saveCode(code: CodeDto) {
  const saved = settings.value?.codes.find(candidate => candidate.id === code.id)
  if (saved && saved.creditMode !== code.creditMode
    && !await confirm(de.settings.creditModeConfirm, { confirmLabel: de.common.save, danger: false })) return
  run(() => $fetch<unknown>(`/api/absence-codes/${code.id}`, {
    method: 'PUT', body: { label: code.label, color: code.color, creditMode: code.creditMode },
  }), de.common.saved)
}

async function saveRule(form: RuleForm) {
  const start = parseTime(form.start)
  const end = optionalTime(form.end)
  if (start === null || end === undefined) return invalidTime()
  if (form.weekdays === 0) return void toast.add({ title: de.settings.ruleWeekdaysMissing, color: 'error' })
  const body = {
    label: form.label, start, end, minCount: form.minCount, active: form.active, weekdays: form.weekdays,
    // Without groups the rule's group is left as it is (always the whole facility then).
    ...(hasGroups.value ? { groupId: form.groupId || null } : {}),
  }
  const ok = await run(() => form.id
    ? $fetch<unknown>(`/api/coverage-rules/${form.id}`, { method: 'PUT', body })
    : $fetch<unknown>('/api/coverage-rules', { method: 'POST', body }), de.common.saved)
  if (ok && !form.id) newRule.value = emptyRule()
}

async function deleteRule(form: RuleForm) {
  if (form.id && await confirm(de.common.confirmDelete)) run(() => $fetch<unknown>(`/api/coverage-rules/${form.id}`, { method: 'DELETE' }), de.common.deleted)
}

const cell = 'px-1 py-1'
const textInput = 'w-full rounded border border-gray-300 px-1 py-0.5'
</script>

<template>
  <div class="max-w-6xl space-y-6">
    <h1 class="text-2xl font-semibold">{{ de.settings.title }}</h1>

    <section class="space-y-2 rounded-lg bg-white p-4 ring-1 ring-gray-200">
      <h2 class="font-semibold">{{ de.settings.timeTracking }}</h2>
      <form class="flex flex-wrap items-end gap-3" @submit.prevent="saveTracking">
        <UFormField :label="de.settings.timeTrackingFrom"><UInput v-model="trackingFrom" type="date" /></UFormField>
        <UButton type="submit" :label="de.common.save" />
      </form>
      <p class="text-xs text-gray-500">{{ de.settings.timeTrackingHint }}</p>
      <SettingsTimeMarksForm />
    </section>

    <section class="space-y-2 rounded-lg bg-white p-4 ring-1 ring-gray-200">
      <h2 class="font-semibold">{{ de.settings.templates }}</h2>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="text-left text-xs text-gray-500">
            <tr>
              <th :class="cell">{{ de.settings.shortLabel }}</th><th :class="cell">{{ de.settings.label }}</th>
              <th :class="cell">{{ de.settings.start }}</th><th :class="cell">{{ de.settings.end }}</th>
              <th :class="cell">{{ de.settings.breakStart }}</th><th :class="cell">{{ de.settings.breakEnd }}</th>
              <th :class="cell">{{ de.settings.workingTime }}</th>
              <th :class="cell" :title="de.settings.legalBreakHint">{{ de.settings.legalBreak }}</th>
              <th :class="cell">{{ de.settings.countsAsStaff }}</th>
              <th :class="cell" :title="de.settings.pairsWithPrepTimeHint">{{ de.settings.pairsWithPrepTime }}</th>
              <th :class="cell">{{ de.settings.sortOrder }}</th><th />
            </tr>
          </thead>
          <tbody>
            <tr v-for="form in [...templates, newTemplate]" :key="form.id ?? 'new'" class="border-t border-gray-100">
              <td :class="cell"><input v-model="form.shortLabel" maxlength="10" class="w-14 rounded border border-gray-300 px-1 py-0.5"></td>
              <td :class="cell"><input v-model="form.label" maxlength="50" :class="textInput"></td>
              <td :class="cell"><TimeInput v-model="form.start" class="w-20" @keydown.enter="saveTemplate(form)" /></td>
              <td :class="cell"><TimeInput v-model="form.end" class="w-20" @keydown.enter="saveTemplate(form)" /></td>
              <td :class="cell"><TimeInput v-model="form.breakStart" class="w-20" @keydown.enter="saveTemplate(form)" /></td>
              <td :class="cell"><TimeInput v-model="form.breakEnd" class="w-20" @keydown.enter="saveTemplate(form)" /></td>
              <td :class="cell" class="whitespace-nowrap font-medium">{{ breakInfo(form).worked }}</td>
              <td :class="[cell, breakInfo(form).ok ? 'text-green-700' : 'font-medium text-red-700']" class="whitespace-nowrap">
                {{ breakInfo(form).text }}
              </td>
              <td :class="cell" class="text-center"><input v-model="form.countsAsStaff" type="checkbox"></td>
              <td :class="cell" class="text-center"><input v-model="form.pairsWithPrepTime" type="checkbox" :title="de.settings.pairsWithPrepTimeHint"></td>
              <td :class="cell"><input v-model.number="form.sortOrder" type="number" class="w-14 rounded border border-gray-300 px-1 py-0.5"></td>
              <td :class="cell" class="whitespace-nowrap text-right">
                <UButton size="xs" :label="form.id ? de.common.save : de.settings.addTemplate" @click="saveTemplate(form)" />
                <UButton v-if="form.id" size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" :aria-label="de.common.delete" @click="deleteTemplate(form)" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="text-xs text-gray-500">{{ de.settings.legalBreakHint }}</p>
    </section>

    <SettingsShiftChangeModal v-model:open="shiftChange.open" :name="shiftChange.name" @choose="settleShiftChange" />

    <WeekTemplatesSection />

    <SettingsLeaveModuleSection v-if="isProvider" />

    <SettingsFacilitiesSection v-if="isProvider" />

    <section class="space-y-2 rounded-lg bg-white p-4 ring-1 ring-gray-200">
      <h2 class="font-semibold">{{ de.settings.codes }}</h2>
      <table class="w-full text-sm">
        <thead class="text-left text-xs text-gray-500">
          <tr><th :class="cell">{{ de.settings.label }}</th><th :class="cell">{{ de.settings.color }}</th><th :class="cell">{{ de.settings.creditMode }}</th><th /></tr>
        </thead>
        <tbody>
          <tr v-for="code in codes" :key="code.id" class="border-t border-gray-100">
            <td :class="cell"><input v-model="code.label" maxlength="50" :class="textInput"></td>
            <td :class="cell"><USelect v-model="code.color" :items="colorItems" class="w-32" /></td>
            <td :class="cell"><USelect v-model="code.creditMode" :items="creditItems" class="w-44" /></td>
            <td :class="cell" class="text-right"><UButton size="xs" :label="de.common.save" @click="saveCode(code)" /></td>
          </tr>
        </tbody>
      </table>
    </section>

    <section class="space-y-2 rounded-lg bg-white p-4 ring-1 ring-gray-200">
      <h2 class="font-semibold">{{ de.settings.rules }}</h2>
      <p class="text-xs text-gray-500">{{ de.settings.rulesHint }}</p>
      <table class="w-full text-sm">
        <thead class="text-left text-xs text-gray-500">
          <tr>
            <th :class="cell">{{ de.settings.label }}</th><th :class="cell">{{ de.settings.ruleStart }}</th>
            <th :class="cell">{{ de.settings.ruleEnd }}</th><th :class="cell">{{ de.settings.minCount }}</th>
            <th :class="cell">{{ de.settings.ruleWeekdays }}</th>
            <th v-if="hasGroups" :class="cell">{{ de.settings.ruleGroup }}</th>
            <th :class="cell">{{ de.settings.active }}</th><th />
          </tr>
        </thead>
        <tbody>
          <template v-for="row in ruleRows" :key="row.key">
            <tr v-if="row.heading !== null">
              <td :colspan="hasGroups ? 8 : 7" class="px-2 pt-3 pb-1">
                <span
                  class="inline-block rounded px-2 py-0.5 text-xs font-semibold text-gray-800"
                  :class="row.color ? groupColorClasses[row.color] : 'bg-gray-100'"
                >{{ row.heading }}</span>
              </td>
            </tr>
            <tr v-else-if="row.form" class="border-t border-gray-100">
              <td :class="cell"><input v-model="row.form.label" maxlength="100" :class="textInput"></td>
              <td :class="cell"><TimeInput v-model="row.form.start" class="w-20" @keydown.enter="saveRule(row.form)" /></td>
              <td :class="cell"><TimeInput v-model="row.form.end" class="w-20" @keydown.enter="saveRule(row.form)" /></td>
              <td :class="cell"><input v-model.number="row.form.minCount" type="number" min="1" max="20" class="w-16 rounded border border-gray-300 px-1 py-0.5"></td>
              <td :class="cell">
                <WorkdayPicker v-model="row.form.weekdays" :aria-label="de.settings.ruleWeekdays" />
                <div v-if="row.form.weekdays !== ALL_WEEKDAYS && row.form.weekdays !== 0" class="mt-0.5 text-xs text-gray-500">{{ weekdaysText(row.form.weekdays) }}</div>
              </td>
              <td v-if="hasGroups" :class="cell">
                <USelect v-model="row.form.groupId" :items="groupItems" class="w-40" :aria-label="de.settings.ruleGroup" />
              </td>
              <td :class="cell" class="text-center"><input v-model="row.form.active" type="checkbox"></td>
              <td :class="cell" class="whitespace-nowrap text-right">
                <UButton size="xs" :label="row.form.id ? de.common.save : de.settings.addRule" @click="saveRule(row.form)" />
                <UButton v-if="row.form.id" size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" :aria-label="de.common.delete" @click="deleteRule(row.form)" />
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </section>

    <SettingsOpeningHoursSection />

    <SettingsRequirementTypesSection />

    <SettingsCareTypesSection />

    <SettingsDocumentTypesSection />

    <SettingsSchoolChildrenSection />

    <SettingsTabletSection />

    <SettingsGroupBooksSection />

    <SettingsGroupCapacitySection />

    <SettingsGroupColorsSection />

    <SettingsAttendanceSection />

    <SettingsRemindersSection />

    <SettingsChildRetentionSection v-if="isProvider" />

    <section v-if="isProvider" class="space-y-2 rounded-lg bg-white p-4 ring-1 ring-gray-200">
      <h2 class="font-semibold">{{ de.settings.backup }}</h2>
      <p class="text-sm text-gray-600">{{ de.settings.backupHint }}</p>
      <a href="/api/backup" download class="inline-flex items-center gap-1 rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700">
        <UIcon name="i-lucide-download" /> {{ de.settings.backupDownload }}
      </a>
    </section>
  </div>
</template>
