<script setup lang="ts">
import { formatTime } from '#shared/domain/time'
import type { TeamMeetingDto, TeamMeetingSavedDto, TeamMeetingsDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorCode, errorMessage } from '~/utils/errors'
import { formatDate } from '~/utils/format'
import { teamMeetingGroup, teamMeetingStamps, type FormPanelSave } from '~/utils/forms'
import { checkHeader, headerBody, headerForm } from '~/utils/teamMeetings'

/**
 * The minutes of one team meeting. While a draft every member of the facility (also at the tablet) changes the header
 * and writes the minutes, saved together with the updatedAt they were loaded with. Leitung and Träger release it
 * (saving unsaved edits first), reopen it with a reason and delete it. Released minutes are only shown. When the
 * meeting was released while someone typed, their save is refused (409 team_meeting_released): what they typed stays
 * on screen to read, with „Neu laden“ for the stored minutes.
 */
const t = de.teamMeetings
const route = useRoute()
const id = Number(route.params.id)
const { user } = useUserSession()
const { data, error, refresh } = await useFetch<TeamMeetingDto>(`/api/team-meetings/${id}`)
// The groups to choose from (the list route has them; only the whole facility's meetings, to keep it short).
const { data: lists } = useFetch<TeamMeetingsDto>('/api/team-meetings', { query: { groupId: 0 }, key: 'team-meeting-groups' })
const toast = useToast()
const confirm = useConfirm()
useUnsavedGuard()

/** The save was refused because the meeting had been released meanwhile: the typed text stays, read-only. */
const releasedMeanwhile = ref(false)
// A new panel (fresh from the stored minutes) after „Neu laden“.
const panelKey = ref(0)
// Once deleted nothing is left to save, so leaving the page does not ask.
const deleted = ref(false)
const editable = computed(() => data.value?.state === 'draft' && !releasedMeanwhile.value && !deleted.value)
const canPrint = computed(() => user.value?.role !== 'terminal')
// The badge knows of a release seen through a refused save, before the minutes are loaded again.
const state = computed(() => (releasedMeanwhile.value ? 'released' : data.value?.state ?? 'draft'))

const header = ref(headerForm(data.value ?? null))
const savedHeader = ref(JSON.stringify(header.value))
function resetHeader() {
  header.value = headerForm(data.value ?? null)
  savedHeader.value = JSON.stringify(header.value)
}
const headerDirty = computed(() => JSON.stringify(header.value) !== savedHeader.value)

const save: FormPanelSave = async (answers, expectedUpdatedAt) => {
  const sent = JSON.stringify(header.value)
  try {
    const saved = await $fetch<TeamMeetingSavedDto>(`/api/team-meetings/${id}`, {
      method: 'PUT', body: { ...headerBody(header.value), answers, expectedUpdatedAt },
    })
    savedHeader.value = sent
    return saved
  }
  catch (failure) {
    if (errorCode(failure) === 'team_meeting_released') releasedMeanwhile.value = true
    throw failure
  }
}
const check = () => checkHeader(header.value)

async function reloadReleased() {
  await refresh()
  releasedMeanwhile.value = false
  resetHeader()
  panelKey.value++
}

const headerLine = computed(() => {
  const meeting = shownHeader.value
  if (!meeting) return ''
  const day = meeting.start === null ? formatDate(meeting.date) : `${formatDate(meeting.date)} ${t.atTime(formatTime(meeting.start))}`
  return [day, teamMeetingGroup(meeting)].join(' · ')
})
// While read-only after a refused save the header shows what was typed (not the stored one).
const shownHeader = computed(() => (releasedMeanwhile.value ? { ...data.value!, ...headerBody(header.value), groupName: groupName(header.value.group) } : data.value))
// On screen the draft badge says „Entwurf“; the lines name the release and the last reopening.
const stampLines = computed(() => (data.value ? teamMeetingStamps(data.value).filter(line => line !== t.draftStamp) : []))
function groupName(group: string): string | null {
  const found = (lists.value?.groups ?? []).find(entry => String(entry.id) === group)
  return found ? found.name : (group === String(data.value?.groupId) ? data.value?.groupName ?? null : null)
}

async function release(dirty: boolean, saveFirst: () => Promise<boolean>) {
  if (!await confirm(t.releaseConfirm, { confirmLabel: t.release, danger: false })) return
  if (dirty && !await saveFirst()) return
  try {
    await $fetch<unknown>(`/api/team-meetings/${id}/release`, { method: 'POST' })
    await refresh()
    toast.add({ title: t.released, color: 'success' })
  }
  catch (failure) {
    toast.add({ title: errorMessage(failure), color: 'error' })
    await refresh()
  }
}

const reopenOpen = ref(false)
const reopenReason = ref('')
const reopening = ref(false)
function openReopen() {
  reopenReason.value = ''
  reopenOpen.value = true
}
async function reopen() {
  reopening.value = true
  try {
    await $fetch<unknown>(`/api/team-meetings/${id}/reopen`, { method: 'POST', body: { reason: reopenReason.value } })
    reopenOpen.value = false
    await refresh()
    resetHeader()
    toast.add({ title: t.reopened, color: 'success' })
  }
  catch (failure) {
    toast.add({ title: errorMessage(failure), color: 'error' })
  }
  finally {
    reopening.value = false
  }
}

async function remove(dirty: boolean) {
  const message = t.deleteConfirm(formatDate(data.value!.date))
  if (!await confirm(dirty ? `${message} ${de.talks.unsavedLost}` : message)) return
  try {
    await $fetch<unknown>(`/api/team-meetings/${id}`, { method: 'DELETE' })
    deleted.value = true
    toast.add({ title: de.common.deleted, color: 'success' })
    await nextTick()
    await navigateTo(`/team-meetings?year=${data.value!.date.slice(0, 4)}`)
  }
  catch (failure) {
    toast.add({ title: errorMessage(failure), color: 'error' })
  }
}
</script>

<template>
  <div class="max-w-3xl min-w-0 space-y-4">
    <UButton
      :to="data ? `/team-meetings?year=${data.date.slice(0, 4)}` : '/team-meetings'" size="sm" color="neutral" variant="ghost"
      icon="i-lucide-arrow-left" :label="t.back"
    />
    <UAlert v-if="error" color="warning" variant="soft" :title="errorMessage(error)" />
    <template v-if="data && shownHeader">
      <div class="flex flex-wrap items-start gap-2">
        <div class="min-w-0 flex-1 basis-56 space-y-1">
          <div class="flex flex-wrap items-center gap-2">
            <h1 class="text-2xl font-semibold break-words">{{ data.title }}</h1>
            <UBadge :color="state === 'released' ? 'success' : 'warning'" variant="soft" :label="t.states[state]" />
          </div>
          <p class="text-sm text-gray-600">{{ headerLine }}</p>
          <p v-for="line in stampLines" :key="line" class="text-sm break-words text-gray-600">{{ line }}</p>
        </div>
        <UButton
          v-if="canPrint" size="sm" color="neutral" variant="outline" icon="i-lucide-printer" :label="t.print"
          :to="`/print/team-meetings/${id}`" target="_blank"
        />
      </div>

      <UAlert v-if="releasedMeanwhile" color="warning" variant="soft" icon="i-lucide-lock" :title="t.releasedMeanwhile" :description="t.releasedMeanwhileHint">
        <template #actions>
          <UButton size="sm" color="neutral" variant="outline" icon="i-lucide-refresh-cw" :label="de.forms.reload" @click="reloadReleased" />
        </template>
      </UAlert>
      <p v-else-if="editable" class="text-sm text-gray-600">{{ t.draftHint }}</p>
      <p v-else class="flex gap-1.5 text-sm text-gray-600">
        <UIcon name="i-lucide-lock" class="mt-0.5 size-4 shrink-0 text-gray-400" />
        <span>{{ t.readOnly }}</span>
      </p>

      <FormsFormPanel
        :key="`${data.id}-${panelKey}`" :form="data" :save="save" :editable="editable" :refresh="refresh"
        :extra-dirty="headerDirty" :check="check" @reset="resetHeader"
      >
        <template #before>
          <div v-if="editable" class="rounded-md bg-white p-3 ring-1 ring-gray-200">
            <TeamMeetingsHeaderFields v-model="header" :groups="lists?.groups ?? []" />
          </div>
          <dl v-else class="grid gap-x-4 gap-y-1 rounded-md bg-white p-3 text-sm ring-1 ring-gray-200 sm:grid-cols-[auto_1fr]">
            <dt class="font-medium text-gray-600">{{ t.participants }}</dt>
            <dd class="break-words">{{ shownHeader.participants || '–' }}</dd>
            <dt class="font-medium text-gray-600">{{ t.recorder }}</dt>
            <dd class="break-words">{{ shownHeader.recorder || '–' }}</dd>
          </dl>
        </template>
        <template v-if="data.canManage" #actions="{ dirty, save: saveFirst }">
          <UButton
            v-if="data.state === 'draft' && !releasedMeanwhile" class="ml-auto" color="success" icon="i-lucide-check"
            :label="t.release" @click="release(dirty, saveFirst)"
          />
          <UButton
            v-else-if="data.state === 'released'" class="ml-auto" color="neutral" variant="outline" icon="i-lucide-lock-open"
            :label="t.reopen" @click="openReopen"
          />
          <UButton color="error" variant="ghost" icon="i-lucide-trash-2" :label="t.delete" :class="releasedMeanwhile ? 'ml-auto' : ''" @click="remove(dirty)" />
        </template>
      </FormsFormPanel>
    </template>

    <UModal v-model:open="reopenOpen" :title="t.reopenTitle">
      <template #body>
        <form class="space-y-3" @submit.prevent="reopen()">
          <UFormField :label="t.reopenReason" :hint="`${reopenReason.trim().length}/200`" :description="t.reopenHint" required>
            <UTextarea v-model="reopenReason" :rows="3" maxlength="200" autoresize class="w-full" />
          </UFormField>
          <div class="flex flex-wrap justify-end gap-2">
            <UButton color="neutral" variant="ghost" :label="de.common.cancel" @click="reopenOpen = false" />
            <UButton type="submit" :label="t.reopen" :loading="reopening" :disabled="!reopenReason.trim()" />
          </div>
        </form>
      </template>
    </UModal>
  </div>
</template>
