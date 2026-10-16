<script setup lang="ts">
import type { OpeningHours } from '#shared/domain/openingHours'
import type { OpeningHoursDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { fromHoursForm, hasOwnDays, toHoursForm, type HoursForm } from '~/utils/openingHours'

/** Opening hours of the facility and the own hours of each group (Leitung and Träger). */
const { data, refresh } = await useFetch<OpeningHoursDto>('/api/opening-hours', { key: 'opening-hours' })
const { busy, run } = useBusyAction(refresh)
const toast = useToast()
const o = de.openingHours

const facilityForm = ref<HoursForm>(toHoursForm(null))
const groupForms = ref<Record<number, HoursForm>>({})

// What each form was last built from, to tell an untouched form from one with unsaved edits (key: 'facility' or the group id).
const stored = new Map<string, string>()
// The forms just saved: they are rebuilt from the answer, the others keep their unsaved edits.
const saved = new Set<string>()
const keyOf = (groupId?: number) => groupId === undefined ? 'facility' : String(groupId)

function sync(key: string, current: HoursForm | undefined, hours: OpeningHours | null): HoursForm {
  const fresh = toHoursForm(hours)
  const untouched = current === undefined || JSON.stringify(current) === stored.get(key)
  stored.set(key, JSON.stringify(fresh))
  return untouched || saved.has(key) ? fresh : current
}

watch(data, (value) => {
  if (!value) return
  facilityForm.value = sync('facility', facilityForm.value, value.facility)
  groupForms.value = Object.fromEntries(value.groups.map(group => [
    group.groupId, sync(keyOf(group.groupId), groupForms.value[group.groupId], group.hours),
  ]))
  saved.clear()
}, { immediate: true })

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
  const hours = body(facilityForm.value)
  if (hours) put('/api/opening-hours', hours, keyOf())
}

function saveGroup(groupId: number) {
  const hours = body(groupForms.value[groupId]!)
  if (hours) put(`/api/groups/${groupId}/opening-hours`, hours, keyOf(groupId))
}

function removeGroup(groupId: number) {
  put(`/api/groups/${groupId}/opening-hours`, null, keyOf(groupId))
}
</script>

<template>
  <section v-if="data" class="space-y-3 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <h2 class="font-semibold">{{ o.title }}</h2>
    <p class="text-xs text-gray-500">{{ o.hint }}</p>
    <SettingsOpeningHoursEditor v-model="facilityForm" :busy="busy" @save="saveFacility" />

    <div v-if="data.groups.length" class="space-y-2 border-t border-gray-100 pt-3">
      <h3 class="text-sm font-semibold">{{ o.groupsTitle }}</h3>
      <details v-for="group in data.groups" :key="group.groupId" class="rounded border border-gray-200 px-3 py-2">
        <summary class="cursor-pointer text-sm font-medium">
          {{ group.groupName }} – {{ o.groupOwn }}
          <span v-if="hasOwnDays(group.hours)" class="ml-1 text-xs font-normal text-sky-700">({{ o.groupOwnActive }})</span>
        </summary>
        <div class="mt-2 space-y-2">
          <p class="text-xs text-gray-500">{{ o.groupHint }}</p>
          <SettingsOpeningHoursEditor
            v-if="groupForms[group.groupId]" v-model="groupForms[group.groupId]!" :busy="busy"
            :removable="group.hours !== null" @save="saveGroup(group.groupId)" @remove="removeGroup(group.groupId)"
          />
        </div>
      </details>
    </div>
  </section>
</template>
