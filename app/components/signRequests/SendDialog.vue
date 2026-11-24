<script setup lang="ts">
import { todayIso } from '#shared/domain/dates'
import type { EmployeeDocumentFolder } from '#shared/domain/personnel'
import { SIGN_REQUEST_NOTE_MAX, SIGN_REQUEST_TITLE_MAX, writtenFormHint } from '#shared/domain/signRequests'
import type { EmployeeListItemDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'
import { searchTargets, usableFolders } from '~/utils/pdfFill'

/**
 * „Zum Unterschreiben senden“ (signRequests.manage): a template of „Vorlagen“ to employees of the facility, or a PDF of a
 * personnel file to its own employee (`recipient` fixed). Title, recipients, the folder of the personnel file for the
 * signed copies (one the sender may use), due date and note; a warning when the title suggests a document that needs the
 * written form. „Senden“ sends the PDF as it is, „Vorher ausfüllen“ opens it in the fill view first and sends exactly that
 * filled-in PDF to everyone.
 */
const props = defineProps<{
  source: { kind: 'template' | 'document'; id: number; title: string; url: string }
  /** A personnel document: only to this person. */
  recipient?: { id: number; name: string }
}>()
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ sent: [] }>()
const t = de.signRequests
const toast = useToast()
const { can } = useCan()

const form = reactive({ title: '', recipientIds: [] as number[], folder: 'correspondence' as EmployeeDocumentFolder, dueDate: '', note: '' })
const staff = ref<EmployeeListItemDto[] | null>(null)
const loadError = ref<string | null>(null)
const query = ref('')
const busy = ref(false)
const filling = ref(false)

const folders = computed(() => usableFolders(can))
const folderItems = computed(() => folders.value.map(folder => ({ label: de.personnel.folders[folder], value: folder })))
const active = computed(() => (staff.value ?? []).filter(person => person.leftOn === null || person.leftOn >= todayIso())
  .sort((a, b) => a.name.localeCompare(b.name, 'de')))
const shown = computed(() => searchTargets(active.value.map(person => ({ id: person.id, name: person.name })), query.value, 500))
const warning = computed(() => writtenFormHint(form.title))
const ready = computed(() => form.title.trim() !== '' && (props.recipient !== undefined || form.recipientIds.length > 0) && folders.value.length > 0)

async function loadStaff() {
  staff.value = null
  loadError.value = null
  try {
    staff.value = await $fetch<EmployeeListItemDto[]>('/api/employees')
  }
  catch (error) {
    loadError.value = errorMessage(error)
  }
}

watch(open, (isOpen) => {
  if (!isOpen) return
  Object.assign(form, {
    title: props.source.title.slice(0, SIGN_REQUEST_TITLE_MAX), recipientIds: props.recipient ? [props.recipient.id] : [],
    folder: folders.value.includes('correspondence') ? 'correspondence' : folders.value[0] ?? 'correspondence', dueDate: '', note: '',
  })
  query.value = ''
  if (!props.recipient) void loadStaff()
}, { immediate: true })

function toggle(id: number) {
  form.recipientIds = form.recipientIds.includes(id) ? form.recipientIds.filter(other => other !== id) : [...form.recipientIds, id]
}
function selectAll(all: boolean) {
  form.recipientIds = all ? active.value.map(person => person.id) : []
}

/** Sends the request: with the filled-in PDF, or (null) the source as it is. */
async function send(pdf: Blob | null) {
  const recipients = props.recipient ? [props.recipient.id] : form.recipientIds
  if (recipients.length === 0) throw new Error(t.noRecipients)
  const body = new FormData()
  body.append('title', form.title.trim())
  body.append('sourceKind', props.source.kind)
  body.append('sourceId', String(props.source.id))
  body.append('recipients', recipients.join(','))
  body.append('folder', form.folder)
  body.append('dueDate', form.dueDate)
  body.append('note', form.note)
  if (pdf) body.append('file', pdf, 'Dokument.pdf')
  await $fetch<{ id: number }>('/api/sign-requests', { method: 'POST', body })
  toast.add({ title: t.sent(recipients.length), color: 'success' })
  open.value = false
  emit('sent')
}

async function sendNow() {
  if (!ready.value || busy.value) return
  busy.value = true
  try {
    await send(null)
  }
  catch (error) {
    toast.add({ title: errorMessage(error), color: 'error' })
  }
  finally {
    busy.value = false
  }
}

/** „Vorher ausfüllen“: the fill view; its „Senden“ sends the filled-in PDF (errors stay in the fill view). */
function prefill() {
  if (!ready.value) return
  filling.value = true
}
const submit = computed(() => ({ label: t.prefillSend, icon: 'i-lucide-send', handler: (pdf: Blob) => send(pdf) }))
</script>

<template>
  <UModal v-model:open="open" :title="t.sendTitle(source.title)" :dismissible="!busy">
    <template #body>
      <form class="space-y-3" @submit.prevent="sendNow">
        <UFormField :label="t.titleLabel" required>
          <UInput v-model="form.title" :maxlength="SIGN_REQUEST_TITLE_MAX" class="w-full" required />
        </UFormField>
        <UAlert v-if="warning" color="warning" variant="soft" icon="i-lucide-triangle-alert" :title="t.writtenForm" />

        <p v-if="recipient" class="text-sm text-gray-700">{{ t.fixedRecipient(recipient.name) }}</p>
        <fieldset v-else class="space-y-2">
          <legend class="text-sm font-medium">{{ t.recipients }} <span class="text-gray-500">({{ t.chosen(form.recipientIds.length) }})</span></legend>
          <UAlert v-if="loadError" color="error" variant="soft" :title="loadError" />
          <p v-else-if="staff === null" class="text-sm text-gray-500">{{ t.loadingStaff }}</p>
          <p v-else-if="!active.length" class="text-sm text-gray-600">{{ t.noStaffAvailable }}</p>
          <template v-else>
            <div class="flex flex-wrap items-center gap-2">
              <UInput v-model="query" icon="i-lucide-search" :placeholder="t.searchStaff" :aria-label="t.searchStaff" class="min-w-48 flex-1" />
              <UButton type="button" size="xs" color="neutral" variant="outline" :label="t.allStaff" @click="selectAll(true)" />
              <UButton type="button" size="xs" color="neutral" variant="ghost" :label="t.noStaff" @click="selectAll(false)" />
            </div>
            <ul class="max-h-56 divide-y divide-gray-100 overflow-y-auto rounded-lg ring-1 ring-gray-200">
              <li v-for="person in shown" :key="person.id">
                <label class="flex min-h-10 cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50">
                  <input type="checkbox" class="size-4" :checked="form.recipientIds.includes(person.id)" @change="toggle(person.id)">
                  {{ person.name }}
                </label>
              </li>
            </ul>
          </template>
        </fieldset>

        <p v-if="!folders.length" class="text-sm text-red-700" role="alert">{{ t.noFolders }}</p>
        <UFormField v-else :label="t.folder" :description="t.folderHint" required>
          <USelect v-model="form.folder" :items="folderItems" class="w-full" />
        </UFormField>
        <UFormField :label="t.due">
          <DateTextInput v-model="form.dueDate" :label="t.due" :min="todayIso()" class="w-full" />
        </UFormField>
        <UFormField :label="t.note">
          <UTextarea v-model="form.note" :rows="2" :maxlength="SIGN_REQUEST_NOTE_MAX" class="w-full" />
        </UFormField>
        <p class="text-xs text-gray-600">{{ t.prefillHint }}</p>
        <div class="flex flex-wrap gap-2">
          <UButton type="submit" icon="i-lucide-send" :label="t.sendNow" :loading="busy" :disabled="busy || !ready" />
          <UButton type="button" color="neutral" variant="outline" icon="i-lucide-pencil-line" :label="t.prefill" :disabled="busy || !ready" @click="prefill" />
          <UButton type="button" color="neutral" variant="ghost" :label="de.common.cancel" :disabled="busy" @click="open = false" />
        </div>
      </form>
    </template>
  </UModal>

  <PdfFillDialog
    v-if="filling" v-model:open="filling" :source="{ url: source.url, title: form.title || source.title }" :submit="submit"
    :subtitle="t.send"
  />
</template>
