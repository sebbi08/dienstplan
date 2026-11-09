<script setup lang="ts">
import { todayIso } from '#shared/domain/dates'
import type { NoteDto, NoteInput, NotesDto } from '#shared/types/api'
import { de } from '~/locales/de'

/**
 * Create a note (note = null) or change one. The kind is chosen only on create (the server keeps it). „Für“: whoever
 * writes for the whole facility picks the facility or a group; a group writer writes for the own group only, so it is
 * shown, not picked. „Gilt bis“ is from today on for a new note; a stored one keeps any date.
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

const form = reactive({ kind: 'board' as NoteInput['kind'], group: FACILITY, date: '', validUntil: '', text: '' })
const today = ref(todayIso())

const groupValue = (groupId: number | null) => (groupId === null ? FACILITY : String(groupId))
watch(open, (isOpen) => {
  if (!isOpen) return
  today.value = todayIso()
  const note = props.note
  if (note) {
    Object.assign(form, {
      kind: note.kind, group: groupValue(note.groupId), date: note.date ?? '', validUntil: note.validUntil ?? '', text: note.text,
    })
    return
  }
  const writable = props.initialGroupId !== null && props.groups.some(group => group.id === props.initialGroupId)
  const group = props.write.facility ? (writable ? groupValue(props.initialGroupId) : FACILITY) : groupValue(props.write.groupId)
  Object.assign(form, { kind: 'board', group, date: today.value, validUntil: '', text: '' })
}, { immediate: true })

const kindItems = [{ label: t.kinds.board, value: 'board' }, { label: t.kinds.day, value: 'day' }]
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
    kind: form.kind,
    groupId: form.group === FACILITY ? null : Number(form.group),
    date: form.kind === 'day' ? form.date : null,
    validUntil: form.kind === 'board' && form.validUntil ? form.validUntil : null,
    text: form.text,
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
        <UFormField v-if="!note" :label="t.kind">
          <URadioGroup v-model="form.kind" orientation="horizontal" :items="kindItems" />
        </UFormField>
        <UFormField :label="t.for">
          <USelect v-if="write.facility" v-model="form.group" :items="groupItems" class="w-full" :aria-label="t.for" />
          <p v-else class="text-sm">{{ fixedGroupName }}</p>
        </UFormField>
        <UFormField v-if="form.kind === 'day'" :label="t.date" required>
          <DateTextInput v-model="form.date" required :aria-label="t.date" class="w-full sm:w-56" />
        </UFormField>
        <UFormField v-else :label="t.validUntil" :description="t.validUntilHint">
          <DateTextInput v-model="form.validUntil" :min="note ? undefined : today" :aria-label="t.validUntil" class="w-full sm:w-56" />
        </UFormField>
        <UFormField :label="t.text" required :help="`${form.text.length} / ${TEXT_MAX}`">
          <UTextarea v-model="form.text" :rows="5" :maxlength="TEXT_MAX" autoresize required class="w-full" />
        </UFormField>
        <div class="flex flex-wrap justify-end gap-2">
          <UButton color="neutral" variant="ghost" :label="de.common.cancel" @click="open = false" />
          <UButton type="submit" :label="de.common.save" :loading="busy" :disabled="form.kind === 'day' && !form.date" />
        </div>
      </form>
    </template>
  </UModal>
</template>
