<script setup lang="ts">
import type { OpeningHours } from '#shared/domain/openingHours'
import type { OpeningHoursDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { fromHoursForm, hasOwnDays, nextForm, toHoursForm, type HoursForm } from '~/utils/openingHours'

/**
 * Opening hours (Leitung and Träger): without `groupId` those of the facility (Einstellungen → Einrichtung), with it the
 * own hours of that group (on the group's page).
 */
const props = defineProps<{ groupId?: number }>()
const { data, refresh } = await useFetch<OpeningHoursDto>('/api/opening-hours', { key: 'opening-hours' })
const { busy, run } = useBusyAction(refresh)
const toast = useToast()
const o = de.openingHours

const facilityForm = ref<HoursForm>(toHoursForm(null))
const groupForms = ref<Record<number, HoursForm>>({})

// What each form was last built from, to tell an untouched form from one with unsaved edits (key: 'facility' or the group id).
const stored = new Map<string, string>()
// The same as hours (times as minutes), to tell whether the save button has anything to save.
const storedHours = reactive(new Map<string, string>())
// The forms just saved: they are rebuilt from the answer, the others keep their unsaved edits.
const saved = new Set<string>()
const keyOf = (groupId?: number) => groupId === undefined ? 'facility' : String(groupId)
/** A form as the hours it saves ("8:00" and "800" are the same), or as typed while a time is unreadable. */
const hoursKey = (form: HoursForm) => JSON.stringify(fromHoursForm(form) ?? form)

function sync(key: string, current: HoursForm | undefined, hours: OpeningHours | null): HoursForm {
  const fresh = toHoursForm(hours)
  const next = nextForm(current, stored.get(key), fresh, saved.has(key))
  stored.set(key, JSON.stringify(fresh))
  storedHours.set(key, hoursKey(fresh))
  return next
}

watch(data, (value) => {
  if (!value) return
  facilityForm.value = sync('facility', facilityForm.value, value.facility)
  groupForms.value = Object.fromEntries(value.groups.map(group => [
    group.groupId, sync(keyOf(group.groupId), groupForms.value[group.groupId], group.hours),
  ]))
  saved.clear()
}, { immediate: true })

const group = computed(() => (props.groupId === undefined ? null : data.value?.groups.find(entry => entry.groupId === props.groupId) ?? null))
const formDirty = (key: string, form: HoursForm | undefined) => !!form && storedHours.has(key) && hoursKey(form) !== storedHours.get(key)
const facilityDirty = computed(() => formDirty('facility', facilityForm.value))
const groupDirty = computed(() => props.groupId !== undefined && formDirty(keyOf(props.groupId), groupForms.value[props.groupId]))
useDirty(() => (props.groupId === undefined ? facilityDirty.value : groupDirty.value))

function body(form: HoursForm): OpeningHours | null {
  const hours = fromHoursForm(form)
  if (hours === null) toast.add({ title: de.settings.invalidTime, color: 'error' })
  return hours
}

/** Sends the hours of one scope; on success that scope's form is rebuilt from the refreshed data. */
function put(url: string, hours: OpeningHours | null, key: string) {
  return run(async () => {
    await $fetch<unknown>(url, { method: 'PUT', body: { hours } })
    saved.add(key)
  }, de.common.saved)
}

function saveFacility() {
  if (!facilityDirty.value) return
  const hours = body(facilityForm.value)
  if (hours) put('/api/opening-hours', hours, keyOf())
}

function saveGroup(groupId: number) {
  if (!groupDirty.value) return
  const hours = body(groupForms.value[groupId]!)
  if (hours) put(`/api/groups/${groupId}/opening-hours`, hours, keyOf(groupId))
}

function removeGroup(groupId: number) {
  put(`/api/groups/${groupId}/opening-hours`, null, keyOf(groupId))
}
</script>

<template>
  <section v-if="data && groupId === undefined" class="space-y-3 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <h2 class="font-semibold">{{ de.settingsAreas.facilityHours }}</h2>
    <p class="text-xs text-gray-500">{{ o.hint }}</p>
    <SettingsOpeningHoursEditor v-model="facilityForm" :busy="busy" :dirty="facilityDirty" @save="saveFacility" />
    <p v-if="data.groups.length" class="text-xs text-gray-500">{{ de.settingsAreas.groupHoursOnGroupPages }}</p>
  </section>
  <section v-else-if="group" class="space-y-3 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <h2 class="font-semibold">
      {{ o.groupOwn }}
      <span v-if="hasOwnDays(group.hours)" class="ml-1 text-xs font-normal text-sky-700">({{ o.groupOwnActive }})</span>
    </h2>
    <p class="text-xs text-gray-500">{{ o.groupHint }}</p>
    <SettingsOpeningHoursEditor
      v-if="groupForms[group.groupId]" v-model="groupForms[group.groupId]!" :busy="busy" :dirty="groupDirty"
      :removable="group.hours !== null" @save="saveGroup(group.groupId)" @remove="removeGroup(group.groupId)"
    />
  </section>
</template>
