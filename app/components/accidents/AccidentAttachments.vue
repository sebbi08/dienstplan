<script setup lang="ts">
import { MAX_ACCIDENT_ATTACHMENTS } from '#shared/domain/accidents'
import type { AccidentAttachmentDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { MAX_DOCUMENT_BYTES, formatSize } from '~/utils/children'
import { uploadSizeError } from '~/utils/uploads'
import { formatDateTime } from '~/utils/format'

/**
 * The files attached to an accident report (photos, PDF): upload where the report may be changed (at the tablet also a
 * photo with the camera, as for the child documents), open, delete (the uploader and Leitung/Träger: `canDelete`). At the tablet a file opens in the app's viewer only
 * (no download, no link to the file); in the office it opens in a new tab or downloads.
 */
const props = defineProps<{
  formId: number
  attachments: AccidentAttachmentDto[]
  /** e.g. /api/child-accidents: uploads go to `${formBase}/<formId>/attachments`. */
  formBase: string
  /** e.g. /api/child-accident-attachments: files at `${attachmentBase}/<id>/file`, deleted at `${attachmentBase}/<id>`. */
  attachmentBase: string
  editable: boolean
  onTablet?: boolean
  refresh: () => Promise<unknown>
}>()
const a = de.accidents
const { busy, run } = useBusyAction(() => props.refresh())
const confirm = useConfirm()
const toast = useToast()
const fileInput = ref<HTMLInputElement | null>(null)
const cameraInput = ref<HTMLInputElement | null>(null)
const viewing = ref<AccidentAttachmentDto | null>(null)
const fileUrl = (id: number, download = false) => `${props.attachmentBase}/${id}/file${download ? '?download=1' : ''}`
const full = computed(() => props.attachments.length >= MAX_ACCIDENT_ATTACHMENTS)

async function upload(event: Event) {
  const input = event.target as HTMLInputElement
  const chosen = input.files?.[0]
  input.value = ''
  if (!chosen) return
  // Fail early instead of after a long upload; the server checks the size and the real type again.
  if (chosen.size > MAX_DOCUMENT_BYTES) return void toast.add({ title: uploadSizeError(chosen.size)!, color: 'error' })
  const body = new FormData()
  body.append('file', chosen)
  await run(() => $fetch<{ id: number }>(`${props.formBase}/${props.formId}/attachments`, { method: 'POST', body }), a.attachmentSaved)
}

async function remove(file: AccidentAttachmentDto) {
  if (!await confirm(a.attachmentDeleteConfirm(file.fileName), { danger: true })) return
  await run(() => $fetch<{ ok: boolean }>(`${props.attachmentBase}/${file.id}`, { method: 'DELETE' }), de.common.deleted)
}

const iconLink = 'inline-flex size-9 items-center justify-center rounded-md text-gray-600 hover:bg-gray-100'
</script>

<template>
  <div class="space-y-2 rounded-md bg-white p-3 ring-1 ring-gray-200">
    <div class="flex flex-wrap items-center gap-2">
      <h3 class="font-semibold">{{ a.attachments }}</h3>
      <span class="text-xs text-gray-500">{{ a.attachmentsHint }}</span>
    </div>
    <p v-if="!attachments.length" class="text-sm text-gray-500">{{ a.attachmentsNone }}</p>
    <ul v-else class="divide-y divide-gray-100">
      <li v-for="file in attachments" :key="file.id" class="flex flex-wrap items-center gap-2 py-2 text-sm">
        <UIcon :name="file.mimeType === 'application/pdf' ? 'i-lucide-file-text' : 'i-lucide-image'" class="size-5 shrink-0 text-gray-500" aria-hidden="true" />
        <div class="min-w-0 flex-1 basis-40">
          <button v-if="onTablet" type="button" class="text-left font-medium break-all text-sky-700 hover:underline" @click="viewing = file">{{ file.fileName }}</button>
          <a v-else :href="fileUrl(file.id)" target="_blank" rel="noopener" class="font-medium break-all text-sky-700 hover:underline">{{ file.fileName }}</a>
          <p class="text-xs text-gray-500">{{ formatSize(file.size) }} · {{ file.uploadedByName }} · {{ formatDateTime(file.uploadedAt) }}</p>
        </div>
        <a
          v-if="!onTablet" :href="fileUrl(file.id, true)" :class="iconLink" :aria-label="`${a.attachmentDownload}: ${file.fileName}`"
          :title="a.attachmentDownload"
        ><UIcon name="i-lucide-download" class="size-4" /></a>
        <UButton
          v-if="editable && file.canDelete" class="min-h-9" size="sm" color="error" variant="ghost" icon="i-lucide-trash-2" :disabled="busy"
          :aria-label="`${a.attachmentDelete}: ${file.fileName}`" @click="remove(file)"
        />
      </li>
    </ul>
    <div v-if="editable && !full" class="flex flex-wrap items-center gap-2">
      <!-- No `capture` on the file input: it would force the camera; the tablet has its own photo button. -->
      <input ref="fileInput" type="file" accept="application/pdf,image/jpeg,image/png" class="hidden" @change="upload">
      <UButton class="min-h-11" color="neutral" variant="outline" icon="i-lucide-paperclip" :label="a.attach" :loading="busy" @click="fileInput?.click()" />
      <template v-if="onTablet">
        <input ref="cameraInput" type="file" accept="image/*" capture="environment" class="hidden" @change="upload">
        <UButton class="min-h-11" color="neutral" variant="outline" icon="i-lucide-camera" :label="a.takePhoto" :disabled="busy" @click="cameraInput?.click()" />
      </template>
    </div>
    <ChildrenDocumentViewer
      v-if="viewing" :open="true" :document-id="viewing.id" :url="fileUrl(viewing.id)" :title="viewing.fileName"
      :mime-type="viewing.mimeType" @update:open="viewing = null"
    />
  </div>
</template>
