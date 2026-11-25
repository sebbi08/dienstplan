<script setup lang="ts">
import { GERMAN_STATES, type GermanState } from '#shared/domain/states'
import type { FacilityDto, HelpoutPairsDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { cardDetails, isCardOpen, readCardState, toggledCardState, writeCardState, type CardState } from '~/utils/facilityCards'

/**
 * Einstellungen → Einrichtung: one card per facility, opening and closing (which are open is kept per device; without a
 * choice only the facility chosen in „Einstellungen für“, marked „gewählt“). In each card: the Stammdaten (name, state,
 * Bavaria flag, Höchstzahl Kinder), the groups and the Kontakt. The Träger edits all of it for every facility and adds
 * new facilities (they copy the Dienste and Pflichtdienste of the first; the new card opens at its Kontakt). The Leitung
 * sees only the own facility's card with its Kontakt, read-only.
 */
const { data, refresh } = useFacilities()
const { can } = useCan()
const manages = computed(() => can('facilities.manage'))
const chosenId = useSettingsFacilityId()

// Open cards: the defaults on the server, the device's choice once mounted.
const cardState = ref<CardState>({})
onMounted(() => {
  cardState.value = readCardState(localStorageOrNull())
})
function localStorageOrNull(): Storage | null {
  try {
    return window.localStorage
  }
  catch {
    return null
  }
}
const isOpen = (facilityId: number) => isCardOpen(cardState.value, facilityId, chosenId.value)
function toggle(facilityId: number) {
  cardState.value = toggledCardState(cardState.value, facilityId, chosenId.value)
  writeCardState(localStorageOrNull(), cardState.value)
}

// The number of groups in each header: the Träger's from each card's group list, the Leitung's own from the groups list.
const groupCounts = reactive<Record<number, number>>({})
const { data: ownGroups } = useGroups()
const groupCountOf = (facilityId: number) => (manages.value ? groupCounts[facilityId] ?? null : ownGroups.value?.length ?? null)
const details = (facility: FacilityDto) => cardDetails(de.states[facility.state], groupCountOf(facility.id), de.facilities.groupCount)

// Help-outs between facilities need the Träger's mutual permission (one pair for both cards).
const { data: pairs, refresh: refreshPairs } = useFetch<HelpoutPairsDto>('/api/helpout-pairs', { key: 'helpout-pairs' })
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
const stored = reactive(new Map<number, Draft>())
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
const facilityDirty = (id: number) => {
  const draft = drafts[id]
  const before = stored.get(id)
  return !!draft && !!before && !sameDraft(draft, before)
}
useDirty(() => newName.value.trim() !== '' || Object.keys(drafts).some(id => facilityDirty(Number(id))))

async function save(id: number) {
  const draft = drafts[id]
  const before = stored.get(id)
  if (!draft || !before || !facilityDirty(id)) return
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
  const created: { id: number | null } = { id: null }
  const ok = await run(async () => {
    created.id = (await $fetch<FacilityDto>('/api/facilities', { method: 'POST', body: { name: newName.value, state: newState.value } })).id
  }, de.common.saved)
  if (!ok || created.id === null) return
  newName.value = ''
  newState.value = 'BW'
  // The new card opens at its Kontakt, to enter the address and phone right away.
  cardState.value = { ...cardState.value, [created.id]: true }
  writeCardState(localStorageOrNull(), cardState.value)
  scrollToWhenShown(`facility-${created.id}-contact`)
}

/** Scrolls to the element once it is rendered (the Kontakt loads after the card); gives up after about two seconds. */
function scrollToWhenShown(elementId: string, tries = 20) {
  const element = document.getElementById(elementId)
  if (element) return void element.scrollIntoView({ behavior: 'smooth', block: 'start' })
  if (tries > 0) setTimeout(() => scrollToWhenShown(elementId, tries - 1), 100)
}
</script>

<template>
  <section class="space-y-3">
    <h2 class="font-semibold">{{ de.facilities.title }}</h2>
    <div v-if="manages" class="space-y-1 rounded-md bg-sky-50 p-3 text-sm text-sky-950 ring-1 ring-sky-200">
      <p>{{ de.helpoutPairs.hint }}</p>
      <template v-if="pairs?.unpaired.length">
        <p class="font-medium">{{ de.helpoutPairs.unpairedTitle }}</p>
        <ul class="list-disc pl-5">
          <li v-for="pair in pairs.unpaired" :key="pair.facilityIds.join('-')">{{ de.helpoutPairs.unpairedPair(pair.names[0], pair.names[1], pair.entries) }}</li>
        </ul>
        <p class="text-xs">{{ de.helpoutPairs.unpairedHint }}</p>
      </template>
    </div>
    <article
      v-for="(facility, index) in data?.facilities ?? []" :id="`facility-card-${facility.id}`" :key="facility.id"
      class="overflow-hidden rounded-lg bg-white ring-1" :class="facility.id === chosenId ? 'ring-sky-300' : 'ring-gray-200'"
    >
      <h3>
        <button
          type="button" class="flex w-full items-center gap-2 px-3 py-2.5 text-left"
          :class="facility.id === chosenId ? 'bg-sky-50' : index % 2 === 1 ? 'bg-gray-50' : 'bg-white'"
          :aria-expanded="isOpen(facility.id)" :aria-controls="`facility-card-${facility.id}-body`" @click="toggle(facility.id)"
        >
          <UIcon name="i-lucide-house" class="size-5 shrink-0 text-gray-500" aria-hidden="true" />
          <span class="min-w-0 flex-1 break-words">
            <span class="font-semibold">{{ facility.name }}</span>
            <span class="text-sm text-gray-600"> · {{ details(facility) }}</span>
          </span>
          <UBadge v-if="facility.id === chosenId" color="info" variant="subtle" size="sm" :label="de.facilities.selected" class="shrink-0" />
          <UIcon :name="isOpen(facility.id) ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="size-5 shrink-0 text-gray-500" aria-hidden="true" />
        </button>
      </h3>
      <div v-show="isOpen(facility.id)" :id="`facility-card-${facility.id}-body`" class="space-y-5 border-t border-gray-100 p-3 sm:p-4">
        <template v-if="manages">
          <div class="space-y-2">
            <h4 class="text-sm font-semibold text-gray-700">{{ de.facilities.masterData }}</h4>
            <form v-if="drafts[facility.id]" class="flex flex-wrap items-end gap-3" @submit.prevent="save(facility.id)">
              <UFormField :label="de.facilities.name"><UInput v-model="drafts[facility.id]!.name" maxlength="80" required /></UFormField>
              <UFormField :label="de.facilities.state"><USelect v-model="drafts[facility.id]!.state" :items="stateItems" class="w-56" /></UFormField>
              <UCheckbox v-if="drafts[facility.id]!.state === 'BY'" v-model="drafts[facility.id]!.assumptionDay" :label="de.facilities.assumptionDay" class="pb-2" />
              <UFormField :label="de.capacity.facilityLabel">
                <UInput v-model="drafts[facility.id]!.capacity" type="number" min="1" max="999" step="1" class="w-28" />
              </UFormField>
              <UButton type="submit" color="neutral" variant="outline" :label="de.common.save" :disabled="!facilityDirty(facility.id)" />
            </form>
          </div>
          <SettingsFacilityGroups :facility-id="facility.id" @count="groupCounts[facility.id] = $event" />
        </template>
        <SettingsFacilityHelpoutPairs
          :facility-id="facility.id" :facilities="data?.facilities ?? []" :pairs="pairs ?? null" :manages="manages" :refresh="refreshPairs"
        />
        <SettingsFacilityContactSection :facility-id="facility.id" />
      </div>
    </article>
    <template v-if="manages">
      <form class="space-y-2 rounded-lg bg-white p-3 ring-1 ring-gray-200 sm:p-4" @submit.prevent="create">
        <h3 class="text-sm font-semibold text-gray-700">{{ de.facilities.addTitle }}</h3>
        <div class="flex flex-wrap items-end gap-3">
          <UFormField :label="de.facilities.name"><UInput v-model="newName" maxlength="80" required /></UFormField>
          <UFormField :label="de.facilities.state"><USelect v-model="newState" :items="stateItems" class="w-56" /></UFormField>
          <UButton type="submit" icon="i-lucide-plus" :label="de.facilities.add" :disabled="!newName.trim()" />
        </div>
        <p class="text-xs text-gray-500">{{ de.facilities.addHint }}</p>
      </form>
      <p class="text-xs text-gray-500">{{ de.capacity.facilityHint }}</p>
      <p class="text-xs text-gray-500">{{ de.facilities.hint }}</p>
      <p class="text-xs text-gray-500">{{ de.groups.hint }}</p>
    </template>
  </section>
</template>
