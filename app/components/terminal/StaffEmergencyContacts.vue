<script setup lang="ts">
import type { TabletStaffEmergencyDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { telHref } from '~/utils/children'
import { errorMessage } from '~/utils/errors'

/**
 * The tile „Notfallkontakte Team“ at the unlocked tablet and the list behind it: the colleagues who agreed, with their
 * contacts as phone links (big touch targets). The server asks for the unlock again on every request (403 tablet_locked
 * otherwise) and returns nothing but names, relations and numbers; a withdrawal is gone with the next opening.
 */
const t = de.staffEmergency
const open = ref(false)
const rows = ref<TabletStaffEmergencyDto[]>([])
const failure = ref('')
const loading = ref(false)

async function show() {
  open.value = true
  failure.value = ''
  loading.value = true
  rows.value = []
  try {
    rows.value = await $fetch<TabletStaffEmergencyDto[]>('/api/terminal/staff-emergency-contacts')
  }
  catch (caught) {
    failure.value = errorMessage(caught)
  }
  finally {
    loading.value = false
  }
}
const phones = (contact: TabletStaffEmergencyDto['contacts'][number]) => [contact.phone, contact.phone2].filter(number => number !== '')
</script>

<template>
  <button
    type="button" class="flex min-h-14 w-full items-center justify-center gap-3 rounded-xl bg-white px-4 py-3 text-lg font-semibold ring-1 ring-gray-200 hover:bg-sky-50"
    @click="show"
  >
    <UIcon name="i-lucide-phone-call" class="size-7 text-sky-700" aria-hidden="true" />
    {{ t.tile }}
  </button>
  <UModal v-model:open="open" :title="t.tabletTitle" :ui="{ content: 'max-w-3xl' }">
    <template #body>
      <p class="mb-3 text-sm text-gray-500">{{ t.tabletHint }}</p>
      <UAlert v-if="failure" color="warning" variant="soft" :title="failure" />
      <p v-else-if="loading" class="text-gray-500">{{ t.loading }}</p>
      <p v-else-if="!rows.length" class="text-gray-600">{{ t.tabletNone }}</p>
      <ul v-else class="divide-y divide-gray-100">
        <li v-for="row in rows" :key="row.employeeId" class="space-y-2 py-3">
          <h3 class="text-lg font-semibold">{{ row.name }}</h3>
          <div v-for="(contact, index) in row.contacts" :key="index" class="flex flex-wrap items-center gap-2">
            <span class="min-w-40 text-base">
              {{ contact.name }}<span v-if="contact.relation" class="text-gray-600"> ({{ contact.relation }})</span>
            </span>
            <a
              v-for="number in phones(contact)" :key="number" :href="telHref(number)" :aria-label="t.call(contact.name)"
              class="inline-flex min-h-12 items-center gap-2 rounded-lg bg-sky-600 px-4 text-lg font-semibold text-white"
            >
              <UIcon name="i-lucide-phone" class="size-5" aria-hidden="true" />{{ number }}
            </a>
          </div>
        </li>
      </ul>
      <div class="mt-4">
        <UButton size="xl" color="neutral" variant="outline" :label="t.close" @click="open = false" />
      </div>
    </template>
  </UModal>
</template>
