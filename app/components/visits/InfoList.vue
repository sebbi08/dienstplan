<script setup lang="ts">
import { INFO_VISIT_STATUSES } from '#shared/domain/visits'
import { todayIso } from '#shared/domain/dates'
import type { InfoVisitListItemDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'
import { formatDate } from '~/utils/format'
import { ALL_STATUSES, emptyInfoVisitForm, filterInfoVisits, infoVisitBody, infoVisitName } from '~/utils/visits'

/**
 * Kinder → Planung → „Infogespräche“ (visits.manage): the facility's info visits with families, searchable and filtered by
 * status; „Neues Infogespräch“ asks the essentials and opens the visit's page.
 */
const t = de.visits
const toast = useToast()
const { data, error, refresh } = await useFetch<InfoVisitListItemDto[]>('/api/info-visits', { key: 'info-visits', default: () => [] })
const query = ref('')
const status = ref(ALL_STATUSES)
const statusItems = [{ label: t.allStatuses, value: ALL_STATUSES }, ...INFO_VISIT_STATUSES.map(value => ({ label: t.infoStatus[value], value }))]
const shown = computed(() => filterInfoVisits(data.value, query.value, status.value))

const createOpen = ref(false)
const form = reactive(emptyInfoVisitForm(todayIso()))
const saving = ref(false)
function startCreate() {
  Object.assign(form, emptyInfoVisitForm(todayIso()))
  createOpen.value = true
}
async function create() {
  if (saving.value) return
  saving.value = true
  try {
    const { id } = await $fetch<{ id: number }>('/api/info-visits', { method: 'POST', body: infoVisitBody(form) })
    createOpen.value = false
    await refresh()
    await navigateTo(`/children/info-visits/${id}`)
  }
  catch (failure) {
    toast.add({ title: errorMessage(failure), color: 'error' })
  }
  finally {
    saving.value = false
  }
}
const badge = (value: InfoVisitListItemDto['status']) =>
  (value === 'open' ? 'bg-sky-50 text-sky-800' : value === 'waitlisted' ? 'bg-green-50 text-green-800' : 'bg-gray-100 text-gray-600')
</script>

<template>
  <div class="space-y-3">
    <MoreHint class="text-sm text-gray-600" :text="t.intro" :more="t.introMore" />
    <div class="flex flex-wrap items-end gap-2">
      <UFormField :label="t.search" class="min-w-56 flex-1 sm:flex-none">
        <UInput v-model="query" icon="i-lucide-search" :placeholder="t.searchPlaceholder" class="w-full" />
      </UFormField>
      <UFormField :label="t.statusFilter">
        <USelect v-model="status" :items="statusItems" class="w-56" />
      </UFormField>
      <UButton class="sm:ml-auto" icon="i-lucide-plus" :label="t.newInfo" @click="startCreate" />
    </div>
    <p v-if="error" class="text-sm text-red-700">{{ errorMessage(error) }}</p>
    <p v-else-if="!data.length" class="text-sm text-gray-500">{{ t.emptyInfo }}</p>
    <p v-else-if="!shown.length" class="text-sm text-gray-500">{{ t.noMatch }}</p>
    <ul v-else class="divide-y divide-gray-100 overflow-hidden rounded-lg bg-white text-sm ring-1 ring-gray-200">
      <li v-for="visit in shown" :key="visit.id">
        <NuxtLink :to="`/children/info-visits/${visit.id}`" class="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 hover:bg-gray-50">
          <span class="w-24 shrink-0 text-gray-600">{{ formatDate(visit.visitDate) }}</span>
          <span class="min-w-0 flex-1 basis-48">
            <span class="font-medium">{{ infoVisitName(visit) }}</span>
            <span v-if="visit.childFirstName || visit.childLastName" class="text-gray-600"> · {{ `${visit.childFirstName} ${visit.childLastName}`.trim() }}</span>
            <span v-if="visit.guidedBy" class="block text-xs text-gray-500">{{ t.fields.guidedBy }}: {{ visit.guidedBy }}</span>
          </span>
          <span class="text-xs text-gray-500">{{ t.counts(visit.documentCount, visit.formCount) }}</span>
          <span class="rounded px-2 py-0.5 text-xs" :class="badge(visit.status)">{{ t.infoStatus[visit.status] }}</span>
        </NuxtLink>
      </li>
    </ul>

    <UModal v-model:open="createOpen" :title="t.newInfo">
      <template #body>
        <form class="grid gap-3 sm:grid-cols-2" @submit.prevent="create">
          <UFormField :label="t.fields.visitDate" required>
            <DateTextInput v-model="form.visitDate" :label="t.fields.visitDate" class="w-full" required />
          </UFormField>
          <UFormField :label="t.fields.visitStart">
            <TimeInput v-model="form.visitStart" any-minute />
          </UFormField>
          <UFormField :label="t.fields.familyName" class="sm:col-span-2" required>
            <UInput v-model="form.familyName" maxlength="120" class="w-full" required />
          </UFormField>
          <UFormField :label="t.fields.childFirstName">
            <UInput v-model="form.childFirstName" maxlength="120" class="w-full" />
          </UFormField>
          <UFormField :label="t.fields.childLastName">
            <UInput v-model="form.childLastName" maxlength="120" class="w-full" />
          </UFormField>
          <UFormField :label="t.fields.phone">
            <UInput v-model="form.phone" maxlength="50" type="tel" class="w-full" />
          </UFormField>
          <UFormField :label="t.fields.email">
            <UInput v-model="form.email" maxlength="200" type="email" class="w-full" />
          </UFormField>
          <div class="flex gap-2 sm:col-span-2">
            <UButton type="submit" :label="t.create" :loading="saving" :disabled="saving" />
            <UButton type="button" color="neutral" variant="ghost" :label="de.common.cancel" @click="createOpen = false" />
          </div>
        </form>
      </template>
    </UModal>
  </div>
</template>
