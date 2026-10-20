<script setup lang="ts">
import { todayIso } from '#shared/domain/dates'
import type { DocMode, DocSettings } from '#shared/domain/reminders'
import type { IsoDate } from '#shared/domain/types'
import type { DocSettingsInput, ReminderSettingsDto, ReminderSettingsInput } from '#shared/types/api'
import { de } from '~/locales/de'
import { formatDate } from '~/utils/format'

/**
 * Leitung and Träger: the lead times of the facility's reminders and the development documentation reminder of the
 * children without group and of each group. Forms are built once from the stored values; a save keeps what is typed
 * in the other rows.
 */
const { data, refresh } = await useFetch<ReminderSettingsDto>('/api/reminder-settings', { key: 'reminder-settings' })
// After a save the stored settings are read again (for „gilt seit“); the forms keep what is typed.
const { busy, run } = useBusyAction(refresh)
const s = de.reminders.settings
// The Träger's group list on this page refreshes the shared groups after a change: pick up new or renamed groups.
const { data: groups } = useGroups()
watch(groups, () => refresh())

/** A documentation form: the setting and the start („Beginn“) shown in interval mode. */
type DocForm = DocSettings & { docSince: string }

/** The form of a stored setting: the start is the stored „gilt seit“ in interval mode, else today (for a switch to it). */
const formOf = (doc: DocSettings, since: IsoDate | null): DocForm =>
  ({ ...doc, docSince: doc.mode === 'interval' && since ? since : todayIso() })

const facility = reactive<Omit<ReminderSettingsInput, 'noGroupDoc'> & { noGroupDoc: DocForm }>({
  noGroupDoc: formOf({ mode: 'off', intervalMonths: 12, leadWeeks: 2 }, null),
  birthdayLeadDays: 7, staffBirthdayLeadDays: 7, leavingLeadWeeks: 4,
})
const groupForms = ref<Record<number, DocForm>>({})

function fill(value: ReminderSettingsDto) {
  Object.assign(facility, {
    noGroupDoc: formOf(value.noGroupDoc, value.noGroupDocSince), birthdayLeadDays: value.birthdayLeadDays,
    staffBirthdayLeadDays: value.staffBirthdayLeadDays, leavingLeadWeeks: value.leavingLeadWeeks,
  })
}

/** What is sent for a form: the start only in interval mode (left empty, the server keeps its automatic „gilt seit“). */
function docBody(form: DocForm): DocSettingsInput {
  const { docSince, ...doc } = form
  return doc.mode === 'interval' && docSince ? { ...doc, docSince } : doc
}

/** Switching a row to interval mode shows its stored start if it already was in interval mode, else today. */
function modeChanged(form: DocForm, stored: { mode: DocMode; since: IsoDate | null } | null, mode: DocMode) {
  if (mode === 'interval') form.docSince = stored?.mode === 'interval' && stored.since ? stored.since : todayIso()
}
// The facility form is filled once (and from each save's answer); new groups get a form, existing forms keep their edits.
let filled = false
watch(data, (value) => {
  if (!value) return
  if (!filled) fill(value)
  filled = true
  for (const group of value.groups) groupForms.value[group.groupId] ??= formOf(group.doc, group.docSince)
}, { immediate: true })

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, index) => ({ label: String(from + index), value: from + index }))
const dayItems = range(0, 30)
const weekItems = range(0, 12)
const monthItems = range(1, 24)
const modeItems = (['off', 'interval', 'birthday'] as DocMode[]).map(mode => ({ label: s.modes[mode], value: mode }))

const hasGroups = computed(() => (data.value?.groups.length ?? 0) > 0)
/** The rows of the documentation table: the children without group first, then the groups in their order. */
const docRows = computed(() => [
  {
    key: 'facility', label: hasGroups.value ? s.noGroup : s.allChildren, form: facility.noGroupDoc, groupId: null as number | null,
    stored: data.value ? { mode: data.value.noGroupDoc.mode, since: data.value.noGroupDocSince } : null,
  },
  ...(data.value?.groups ?? []).flatMap(group => {
    const form = groupForms.value[group.groupId]
    const stored = { mode: group.doc.mode, since: group.docSince }
    return form ? [{ key: `group-${group.groupId}`, label: group.name, form, groupId: group.groupId as number | null, stored }] : []
  }),
])

function saveFacility() {
  run(async () => {
    const body: ReminderSettingsInput = { ...facility, noGroupDoc: docBody(facility.noGroupDoc) }
    const answer = await $fetch<ReminderSettingsDto>('/api/reminder-settings', { method: 'PUT', body })
    fill(answer)
  }, de.common.saved)
}

/** After a group's save (and the refresh), its „Beginn“ shows the day in force, e.g. when the field was left empty. */
async function saveRow(groupId: number | null, form: DocForm) {
  if (groupId === null) return saveFacility()
  const saved = await run(() => $fetch<unknown>(`/api/groups/${groupId}/documentation`, { method: 'PUT', body: docBody(form) }), de.common.saved)
  const group = data.value?.groups.find(stored => stored.groupId === groupId)
  if (saved && group) form.docSince = formOf(group.doc, group.docSince).docSince
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
              <th :class="cell">{{ s.intervalMonths }}</th><th :class="cell">{{ s.start }}</th>
              <th :class="cell">{{ s.leadWeeks }}</th><th />
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in docRows" :key="row.key" class="border-t border-gray-100">
              <td :class="cell" class="font-medium">{{ row.label }}</td>
              <td :class="cell">
                <USelect
                  v-model="row.form.mode" :items="modeItems" class="w-48" :aria-label="`${s.mode} ${row.label}`"
                  @update:model-value="modeChanged(row.form, row.stored, $event)"
                />
                <p
                  v-if="row.stored?.since && row.form.mode === 'birthday' && row.stored.mode === row.form.mode"
                  class="mt-0.5 text-xs text-gray-500"
                >
                  {{ s.since(formatDate(row.stored.since)) }}
                </p>
              </td>
              <td :class="cell">
                <USelect
                  v-if="row.form.mode === 'interval'" v-model="row.form.intervalMonths" :items="monthItems" class="w-24"
                  :aria-label="`${s.intervalMonths} ${row.label}`"
                />
              </td>
              <td :class="cell">
                <UInput
                  v-if="row.form.mode === 'interval'" v-model="row.form.docSince" type="date" class="w-40"
                  :aria-label="`${s.start} ${row.label}`"
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
