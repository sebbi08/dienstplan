<script setup lang="ts">
import { todayIso } from '#shared/domain/dates'
import type { EmployeeDocumentsDto, EmployeeRequiredDocumentDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { MAX_DOCUMENT_BYTES } from '~/utils/children'
import { formatDate, formatDateTime } from '~/utils/format'
import { employeeDocumentUrl } from '~/utils/personnel'
import { inspectionForm, inspectionInput } from '~/utils/requiredDocuments'
import { pickedFile, uploadSizeError } from '~/utils/uploads'

/**
 * Nachweise → „Pflichtdokumente“ of a person: each Pflichtdokument of the facility that applies to them, in a folder the
 * viewer may see (others are not shown at all), with its status – „vorhanden“ (the newest linked document, to open),
 * „fehlt“, „läuft ab am …“ (within 2 months of the end of validity), „abgelaufen“. „Hochladen“ files a new document into
 * the type's folder and links it; „Vorhandenes Dokument zuordnen“ links one of that folder (asking first if it is another
 * type's); „Ausfüllen“ fills the type's template, saved into its folder and linked in the same request; „Zum
 * Unterschreiben senden“ sends the template to the
 * person (signRequests.manage), its signed copy linked by itself. A type „nur Einsicht vermerken“ (the Führungszeugnis,
 * § 72a Abs. 5 SGB VIII) has none of these: „Einsicht vermerken“ records the certificate's date, optionally the day of
 * inspection, and the result – „keine einschlägige Eintragung“ or „einschlägige Eintragung vorhanden“ („Eintragung
 * vorhanden – bitte prüfen“), nothing preset, also not on „Neu vermerken“, saving only once one is chosen; a file kept for
 * it is shown with „Datei jetzt löschen“; who recorded, changed or deleted the record when is listed. A record left after
 * the type was switched back to „Datei“ stays read only with „Vermerk löschen“. The § 72a texts only for a type flagged
 * „§ 72a SGB VIII (Führungszeugnis)“, neutral ones otherwise. Loaded once the tab is opened.
 */
const props = defineProps<{ employeeId: number; employeeName: string; active: boolean }>()
const t = de.requiredDocuments
const { can } = useCan()
const toast = useToast()
const confirm = useConfirm()

const { data: rows, refresh, execute } = useFetch<EmployeeRequiredDocumentDto[]>(() => `/api/employees/${props.employeeId}/required-documents`, {
  immediate: false, watch: false, default: () => [],
})
watch(() => props.active, (active) => { if (active) void execute() }, { immediate: true })
const { busy, run } = useBusyAction(() => refresh())

const tone: Record<EmployeeRequiredDocumentDto['state'], 'success' | 'warning' | 'error'> = {
  present: 'success', expiring: 'warning', expired: 'error', missing: 'error', entry: 'error',
}
/** A type „§ 72a SGB VIII (Führungszeugnis)“ gets the texts naming the law, any other type „nur Einsicht“ neutral ones. */
const certificate = (row: EmployeeRequiredDocumentDto) => row.certificate
function stateText(row: EmployeeRequiredDocumentDto): string {
  if (row.state === 'missing') return t.states.missing
  if (row.state === 'entry') return certificate(row) ? t.entryState : t.entryStateGeneric
  if (row.state === 'expired') return t.expiredOn(formatDate(row.expiresOn!))
  if (row.state === 'expiring') return t.expiresOn(formatDate(row.expiresOn!))
  return t.presentOn(formatDate(row.date!))
}
/** „Führungszeugnis vom … · eingesehen am … · vermerkt von … am …“ under the name of the type. */
function inspectionText(row: EmployeeRequiredDocumentDto): string {
  const record = row.inspection
  if (!record) return ''
  const at = formatDateTime(record.recordedAt)
  return [
    (certificate(row) ? t.certificateOn : t.certificateOnGeneric)(formatDate(record.certificateDate)),
    record.inspectedOn ? t.inspectedOn(formatDate(record.inspectedOn)) : '',
    record.recordedBy ? t.recordedBy(record.recordedBy, at) : t.recordedByUnknown(at),
  ].filter(Boolean).join(' · ')
}
/** The audit lines: who recorded, changed or deleted the record and when. */
const historyText = (row: EmployeeRequiredDocumentDto) =>
  row.history.map(line => t.historyLine(line.action, line.by, formatDateTime(line.at))).join(' · ')
const templateUrl = (templateId: number) => `/api/print-templates/${templateId}/file`

// „Hochladen“: the date, an optional title (else the type's name), a note and the file.
const uploading = ref<EmployeeRequiredDocumentDto | null>(null)
const uploadOpen = ref(false)
const upload = reactive({ title: '', documentDate: todayIso(), note: '' })
const file = ref<File | null>(null)
function openUpload(row: EmployeeRequiredDocumentDto) {
  uploading.value = row
  Object.assign(upload, { title: '', documentDate: todayIso(), note: '' })
  file.value = null
  uploadOpen.value = true
}
function pick(event: Event) {
  file.value = pickedFile(event, toast, MAX_DOCUMENT_BYTES)
}
async function saveUpload() {
  const row = uploading.value
  const chosen = file.value
  if (!row || !chosen) return void toast.add({ title: de.errors.file_required, color: 'error' })
  if (chosen.size > MAX_DOCUMENT_BYTES) return void toast.add({ title: uploadSizeError(chosen.size)!, color: 'error' })
  const body = new FormData()
  body.append('file', chosen)
  body.append('title', upload.title)
  body.append('documentDate', upload.documentDate)
  body.append('note', upload.note)
  const ok = await run(() => $fetch<{ id: number }>(`/api/employees/${props.employeeId}/required-documents/${row.typeId}`, { method: 'POST', body }), t.uploaded)
  if (ok) uploadOpen.value = false
}

// „Vorhandenes Dokument zuordnen“: the person's documents in the type's folder.
const linking = ref<EmployeeRequiredDocumentDto | null>(null)
const linkOpen = ref(false)
const candidates = ref<EmployeeDocumentsDto[keyof EmployeeDocumentsDto]>([])
const chosenDocument = ref(0)
async function openLink(row: EmployeeRequiredDocumentDto) {
  linking.value = row
  chosenDocument.value = 0
  linkOpen.value = true
  const documents = await $fetch<EmployeeDocumentsDto>(`/api/employees/${props.employeeId}/documents`).catch(() => ({} as EmployeeDocumentsDto))
  candidates.value = documents[row.folder] ?? []
  chosenDocument.value = candidates.value.find(document => document.requiredTypeId === null)?.id ?? candidates.value[0]?.id ?? 0
}
/** The Pflichtdokument a document is linked to: its name if it is one of the box, else „einem anderen“. */
const typeName = (typeId: number) => rows.value?.find(other => other.typeId === typeId)?.name ?? t.otherType
const linkItems = computed(() => (candidates.value ?? []).map(document => ({
  value: document.id,
  label: [
    document.title || de.personnel.documents.untitled, formatDate(document.documentDate),
    document.requiredTypeId === null ? '' : t.linkedTo(typeName(document.requiredTypeId)),
  ].filter(Boolean).join(' · '),
})))
async function saveLink() {
  const row = linking.value
  if (!row || !chosenDocument.value) return
  // One document counts for one Pflichtdokument: taking it from another type asks first.
  const other = candidates.value?.find(document => document.id === chosenDocument.value)?.requiredTypeId ?? null
  if (other !== null && other !== row.typeId && !await confirm(t.relinkConfirm(typeName(other), row.name))) return
  const ok = await run(() => $fetch<{ ok: boolean }>(`/api/employee-documents/${chosenDocument.value}/required-type`, { method: 'PUT', body: { typeId: row.typeId } }), t.linked)
  if (ok) linkOpen.value = false
}

// „Ausfüllen“: the template in the fill view, saved into the type's folder (preset) and linked in the same request;
// saved into another folder there, it is not linked (said so).
const filling = ref<EmployeeRequiredDocumentDto | null>(null)
const fillOpen = ref(false)
function openFill(row: EmployeeRequiredDocumentDto) {
  filling.value = row
  fillOpen.value = true
}
function afterFill(result: { id: number | null; linked: boolean }) {
  if (!result.linked) toast.add({ title: t.fillNotLinked, color: 'warning' })
  void refresh()
}

// „Einsicht vermerken“: the certificate's date, optionally the day of inspection (neither in the future), and the result
// – one of two, nothing preset (also not on „Neu vermerken“), so it is always confirmed actively; nothing else is stored.
const recording = ref<EmployeeRequiredDocumentDto | null>(null)
const recordOpen = ref(false)
const record = reactive(inspectionForm('', todayIso()))
function openRecord(row: EmployeeRequiredDocumentDto) {
  recording.value = row
  Object.assign(record, inspectionForm(row.inspection?.certificateDate ?? '', row.inspection?.inspectedOn ?? todayIso()))
  recordOpen.value = true
}
const choiceItems = computed(() => {
  const named = !!recording.value && certificate(recording.value)
  return [
    { value: 'none', label: named ? t.noRelevantEntry : t.noRelevantEntryGeneric },
    { value: 'entry', label: named ? t.relevantEntry : t.relevantEntryGeneric },
  ]
})
const recordBody = computed(() => inspectionInput(record, todayIso()))
async function saveRecord() {
  const row = recording.value
  const body = recordBody.value
  if (!row || !body) return
  const ok = await run(() => $fetch<{ ok: boolean }>(`/api/employees/${props.employeeId}/required-inspections/${row.typeId}`, {
    method: 'PUT', body,
  }), t.recorded)
  if (ok) recordOpen.value = false
}
async function removeRecord(row: EmployeeRequiredDocumentDto) {
  if (!await confirm(t.removeRecordConfirm(row.name))) return
  await run(() => $fetch<{ ok: boolean }>(`/api/employees/${props.employeeId}/required-inspections/${row.typeId}`, { method: 'DELETE' }), t.recordRemoved)
}
/** „Datei jetzt löschen“: a file kept from before for a type „nur Einsicht vermerken“ (the folder's key, as every delete). */
async function deleteFile(file: EmployeeRequiredDocumentDto['storedFiles'][number]) {
  if (!await confirm(t.deleteFileConfirm(file.title || de.personnel.documents.untitled), { danger: true })) return
  await run(() => $fetch<unknown>(`/api/employee-documents/${file.id}`, { method: 'DELETE' }), t.fileDeleted)
}

// „Zum Unterschreiben senden“: the type's template to this person, the signed copy filed as the type.
const sending = ref<EmployeeRequiredDocumentDto | null>(null)
const sendOpen = ref(false)
function openSend(row: EmployeeRequiredDocumentDto) {
  sending.value = row
  sendOpen.value = true
}
</script>

<template>
  <section id="employee-section-required-documents" class="scroll-mt-32 space-y-3 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <h2 class="font-semibold">{{ t.title }}</h2>
    <p class="text-xs text-gray-500">{{ t.boxHint }}</p>
    <p v-if="!rows?.length" class="text-sm text-gray-500">{{ t.boxNone }}</p>
    <ul v-else class="divide-y divide-gray-100">
      <li v-for="row in rows" :key="row.typeId" class="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2">
        <div class="min-w-0 flex-1">
          <div class="font-medium">{{ row.name }}</div>
          <div class="text-xs text-gray-500">
            {{ de.personnel.folders[row.folder] }}<template v-if="row.mode === 'inspection'"> · {{ t.inspectionOnly }}</template>
          </div>
          <div v-if="row.inspection" class="text-xs text-gray-600">{{ inspectionText(row) }}</div>
          <div v-if="row.mode === 'file' && row.inspection" class="text-xs text-amber-800">{{ t.readOnlyRecord }}</div>
          <div v-if="row.history.length" class="text-xs text-gray-500">{{ t.historyTitle }}: {{ historyText(row) }}</div>
        </div>
        <UBadge size="sm" variant="soft" :color="tone[row.state]" :label="stateText(row)" />
        <div v-if="row.mode === 'inspection' || row.inspection" class="flex flex-wrap gap-1">
          <UButton
            v-if="row.mode === 'inspection'" size="xs" color="neutral" variant="outline" icon="i-lucide-eye" :label="row.inspection ? t.recordAgain : t.record"
            :disabled="busy" @click="openRecord(row)"
          />
          <UButton v-if="row.inspection" size="xs" color="neutral" variant="ghost" icon="i-lucide-x" :label="t.removeRecord" :disabled="busy" @click="removeRecord(row)" />
        </div>
        <div v-if="row.storedFiles.length" class="w-full space-y-1 rounded-md bg-amber-50 p-2 text-xs text-amber-900 ring-1 ring-amber-200">
          <p>{{ certificate(row) ? t.storedFile : t.storedFileGeneric }}</p>
          <div v-for="file in row.storedFiles" :key="file.id" class="flex flex-wrap items-center gap-2">
            <span class="min-w-0 break-words">{{ file.title || de.personnel.documents.untitled }} · {{ formatDate(file.documentDate) }}</span>
            <UButton size="xs" color="neutral" variant="outline" icon="i-lucide-external-link" :label="t.openFile" :to="employeeDocumentUrl(file.id)" target="_blank" />
            <UButton size="xs" color="error" variant="outline" icon="i-lucide-trash-2" :label="t.deleteFile" :disabled="busy" @click="deleteFile(file)" />
          </div>
        </div>
        <div v-if="row.mode === 'file'" class="flex flex-wrap gap-1">
          <UButton
            v-if="row.documentId !== null" size="xs" color="neutral" variant="outline" icon="i-lucide-external-link" :label="t.open"
            :to="employeeDocumentUrl(row.documentId)" target="_blank"
          />
          <UButton size="xs" color="neutral" variant="outline" icon="i-lucide-upload" :label="t.upload" :disabled="busy" @click="openUpload(row)" />
          <UButton v-if="row.templateId !== null" size="xs" color="neutral" variant="outline" icon="i-lucide-pencil-line" :label="t.fill" :disabled="busy" @click="openFill(row)" />
          <UButton
            v-if="row.templateId !== null && can('signRequests.manage')" size="xs" color="neutral" variant="outline" icon="i-lucide-signature"
            :label="t.sign" :disabled="busy" @click="openSend(row)"
          />
          <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-link" :label="t.link" :disabled="busy" @click="openLink(row)" />
        </div>
      </li>
    </ul>

    <UModal v-model:open="uploadOpen" :title="uploading ? t.uploadTitle(uploading.name) : t.upload">
      <template #body>
        <form class="space-y-3" @submit.prevent="saveUpload">
          <UFormField :label="t.file" required>
            <input type="file" accept="application/pdf,image/jpeg,image/png" class="block w-full text-sm" @change="pick">
          </UFormField>
          <UFormField :label="t.documentDate" required>
            <DateTextInput v-model="upload.documentDate" :label="t.documentDate" class="w-full" />
          </UFormField>
          <UFormField :label="de.personnel.documents.title">
            <UInput v-model="upload.title" maxlength="200" :placeholder="uploading?.name" class="w-full" />
          </UFormField>
          <UFormField :label="t.note">
            <UTextarea v-model="upload.note" :rows="2" maxlength="1000" class="w-full" />
          </UFormField>
          <div class="flex gap-2">
            <UButton type="submit" :label="t.upload" :loading="busy" :disabled="busy || !file" />
            <UButton type="button" color="neutral" variant="ghost" :label="de.common.cancel" @click="uploadOpen = false" />
          </div>
        </form>
      </template>
    </UModal>

    <UModal v-model:open="linkOpen" :title="linking ? t.linkTitle(linking.name) : t.link">
      <template #body>
        <form class="space-y-3" @submit.prevent="saveLink">
          <p v-if="!linkItems.length" class="text-sm text-gray-500">{{ t.linkNone }}</p>
          <URadioGroup v-else v-model="chosenDocument" :items="linkItems" />
          <div class="flex gap-2">
            <UButton type="submit" :label="t.link" :loading="busy" :disabled="busy || !chosenDocument" />
            <UButton type="button" color="neutral" variant="ghost" :label="de.common.cancel" @click="linkOpen = false" />
          </div>
        </form>
      </template>
    </UModal>

    <UModal v-model:open="recordOpen" :title="recording ? t.recordTitle(recording.name) : t.record">
      <template #body>
        <form class="space-y-3" @submit.prevent="saveRecord">
          <p class="text-xs text-gray-500">{{ recording && certificate(recording) ? t.recordHint : t.recordHintGeneric }}</p>
          <UFormField
            :label="recording && certificate(recording) ? t.certificateDate : t.certificateDateGeneric" :description="t.certificateDateHint" required
          >
            <DateTextInput
              v-model="record.certificateDate" :label="recording && certificate(recording) ? t.certificateDate : t.certificateDateGeneric"
              :max="todayIso()" class="w-full"
            />
          </UFormField>
          <UFormField :label="t.inspectionDate" :description="t.inspectionDateHint">
            <DateTextInput v-model="record.inspectedOn" :label="t.inspectionDate" :max="todayIso()" class="w-full" />
          </UFormField>
          <UFormField :label="t.choice" :description="recording?.inspection ? t.choiceAgainHint : t.choiceHint" required>
            <URadioGroup
              :model-value="record.choice ?? undefined" :items="choiceItems"
              @update:model-value="(value: string | undefined) => record.choice = value === 'none' || value === 'entry' ? value : null"
            />
          </UFormField>
          <div class="flex gap-2">
            <UButton type="submit" :label="t.record" :loading="busy" :disabled="busy || !recordBody" />
            <UButton type="button" color="neutral" variant="ghost" :label="de.common.cancel" @click="recordOpen = false" />
          </div>
        </form>
      </template>
    </UModal>

    <PdfFillDialog
      v-if="filling && filling.templateId !== null && fillOpen" v-model:open="fillOpen"
      :source="{ url: templateUrl(filling.templateId), title: filling.name }"
      :target="{ kind: 'employee', id: employeeId, name: employeeName, folder: filling.folder, requiredTypeId: filling.typeId }"
      @saved="afterFill"
    />
    <SignRequestsSendDialog
      v-if="sending && sending.templateId !== null" v-model:open="sendOpen"
      :source="{ kind: 'template', id: sending.templateId, title: sending.name, url: templateUrl(sending.templateId) }"
      :recipient="{ id: employeeId, name: employeeName }" :required-type="{ id: sending.typeId, folder: sending.folder }"
      @sent="refresh()"
    />
  </section>
</template>
