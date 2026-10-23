<script setup lang="ts">
import { de } from '~/locales/de'
import { visibleSettingsAreas } from '~/utils/settingsAreas'

/** The overview of the settings: each area with what is in it (on a phone the way into the areas). */
const { user } = useUserSession()
const areas = computed(() => visibleSettingsAreas({ isProvider: user.value?.role === 'provider' }))
</script>

<template>
  <ul class="divide-y divide-gray-100 rounded-lg bg-white ring-1 ring-gray-200" :aria-label="de.settingsAreas.menu">
    <li v-for="entry in areas" :key="entry.area">
      <NuxtLink :to="entry.path" class="flex items-center gap-3 px-4 py-3 hover:bg-gray-50">
        <span class="min-w-0 flex-1">
          <span class="block font-medium">{{ entry.title }}</span>
          <span class="block text-xs text-gray-500">{{ entry.summary }}</span>
        </span>
        <UIcon name="i-lucide-chevron-right" class="size-4 shrink-0 text-gray-400" aria-hidden="true" />
      </NuxtLink>
    </li>
  </ul>
</template>
