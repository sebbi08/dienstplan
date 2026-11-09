<script setup lang="ts">
import type { GroupColor, NoteDto, NotesDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorCode, errorMessage } from '~/utils/errors'
import { canCreateNote, NOTE_SEARCH_MAX, noteSearchFromQuery } from '~/utils/notes'
import { filterFromQuery, type TeamMeetingFilter } from '~/utils/teamMeetings'

/**
 * „Notizen“ for every member of the facility and the tablet: the notes that apply, newest first, and the expired ones
 * folded away; filtered by group (Alle / Einrichtung / one group; a group shows its notes and the facility's) and by
 * the search „Suchen“ (text or name, every word; the expired ones too, which then open when they have hits), both kept
 * in the address. Whoever may write creates notes and changes or deletes those they may.
 */
const t = de.notes
const route = useRoute()
const router = useRouter()

const filter = computed<TeamMeetingFilter>({
  get: () => filterFromQuery(route.query.group),
  set: value => router.replace({ query: { ...route.query, group: value === 'all' ? undefined : String(value) } }),
})

// The search as typed; it reaches the address (and so the list) 300 ms after the last key.
const SEARCH_DELAY = 300
const searched = computed(() => noteSearchFromQuery(route.query.q).trim())
const searchText = ref(searched.value)
let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(searchText, (value) => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    const q = value.trim()
    if (q !== searched.value) router.replace({ query: { ...route.query, q: q === '' ? undefined : q } })
  }, SEARCH_DELAY)
})
// Back and forward change the address: the field follows.
watch(searched, (value) => { if (value !== searchText.value.trim()) searchText.value = value })
onBeforeUnmount(() => clearTimeout(searchTimer))
const searching = computed(() => searched.value !== '')

const query = computed(() => ({ group: String(filter.value), q: searched.value || undefined }))
const { data, error, refresh } = await useFetch<NotesDto>('/api/notes', { query })

// A group in the address that no longer exists: back to „Alle“, so the page loads.
watch(error, (value) => { if (value && errorCode(value) === 'group_not_found') filter.value = 'all' }, { immediate: true })

const filterItems = computed(() => [
  { label: t.filterAll, value: 'all' },
  { label: t.filterFacility, value: 'facility' },
  ...(data.value?.groups ?? []).map(group => ({ label: group.name, value: String(group.id) })),
])
const filterValue = computed({
  get: () => String(filter.value),
  set: (value: string) => { filter.value = filterFromQuery(value) },
})

const colors = computed(() => new Map<number, GroupColor | null>((data.value?.groups ?? []).map(group => [group.id, group.color])))
const colorOf = (note: NoteDto) => (note.groupId === null ? null : colors.value.get(note.groupId) ?? null)
const nothingFound = computed(() => searching.value && !data.value?.current.length && !data.value?.expired.length)
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
    <div class="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-6">
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-sm font-medium">{{ t.filter }}</span>
        <USelect v-model="filterValue" :items="filterItems" class="w-full sm:w-56" :aria-label="t.filter" />
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-sm font-medium">{{ t.search }}</span>
        <UInput
          v-model="searchText" type="search" icon="i-lucide-search" :placeholder="t.searchPlaceholder" :aria-label="t.search"
          :maxlength="NOTE_SEARCH_MAX" class="w-full sm:w-64"
        />
      </div>
    </div>
    <UAlert v-if="error" color="warning" variant="soft" :title="errorMessage(error)" />

    <section v-else-if="data" class="space-y-2">
      <h2 class="text-lg font-semibold">{{ t.current }}</h2>
      <p v-if="nothingFound" class="text-sm text-gray-500">{{ t.noResults }}</p>
      <p v-else-if="!data.current.length && !searching" class="text-sm text-gray-500">{{ t.empty }}</p>
      <ul v-if="data.current.length" class="space-y-2">
        <NotesNoteCard
          v-for="note in data.current" :key="note.id" :note="note" :group-color="colorOf(note)"
          @edit="openDialog(note)" @remove="remove(note)"
        />
      </ul>
      <details v-if="data.expired.length" :open="searching" class="rounded-lg bg-gray-50 ring-1 ring-gray-200">
        <summary class="cursor-pointer px-3 py-2 text-sm font-semibold text-gray-700">{{ t.expired(data.expired.length) }}</summary>
        <ul class="space-y-2 border-t border-gray-200 p-2 sm:p-3">
          <NotesNoteCard
            v-for="note in data.expired" :key="note.id" :note="note" :group-color="colorOf(note)"
            @edit="openDialog(note)" @remove="remove(note)"
          />
        </ul>
      </details>
    </section>

    <NotesNoteDialog
      v-if="write && mayCreate" v-model:open="dialogOpen" :note="editing" :groups="data?.groups ?? []" :write="write"
      :initial-group-id="typeof filter === 'number' ? filter : null" @saved="refresh"
    />
  </div>
</template>
