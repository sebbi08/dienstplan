<script setup lang="ts">
import { SETUP_AREAS, type SetupChecklist, type SetupItem } from '#shared/domain/setupChecklist'
import { de } from '~/locales/de'

/**
 * „Was noch fehlt“ at the top of the settings: what is not entered yet in the active facility, by area, each with the
 * place to fix it. „Brauchen wir nicht“ hides an item for every Leitung and the Träger of the facility.
 */
const t = de.setupChecklist
const { data, error, refresh } = useFetch<SetupChecklist>('/api/setup-checklist', { key: 'setup-checklist', lazy: true })
const { busy, guard } = useBusy()
const act = useAction(refresh)

const text = (item: SetupItem) => t.items[item.key](item.count)
const byArea = computed(() => SETUP_AREAS
  .map(area => ({ area, items: (data.value?.open ?? []).filter(item => item.area === area) }))
  .filter(entry => entry.items.length > 0))

const path = (item: SetupItem) => `/api/setup-checklist/hidden/${encodeURIComponent(item.key)}`
const hide = (item: SetupItem) => guard(() => act(() => $fetch(path(item), { method: 'PUT' })))
const show = (item: SetupItem) => guard(() => act(() => $fetch(path(item), { method: 'DELETE' })))
</script>

<template>
  <section class="space-y-3 rounded-lg bg-white p-4 ring-1 ring-gray-200" aria-labelledby="setup-checklist-title">
    <h2 id="setup-checklist-title" class="font-semibold">{{ t.title }}</h2>
    <p v-if="error" class="text-sm text-red-700">{{ t.loadFailed }}</p>
    <template v-else-if="data">
      <p v-if="data.open.length === 0" class="flex items-center gap-1.5 text-sm text-green-700">
        <UIcon name="i-lucide-circle-check" class="size-4 shrink-0" aria-hidden="true" />{{ t.allDone }}
      </p>
      <div v-for="entry in byArea" :key="entry.area" class="space-y-1.5">
        <h3 class="text-xs font-semibold uppercase tracking-wide text-gray-500">{{ t.areas[entry.area] }}</h3>
        <ul class="divide-y divide-gray-100 rounded-md ring-1 ring-gray-100">
          <li v-for="item in entry.items" :key="item.key" class="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2">
            <div class="min-w-0 flex-1 basis-56">
              <NuxtLink :to="item.to" class="font-medium text-sky-800 hover:underline">{{ text(item) }}</NuxtLink>
              <p v-if="item.names.length > 0" class="break-words text-xs text-gray-600">
                <template v-for="(named, index) in item.names" :key="named.to">
                  <span v-if="index > 0">, </span><NuxtLink :to="named.to" class="hover:underline">{{ named.name }}</NuxtLink>
                </template>
                <span v-if="item.count > item.names.length"> {{ t.more(item.count - item.names.length) }}</span>
              </p>
            </div>
            <UButton
              size="xs" color="neutral" variant="ghost" :label="t.hide" :aria-label="t.hideLabel(text(item))"
              :disabled="busy" @click="hide(item)"
            />
          </li>
        </ul>
      </div>
      <details v-if="data.hidden.length > 0" class="text-sm">
        <summary class="cursor-pointer text-gray-600">{{ t.hidden(data.hidden.length) }}</summary>
        <p class="mt-1 text-xs text-gray-500">{{ t.hiddenHint }}</p>
        <ul class="mt-1.5 divide-y divide-gray-100 rounded-md ring-1 ring-gray-100">
          <li v-for="item in data.hidden" :key="item.key" class="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2">
            <span class="min-w-0 flex-1 basis-56 text-gray-600">{{ text(item) }}</span>
            <UButton
              size="xs" color="neutral" variant="outline" :label="t.show" :aria-label="t.showLabel(text(item))"
              :disabled="busy" @click="show(item)"
            />
          </li>
        </ul>
      </details>
    </template>
  </section>
</template>
