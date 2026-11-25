<script setup lang="ts">
import { de } from '~/locales/de'
import { isAreaTabActive, type AreaTab } from '~/utils/areaTabs'

/**
 * The tabs of a page that holds former menu entries (Kalender | Schließzeiten, Mitarbeiter | Bewerbungen & Hospitationen |
 * Krankheitstage, Benutzer | Rechte und Rollen): each tab is a page of its own (or a `?tab=` of it), so the address names
 * it. Hidden with fewer than two tabs.
 */
const props = defineProps<{ tabs: AreaTab[] }>()
const route = useRoute()
const shown = computed(() => (props.tabs.length > 1 ? props.tabs : []))
const keyOf = (tab: AreaTab) => `${tab.to}|${tab.tab ?? ''}`
</script>

<template>
  <nav v-if="shown.length" :aria-label="de.nav.areaTabs" class="flex flex-wrap gap-1 border-b border-gray-200 print:hidden">
    <NuxtLink
      v-for="tab in shown" :key="keyOf(tab)" :to="{ path: tab.to, query: tab.tab ? { tab: tab.tab } : {} }"
      :aria-current="isAreaTabActive(tab, route) ? 'page' : undefined"
      class="-mb-px inline-flex min-h-11 items-center border-b-2 px-3 text-sm focus-visible:outline-2 focus-visible:outline-primary"
      :class="isAreaTabActive(tab, route) ? 'border-sky-600 font-semibold text-sky-800' : 'border-transparent text-gray-600 hover:text-gray-900'"
    >
      {{ tab.label }}
    </NuxtLink>
  </nav>
</template>
