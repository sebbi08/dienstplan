<script setup lang="ts">
import { todayIso } from '#shared/domain/dates'
import type { NoteDto, NoteInput, NotesDto, NoteVisibility } from '#shared/types/api'
import { de } from '~/locales/de'
import { noteVisibilityItems } from '~/utils/notes'

/**
 * Create a note (note = null) or change one. „Für“: whoever writes for the whole facility picks the facility or a
 * group; a group writer writes for the own group only, so it is shown, not picked. „Gilt bis“ is optional, from today
 * on for a new note; a stored one keeps any date. „Sichtbar für“ offers exactly the levels the writer may choose
 * (`write.visibilities`; hidden when that is only „Alle“), a new note is for all at first.
 */
const props = defineProps<{
  note: NoteDto | null
  groups: NotesDto['groups']
  write: NonNullable<NotesDto['write']>
  /** The group a new note is for at first (the filtered one); null = the whole facility. */
  initialGroupId: number | null
}>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ saved: [] }>()

const t = de.notes
const TEXT_MAX = 1000
const FACILITY = 'facility'
const { busy, run } = useBusyAction()

const form = reactive<{ group: string; validUntil: string; text: string; visibility: NoteVisibility }>({
  group: FACILITY, validUntil: '', text: '', visibility: 'all',
})
const today = ref(todayIso())

const groupValue = (groupId: number | null) => (groupId === null ? FACILITY : String(groupId))
watch(open, (isOpen) => {
  if (!isOpen) return
  today.value = todayIso()
  const note = props.note
  if (note) {
    Object.assign(form, {
      group: groupValue(note.groupId), validUntil: note.validUntil ?? '', text: note.text, visibility: note.visibility,
    })
    return
  }
  const writable = props.initialGroupId !== null && props.groups.some(group => group.id === props.initialGroupId)
  const group = props.write.facility ? (writable ? groupValue(props.initialGroupId) : FACILITY) : groupValue(props.write.groupId)
  Object.assign(form, { group, validUntil: '', text: '', visibility: 'all' })
}, { immediate: true })

const visibilityItems = computed(() => noteVisibilityItems(props.write.visibilities))

const groupItems = computed(() => [
  { label: t.wholeFacility, value: FACILITY },
  ...props.groups.map(group => ({ label: group.name, value: String(group.id) })),
])
// A group writer's fixed group, by name (the note's own group name when changing one).
const fixedGroupName = computed(() => {
  const id = form.group === FACILITY ? null : Number(form.group)
  if (id === null) return t.wholeFacility
  return props.groups.find(group => group.id === id)?.name ?? props.note?.groupName ?? ''
})

async function save() {
  const body: NoteInput = {
    groupId: form.group === FACILITY ? null : Number(form.group),
    validUntil: form.validUntil || null,
    text: form.text,
    visibility: form.visibility,
  }
  const note = props.note
  const ok = await run(
    () => (note
      ? $fetch<NoteDto>(`/api/notes/${note.id}`, { method: 'PUT', body })
      : $fetch<NoteDto>('/api/notes', { method: 'POST', body })),
    t.saved,
  )
  if (ok) {
    open.value = false
    emit('saved')
  }
}
</script>

<template>
  <UModal v-model:open="open" :title="note ? t.edit : t.create">
    <template #body>
      <form class="space-y-3" @submit.prevent="save()">
        <UFormField :label="t.for">
          <USelect v-if="write.facility" v-model="form.group" :items="groupItems" class="w-full" :aria-label="t.for" />
          <p v-else class="text-sm">{{ fixedGroupName }}</p>
        </UFormField>
        <UFormField v-if="visibilityItems.length > 1" :label="t.visibility">
          <USelect v-model="form.visibility" :items="visibilityItems" class="w-full sm:w-56" :aria-label="t.visibility" />
        </UFormField>
        <UFormField :label="t.validUntil" :description="t.validUntilHint">
          <DateTextInput v-model="form.validUntil" :min="note ? undefined : today" :aria-label="t.validUntil" class="w-full sm:w-56" />
        </UFormField>
        <UFormField :label="t.text" required :help="`${form.text.trim().length} /${TEXT_MAX}`">
          <UTextarea v-model="form.text" :rows="5" :maxlength="TEXT_MAX" autoresize required class="w-full" />
        </UFormField>
        <div class="flex flex-wrap justify-end gap-2">
          <UButton color="neutral" variant="ghost" :label="de.common.cancel" @click="open = false" />
          <UButton type="submit" :label="de.common.save" :loading="busy" />
        </div>
      </form>
    </template>
  </UModal>
</template>
