<script setup lang="ts">
import { GERMAN_STATES, type GermanState } from '#shared/domain/states'
import type { FacilityDto } from '#shared/types/api'
import { de } from '~/locales/de'

/**
 * Träger only: list the facilities, change their name, state, Bavaria flag and Höchstzahl Kinder and add a new one (it copies the Dienste
 * and Pflichtdienste of the first). Under each facility its groups.
 */
const { data, refresh } = useFacilities()
// The state decides the holidays (the list on the closures page reads the same facilities) and the suggested school cutoff.
const run = useAction(async () => {
  await refresh()
  await refreshNuxtData('school-settings')
})
const confirm = useConfirm()

const stateItems = GERMAN_STATES.map(value => ({ label: de.states[value], value }))

// One draft per facility. A refresh only touches drafts that have no unsaved edit (or are new), so typing in one row
// survives saving another.
// The Höchstzahl Kinder as typed ('' = none).
type Draft = Pick<FacilityDto, 'name' | 'state' | 'assumptionDay'> & { capacity: string }
const drafts = reactive<Record<number, Draft>>({})
const stored = new Map<number, Draft>()
const capacityText = (draft: Draft) => String(draft.capacity ?? '').trim()
const sameDraft = (a: Draft, b: Draft) => a.name === b.name && a.state === b.state && a.assumptionDay === b.assumptionDay
  && capacityText(a) === capacityText(b)
function syncDrafts(saved?: number) {
  for (const facility of data.value?.facilities ?? []) {
    const current = drafts[facility.id]
    const previous = stored.get(facility.id)
    const untouched = current === undefined || (previous !== undefined && sameDraft(current, previous))
    const fresh = {
      name: facility.name, state: facility.state, assumptionDay: facility.assumptionDay,
      capacity: facility.capacity === null ? '' : String(facility.capacity),
    }
    if (untouched || facility.id === saved) drafts[facility.id] = { ...fresh }
    stored.set(facility.id, fresh)
  }
}
watch(data, () => syncDrafts(), { immediate: true })
const newName = ref('')
const newState = ref<GermanState>('BW')

async function save(id: number) {
  const draft = drafts[id]
  const before = stored.get(id)
  if (!draft || !before) return
  // Other holidays apply to all days, also past ones: only after an explicit yes.
  const holidaysChange = draft.state !== before.state || (draft.state === 'BY' && draft.assumptionDay !== before.assumptionDay)
  if (holidaysChange && !await confirm(de.facilities.stateChangeConfirm, { confirmLabel: de.facilities.stateChangeAction, danger: false })) return
  const body = { name: draft.name, state: draft.state, assumptionDay: draft.assumptionDay }
  const capacity = capacityText(draft)
  const capacityChanged = capacity !== capacityText(before)
  const ok = await run(async () => {
    await $fetch<unknown>(`/api/facilities/${id}`, { method: 'PUT', body })
    if (capacityChanged) {
      await $fetch<unknown>(`/api/facilities/${id}/capacity`, { method: 'PUT', body: { capacity: capacity === '' ? null : Number(capacity) } })
    }
  }, de.common.saved)
  if (ok) syncDrafts(id)
  // The Summe of the Belegung is compared with it.
  if (capacityChanged) await refreshNuxtData('children-occupancy')
}

async function create() {
  if (await run(() => $fetch<unknown>('/api/facilities', { method: 'POST', body: { name: newName.value, state: newState.value } }), de.common.saved)) {
    newName.value = ''
    newState.value = 'BW'
  }
}
</script>

<template>
  <section class="space-y-3 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <h2 class="font-semibold">{{ de.facilities.title }}</h2>
    <div v-for="facility in data?.facilities ?? []" :key="facility.id" class="space-y-3 border-t border-gray-100 pt-3 first-of-type:border-t-0 first-of-type:pt-0">
      <form v-if="drafts[facility.id]" class="flex flex-wrap items-end gap-3" @submit.prevent="save(facility.id)">
        <UFormField :label="de.facilities.name"><UInput v-model="drafts[facility.id]!.name" maxlength="80" required /></UFormField>
        <UFormField :label="de.facilities.state"><USelect v-model="drafts[facility.id]!.state" :items="stateItems" class="w-56" /></UFormField>
        <UCheckbox v-if="drafts[facility.id]!.state === 'BY'" v-model="drafts[facility.id]!.assumptionDay" :label="de.facilities.assumptionDay" class="pb-2" />
        <UFormField :label="de.capacity.facilityLabel">
          <UInput v-model="drafts[facility.id]!.capacity" type="number" min="1" max="999" step="1" class="w-28" />
        </UFormField>
        <UButton type="submit" color="neutral" variant="outline" :label="de.common.save" />
      </form>
      <SettingsFacilityGroups :facility-id="facility.id" />
    </div>
    <form class="flex flex-wrap items-end gap-3 border-t border-gray-100 pt-3" @submit.prevent="create">
      <UFormField :label="de.facilities.name"><UInput v-model="newName" maxlength="80" required /></UFormField>
      <UFormField :label="de.facilities.state"><USelect v-model="newState" :items="stateItems" class="w-56" /></UFormField>
      <UButton type="submit" icon="i-lucide-plus" :label="de.facilities.add" />
    </form>
    <p class="text-xs text-gray-500">{{ de.capacity.facilityHint }}</p>
    <p class="text-xs text-gray-500">{{ de.facilities.hint }}</p>
    <p class="text-xs text-gray-500">{{ de.groups.hint }}</p>
  </section>
</template>
