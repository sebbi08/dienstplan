<script setup lang="ts">
import { todayIso } from '#shared/domain/dates'
import { EMPLOYEE_DOCUMENT_FOLDERS, type EmployeeDocumentFolder } from '#shared/domain/personnel'
import type { ApplicationFormDto, EmployeeDocumentDto, EmployeeDocumentMeta, EmployeeDocumentsDto, PrintTemplateDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { MAX_DOCUMENT_BYTES, formatSize } from '~/utils/children'
import { pickedFile, uploadSizeError } from '~/utils/uploads'
import { errorMessage } from '~/utils/errors'
import { formatDate, formatDateTime } from '~/utils/format'
import type { FillTarget } from '~/utils/pdfFill'
import { employeeDocumentUrl } from '~/utils/personnel'

/**
 * „Dokumente“ of the personnel file (tab „Nachweise“): one section per folder the viewer may use (the server answers with exactly
 * those), each with its documents (open in a new tab, download, change, delete) and „Hochladen“. Like the child
 * documents: PDF, JPG or PNG up to 30 MB. Loaded in the browser once the tab is opened.
 */
const props = defineProps<{ employeeId: number; employeeName: string; active: boolean }>()
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
  file.value = pickedFile(event, toast)
}

async function save() {
  if (editingId.value === null) {
    const chosen = file.value
    if (!chosen) return void toast.add({ title: de.errors.file_required, color: 'error' })
    // Fail early instead of after a long upload; the server checks the size and the real file type again.
    if (chosen.size > MAX_DOCUMENT_BYTES) return void toast.add({ title: uploadSizeError(chosen.size)!, color: 'error' })
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

// Filling PDFs: „Aus Vorlage ausfüllen“ (the facility's templates the viewer sees) into a new document of a folder the
// viewer may use, „Bearbeiten“ of a PDF document (fields, text, tick, cross, signature; replaces its file, with the
// folder's key like every change).
const { can } = useCan()
const mayFill = computed(() => can('printTemplates.view'))
const { data: templateList, execute: loadTemplates, status: templateStatus } = useFetch<PrintTemplateDto[]>('/api/print-templates', {
  key: 'fill-templates', server: false, immediate: false, default: () => [],
})
watch(() => props.active && mayFill.value && folders.value.length > 0, (wanted) => {
  if (wanted && templateStatus.value === 'idle') void loadTemplates()
}, { immediate: true })
const fillTemplates = computed(() => templateList.value ?? [])
// The forms of the application (moved here at „Einstellen“): for the folder „Bewerbung“ or visits.manage, as the server decides.
const seesApplicationForms = computed(() => can('visits.manage') || can('employees.docs.application'))
const { data: applicationForms, execute: loadApplicationForms, status: applicationStatus, refresh: refreshApplicationForms } = useFetch<ApplicationFormDto[]>(
  () => `/api/employees/${props.employeeId}/application-forms`, { key: `application-forms-${props.employeeId}`, server: false, immediate: false, default: () => [] },
)
watch(() => props.active && seesApplicationForms.value, (wanted) => {
  if (wanted && applicationStatus.value === 'idle') void loadApplicationForms()
}, { immediate: true })
const fillTarget = computed<FillTarget>(() => ({ kind: 'employee', id: props.employeeId, name: props.employeeName }))
const fromTemplateOpen = ref(false)
const refilling = ref<EmployeeDocumentDto | null>(null)
const refillOpen = ref(false)
function refill(document: EmployeeDocumentDto) {
  refilling.value = document
  refillOpen.value = true
}
function onRefillOpen(value: boolean) {
  if (!value) refilling.value = null
}
const afterFill = () => refresh()

// „Zum Unterschreiben senden“ (signRequests.manage): a PDF of the file to this person, to sign in the app.
const canSend = computed(() => can('signRequests.manage'))
const sending = ref<{ kind: 'document'; id: number; title: string; url: string } | null>(null)
const sendOpen = ref(false)
function startSend(document: EmployeeDocumentDto) {
  sending.value = { kind: 'document', id: document.id, title: titleOf(document), url: employeeDocumentUrl(document.id) }
  sendOpen.value = true
}

const loadError = computed(() => (error.value ? errorMessage(error.value) : null))
const link = 'text-sky-700 hover:underline'
const iconLink = 'inline-flex size-7 items-center justify-center rounded-md text-gray-600 hover:bg-gray-100'
</script>

<template>
  <div class="flex flex-wrap items-start gap-2">
    <div class="min-w-0 flex-1">
      <h2 class="font-semibold">{{ t.heading }}</h2>
      <p class="text-sm text-gray-500">{{ t.hint }}</p>
    </div>
    <UButton
      v-if="documents && folders.length && fillTemplates.length" size="xs" color="neutral" variant="outline" icon="i-lucide-pencil-line"
      :label="de.pdfFill.fromTemplate" :disabled="busy" @click="fromTemplateOpen = true"
    />
  </div>
  <UAlert v-if="loadError" color="error" variant="soft" :title="loadError" />
  <p v-else-if="!documents" class="text-sm text-gray-500">{{ t.loading }}</p>
  <template v-else>
    <section v-for="folder in folders" :key="folder" class="space-y-2 rounded-lg bg-white p-4 ring-1 ring-gray-200">
      <div class="flex flex-wrap items-center gap-2">
        <div class="min-w-0">
          <h3 class="font-semibold">{{ de.personnel.folders[folder] }}</h3>
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
          <div class="flex flex-wrap items-center">
            <a :href="employeeDocumentUrl(document.id)" target="_blank" rel="noopener" :class="iconLink" :aria-label="t.open" :title="t.open"><UIcon name="i-lucide-external-link" class="size-4" /></a>
            <a :href="employeeDocumentUrl(document.id, true)" :class="iconLink" :aria-label="t.download" :title="t.download"><UIcon name="i-lucide-download" class="size-4" /></a>
            <UButton
              v-if="document.mimeType === 'application/pdf'" size="xs" color="neutral" variant="ghost" icon="i-lucide-pencil-line"
              :label="de.pdfFill.edit" :aria-label="de.pdfFill.editLabel(titleOf(document))" :disabled="busy" @click="refill(document)"
            />
            <UButton
              v-if="canSend && document.mimeType === 'application/pdf'" size="xs" color="neutral" variant="ghost" icon="i-lucide-signature"
              :label="de.signRequests.send" :disabled="busy" @click="startSend(document)"
            />
            <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-pencil" :aria-label="de.common.edit" :disabled="busy" @click="openEdit(document)" />
            <UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" :aria-label="de.common.delete" :disabled="busy" @click="remove(document)" />
          </div>
        </li>
      </ul>
    </section>
  </template>

  <!-- The forms of the application, moved here at „Einstellen“ (Bewerbungen & Hospitationen), read only. -->
  <section v-if="applicationForms?.length" class="space-y-2 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <h3 class="font-semibold">{{ de.visits.applicationForms }}</h3>
    <p class="text-xs text-gray-500">{{ de.visits.applicationFormsHint }}</p>
    <details v-for="form in applicationForms" :key="form.id" class="rounded-md ring-1 ring-gray-100">
      <summary class="cursor-pointer px-3 py-2 text-sm font-medium">{{ form.title }}</summary>
      <div class="px-3 pb-3">
        <FormsFormPanel :form="form" :editable="false" :refresh="refreshApplicationForms" />
      </div>
    </details>
  </section>

  <PdfFillStart v-if="folders.length" v-model:open="fromTemplateOpen" :target="fillTarget" :templates="fillTemplates" @saved="afterFill" />
  <PdfFillDialog
    v-if="refilling" v-model:open="refillOpen" :source="{ url: employeeDocumentUrl(refilling.id), title: titleOf(refilling) }"
    :replace="{ kind: 'employee', documentId: refilling.id }" @saved="afterFill" @update:open="onRefillOpen"
  />

  <SignRequestsSendDialog v-if="sending" v-model:open="sendOpen" :source="sending" :recipient="{ id: employeeId, name: employeeName }" />

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
