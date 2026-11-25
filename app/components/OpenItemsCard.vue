<script setup lang="ts">
import type { MyOpenItemsDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { openItemLinks } from '~/utils/openItems'

/**
 * „Offen für dich“: what waits for the signed-in person (their linked employee), one line per kind with its count and a
 * link to the page where it is done – „Gelesen und verstanden“, Zu unterschreiben, Selbstbeurteilung, Rückmeldungen zu
 * Urlaubsanträgen, Hinweis zum Resturlaub, fällige Pflichttermine. Hidden while nothing is open, for accounts without a
 * linked employee and at the tablet. Loaded again on every page change, like the menu's counts.
 */
const { user } = useUserSession()
const enabled = computed(() => !!user.value && user.value.role !== 'terminal' && user.value.employeeId != null)
const { data, refresh } = useFetch<MyOpenItemsDto>('/api/my/open-items', { key: 'my-open-items', watch: false, immediate: enabled.value, server: false })
const route = useRoute()
watch(() => route.fullPath, () => { if (enabled.value) refresh() })
const links = computed(() => (data.value && enabled.value ? openItemLinks(data.value) : []))
</script>

<template>
  <section
    v-if="links.length" class="rounded-lg bg-sky-50 px-4 py-3 ring-1 ring-sky-200 print:hidden" aria-labelledby="open-items-title"
  >
    <h2 id="open-items-title" class="mb-1.5 text-sm font-semibold text-sky-900">{{ de.openItems.title }}</h2>
    <ul class="flex flex-wrap gap-2">
      <li v-for="link in links" :key="link.key">
        <NuxtLink
          :to="link.to"
          class="inline-flex min-h-10 items-center gap-2 rounded-md bg-white px-3 py-1.5 text-sm text-sky-900 ring-1 ring-sky-200 hover:bg-sky-100 focus-visible:outline-2 focus-visible:outline-primary"
        >
          <UIcon :name="link.icon" class="size-4 shrink-0" aria-hidden="true" />
          <span>{{ link.label }}</span>
          <UIcon name="i-lucide-chevron-right" class="size-4 shrink-0 text-sky-600" aria-hidden="true" />
        </NuxtLink>
      </li>
    </ul>
  </section>
</template>
