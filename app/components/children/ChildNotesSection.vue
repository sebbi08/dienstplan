<script setup lang="ts">
import { todayIso } from '#shared/domain/dates'
import type { ChildNoteDto, ChildNoteInput, ChildRecordDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { formatDate } from '~/utils/format'

/**
 * „Notizen“ in the record: a table Datum | Information | Erzieher, newest first. Whoever keeps the child's attendance
 * adds a note (`canAddNotes`: not only who may change the record, never with read access only); the author, Leitung
 * and Träger change and delete it (`canEdit` per note, the server checks again). A new note starts with today and the acting person as educator (at the tablet the one who
 * unlocked it). `reload` re-reads the record; the busy flag stays on until it is done.
 */
const props = defineProps<{ child: ChildRecordDto; lookups: ReturnType<typeof useChildLookups>; reload: () => Promise<unknown> }>()
const { busy, run } = useBusyAction(props.reload)
const confirm = useConfirm()
const n = de.childNotes
const MAX_TEXT = 2000

const open = ref(false)
const editing = ref<ChildNoteDto | null>(null)
const error = ref('')
// USelect needs a value: 0 = no educator, KEEP = the stored educator whose employee was deleted (only the saved name is left).
const KEEP = -1
const emptyForm = () => ({ date: todayIso(), text: '', educatorId: props.child.noteEducatorId ?? 0 })
const form = reactive(emptyForm())
watch(() => form.text, () => {
  error.value = ''
})
const textLength = computed(() => form.text.trim().length)

/**
 * The facility's staff; a note's educator who has left since stays selectable, and one whose employee was deleted
 * stays as „keep“ under the saved name, so changing the text does not lose it.
 */
const educatorItems = computed(() => {
  const items = [{ label: n.noEducator, value: 0 }, ...props.lookups.staff.value.map(person => ({ label: person.name, value: person.id }))]
  const current = editing.value
  if (current?.educatorEmployeeId && !items.some(item => item.value === current.educatorEmployeeId)) {
    items.push({ label: current.educatorName, value: current.educatorEmployeeId })
  }
  else if (current && current.educatorEmployeeId === null && current.educatorName) {
    items.push({ label: current.educatorName, value: KEEP })
  }
  return items
})

function openNew() {
  editing.value = null
  Object.assign(form, emptyForm())
  error.value = ''
  open.value = true
}
function openEdit(note: ChildNoteDto) {
  editing.value = note
  Object.assign(form, { date: note.date, text: note.text, educatorId: note.educatorEmployeeId ?? (note.educatorName ? KEEP : 0) })
  error.value = ''
  open.value = true
}

async function save() {
  if (!form.text.trim()) {
    error.value = n.textRequired
    return
  }
  const educatorEmployeeId = form.educatorId === KEEP ? 'keep' : form.educatorId || null
  const body: ChildNoteInput = { date: form.date, text: form.text, educatorEmployeeId }
  const id = editing.value?.id
  const request = id === undefined
    ? () => $fetch<{ id: number }>(`/api/children/${props.child.id}/notes`, { method: 'POST', body })
    : () => $fetch<{ ok: boolean }>(`/api/children/notes/${id}`, { method: 'PUT', body })
  if (await run(request, de.common.saved)) open.value = false
}

async function remove(note: ChildNoteDto) {
  if (busy.value) return
  if (!await confirm(n.confirmDelete, { confirmLabel: de.common.delete, danger: true })) return
  run(() => $fetch<{ ok: boolean }>(`/api/children/notes/${note.id}`, { method: 'DELETE' }), de.common.deleted)
}

/** „angelegt von … am …“, or „geändert …“ after a change; the day in Berlin. */
function stamp(note: ChildNoteDto): string {
  const day = (timestamp: string) => formatDate(todayIso(new Date(timestamp)))
  return note.updatedAt
    ? n.updatedBy(note.updatedByName ?? de.children.unknownUser, day(note.updatedAt))
    : n.createdBy(note.createdByName, day(note.createdAt))
}

const th = 'px-3 py-2 font-medium'
const td = 'px-3 py-2 align-top'
const anyEditable = computed(() => props.child.notes.some(note => note.canEdit))
</script>

<template>
  <ChildrenChildSection :title="n.title" :can-edit="false">
    <template v-if="child.canAddNotes" #actions>
      <UButton class="min-h-11" color="neutral" variant="outline" icon="i-lucide-plus" :label="n.add" :disabled="busy" @click="openNew" />
    </template>

    <p v-if="!child.notes.length" class="text-sm text-gray-500">{{ n.none }}</p>
    <div v-else class="overflow-x-auto rounded-lg ring-1 ring-gray-200">
      <table class="w-full bg-white text-sm">
        <thead class="bg-gray-100 text-left text-xs text-gray-600">
          <tr>
            <th :class="[th, 'whitespace-nowrap']">{{ n.date }}</th>
            <th :class="th">{{ n.text }}</th>
            <th :class="th">{{ n.educator }}</th>
            <th v-if="anyEditable" :class="th"><span class="sr-only">{{ n.actions }}</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="note in child.notes" :key="note.id" class="border-t border-gray-100">
            <td :class="[td, 'whitespace-nowrap']">{{ formatDate(note.date) }}</td>
            <td :class="[td, 'min-w-48']">
              <p class="whitespace-pre-line break-words">{{ note.text }}</p>
              <p class="mt-1 text-xs text-gray-500">{{ stamp(note) }}</p>
            </td>
            <td :class="td">{{ note.educatorName || '–' }}</td>
            <td v-if="anyEditable" :class="[td, 'whitespace-nowrap text-right']">
              <template v-if="note.canEdit">
                <UButton class="min-h-11" color="neutral" variant="ghost" icon="i-lucide-pencil" :label="n.edit" :disabled="busy" @click="openEdit(note)" />
                <UButton class="min-h-11 min-w-11 justify-center" color="error" variant="ghost" icon="i-lucide-trash-2" :aria-label="de.common.delete" :disabled="busy" @click="remove(note)" />
              </template>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <UModal v-model:open="open" :title="editing === null ? n.add : n.editTitle">
      <template #body>
        <form class="space-y-3" @submit.prevent="save">
          <UFormField :label="n.date" required><DateTextInput v-model="form.date" :label="n.date" size="lg" class="w-full" required /></UFormField>
          <UFormField :label="n.text" required :hint="n.counter(textLength, MAX_TEXT)">
            <UTextarea v-model="form.text" :rows="4" :maxlength="MAX_TEXT" autoresize class="w-full" />
          </UFormField>
          <UFormField :label="n.educator">
            <USelect v-model="form.educatorId" :items="educatorItems" size="lg" class="w-full" />
          </UFormField>
          <p v-if="error" class="text-sm text-red-600" role="alert">{{ error }}</p>
          <div class="flex gap-2">
            <UButton type="submit" class="min-h-11" :label="de.common.save" :loading="busy" :disabled="busy" />
            <UButton type="button" class="min-h-11" color="neutral" variant="ghost" :label="de.common.cancel" @click="open = false" />
          </div>
        </form>
      </template>
    </UModal>
  </ChildrenChildSection>
</template>
