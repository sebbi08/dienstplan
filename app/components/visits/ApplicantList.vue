<script setup lang="ts">
import { APPLICANT_KINDS, APPLICANT_STATUSES } from '#shared/domain/visits'
import type { ApplicantVisitListItemDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'
import { ALL_STATUSES, applicantBody, dayRangeText, emptyApplicantForm, filterApplicants } from '~/utils/visits'

/**
 * Mitarbeiter → „Bewerbungen & Hospitationen“: the facility's applicants (Bewerbung, Hospitation, Praktikum), searchable
 * and filtered by status. visits.manage creates them („Neue Hospitation oder Bewerbung“ asks the essentials and opens the
 * page); visits.applicants.view only reads.
 */
const t = de.visits
const toast = useToast()
const { can } = useCan()
const canManage = computed(() => can('visits.manage'))
const { data, error, refresh } = await useFetch<ApplicantVisitListItemDto[]>('/api/applicant-visits', { key: 'applicant-visits', default: () => [] })
const query = ref('')
const status = ref(ALL_STATUSES)
const statusItems = [{ label: t.allStatuses, value: ALL_STATUSES }, ...APPLICANT_STATUSES.map(value => ({ label: t.applicantStatus[value], value }))]
const kindItems = APPLICANT_KINDS.map(value => ({ label: t.kinds[value], value }))
const shown = computed(() => filterApplicants(data.value, query.value, status.value))

const createOpen = ref(false)
const form = reactive(emptyApplicantForm())
const saving = ref(false)
function startCreate() {
  Object.assign(form, emptyApplicantForm())
  createOpen.value = true
}
async function create() {
  if (saving.value) return
  saving.value = true
  try {
    const { id } = await $fetch<{ id: number }>('/api/applicant-visits', { method: 'POST', body: applicantBody(form) })
    createOpen.value = false
    await refresh()
    await navigateTo(`/admin/employees/applicants/${id}`)
  }
  catch (failure) {
    toast.add({ title: errorMessage(failure), color: 'error' })
  }
  finally {
    saving.value = false
  }
}
const badge = (value: ApplicantVisitListItemDto['status']) =>
  (value === 'open' ? 'bg-sky-50 text-sky-800' : value === 'hired' ? 'bg-green-50 text-green-800' : 'bg-gray-100 text-gray-600')
</script>

<template>
  <div class="space-y-3">
    <div class="flex flex-wrap items-end gap-2">
      <UFormField :label="t.search" class="min-w-56 flex-1 sm:flex-none">
        <UInput v-model="query" icon="i-lucide-search" :placeholder="t.searchPlaceholder" class="w-full" />
      </UFormField>
      <UFormField :label="t.statusFilter">
        <USelect v-model="status" :items="statusItems" class="w-48" />
      </UFormField>
      <UButton v-if="canManage" class="sm:ml-auto" icon="i-lucide-plus" :label="t.newApplicant" @click="startCreate" />
    </div>
    <p v-if="error" class="text-sm text-red-700">{{ errorMessage(error) }}</p>
    <p v-else-if="!data.length" class="text-sm text-gray-500">{{ t.emptyApplicants }}</p>
    <p v-else-if="!shown.length" class="text-sm text-gray-500">{{ t.noMatch }}</p>
    <ul v-else class="divide-y divide-gray-100 overflow-hidden rounded-lg bg-white text-sm ring-1 ring-gray-200">
      <li v-for="visit in shown" :key="visit.id">
        <NuxtLink :to="`/admin/employees/applicants/${visit.id}`" class="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 hover:bg-gray-50">
          <span class="min-w-0 flex-1 basis-48">
            <span class="font-medium">{{ visit.name }}</span>
            <span class="text-gray-600"> · {{ t.kinds[visit.kind] }}</span>
            <span class="block text-xs text-gray-500">
              {{ [dayRangeText(visit), visit.dayCount ? t.days(visit.dayCount) : '', visit.mentorName ? `${t.fields.mentor}: ${visit.mentorName}` : ''].filter(Boolean).join(' · ') }}
            </span>
          </span>
          <span class="text-xs text-gray-500">{{ t.counts(visit.documentCount, visit.formCount) }}</span>
          <span class="rounded px-2 py-0.5 text-xs" :class="badge(visit.status)">{{ t.applicantStatus[visit.status] }}</span>
        </NuxtLink>
      </li>
    </ul>

    <UModal v-model:open="createOpen" :title="t.newApplicant">
      <template #body>
        <form class="grid gap-3 sm:grid-cols-2" @submit.prevent="create">
          <UFormField :label="t.fields.name" required>
            <UInput v-model="form.name" maxlength="120" class="w-full" required />
          </UFormField>
          <UFormField :label="t.fields.kind" required>
            <USelect v-model="form.kind" :items="kindItems" class="w-full" />
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
