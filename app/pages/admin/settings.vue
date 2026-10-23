<script setup lang="ts">
import { de } from '~/locales/de'
import { searchSettings, visibleSettingsAreas, type SettingsHit } from '~/utils/settingsAreas'

/**
 * The frame of the settings: the search on top, on a wide screen the areas as a menu on the left, and the open area or
 * group page (child route) next to it. On a phone the overview lists the areas and each page has a link back. Leaving a
 * page with unsaved edits asks first.
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
const hits = computed(() => searchSettings(query.value, viewer.value, groups.value ?? []))
const showHits = computed(() => query.value.trim().length >= 2)

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
        <NuxtPage />
      </div>
    </div>
  </div>
</template>
