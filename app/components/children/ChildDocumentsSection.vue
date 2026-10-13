<script setup lang="ts">
import { todayIso } from '#shared/domain/dates'
import type { ChildDocumentDto, ChildRecordDto, DocumentTypeDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { MAX_DOCUMENT_BYTES, documentFileUrl, formatSize } from '~/utils/children'
import { formatDate, formatDateTime } from '~/utils/format'

/** Documents of a child: upload (PDF, JPG, PNG), open, download, change and delete. Confidential ones are locked for some viewers. */
/** `reload` re-reads the record; the busy flag stays on until it is done, so the next action works on fresh data. */
const props = defineProps<{ child: ChildRecordDto; reload: () => Promise<unknown> }>()
const { busy, run } = useBusyAction(() => props.reload())
const confirm = useConfirm()
const toast = useToast()

const { data: typeList } = useFetch<DocumentTypeDto[]>('/api/document-types', { key: 'document-types', default: () => [] })
const types = computed(() => typeList.value ?? [])
const typeItems = computed(() => types.value.map(type => ({ label: type.name, value: type.id })))

const open = ref(false)
/** null = a new upload, otherwise the document being changed. */
const editingId = ref<number | null>(null)
const file = shallowRef<File | null>(null)
const form = reactive({ typeId: 0, title: '', documentDate: todayIso(), confidential: false })

function openNew() {
  editingId.value = null
  file.value = null
  const first = types.value[0]
  Object.assign(form, { typeId: first?.id ?? 0, title: '', documentDate: todayIso(), confidential: first?.confidentialDefault ?? false })
  open.value = true
}
function openEdit(document: ChildDocumentDto) {
  editingId.value = document.id
  Object.assign(form, { typeId: document.typeId, title: document.title, documentDate: document.documentDate, confidential: document.confidential })
  open.value = true
}

/** A new document starts out with the confidentiality of its type; changing an existing one keeps the choice. */
function onType(typeId: number) {
  form.typeId = typeId
  if (editingId.value === null) form.confidential = types.value.find(type => type.id === typeId)?.confidentialDefault ?? false
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
    body.append('typeId', String(form.typeId))
    body.append('title', form.title)
    body.append('documentDate', form.documentDate)
    body.append('confidential', String(form.confidential))
    if (await run(() => $fetch<unknown>(`/api/children/${props.child.id}/documents`, { method: 'POST', body }), de.common.saved)) open.value = false
    return
  }
  const id = editingId.value
  if (await run(() => $fetch<unknown>(`/api/child-documents/${id}`, { method: 'PUT', body: { ...form } }), de.common.saved)) open.value = false
}

async function remove(document: ChildDocumentDto) {
  if (await confirm(de.childDocuments.confirmDelete)) run(() => $fetch<unknown>(`/api/child-documents/${document.id}`, { method: 'DELETE' }), de.common.deleted)
}

const link = 'text-sky-700 hover:underline'
const iconLink = 'inline-flex size-7 items-center justify-center rounded-md text-gray-600 hover:bg-gray-100'
</script>

<template>
  <ChildrenChildSection :title="de.children.sections.documents" :can-edit="false">
    <template v-if="child.canEdit" #actions>
      <UButton size="xs" color="neutral" variant="outline" icon="i-lucide-upload" :label="de.childDocuments.upload" @click="openNew" />
    </template>

    <template #banner>
      <ChildrenReviewBanner :child="child" section="documents" :reload="reload" named />
      <ChildrenReviewBanner :child="child" section="contract" :reload="reload" named />
    </template>

    <p v-if="!child.documents.length" class="text-sm text-gray-500">{{ de.childDocuments.none }}</p>
    <ul v-else class="divide-y divide-gray-100">
      <li v-for="document in child.documents" :key="document.id" class="flex flex-wrap items-start gap-3 py-3 text-sm">
        <UIcon v-if="document.canOpen" name="i-lucide-file-text" class="mt-0.5 size-5 shrink-0 text-gray-500" aria-hidden="true" />
        <UIcon v-else name="i-lucide-lock" class="mt-0.5 size-5 shrink-0 text-gray-500" role="img" :aria-label="de.childDocuments.lockedHint" :title="de.childDocuments.lockedHint" />
        <div class="min-w-0 flex-1 space-y-0.5">
          <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
            <a v-if="document.canOpen" :href="documentFileUrl(document.id)" target="_blank" rel="noopener" :class="[link, 'font-medium']">{{ document.title || document.typeName }}</a>
            <span v-else class="font-medium text-gray-700">{{ document.title || document.typeName }}</span>
            <span class="rounded bg-gray-100 px-1.5 py-0.5 text-xs">{{ document.typeName }}</span>
            <span v-if="document.confidential" class="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">{{ de.childDocuments.confidential }}</span>
          </div>
          <p class="text-gray-600">{{ formatDate(document.documentDate) }} · {{ formatSize(document.size) }}</p>
          <p class="text-xs text-gray-500">{{ de.childDocuments.uploadedBy(document.uploadedBy ?? de.childDocuments.unknownUploader, formatDateTime(document.uploadedAt)) }}</p>
        </div>
        <div class="flex items-center">
          <template v-if="document.canOpen">
            <a :href="documentFileUrl(document.id)" target="_blank" rel="noopener" :class="iconLink" :aria-label="de.childDocuments.open" :title="de.childDocuments.open"><UIcon name="i-lucide-external-link" class="size-4" /></a>
            <a :href="documentFileUrl(document.id, true)" :class="iconLink" :aria-label="de.childDocuments.download" :title="de.childDocuments.download"><UIcon name="i-lucide-download" class="size-4" /></a>
          </template>
          <template v-if="child.canEdit && document.canOpen">
            <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-pencil" :aria-label="de.common.edit" :disabled="busy" @click="openEdit(document)" />
            <UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" :aria-label="de.common.delete" :disabled="busy" @click="remove(document)" />
          </template>
        </div>
      </li>
    </ul>

    <UModal v-model:open="open" :title="editingId === null ? de.childDocuments.upload : de.childDocuments.edit">
      <template #body>
        <p v-if="!types.length" class="text-sm text-gray-600">{{ de.childDocuments.noTypes }}</p>
        <form v-else class="grid gap-3 sm:grid-cols-2" @submit.prevent="save">
          <UFormField v-if="editingId === null" :label="de.childDocuments.file" class="sm:col-span-2" required>
            <!-- No `capture`: it would force the camera and block choosing an existing file; phones offer both anyway. -->
            <input
              type="file" accept="application/pdf,image/jpeg,image/png" required
              class="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-gray-100 file:px-3 file:py-1.5 file:text-sm hover:file:bg-gray-200"
              @change="onFile"
            >
          </UFormField>
          <UFormField :label="de.childDocuments.type" required>
            <USelect :model-value="form.typeId" :items="typeItems" class="w-full" @update:model-value="onType(Number($event))" />
          </UFormField>
          <UFormField :label="de.childDocuments.date" required><UInput v-model="form.documentDate" type="date" class="w-full" required /></UFormField>
          <UFormField :label="de.childDocuments.title" class="sm:col-span-2"><UInput v-model="form.title" maxlength="200" class="w-full" /></UFormField>
          <UFormField :label="de.childDocuments.visibility" class="sm:col-span-2">
            <USelect
              :model-value="form.confidential ? 'confidential' : 'all'"
              :items="[{ label: de.childDocuments.all, value: 'all' }, { label: de.childDocuments.confidential, value: 'confidential' }]"
              class="w-full" @update:model-value="form.confidential = $event === 'confidential'"
            />
          </UFormField>
          <div class="flex gap-2 sm:col-span-2">
            <UButton type="submit" :label="editingId === null ? de.childDocuments.upload : de.common.save" :loading="busy" :disabled="busy" />
            <UButton type="button" color="neutral" variant="ghost" :label="de.common.cancel" @click="open = false" />
          </div>
        </form>
      </template>
    </UModal>
  </ChildrenChildSection>
</template>
