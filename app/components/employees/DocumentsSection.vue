<script setup lang="ts">
import { todayIso } from '#shared/domain/dates'
import { EMPLOYEE_DOCUMENT_FOLDERS, type EmployeeDocumentFolder } from '#shared/domain/personnel'
import type { EmployeeDocumentDto, EmployeeDocumentMeta, EmployeeDocumentsDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { MAX_DOCUMENT_BYTES, formatSize } from '~/utils/children'
import { errorMessage } from '~/utils/errors'
import { formatDate, formatDateTime } from '~/utils/format'
import { employeeDocumentUrl } from '~/utils/personnel'

/**
 * Tab „Dokumente“ of the personnel file: one section per folder the viewer may use (the server answers with exactly
 * those), each with its documents (open in a new tab, download, change, delete) and „Hochladen“. Like the child
 * documents: PDF, JPG or PNG up to 10 MB. Loaded in the browser once the tab is opened.
 */
const props = defineProps<{ employeeId: number; active: boolean }>()
const t = de.personnel.documents
const { data: documents, status, error, execute, refresh } = useFetch<EmployeeDocumentsDto>(
  `/api/employees/${props.employeeId}/documents`, { server: false, immediate: false },
)
const { busy, run } = useBusyAction(() => refresh())
const confirm = useConfirm()
const toast = useToast()

onMounted(() => {
  watch(() => props.active, (active) => {
    if (active && status.value === 'idle') void execute()
  }, { immediate: true })
})

const folders = computed(() => EMPLOYEE_DOCUMENT_FOLDERS.filter(folder => documents.value?.[folder] !== undefined))
const folderItems = computed(() => folders.value.map(folder => ({ label: de.personnel.folders[folder], value: folder })))
const titleOf = (document: EmployeeDocumentDto) => document.title || t.untitled

const open = ref(false)
/** null = a new upload, otherwise the document being changed. */
const editingId = ref<number | null>(null)
const file = shallowRef<File | null>(null)
const form = reactive<EmployeeDocumentMeta>({ folder: 'qualifications', title: '', documentDate: todayIso(), note: '' })

function openNew(folder: EmployeeDocumentFolder) {
  editingId.value = null
  file.value = null
  Object.assign(form, { folder, title: '', documentDate: todayIso(), note: '' })
  open.value = true
}
function openEdit(document: EmployeeDocumentDto) {
  editingId.value = document.id
  Object.assign(form, { folder: document.folder, title: document.title, documentDate: document.documentDate, note: document.note })
  open.value = true
}
function onFile(event: Event) {
  file.value = (event.target as HTMLInputElement).files?.[0] ?? null
}

async function save() {
  if (editingId.value === null) {
    const chosen = file.value
    if (!chosen) return void toast.add({ title: de.errors.file_required, color: 'error' })
    // Fail early instead of after a long upload; the server checks the size and the real file type again.
    if (chosen.size > MAX_DOCUMENT_BYTES) return void toast.add({ title: de.errors.document_too_large, color: 'error' })
    const body = new FormData()
    body.append('file', chosen)
    body.append('folder', form.folder)
    body.append('title', form.title)
    body.append('documentDate', form.documentDate)
    body.append('note', form.note)
    const request = () => $fetch<unknown>(`/api/employees/${props.employeeId}/documents`, { method: 'POST', body })
    if (await run(request, de.common.saved)) open.value = false
    return
  }
  const id = editingId.value
  if (await run(() => $fetch<unknown>(`/api/employee-documents/${id}`, { method: 'PUT', body: { ...form } }), de.common.saved)) open.value = false
}

async function remove(document: EmployeeDocumentDto) {
  if (await confirm(t.confirmDelete(titleOf(document)))) {
    await run(() => $fetch<unknown>(`/api/employee-documents/${document.id}`, { method: 'DELETE' }), de.common.deleted)
  }
}

const loadError = computed(() => (error.value ? errorMessage(error.value) : null))
const link = 'text-sky-700 hover:underline'
const iconLink = 'inline-flex size-7 items-center justify-center rounded-md text-gray-600 hover:bg-gray-100'
</script>

<template>
  <p class="text-sm text-gray-500">{{ t.hint }}</p>
  <UAlert v-if="loadError" color="error" variant="soft" :title="loadError" />
  <p v-else-if="!documents" class="text-sm text-gray-500">{{ t.loading }}</p>
  <template v-else>
    <section v-for="folder in folders" :key="folder" class="space-y-2 rounded-lg bg-white p-4 ring-1 ring-gray-200">
      <div class="flex flex-wrap items-center gap-2">
        <div class="min-w-0">
          <h2 class="font-semibold">{{ de.personnel.folders[folder] }}</h2>
          <p class="text-xs text-gray-500">{{ t.folderHints[folder] }}</p>
        </div>
        <UButton
          class="ml-auto" size="xs" color="neutral" variant="outline" icon="i-lucide-upload" :label="t.upload"
          :aria-label="t.uploadTo(de.personnel.folders[folder])" :disabled="busy" @click="openNew(folder)"
        />
      </div>
      <p v-if="!documents[folder]?.length" class="text-sm text-gray-500">{{ t.none }}</p>
      <ul v-else class="divide-y divide-gray-100">
        <li v-for="document in documents[folder]" :key="document.id" class="flex flex-wrap items-start gap-3 py-3 text-sm">
          <UIcon :name="document.mimeType === 'application/pdf' ? 'i-lucide-file-text' : 'i-lucide-image'" class="mt-0.5 size-5 shrink-0 text-gray-500" aria-hidden="true" />
          <div class="min-w-0 flex-1 space-y-0.5">
            <a :href="employeeDocumentUrl(document.id)" target="_blank" rel="noopener" :class="[link, 'font-medium break-words']">{{ titleOf(document) }}</a>
            <p class="text-gray-600">{{ formatDate(document.documentDate) }} · {{ formatSize(document.size) }}</p>
            <p v-if="document.note" class="whitespace-pre-line break-words text-gray-700">{{ document.note }}</p>
            <p class="text-xs text-gray-500">{{ t.uploadedBy(document.uploadedBy ?? t.unknownUploader, formatDateTime(document.uploadedAt)) }}</p>
          </div>
          <div class="flex items-center">
            <a :href="employeeDocumentUrl(document.id)" target="_blank" rel="noopener" :class="iconLink" :aria-label="t.open" :title="t.open"><UIcon name="i-lucide-external-link" class="size-4" /></a>
            <a :href="employeeDocumentUrl(document.id, true)" :class="iconLink" :aria-label="t.download" :title="t.download"><UIcon name="i-lucide-download" class="size-4" /></a>
            <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-pencil" :aria-label="de.common.edit" :disabled="busy" @click="openEdit(document)" />
            <UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" :aria-label="de.common.delete" :disabled="busy" @click="remove(document)" />
          </div>
        </li>
      </ul>
    </section>
  </template>

  <UModal v-model:open="open" :title="editingId === null ? t.uploadTo(de.personnel.folders[form.folder]) : t.edit">
    <template #body>
      <form class="grid gap-3 sm:grid-cols-2" @submit.prevent="save">
        <UFormField v-if="editingId === null" :label="t.file" class="sm:col-span-2" required>
          <input
            type="file" accept="application/pdf,image/jpeg,image/png" required
            class="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-gray-100 file:px-3 file:py-1.5 file:text-sm hover:file:bg-gray-200"
            @change="onFile"
          >
        </UFormField>
        <UFormField :label="t.folder" required>
          <USelect v-model="form.folder" :items="folderItems" class="w-full" />
        </UFormField>
        <UFormField :label="t.date" required><DateTextInput v-model="form.documentDate" :label="t.date" class="w-full" required /></UFormField>
        <UFormField :label="t.title" class="sm:col-span-2" required><UInput v-model="form.title" maxlength="200" class="w-full" required /></UFormField>
        <UFormField :label="t.note" class="sm:col-span-2"><UTextarea v-model="form.note" :rows="3" maxlength="1000" class="w-full" /></UFormField>
        <div class="flex gap-2 sm:col-span-2">
          <UButton type="submit" :label="editingId === null ? t.upload : de.common.save" :loading="busy" :disabled="busy" />
          <UButton type="button" color="neutral" variant="ghost" :label="de.common.cancel" @click="open = false" />
        </div>
      </form>
    </template>
  </UModal>
</template>
