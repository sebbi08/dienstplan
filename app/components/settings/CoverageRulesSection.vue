<script setup lang="ts">
import { ALL_WEEKDAYS } from '#shared/domain/openingHours'
import { parseTime } from '#shared/domain/time'
import type { CoverageRuleDto, GroupColor, SettingsDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { coverageRuleSections } from '~/utils/coverageRuleSections'
import { groupColorClasses } from '~/utils/groups'
import { weekdaysText } from '~/utils/openingHours'
import { builtRows, mergeRows, optionalTime, timeKey, timeText } from '~/utils/settingsForms'

/** Einstellungen → Dienstplan → Pflichtdienste: the facility's first, then those of each group; a row saves on its own. */
/** groupId 0 = the whole facility (the select needs a non-null value). */
interface RuleForm {
  id: number | null; label: string; start: string; end: string; minCount: number; active: boolean; groupId: number
  /** Weekday mask Mo = 1 … Fr = 16. */
  weekdays: number
}

const { data: settings, refresh } = await useFetch<SettingsDto>('/api/settings', { key: 'settings' })
const run = useAction(refresh)
const toast = useToast()
const confirm = useConfirm()

// Required duties may apply to one group; the choice appears only when the facility has groups.
const { data: groups, hasGroups } = useGroups()
const groupItems = computed(() => [
  { label: de.settings.ruleWholeFacility, value: 0 },
  ...(groups.value ?? []).map(group => ({ label: group.name, value: group.id })),
])

const emptyRule = (): RuleForm => ({ id: null, label: '', start: '', end: '', minCount: 1, active: true, groupId: 0, weekdays: ALL_WEEKDAYS })
const rules = ref<RuleForm[]>([])
const newRule = ref(emptyRule())
// Any save on the page reloads the shared settings: rows with unsaved edits keep them unless they were just saved.
let built = new Map<number, string>()
const justSaved = new Set<number>()
watch(settings, (value) => {
  const fresh = (value?.coverageRules ?? []).map((r: CoverageRuleDto): RuleForm => ({
    id: r.id, label: r.label, start: timeText(r.start), end: timeText(r.end), minCount: r.minCount, active: r.active,
    groupId: r.groupId ?? 0, weekdays: r.weekdays,
  }))
  rules.value = mergeRows(rules.value, built, fresh, justSaved)
  built = builtRows(fresh)
  justSaved.clear()
}, { immediate: true })

function rowDirty(form: RuleForm): boolean {
  if (!form.id) return !sameValue(form, emptyRule())
  const saved = settings.value?.coverageRules.find(rule => rule.id === form.id)
  if (!saved) return false
  return !sameValue(
    [form.label, timeKey(form.start), timeKey(form.end), Number(form.minCount), form.active, form.groupId, form.weekdays],
    [saved.label, saved.start, saved.end, saved.minCount, saved.active, saved.groupId ?? 0, saved.weekdays],
  )
}
useDirty(() => [...rules.value, newRule.value].some(rowDirty))

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

async function saveRule(form: RuleForm) {
  if (!rowDirty(form)) return
  const start = parseTime(form.start)
  const end = optionalTime(form.end)
  if (start === null || end === undefined) return void toast.add({ title: de.settings.invalidTime, color: 'error' })
  if (form.weekdays === 0) return void toast.add({ title: de.settings.ruleWeekdaysMissing, color: 'error' })
  const body = {
    label: form.label, start, end, minCount: form.minCount, active: form.active, weekdays: form.weekdays,
    // Without groups the rule's group is left as it is (always the whole facility then).
    ...(hasGroups.value ? { groupId: form.groupId || null } : {}),
  }
  const id = form.id
  const ok = await run(async () => {
    if (id) {
      await $fetch<unknown>(`/api/coverage-rules/${id}`, { method: 'PUT', body })
      justSaved.add(id)
    }
    else await $fetch<unknown>('/api/coverage-rules', { method: 'POST', body })
  }, de.common.saved)
  if (ok && !form.id) newRule.value = emptyRule()
}

async function deleteRule(form: RuleForm) {
  if (form.id && await confirm(de.common.confirmDelete)) run(() => $fetch<unknown>(`/api/coverage-rules/${form.id}`, { method: 'DELETE' }), de.common.deleted)
}

const cell = 'px-1 py-1'
const textInput = 'w-full min-w-24 rounded border border-gray-300 px-1 py-0.5'
</script>

<template>
  <section class="space-y-2 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <h2 class="font-semibold">{{ de.settings.rules }}</h2>
    <p class="text-xs text-gray-500">{{ de.settings.rulesHint }}</p>
    <div class="overflow-x-auto">
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
              <td :class="cell"><input v-model="row.form.label" maxlength="100" :class="textInput" :aria-label="de.settings.label"></td>
              <td :class="cell"><TimeInput v-model="row.form.start" class="w-20" :aria-label="de.settings.ruleStart" @keydown.enter="saveRule(row.form)" /></td>
              <td :class="cell"><TimeInput v-model="row.form.end" class="w-20" :aria-label="de.settings.ruleEnd" @keydown.enter="saveRule(row.form)" /></td>
              <td :class="cell"><input v-model.number="row.form.minCount" type="number" min="1" max="20" class="w-16 rounded border border-gray-300 px-1 py-0.5" :aria-label="de.settings.minCount"></td>
              <td :class="cell">
                <WorkdayPicker v-model="row.form.weekdays" :aria-label="de.settings.ruleWeekdays" />
                <div v-if="row.form.weekdays !== ALL_WEEKDAYS && row.form.weekdays !== 0" class="mt-0.5 text-xs text-gray-500">{{ weekdaysText(row.form.weekdays) }}</div>
              </td>
              <td v-if="hasGroups" :class="cell">
                <USelect v-model="row.form.groupId" :items="groupItems" class="w-40" :aria-label="de.settings.ruleGroup" />
              </td>
              <td :class="cell" class="text-center"><input v-model="row.form.active" type="checkbox" :aria-label="de.settings.active"></td>
              <td :class="cell" class="whitespace-nowrap text-right">
                <UButton v-if="!row.form.id" size="xs" :label="de.settings.addRule" :disabled="!rowDirty(row.form)" @click="saveRule(row.form)" />
                <UButton v-else-if="rowDirty(row.form)" size="xs" :label="de.common.save" @click="saveRule(row.form)" />
                <UButton v-if="row.form.id" size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" :aria-label="de.common.delete" @click="deleteRule(row.form)" />
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
  </section>
</template>
