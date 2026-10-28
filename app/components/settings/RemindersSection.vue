<script setup lang="ts">
import { todayIso } from '#shared/domain/dates'
import type { DocMode, DocSettings } from '#shared/domain/reminders'
import type { IsoDate } from '#shared/domain/types'
import type { DocSettingsInput, ReminderSettingsDto, ReminderSettingsInput } from '#shared/types/api'
import { de } from '~/locales/de'
import { formatDate } from '~/utils/format'

/**
 * Leitung and Träger: without `groupId` the lead times of the facility's reminders and the development documentation
 * reminder of the children without group (Einstellungen → Kinder → Erinnerungen); with it the development documentation
 * reminder of that group (on the group's page). Forms are built once from the stored values; a save keeps what is
 * typed elsewhere.
 */
const props = defineProps<{ groupId?: number }>()
const { data, refresh } = await useFetch<ReminderSettingsDto>('/api/reminder-settings', { key: 'reminder-settings' })
// After a save the stored settings are read again (for „gilt seit“); the forms keep what is typed.
const { busy, run } = useBusyAction(refresh)
const s = de.reminders.settings
// The Träger's group list refreshes the shared groups after a change: pick up new or renamed groups.
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

interface DocRow {
  key: string; label: string; form: DocForm; groupId: number | null
  stored: { mode: DocMode; since: IsoDate | null; form: DocForm }
}
/** The documentation row shown here: the children without group, or the group of this page. */
const docRow = computed<DocRow | null>(() => {
  const value = data.value
  if (!value) return null
  if (props.groupId === undefined) {
    return {
      key: 'facility', label: hasGroups.value ? s.noGroup : s.allChildren, form: facility.noGroupDoc, groupId: null,
      stored: { mode: value.noGroupDoc.mode, since: value.noGroupDocSince, form: formOf(value.noGroupDoc, value.noGroupDocSince) },
    }
  }
  const group = value.groups.find(entry => entry.groupId === props.groupId)
  const form = group ? groupForms.value[group.groupId] : undefined
  if (!group || !form) return null
  return {
    key: `group-${group.groupId}`, label: group.name, form, groupId: group.groupId,
    stored: { mode: group.doc.mode, since: group.docSince, form: formOf(group.doc, group.docSince) },
  }
})

const rowDirty = computed(() => !!docRow.value && !sameValue(docBody(docRow.value.form), docBody(docRow.value.stored.form)))
const leadDirty = computed(() => !!data.value && props.groupId === undefined && !sameValue(
  [facility.birthdayLeadDays, facility.staffBirthdayLeadDays, facility.leavingLeadWeeks],
  [data.value.birthdayLeadDays, data.value.staffBirthdayLeadDays, data.value.leavingLeadWeeks],
))
useDirty(() => rowDirty.value || leadDirty.value)

function saveFacility() {
  if (!leadDirty.value && !rowDirty.value) return
  run(async () => {
    const body: ReminderSettingsInput = { ...facility, noGroupDoc: docBody(facility.noGroupDoc) }
    const answer = await $fetch<ReminderSettingsDto>('/api/reminder-settings', { method: 'PUT', body })
    fill(answer)
  }, de.common.saved)
}

/** After a group's save (and the refresh), its „Beginn“ shows the day in force, e.g. when the field was left empty. */
async function saveRow(row: DocRow) {
  if (row.groupId === null) return saveFacility()
  if (!rowDirty.value) return
  const groupId = row.groupId
  const saved = await run(() => $fetch<unknown>(`/api/groups/${groupId}/documentation`, { method: 'PUT', body: docBody(row.form) }), de.common.saved)
  const group = data.value?.groups.find(stored => stored.groupId === groupId)
  if (saved && group) row.form.docSince = formOf(group.doc, group.docSince).docSince
}
</script>

<template>
  <section v-if="data && docRow" class="space-y-3 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <template v-if="groupId === undefined">
      <h2 class="font-semibold">{{ s.title }}</h2>
      <p class="text-xs text-gray-500">{{ s.hint }}</p>

      <form class="flex flex-wrap items-end gap-3" @submit.prevent="saveFacility">
        <UFormField :label="s.birthdayLeadDays"><USelect v-model="facility.birthdayLeadDays" :items="dayItems" class="w-24" /></UFormField>
        <UFormField :label="s.staffBirthdayLeadDays"><USelect v-model="facility.staffBirthdayLeadDays" :items="dayItems" class="w-24" /></UFormField>
        <UFormField :label="s.leavingLeadWeeks"><USelect v-model="facility.leavingLeadWeeks" :items="weekItems" class="w-24" /></UFormField>
        <UButton type="submit" :label="de.common.save" :loading="busy" :disabled="busy || !(leadDirty || rowDirty)" />
      </form>
    </template>

    <div :class="groupId === undefined ? 'space-y-2 border-t border-gray-100 pt-3' : 'space-y-2'">
      <component :is="groupId === undefined ? 'h3' : 'h2'" :class="groupId === undefined ? 'text-sm font-semibold' : 'font-semibold'">
        {{ s.docTitle }}<template v-if="groupId === undefined"> – {{ docRow.label }}</template>
      </component>
      <p class="text-xs text-gray-500">{{ s.docHint }}</p>
      <form class="flex flex-wrap items-end gap-3" @submit.prevent="saveRow(docRow)">
        <UFormField :label="s.mode">
          <USelect
            v-model="docRow.form.mode" :items="modeItems" class="w-48" :aria-label="`${s.mode} ${docRow.label}`"
            @update:model-value="modeChanged(docRow.form, docRow.stored, $event)"
          />
        </UFormField>
        <UFormField v-if="docRow.form.mode === 'interval'" :label="s.intervalMonths">
          <USelect v-model="docRow.form.intervalMonths" :items="monthItems" class="w-24" :aria-label="`${s.intervalMonths} ${docRow.label}`" />
        </UFormField>
        <UFormField v-if="docRow.form.mode === 'interval'" :label="s.start">
          <DateTextInput v-model="docRow.form.docSince" class="w-40" :aria-label="`${s.start} ${docRow.label}`" />
        </UFormField>
        <UFormField v-if="docRow.form.mode !== 'off'" :label="s.leadWeeks">
          <USelect v-model="docRow.form.leadWeeks" :items="weekItems" class="w-24" :aria-label="`${s.leadWeeks} ${docRow.label}`" />
        </UFormField>
        <UButton type="submit" :label="de.common.save" :loading="busy" :disabled="busy || !rowDirty" />
      </form>
      <p v-if="docRow.stored.since && docRow.form.mode === 'birthday' && docRow.stored.mode === docRow.form.mode" class="text-xs text-gray-500">
        {{ s.since(formatDate(docRow.stored.since)) }}
      </p>
      <p v-if="groupId === undefined && hasGroups" class="text-xs text-gray-500">{{ de.settingsAreas.groupDocOnGroupPages }}</p>
      <p v-if="groupId !== undefined" class="text-xs text-gray-500">{{ de.settingsAreas.groupDocNoGroupHint }}</p>
    </div>
  </section>
</template>
