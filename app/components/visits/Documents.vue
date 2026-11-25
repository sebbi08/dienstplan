<script setup lang="ts">
import { MAX_UPLOAD_BYTES } from '#shared/domain/uploads'
import type { PrintTemplateDto, VisitDocumentDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { formatSize } from '~/utils/children'
import { errorMessage } from '~/utils/errors'
import { formatDate } from '~/utils/format'
import type { FillTarget } from '~/utils/pdfFill'

/**
 * The documents of an info visit or an applicant: open, upload (PDF, JPG, PNG up to 30 MB), delete, „Aus Vorlage
 * ausfüllen“ (the filled copy is saved into this record) and „Bearbeiten“ of a saved PDF. Read only without `editable`.
 */
const props = defineProps<{
  kind: 'info' | 'applicant'
  recordId: number
  ownerName: string
  documents: VisitDocumentDto[]
  editable: boolean
}>()
const emit = defineEmits<{ changed: [] }>()
const t = de.visits
const toast = useToast()
const confirm = useConfirm()
const { can } = useCan()
const run = useAction(async () => emit('changed'))

const fillKind = computed(() => (props.kind === 'info' ? 'infoVisit' as const : 'applicant' as const))
const fillTarget = computed<FillTarget>(() => ({ kind: fillKind.value, id: props.recordId, name: props.ownerName }))
const mayFill = computed(() => props.editable && can('printTemplates.view'))
const { data: templateList, execute: loadTemplates, status: templateStatus } = useFetch<PrintTemplateDto[]>('/api/print-templates', {
  key: 'fill-templates', server: false, immediate: false, default: () => [],
})
watch(mayFill, (wanted) => {
  if (wanted && templateStatus.value === 'idle') void loadTemplates()
}, { immediate: true })
const fromTemplateOpen = ref(false)
const refilling = ref<VisitDocumentDto | null>(null)
const refillOpen = ref(false)
function refill(document: VisitDocumentDto) {
  refilling.value = document
  refillOpen.value = true
}

const fileUrl = (id: number) => `/api/visit-documents/${id}`
const uploadOpen = ref(false)
const uploadTitle = ref('')
const uploadFile = ref<File | null>(null)
const uploading = ref(false)
function chooseFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0] ?? null
  if (file && file.size > MAX_UPLOAD_BYTES) {
    toast.add({ title: de.errors.document_too_large, color: 'error' })
    uploadFile.value = null
    return
  }
  uploadFile.value = file
}
function startUpload() {
  uploadTitle.value = ''
  uploadFile.value = null
  uploadOpen.value = true
}
async function upload() {
  if (!uploadFile.value || uploading.value) return
  uploading.value = true
  const body = new FormData()
  body.append('file', uploadFile.value, uploadFile.value.name)
  body.append('title', uploadTitle.value)
  try {
    await $fetch<{ id: number }>(`/api/${props.kind === 'info' ? 'info-visits' : 'applicant-visits'}/${props.recordId}/documents`, { method: 'POST', body })
    uploadOpen.value = false
    toast.add({ title: de.common.saved, color: 'success' })
    emit('changed')
  }
  catch (error) {
    toast.add({ title: errorMessage(error), color: 'error' })
  }
  finally {
    uploading.value = false
  }
}
async function remove(document: VisitDocumentDto) {
  if (await confirm(t.deleteDocumentConfirm(document.title))) {
    await run(() => $fetch<unknown>(`/api/visit-documents/${document.id}`, { method: 'DELETE' }), de.common.deleted)
  }
}
</script>

<template>
  <section class="space-y-2 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <div class="flex flex-wrap items-center gap-2">
      <h2 class="font-semibold">{{ t.documents }}</h2>
      <div v-if="editable" class="flex flex-wrap gap-2 sm:ml-auto">
        <UButton size="sm" icon="i-lucide-upload" :label="t.upload" @click="startUpload" />
        <UButton
          v-if="mayFill && (templateList ?? []).length" size="sm" color="neutral" variant="outline" icon="i-lucide-pencil-line"
          :label="de.pdfFill.fromTemplate" @click="fromTemplateOpen = true"
        />
      </div>
    </div>
    <p v-if="!documents.length" class="text-sm text-gray-500">{{ t.noDocuments }}</p>
    <ul v-else class="divide-y divide-gray-100 text-sm">
      <li v-for="document in documents" :key="document.id" class="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
        <div class="min-w-0 flex-1">
          <a :href="fileUrl(document.id)" target="_blank" rel="noopener" class="font-medium text-sky-700 hover:underline">{{ document.title }}</a>
          <p class="text-xs text-gray-500">{{ t.uploaded(document.uploadedBy, formatDate(document.uploadedAt.slice(0, 10))) }} · {{ formatSize(document.size) }}</p>
        </div>
        <UButton
          v-if="editable && mayFill && document.mimeType === 'application/pdf'" size="xs" color="neutral" variant="ghost" icon="i-lucide-pencil-line"
          :label="de.pdfFill.edit" :aria-label="de.pdfFill.editLabel(document.title)" @click="refill(document)"
        />
        <UButton
          v-if="editable" size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" :label="t.deleteDocument"
          :aria-label="`${t.deleteDocument}: ${document.title}`" @click="remove(document)"
        />
      </li>
    </ul>

    <UModal v-model:open="uploadOpen" :title="t.upload">
      <template #body>
        <form class="space-y-3" @submit.prevent="upload">
          <UFormField :label="t.upload" :help="t.uploadHint" required>
            <input type="file" accept="application/pdf,image/jpeg,image/png" class="block w-full text-sm" required @change="chooseFile">
          </UFormField>
          <UFormField :label="t.documentTitle">
            <UInput v-model="uploadTitle" maxlength="200" class="w-full" />
          </UFormField>
          <div class="flex gap-2">
            <UButton type="submit" :label="t.upload" :loading="uploading" :disabled="uploading || !uploadFile" />
            <UButton type="button" color="neutral" variant="ghost" :label="de.common.cancel" @click="uploadOpen = false" />
          </div>
        </form>
      </template>
    </UModal>

    <PdfFillStart v-if="mayFill" v-model:open="fromTemplateOpen" :target="fillTarget" :templates="templateList ?? []" @saved="emit('changed')" />
    <PdfFillDialog
      v-if="refilling" v-model:open="refillOpen" :source="{ url: fileUrl(refilling.id), title: refilling.title }"
      :replace="{ kind: fillKind, documentId: refilling.id }" @saved="emit('changed')" @update:open="value => { if (!value) refilling = null }"
    />
  </section>
</template>
