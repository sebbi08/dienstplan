<script setup lang="ts">
import { de } from '~/locales/de'
import { areaPath, searchSettings, visibleSettingsAreas, type SettingsHit } from '~/utils/settingsAreas'

/**
 * The frame of the settings: the search on top, on a wide screen the areas as a menu on the left, and the open area or
 * group page (child route) next to it. On a phone the overview lists the areas and each page has a link back. Leaving a
 * page with unsaved edits asks first. The Träger chooses on top whose settings are shown („Einstellungen für“); the
 * header and every other page stay on the active facility.
 */
const { user } = useUserSession()
const viewer = computed(() => ({ isProvider: user.value?.role === 'provider' }))
const areas = computed(() => visibleSettingsAreas(viewer.value))
const route = useRoute()
// A group's page has its own link back to the groups.
const showBack = computed(() => route.path.replace(/\/$/, '') !== '/admin/settings' && !route.path.startsWith('/admin/settings/groups/'))
const isActive = (path: string) => route.path === path || route.path.startsWith(`${path}/`)
const { data: groups } = useGroups()
useUnsavedGuard()

const s = de.settingsAreas
const query = ref('')
const { data: staffing } = useStaffingSettings()
const hits = computed(() => searchSettings(query.value, viewer.value, {
  groups: groups.value ?? [], hasGroupTypes: (staffing.value?.effective.groupTypes?.length ?? 0) > 0,
}))
const showHits = computed(() => query.value.trim().length >= 2)

// „Einstellungen für“ (Träger only, with more than one facility): another facility's settings without switching.
const { data: facilities } = useFacilities()
const chosenFacility = useSettingsFacility()
const shownFacility = useSettingsFacilityId()
const facilityItems = computed(() => (facilities.value?.facilities ?? []).map(facility => ({ label: facility.name, value: facility.id })))
const showFacilityChoice = computed(() => viewer.value.isProvider && facilityItems.value.length > 1)
const facilityName = (id: number | null | undefined) => facilities.value?.facilities.find(facility => facility.id === id)?.name ?? ''
const otherFacilityHint = computed(() => chosenFacility.value === null ? null
  : s.otherFacilityHint(facilityName(chosenFacility.value), facilityName(facilities.value?.activeId)))
const confirm = useConfirm()
// Each choice shows the open page anew, so no form keeps a draft or a list of the facility shown before.
const shownVersion = ref(0)
const pageKey = (target: { path: string }) => `${target.path}|${shownVersion.value}`

async function chooseFacility(facilityId: number) {
  if (!Number.isInteger(facilityId) || facilityId === shownFacility.value) return
  // A group belongs to the facility shown so far: back to the list of groups (asks about unsaved edits itself).
  if (route.path.startsWith('/admin/settings/groups/')) {
    if (await navigateTo(areaPath('groups'))) return
  }
  else if (hasUnsavedChanges() && !await confirm(s.unsavedConfirm, { confirmLabel: s.unsavedSwitch, danger: true })) return
  chosenFacility.value = facilityId === facilities.value?.activeId ? null : facilityId
  await refreshNuxtData()
  shownVersion.value++
}

async function open(hit: SettingsHit | undefined) {
  if (!hit) return
  // A refused navigation (unsaved edits kept) resolves with the failure and leaves the search as it is.
  const failure = await navigateTo(hit.to)
  if (!failure) query.value = ''
}
</script>

<template>
  <div class="mx-auto max-w-6xl space-y-4">
    <h1 class="text-2xl font-semibold">{{ de.settings.title }}</h1>

    <div v-if="showFacilityChoice" class="space-y-2">
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-sm font-medium">{{ s.settingsFor }}:</span>
        <USelect
          :model-value="shownFacility ?? undefined" :items="facilityItems" :aria-label="s.settingsFor" class="w-full sm:w-64"
          @update:model-value="chooseFacility(Number($event))"
        />
      </div>
      <UAlert v-if="otherFacilityHint" color="warning" variant="subtle" icon="i-lucide-building-2" :title="otherFacilityHint" />
    </div>

    <div class="relative max-w-xl">
      <UInput
        v-model="query" icon="i-lucide-search" :placeholder="s.searchPlaceholder" :aria-label="s.search" class="w-full"
        autocomplete="off" @keydown.enter.prevent="open(hits[0])" @keydown.esc="query = ''"
      />
      <div v-if="showHits" class="absolute inset-x-0 top-full z-30 mt-1 max-h-80 overflow-y-auto rounded-md bg-white shadow-lg ring-1 ring-gray-200">
        <ul v-if="hits.length" :aria-label="s.search">
          <li v-for="hit in hits" :key="`${hit.key}-${hit.to}`">
            <button type="button" class="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-gray-50 focus:bg-gray-50 focus:outline-none" @click="open(hit)">
              <span class="text-sm font-medium">{{ hit.title }}</span>
              <span class="text-xs text-gray-500">{{ hit.where }}</span>
            </button>
          </li>
        </ul>
        <p v-else class="px-3 py-2 text-sm text-gray-500">{{ s.noResults }}</p>
      </div>
    </div>

    <div class="md:grid md:grid-cols-[12rem_minmax(0,1fr)] md:gap-6">
      <nav class="hidden md:block" :aria-label="s.menu">
        <ul class="sticky top-16 space-y-1">
          <li v-for="entry in areas" :key="entry.area">
            <NuxtLink
              :to="entry.path" class="block rounded px-3 py-2 text-sm hover:bg-gray-100"
              :class="isActive(entry.path) ? 'bg-white font-medium ring-1 ring-gray-200' : 'text-gray-700'"
            >
              {{ entry.title }}
            </NuxtLink>
          </li>
        </ul>
      </nav>
      <div class="min-w-0 space-y-4">
        <NuxtLink v-if="showBack" to="/admin/settings" class="inline-flex items-center gap-1 text-sm text-sky-700 hover:underline md:hidden">
          <UIcon name="i-lucide-chevron-left" class="size-4" aria-hidden="true" /> {{ s.back }}
        </NuxtLink>
        <NuxtPage :page-key="pageKey" />
      </div>
    </div>
  </div>
</template>
