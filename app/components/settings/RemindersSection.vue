<script setup lang="ts">
import type { DocMode, DocSettings } from '#shared/domain/reminders'
import type { ReminderSettingsDto, ReminderSettingsInput } from '#shared/types/api'
import { de } from '~/locales/de'

/**
 * Leitung and Träger: the lead times of the facility's reminders and the development documentation reminder of the
 * children without group and of each group. Forms are built once from the stored values; a save keeps what is typed
 * in the other rows.
 */
const { data, refresh } = await useFetch<ReminderSettingsDto>('/api/reminder-settings', { key: 'reminder-settings' })
const { busy, run } = useBusyAction()
const s = de.reminders.settings
// The Träger's group list on this page refreshes the shared groups after a change: pick up new or renamed groups.
const { data: groups } = useGroups()
watch(groups, () => refresh())

const facility = reactive<ReminderSettingsInput>({
  noGroupDoc: { mode: 'off', intervalMonths: 12, leadWeeks: 2 }, birthdayLeadDays: 7, staffBirthdayLeadDays: 7, leavingLeadWeeks: 4,
})
const groupForms = ref<Record<number, DocSettings>>({})

function fill(value: ReminderSettingsDto) {
  Object.assign(facility, {
    noGroupDoc: { ...value.noGroupDoc }, birthdayLeadDays: value.birthdayLeadDays,
    staffBirthdayLeadDays: value.staffBirthdayLeadDays, leavingLeadWeeks: value.leavingLeadWeeks,
  })
}
// The facility form is filled once (and from each save's answer); new groups get a form, existing forms keep their edits.
let filled = false
watch(data, (value) => {
  if (!value) return
  if (!filled) fill(value)
  filled = true
  for (const group of value.groups) groupForms.value[group.groupId] ??= { ...group.doc }
}, { immediate: true })

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, index) => ({ label: String(from + index), value: from + index }))
const dayItems = range(0, 30)
const weekItems = range(0, 12)
const monthItems = range(1, 24)
const modeItems = (['off', 'interval', 'birthday'] as DocMode[]).map(mode => ({ label: s.modes[mode], value: mode }))

const hasGroups = computed(() => (data.value?.groups.length ?? 0) > 0)
/** The rows of the documentation table: the children without group first, then the groups in their order. */
const docRows = computed(() => [
  { key: 'facility', label: hasGroups.value ? s.noGroup : s.allChildren, form: facility.noGroupDoc, groupId: null as number | null },
  ...(data.value?.groups ?? []).flatMap(group => {
    const form = groupForms.value[group.groupId]
    return form ? [{ key: `group-${group.groupId}`, label: group.name, form, groupId: group.groupId as number | null }] : []
  }),
])

function saveFacility() {
  run(async () => {
    const answer = await $fetch<ReminderSettingsDto>('/api/reminder-settings', { method: 'PUT', body: { ...facility, noGroupDoc: { ...facility.noGroupDoc } } })
    fill(answer)
  }, de.common.saved)
}

function saveRow(groupId: number | null, form: DocSettings) {
  if (groupId === null) return saveFacility()
  run(() => $fetch<unknown>(`/api/groups/${groupId}/documentation`, { method: 'PUT', body: { ...form } }), de.common.saved)
}

const cell = 'px-1 py-1'
</script>

<template>
  <section v-if="data" class="space-y-3 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <h2 class="font-semibold">{{ s.title }}</h2>
    <p class="text-xs text-gray-500">{{ s.hint }}</p>

    <form class="flex flex-wrap items-end gap-3" @submit.prevent="saveFacility">
      <UFormField :label="s.birthdayLeadDays"><USelect v-model="facility.birthdayLeadDays" :items="dayItems" class="w-24" /></UFormField>
      <UFormField :label="s.staffBirthdayLeadDays"><USelect v-model="facility.staffBirthdayLeadDays" :items="dayItems" class="w-24" /></UFormField>
      <UFormField :label="s.leavingLeadWeeks"><USelect v-model="facility.leavingLeadWeeks" :items="weekItems" class="w-24" /></UFormField>
      <UButton type="submit" :label="de.common.save" :loading="busy" :disabled="busy" />
    </form>

    <div class="space-y-2 border-t border-gray-100 pt-3">
      <h3 class="text-sm font-semibold">{{ s.docTitle }}</h3>
      <p class="text-xs text-gray-500">{{ s.docHint }}</p>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="text-left text-xs text-gray-500">
            <tr>
              <th :class="cell">{{ s.group }}</th><th :class="cell">{{ s.mode }}</th>
              <th :class="cell">{{ s.intervalMonths }}</th><th :class="cell">{{ s.leadWeeks }}</th><th />
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in docRows" :key="row.key" class="border-t border-gray-100">
              <td :class="cell" class="font-medium">{{ row.label }}</td>
              <td :class="cell"><USelect v-model="row.form.mode" :items="modeItems" class="w-48" :aria-label="`${s.mode} ${row.label}`" /></td>
              <td :class="cell">
                <USelect
                  v-if="row.form.mode === 'interval'" v-model="row.form.intervalMonths" :items="monthItems" class="w-24"
                  :aria-label="`${s.intervalMonths} ${row.label}`"
                />
              </td>
              <td :class="cell">
                <USelect
                  v-if="row.form.mode !== 'off'" v-model="row.form.leadWeeks" :items="weekItems" class="w-24"
                  :aria-label="`${s.leadWeeks} ${row.label}`"
                />
              </td>
              <td :class="cell" class="text-right">
                <UButton size="xs" :label="de.common.save" :disabled="busy" @click="saveRow(row.groupId, row.form)" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>
