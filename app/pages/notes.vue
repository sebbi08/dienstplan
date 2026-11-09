<script setup lang="ts">
import { todayIso } from '#shared/domain/dates'
import type { GroupColor, NoteDto, NotesDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'
import { canCreateNote, noteDayHeading, notesByDay } from '~/utils/notes'
import { filterFromQuery, type TeamMeetingFilter } from '~/utils/teamMeetings'

/**
 * „Notizen“ for every member of the facility and the tablet: the board (the expired notes folded away) and the day
 * notes from today on by day (the earlier days folded away, the last 12 months unless „Ältere anzeigen“), filtered by
 * group (Alle / Einrichtung / one group, kept in the address; a group shows its notes and the facility's). Whoever may
 * write creates notes and changes or deletes those they may (spec Notizen §2, §3).
 */
const t = de.notes
const route = useRoute()
const router = useRouter()

const filter = computed<TeamMeetingFilter>({
  get: () => filterFromQuery(route.query.group),
  set: value => router.replace({ query: { ...route.query, group: value === 'all' ? undefined : String(value) } }),
})
const older = ref(false)
const query = computed(() => ({ group: String(filter.value), older: older.value ? '1' : undefined }))
const { data, error, refresh } = await useFetch<NotesDto>('/api/notes', { query })

const filterItems = computed(() => [
  { label: t.filterAll, value: 'all' },
  { label: t.filterFacility, value: 'facility' },
  ...(data.value?.groups ?? []).map(group => ({ label: group.name, value: String(group.id) })),
])
const filterValue = computed({
  get: () => String(filter.value),
  set: (value: string) => { filter.value = filterFromQuery(value) },
})

const today = todayIso()
const colors = computed(() => new Map<number, GroupColor | null>((data.value?.groups ?? []).map(group => [group.id, group.color])))
const colorOf = (note: NoteDto) => (note.groupId === null ? null : colors.value.get(note.groupId) ?? null)
const upcomingDays = computed(() => notesByDay(data.value?.upcoming ?? []))
const pastDays = computed(() => notesByDay(data.value?.past ?? []))
const write = computed(() => data.value?.write ?? null)
const mayCreate = computed(() => canCreateNote(write.value))

const dialogOpen = ref(false)
const editing = ref<NoteDto | null>(null)
function openDialog(note: NoteDto | null) {
  editing.value = note
  dialogOpen.value = true
}

const run = useAction(refresh)
const confirm = useConfirm()
async function remove(note: NoteDto) {
  if (!(await confirm(t.deleteConfirm, { danger: true }))) return
  await run(() => $fetch<{ ok: boolean }>(`/api/notes/${note.id}`, { method: 'DELETE' }), t.deleted)
}
</script>

<template>
  <div class="max-w-4xl min-w-0 space-y-4">
    <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
      <h1 class="text-2xl font-semibold">{{ t.title }}</h1>
      <UButton v-if="mayCreate" class="ml-auto" icon="i-lucide-plus" :label="t.create" @click="openDialog(null)" />
    </div>
    <p class="text-sm text-gray-600">{{ t.intro }}</p>
    <div class="flex flex-wrap items-center gap-2">
      <span class="text-sm font-medium">{{ t.filter }}</span>
      <USelect v-model="filterValue" :items="filterItems" class="w-full sm:w-56" :aria-label="t.filter" />
    </div>
    <UAlert v-if="error" color="warning" variant="soft" :title="errorMessage(error)" />

    <template v-else-if="data">
      <section class="space-y-2">
        <h2 class="text-lg font-semibold">{{ t.board }}</h2>
        <p v-if="!data.board.length" class="text-sm text-gray-500">{{ t.boardEmpty }}</p>
        <ul v-else class="space-y-2">
          <NotesNoteCard
            v-for="note in data.board" :key="note.id" :note="note" :group-color="colorOf(note)"
            @edit="openDialog(note)" @remove="remove(note)"
          />
        </ul>
        <details v-if="data.expired.length" class="rounded-lg bg-gray-50 ring-1 ring-gray-200">
          <summary class="cursor-pointer px-3 py-2 text-sm font-semibold text-gray-700">{{ t.expired(data.expired.length) }}</summary>
          <ul class="space-y-2 border-t border-gray-200 p-2 sm:p-3">
            <NotesNoteCard
              v-for="note in data.expired" :key="note.id" :note="note" :group-color="colorOf(note)"
              @edit="openDialog(note)" @remove="remove(note)"
            />
          </ul>
        </details>
      </section>

      <section class="space-y-2">
        <h2 class="text-lg font-semibold">{{ t.days }}</h2>
        <p v-if="!upcomingDays.length" class="text-sm text-gray-500">{{ t.daysEmpty }}</p>
        <div v-for="day in upcomingDays" :key="day.date" class="space-y-2">
          <h3 class="text-sm font-semibold" :class="day.date === today ? 'text-sky-800' : 'text-gray-700'">
            {{ noteDayHeading(day.date, today) }}
          </h3>
          <ul class="space-y-2">
            <NotesNoteCard
              v-for="note in day.notes" :key="note.id" :note="note" :group-color="colorOf(note)"
              @edit="openDialog(note)" @remove="remove(note)"
            />
          </ul>
        </div>
        <details v-if="data.past.length || data.pastHasOlder" class="rounded-lg bg-gray-50 ring-1 ring-gray-200">
          <summary class="cursor-pointer px-3 py-2 text-sm font-semibold text-gray-700">{{ t.past(data.past.length) }}</summary>
          <div class="space-y-3 border-t border-gray-200 p-2 sm:p-3">
            <div v-for="day in pastDays" :key="day.date" class="space-y-2">
              <h3 class="text-sm font-semibold text-gray-700">{{ noteDayHeading(day.date, today) }}</h3>
              <ul class="space-y-2">
                <NotesNoteCard
                  v-for="note in day.notes" :key="note.id" :note="note" :group-color="colorOf(note)"
                  @edit="openDialog(note)" @remove="remove(note)"
                />
              </ul>
            </div>
            <UButton
              v-if="data.pastHasOlder" color="neutral" variant="outline" size="sm" icon="i-lucide-history" :label="t.older"
              @click="older = true"
            />
          </div>
        </details>
      </section>
    </template>

    <NotesNoteDialog
      v-if="write && mayCreate" v-model:open="dialogOpen" :note="editing" :groups="data?.groups ?? []" :write="write"
      :initial-group-id="typeof filter === 'number' ? filter : null" @saved="refresh"
    />
  </div>
</template>
