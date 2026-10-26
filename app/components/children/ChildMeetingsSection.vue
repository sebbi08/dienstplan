<script setup lang="ts">
import { todayIso } from '#shared/domain/dates'
import { formatTime, parseTime } from '#shared/domain/time'
import { MEETING_KINDS, type ChildRecordDto, type MeetingKind, type ParentMeetingDto, type ParentMeetingInput } from '#shared/types/api'
import { de } from '~/locales/de'
import { formatDate } from '~/utils/format'

/**
 * „Elterngespräche“ in the record: the meetings newest first (planned ones marked), and for whoever may edit the record
 * „Gespräch eintragen“, „Ändern“ and delete. The confidential note is shown and sent only by Leitung and Träger: for
 * everyone else the form leaves the field out entirely, so the server keeps the stored note on a change.
 * `reload` re-reads the record; the busy flag stays on until it is done.
 * Per meeting „Bogen ausfüllen“ (whoever may start an observation form: managers, the key educator at the tablet)
 * starts its observation form with the meeting's date, time and participants; once there is one, „Bogen öffnen“
 * opens it in „Beobachtungen“.
 */
const props = defineProps<{ child: ChildRecordDto; reload: () => Promise<unknown> }>()
const childForms = useChildForms(props.child.id)
const { busy, run } = useBusyAction(async () => {
  await Promise.all([props.reload(), refreshNuxtData('children-reminders'), childForms.refresh()])
})
const confirm = useConfirm()
const { rights } = useChildRights()
const isManager = computed(() => !!rights.value?.isManager)
const m = de.parentMeetings
const c = de.childForms

// „Bogen ausfüllen“: the template to fill (the first one preselected), the header comes from the meeting.
const canFill = computed(() => !!childForms.data.value?.canCreate)
const fillTemplates = computed(() => (childForms.data.value?.templates ?? []).map(template => ({ label: template.name, value: template.id })))
const fillOpen = ref(false)
const fillMeeting = ref<ParentMeetingDto | null>(null)
const fillTemplateId = ref<number | undefined>(undefined)
function openFill(meeting: ParentMeetingDto) {
  fillMeeting.value = meeting
  fillTemplateId.value = childForms.data.value?.templates[0]?.id
  fillOpen.value = true
}
async function fill() {
  const meeting = fillMeeting.value
  const templateId = fillTemplateId.value
  if (!meeting || templateId === undefined) return
  let createdId: number | null = null
  const ok = await run(async () => {
    createdId = (await $fetch<{ id: number }>(`/api/children/${props.child.id}/forms`, {
      method: 'POST', body: { templateId, parentMeetingId: meeting.id },
    })).id
  }, c.created)
  if (!ok || createdId === null) return
  fillOpen.value = false
  childForms.openRequest.value = createdId
}
const openForm = (formId: number) => {
  childForms.openRequest.value = formId
}

const kindItems = MEETING_KINDS.map(kind => ({ label: m.kinds[kind], value: kind }))

const open = ref(false)
const editingId = ref<number | null>(null)
const error = ref('')
const emptyForm = () => ({ date: todayIso(), start: '', end: '', kind: 'development' as MeetingKind, participants: '', note: '' })
const form = reactive(emptyForm())
// A hint about the times goes away as soon as they are changed.
watch(() => [form.start, form.end], () => {
  error.value = ''
})

function openNew() {
  editingId.value = null
  Object.assign(form, emptyForm())
  error.value = ''
  open.value = true
}
function openEdit(meeting: ParentMeetingDto) {
  editingId.value = meeting.id
  Object.assign(form, {
    date: meeting.date, start: formatTime(meeting.start), end: meeting.end === null ? '' : formatTime(meeting.end),
    kind: meeting.kind, participants: meeting.participants, note: meeting.note ?? '',
  })
  error.value = ''
  open.value = true
}

/** The checked input, or null after setting `error`: a start, an optional end after it. */
function payload(): ParentMeetingInput | null {
  const start = parseTime(form.start)
  if (!form.start.trim()) error.value = m.startRequired
  else if (start === null || start > 1439) error.value = de.common.invalidTimeAnyMinute
  const end = form.end.trim() ? parseTime(form.end) : null
  if (!error.value && form.end.trim() && (end === null || end > 1439)) error.value = de.common.invalidTimeAnyMinute
  if (!error.value && end !== null && end <= start!) error.value = de.errors.meeting_end_invalid
  if (error.value) return null
  const input: ParentMeetingInput = { date: form.date, start: start!, end, kind: form.kind, participants: form.participants }
  // Only Leitung and Träger send the note (a staff member's request with the key is refused, even when empty).
  if (isManager.value) input.note = form.note
  return input
}

async function save() {
  error.value = ''
  const body = payload()
  if (!body) return
  const request = editingId.value === null
    ? () => $fetch<unknown>(`/api/children/${props.child.id}/meetings`, { method: 'POST', body })
    : () => $fetch<unknown>(`/api/children/meetings/${editingId.value}`, { method: 'PUT', body })
  if (await run(request, de.common.saved)) open.value = false
}

async function remove(meeting: ParentMeetingDto) {
  if (busy.value) return
  if (!await confirm(m.confirmDelete(formatDate(meeting.date)), { confirmLabel: de.common.delete, danger: true })) return
  run(() => $fetch<unknown>(`/api/children/meetings/${meeting.id}`, { method: 'DELETE' }), de.common.deleted)
}

/** „20.10.2026 14:00–14:45 · Entwicklungsgespräch · Mama, Papa“ (without the end or the participants when empty). */
function headline(meeting: ParentMeetingDto): string {
  const time = meeting.end === null ? formatTime(meeting.start) : `${formatTime(meeting.start)}–${formatTime(meeting.end)}`
  return [`${formatDate(meeting.date)} ${time}`, m.kinds[meeting.kind], meeting.participants.trim()].filter(Boolean).join(' · ')
}

/** „eingetragen von … am …“, or „geändert …“ after a change; the day in Berlin. */
function stamp(meeting: ParentMeetingDto): string {
  const day = (timestamp: string) => formatDate(todayIso(new Date(timestamp)))
  return meeting.updatedAt
    ? m.updatedBy(meeting.updatedByName ?? de.children.unknownUser, day(meeting.updatedAt))
    : m.createdBy(meeting.createdByName, day(meeting.createdAt))
}
</script>

<template>
  <ChildrenChildSection :title="m.section" :can-edit="false">
    <template v-if="child.canEditMeetings" #actions>
      <UButton class="min-h-11" color="neutral" variant="outline" icon="i-lucide-plus" :label="m.add" :disabled="busy" @click="openNew" />
    </template>

    <p v-if="!child.meetings.length" class="text-sm text-gray-500">{{ m.none }}</p>
    <ul v-else class="divide-y divide-gray-100">
      <li v-for="meeting in child.meetings" :key="meeting.id" class="flex flex-wrap items-start gap-3 py-3 text-sm">
        <div class="min-w-0 flex-1 basis-56 space-y-1">
          <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span class="font-medium">{{ headline(meeting) }}</span>
            <span v-if="meeting.planned" class="rounded bg-sky-100 px-1.5 py-0.5 text-xs font-medium text-sky-800">{{ m.planned }}</span>
          </div>
          <p v-if="meeting.note" class="flex gap-1.5 whitespace-pre-line text-gray-600">
            <UIcon name="i-lucide-lock" class="mt-0.5 size-4 shrink-0 text-gray-400" role="img" :aria-label="m.confidential" />
            <span>{{ meeting.note }}</span>
          </p>
          <p class="text-xs text-gray-500">{{ stamp(meeting) }}</p>
        </div>
        <UButton
          v-if="meeting.formId !== null" class="min-h-11" color="neutral" variant="outline" icon="i-lucide-file-text"
          :label="c.openForm" @click="openForm(meeting.formId)"
        />
        <UButton
          v-else-if="canFill" class="min-h-11" color="neutral" variant="outline" icon="i-lucide-file-pen-line"
          :label="c.fill" :disabled="busy" @click="openFill(meeting)"
        />
        <div v-if="child.canEditMeetings" class="flex items-center gap-1">
          <UButton class="min-h-11" color="neutral" variant="ghost" icon="i-lucide-pencil" :label="m.edit" :disabled="busy" @click="openEdit(meeting)" />
          <UButton class="min-h-11 min-w-11 justify-center" color="error" variant="ghost" icon="i-lucide-trash-2" :aria-label="de.common.delete" :disabled="busy" @click="remove(meeting)" />
        </div>
      </li>
    </ul>

    <UModal v-model:open="open" :title="editingId === null ? m.add : m.editTitle">
      <template #body>
        <form class="grid gap-3 sm:grid-cols-2" @submit.prevent="save">
          <UFormField :label="m.date" required class="sm:col-span-2"><DateTextInput :label="m.date" v-model="form.date" size="lg" class="w-full" required /></UFormField>
          <UFormField :label="m.start" required><TimeInput v-model="form.start" any-minute size="lg" /></UFormField>
          <UFormField :label="m.end" :hint="m.endHint"><TimeInput v-model="form.end" any-minute size="lg" /></UFormField>
          <UFormField :label="m.kind" required class="sm:col-span-2">
            <USelect v-model="form.kind" :items="kindItems" size="lg" class="w-full" />
          </UFormField>
          <UFormField :label="m.participants" class="sm:col-span-2">
            <UInput v-model="form.participants" maxlength="200" size="lg" :placeholder="m.participantsPlaceholder" class="w-full" />
          </UFormField>
          <UFormField v-if="isManager" :label="m.note" :help="m.noteHint" class="sm:col-span-2">
            <UTextarea v-model="form.note" :rows="3" maxlength="2000" class="w-full" />
          </UFormField>
          <p v-if="error" class="text-sm text-red-600 sm:col-span-2" role="alert">{{ error }}</p>
          <div class="flex gap-2 sm:col-span-2">
            <UButton type="submit" class="min-h-11" :label="de.common.save" :loading="busy" :disabled="busy" />
            <UButton type="button" class="min-h-11" color="neutral" variant="ghost" :label="de.common.cancel" @click="open = false" />
          </div>
        </form>
      </template>
    </UModal>

    <UModal v-model:open="fillOpen" :title="c.fill" :description="fillMeeting ? headline(fillMeeting) : undefined">
      <template #body>
        <p v-if="!fillTemplates.length" class="text-sm text-gray-600">{{ c.noTemplates }}</p>
        <form v-else class="space-y-3" @submit.prevent="fill">
          <UFormField :label="c.template" required>
            <USelect v-model="fillTemplateId" :items="fillTemplates" size="lg" class="w-full" :placeholder="c.templatePick" />
          </UFormField>
          <p class="text-sm text-gray-600">{{ c.fillHint }}</p>
          <div class="flex gap-2">
            <UButton type="submit" class="min-h-11" :label="c.fill" :loading="busy" :disabled="busy || fillTemplateId === undefined" />
            <UButton type="button" class="min-h-11" color="neutral" variant="ghost" :label="de.common.cancel" @click="fillOpen = false" />
          </div>
        </form>
      </template>
    </UModal>
  </ChildrenChildSection>
</template>
