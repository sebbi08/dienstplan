<script setup lang="ts">
import { parseIsoDate, todayIso } from '#shared/domain/dates'
import { formatTime } from '#shared/domain/time'
import type { TeamMeetingListItemDto, TeamMeetingsDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'
import { formatDate, formatDateTime } from '~/utils/format'
import { teamMeetingGroup } from '~/utils/forms'
import { checkHeader, filterFromQuery, filterGroupId, headerBody, headerForm, type TeamMeetingFilter } from '~/utils/teamMeetings'

/**
 * „Teamsitzungen“ for every member of the facility (Leitung/Träger, staff accounts, the tablet): the meetings of a year,
 * newest first, filtered by group (Alle / Einrichtung / one group), each with its state; „Sitzung anlegen“ (template,
 * date, time, group, participants, Protokollführung) opens the new minutes. Year and filter stay in the address, so
 * coming back from a meeting shows the same list.
 */
const t = de.teamMeetings
const route = useRoute()
const router = useRouter()
const currentYear = parseIsoDate(todayIso()).year

const year = computed({
  get: () => {
    const value = Number(route.query.year)
    return Number.isInteger(value) && value >= 2000 && value <= 2100 ? value : currentYear
  },
  set: value => router.replace({ query: { ...route.query, year: String(value) } }),
})
const filter = computed<TeamMeetingFilter>({
  get: () => filterFromQuery(route.query.group),
  set: value => router.replace({ query: { ...route.query, group: value === 'all' ? undefined : String(value) } }),
})
const query = computed(() => ({ year: year.value, groupId: filterGroupId(filter.value) }))
const { data, error, refresh } = await useFetch<TeamMeetingsDto>('/api/team-meetings', { query })

const filterItems = computed(() => [
  { label: t.filterAll, value: 'all' },
  { label: t.filterFacility, value: 'facility' },
  ...(data.value?.groups ?? []).map(group => ({ label: group.name, value: String(group.id) })),
])
const filterValue = computed({
  get: () => String(filter.value),
  set: (value: string) => { filter.value = filterFromQuery(value) },
})

const when = (meeting: TeamMeetingListItemDto) =>
  meeting.start === null ? formatDate(meeting.date) : `${formatDate(meeting.date)} ${t.atTime(formatTime(meeting.start))}`

// „Sitzung anlegen“
const dialogOpen = ref(false)
const templateId = ref<number | undefined>(undefined)
const form = ref(headerForm(null, todayIso()))
const creating = ref(false)
const toast = useToast()
const templateItems = computed(() => (data.value?.templates ?? []).map(template => ({ label: template.name, value: template.id })))
function openDialog() {
  const templates = data.value?.templates ?? []
  templateId.value = templates.length === 1 ? templates[0]!.id : undefined
  form.value = headerForm(null, todayIso())
  // A meeting made while one group is filtered belongs to that group.
  if (typeof filter.value === 'number') form.value.group = String(filter.value)
  dialogOpen.value = true
}
async function create() {
  if (templateId.value === undefined) return
  const refused = checkHeader(form.value)
  if (refused) {
    toast.add({ title: refused, color: 'error' })
    return
  }
  creating.value = true
  try {
    const { id } = await $fetch<{ id: number }>('/api/team-meetings', {
      method: 'POST', body: { ...headerBody(form.value), templateId: templateId.value },
    })
    dialogOpen.value = false
    toast.add({ title: t.created, color: 'success' })
    await navigateTo(`/team-meetings/${id}`)
  }
  catch (failure) {
    toast.add({ title: errorMessage(failure), color: 'error' })
    await refresh()
  }
  finally {
    creating.value = false
  }
}
</script>

<template>
  <div class="max-w-4xl min-w-0 space-y-4">
    <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
      <h1 class="text-2xl font-semibold">{{ t.title }}</h1>
      <YearNav v-model="year" />
      <UButton class="ml-auto" icon="i-lucide-plus" :label="t.create" @click="openDialog" />
    </div>
    <p class="text-sm text-gray-600">{{ t.intro }}</p>
    <div class="flex flex-wrap items-center gap-2">
      <span class="text-sm font-medium">{{ t.filter }}</span>
      <USelect v-model="filterValue" :items="filterItems" class="w-full sm:w-56" :aria-label="t.filter" />
    </div>
    <UAlert v-if="error" color="warning" variant="soft" :title="errorMessage(error)" />
    <p v-else-if="!(data?.meetings ?? []).length" class="text-sm text-gray-500">{{ t.none }}</p>

    <ul class="space-y-2">
      <li v-for="meeting in data?.meetings ?? []" :key="meeting.id">
        <NuxtLink
          :to="`/team-meetings/${meeting.id}`"
          class="block min-w-0 space-y-1 rounded-lg bg-white p-3 ring-1 ring-gray-200 hover:ring-gray-400 sm:p-4"
        >
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-semibold">{{ when(meeting) }}</span>
            <span class="min-w-0 break-words text-gray-700">{{ meeting.title }}</span>
            <UBadge color="neutral" variant="outline" size="sm" :label="teamMeetingGroup(meeting)" />
            <UBadge
              :color="meeting.state === 'released' ? 'success' : 'warning'" variant="soft" size="sm"
              :label="t.states[meeting.state]" class="ml-auto"
            />
          </div>
          <p v-if="meeting.participants" class="text-sm break-words text-gray-600">{{ t.participants }}: {{ meeting.participants }}</p>
          <p v-if="meeting.recorder" class="text-sm break-words text-gray-600">{{ t.recorder }}: {{ meeting.recorder }}</p>
          <p class="text-xs text-gray-500">
            {{ meeting.state === 'released' && meeting.releasedAt
              ? t.releasedAt(formatDateTime(meeting.releasedAt), meeting.releasedBy ?? '')
              : de.forms.lastChanged(meeting.updatedBy, formatDateTime(meeting.updatedAt)) }}
          </p>
        </NuxtLink>
      </li>
    </ul>

    <UModal v-model:open="dialogOpen" :title="t.create">
      <template #body>
        <form class="space-y-3" @submit.prevent="create()">
          <p v-if="!templateItems.length" class="text-sm text-gray-600">{{ t.noTemplates }}</p>
          <template v-else>
            <UFormField :label="t.template" required>
              <USelect v-model="templateId" :items="templateItems" size="lg" class="w-full" :placeholder="t.templatePick" :aria-label="t.template" />
            </UFormField>
            <TeamMeetingsHeaderFields v-model="form" :groups="data?.groups ?? []" />
          </template>
          <div class="flex flex-wrap justify-end gap-2">
            <UButton color="neutral" variant="ghost" :label="de.common.cancel" @click="dialogOpen = false" />
            <UButton
              v-if="templateItems.length" type="submit" :label="t.create" :loading="creating"
              :disabled="templateId === undefined || !form.date"
            />
          </div>
        </form>
      </template>
    </UModal>
  </div>
</template>
