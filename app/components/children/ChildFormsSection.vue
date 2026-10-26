<script setup lang="ts">
import { isValidIsoDate, todayIso } from '#shared/domain/dates'
import { formatTime, parseTime } from '#shared/domain/time'
import type { ChildFormEditorDto, ChildFormListItemDto, ChildRecordDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { formatDate, formatDateTime } from '~/utils/format'

/**
 * „Beobachtungen“ in the record: the child's observation forms newest first (date, template, „zuletzt geändert“). Who
 * may start one (managers, the key educator at the tablet) gets „Bogen anlegen“; each form opens here to fill in or
 * to read, as the API says per form. Leitung and Träger also unlock employees for a form („Mitarbeiter freischalten“)
 * and delete it. One form is open at a time; closing it, opening another, deleting it or leaving the page asks first
 * while it has unsaved answers. Printing is in the office only (the tablet never prints child data).
 */
const props = defineProps<{ child: ChildRecordDto }>()
const c = de.childForms
const { data, refresh, openRequest } = useChildForms(props.child.id)
const { onTablet } = useChildRights()
const lookups = useChildLookups()
const run = useAction(refresh)
const confirm = useConfirm()
const forms = computed(() => data.value?.forms ?? [])

// One form is open at a time. Closing it, or opening another one, asks first while it has unsaved answers.
const openFormId = ref<number | null>(null)
const openDirty = ref(false)
const isOpen = (formId: number) => openFormId.value === formId
/** Asks before the open form's unsaved answers would go; changes nothing. */
async function askLeaveOpen(): Promise<boolean> {
  if (openFormId.value === null || !openDirty.value) return true
  return await confirm(de.forms.closeConfirm, { confirmLabel: de.forms.closeDiscard })
}
/** Asks, and once agreed the open form counts as given up (nothing unsaved any more). */
async function mayLeaveOpen(): Promise<boolean> {
  if (!await askLeaveOpen()) return false
  openDirty.value = false
  return true
}
async function toggleForm(formId: number) {
  if (!await mayLeaveOpen()) return
  openFormId.value = isOpen(formId) ? null : formId
}
/** Opens the form (unless it is open already) and brings it into view. */
async function showForm(formId: number) {
  if (!isOpen(formId)) {
    if (!await mayLeaveOpen()) return
    openFormId.value = formId
  }
  await nextTick()
  document.getElementById(`child-form-${formId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
// The meetings section asks to open a form („Bogen öffnen“, or the one „Bogen ausfüllen“ just made).
watch(openRequest, async (formId) => {
  if (formId === null) return
  openRequest.value = null
  await refresh()
  await showForm(formId)
})

function titleLine(form: ChildFormListItemDto): string {
  const day = form.date ? formatDate(form.date) : ''
  return form.start === null ? day : `${day} ${c.atTime(formatTime(form.start))}`
}

// „Bogen anlegen“.
const createOpen = ref(false)
const createError = ref('')
const draft = reactive({ templateId: undefined as number | undefined, date: todayIso(), start: '', participants: '' })
const templateItems = computed(() => (data.value?.templates ?? []).map(template => ({ label: template.name, value: template.id })))
function openCreate() {
  Object.assign(draft, { templateId: data.value?.templates[0]?.id, date: todayIso(), start: '', participants: '' })
  createError.value = ''
  createOpen.value = true
}
async function create() {
  createError.value = ''
  const start = draft.start.trim() ? parseTime(draft.start) : null
  if (!isValidIsoDate(draft.date)) createError.value = c.dateInvalid
  else if (draft.start.trim() && (start === null || start > 1439)) createError.value = de.common.invalidTimeAnyMinute
  if (createError.value || draft.templateId === undefined) return
  // Asked first, but the open form stays unsaved (and guarded) until the new one is really there.
  if (!await askLeaveOpen()) return
  let createdId: number | null = null
  const body = { templateId: draft.templateId, date: draft.date, start, participants: draft.participants }
  const ok = await run(async () => {
    createdId = (await $fetch<{ id: number }>(`/api/children/${props.child.id}/forms`, { method: 'POST', body })).id
  }, c.created)
  if (!ok || createdId === null) return
  createOpen.value = false
  openDirty.value = false
  await showForm(createdId)
}

// „Mitarbeiter freischalten“ (Leitung and Träger).
const editorsOpen = ref(false)
const editorsForm = ref<ChildFormListItemDto | null>(null)
const editorsCurrent = ref<ChildFormEditorDto[]>([])
const editorsPicked = ref<number[]>([])
const editorsBusy = ref(false)
/** The facility's staff, plus whoever is unlocked already but no longer among them (so they can be revoked). */
const editorChoices = computed(() => {
  const staff = lookups.staff.value.map(person => ({ id: person.id, name: person.name }))
  const extra = editorsCurrent.value.filter(editor => !staff.some(person => person.id === editor.employeeId))
    .map(editor => ({ id: editor.employeeId, name: editor.name }))
  return [...staff, ...extra]
})
const isKeyEducator = (employeeId: number) => props.child.master.keyEducatorId === employeeId
async function openEditors(form: ChildFormListItemDto) {
  editorsForm.value = form
  const ok = await run(async () => {
    editorsCurrent.value = await $fetch<ChildFormEditorDto[]>(`/api/child-forms/${form.id}/editors`)
  })
  if (!ok) return
  editorsPicked.value = editorsCurrent.value.map(editor => editor.employeeId)
  editorsOpen.value = true
}
function togglePicked(employeeId: number, on: boolean) {
  editorsPicked.value = on ? [...new Set([...editorsPicked.value, employeeId])] : editorsPicked.value.filter(id => id !== employeeId)
}
async function saveEditors() {
  const form = editorsForm.value
  if (!form) return
  editorsBusy.value = true
  const ok = await run(async () => {
    editorsCurrent.value = await $fetch<ChildFormEditorDto[]>(`/api/child-forms/${form.id}/editors`, {
      method: 'PUT', body: { employeeIds: editorsPicked.value },
    })
  }, c.editorsSaved)
  editorsBusy.value = false
  if (ok) editorsOpen.value = false
}

async function remove(form: ChildFormListItemDto) {
  const lost = openDirty.value && isOpen(form.id) ? ` ${c.unsavedLost}` : ''
  if (!await confirm(`${c.deleteConfirm(form.title, form.date ? formatDate(form.date) : '')}${lost}`, { confirmLabel: c.delete, danger: true })) return
  if (await run(() => $fetch<unknown>(`/api/child-forms/${form.id}`, { method: 'DELETE' }), de.common.deleted) && isOpen(form.id)) {
    openFormId.value = null
    openDirty.value = false
  }
}
</script>

<template>
  <ChildrenChildSection :title="c.section" :can-edit="false">
    <template v-if="data?.canCreate" #actions>
      <UButton class="min-h-11" color="neutral" variant="outline" icon="i-lucide-plus" :label="c.create" @click="openCreate" />
    </template>

    <p v-if="!forms.length" class="text-sm text-gray-500">{{ c.none }}</p>
    <ul v-else class="space-y-2">
      <li
        v-for="form in forms" :id="`child-form-${form.id}`" :key="form.id"
        class="min-w-0 scroll-mt-20 space-y-2 rounded-md bg-gray-50 p-2 ring-1 ring-gray-200 sm:p-3"
      >
        <div class="flex flex-wrap items-start gap-2">
          <div class="min-w-0 flex-1 basis-56 space-y-0.5">
            <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span class="font-medium break-words">{{ titleLine(form) }} · {{ form.title }}</span>
              <span v-if="form.parentMeetingId !== null" class="rounded bg-sky-100 px-1.5 py-0.5 text-xs font-medium text-sky-800">{{ c.fromMeeting }}</span>
              <span v-if="form.right === 'read'" class="rounded bg-gray-200 px-1.5 py-0.5 text-xs text-gray-700">{{ c.readOnlyBadge }}</span>
            </div>
            <p v-if="form.participants" class="text-sm break-words text-gray-600">{{ c.participants }}: {{ form.participants }}</p>
            <p class="text-xs text-gray-500">{{ de.forms.lastChanged(form.updatedBy, formatDateTime(form.updatedAt)) }}</p>
          </div>
          <div class="flex flex-wrap items-center gap-1">
            <UButton
              class="min-h-11" color="neutral" variant="outline" :icon="isOpen(form.id) ? 'i-lucide-chevron-up' : 'i-lucide-file-pen-line'"
              :label="isOpen(form.id) ? c.close : c.open" :aria-expanded="isOpen(form.id)" @click="toggleForm(form.id)"
            />
            <UButton
              v-if="!onTablet" class="min-h-11" color="neutral" variant="ghost" icon="i-lucide-printer" :label="c.print"
              :to="`/print/children/forms/${form.id}`" target="_blank"
            />
            <template v-if="form.canManage">
              <UButton class="min-h-11" color="neutral" variant="ghost" icon="i-lucide-user-check" :label="c.editors" @click="openEditors(form)" />
              <UButton class="min-h-11 min-w-11 justify-center" color="error" variant="ghost" icon="i-lucide-trash-2" :aria-label="c.delete" @click="remove(form)" />
            </template>
          </div>
        </div>
        <ChildrenChildFormPanel v-if="isOpen(form.id)" :form-id="form.id" :archived="child.status === 'archived'" :refresh-list="refresh" @dirty="openDirty = $event" />
      </li>
    </ul>

    <UModal v-model:open="createOpen" :title="c.create">
      <template #body>
        <p v-if="!templateItems.length" class="text-sm text-gray-600">{{ c.noTemplates }}</p>
        <form v-else class="grid gap-3 sm:grid-cols-2" @submit.prevent="create">
          <UFormField :label="c.template" required class="sm:col-span-2">
            <USelect v-model="draft.templateId" :items="templateItems" size="lg" class="w-full" :placeholder="c.templatePick" />
          </UFormField>
          <UFormField :label="c.date" required><DateTextInput v-model="draft.date" :label="c.date" size="lg" class="w-full" required /></UFormField>
          <UFormField :label="c.start" :hint="c.startHint"><TimeInput v-model="draft.start" any-minute size="lg" /></UFormField>
          <UFormField :label="c.participants" class="sm:col-span-2">
            <UInput v-model="draft.participants" maxlength="300" size="lg" :placeholder="c.participantsPlaceholder" class="w-full" />
          </UFormField>
          <p v-if="createError" class="text-sm text-red-600 sm:col-span-2" role="alert">{{ createError }}</p>
          <div class="flex gap-2 sm:col-span-2">
            <UButton type="submit" class="min-h-11" :label="c.create" :disabled="draft.templateId === undefined" />
            <UButton type="button" class="min-h-11" color="neutral" variant="ghost" :label="de.common.cancel" @click="createOpen = false" />
          </div>
        </form>
      </template>
    </UModal>

    <UModal v-model:open="editorsOpen" :title="c.editors" :description="editorsForm ? `${titleLine(editorsForm)} · ${editorsForm.title}` : undefined">
      <template #body>
        <div class="space-y-3">
          <p class="text-sm text-gray-600">{{ c.editorsHint }}</p>
          <ul class="max-h-80 space-y-1 overflow-y-auto">
            <li v-for="person in editorChoices" :key="person.id">
              <UCheckbox
                class="min-h-11 items-center" :model-value="editorsPicked.includes(person.id) || isKeyEducator(person.id)"
                :disabled="isKeyEducator(person.id)" :label="isKeyEducator(person.id) ? `${person.name} (${de.groupChange.sections.keyEducator})` : person.name"
                @update:model-value="togglePicked(person.id, !!$event)"
              />
            </li>
          </ul>
          <div class="flex gap-2">
            <UButton class="min-h-11" :label="de.common.save" :loading="editorsBusy" @click="saveEditors" />
            <UButton class="min-h-11" color="neutral" variant="ghost" :label="de.common.cancel" @click="editorsOpen = false" />
          </div>
        </div>
      </template>
    </UModal>
  </ChildrenChildSection>
</template>
