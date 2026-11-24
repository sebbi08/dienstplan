<script setup lang="ts">
import { todayIso } from '#shared/domain/dates'
import { DECLINE_REASON_MAX, signatureFooter } from '#shared/domain/signRequests'
import type { MySignRequestDto, MySignRequestsDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorCode, errorMessage } from '~/utils/errors'
import { formatDate, formatDateTime } from '~/utils/format'

/**
 * The open requests to sign of one person: with the own account (Meins → Zu unterschreiben, `base` /api/my/sign-requests)
 * or at the tablet unlocked with their PIN (/api/terminal/sign-requests, only that person's). Overdue ones are marked, a
 * reminder of the Leitung shows. „Öffnen und unterschreiben“ opens the PDF in the fill view with the signature tool (form
 * fields and text for place and date allowed); „Unterschreiben“ asks for the confirmation, writes the line
 * „Elektronisch unterschrieben von …“ onto the last page and stores the signed copy in the personnel file. „Nicht
 * unterschreiben“ asks for a reason. The drawn signature exists only in the signed PDF.
 */
const props = defineProps<{ base: string }>()
/** `locked`: at the tablet the sign unlock ran out (or ended elsewhere): the tablet goes back to its start page. */
const emit = defineEmits<{ changed: []; locked: [] }>()
const t = de.signRequests
const toast = useToast()

const data = ref<MySignRequestsDto | null>(null)
const loadError = ref<string | null>(null)

async function load() {
  loadError.value = null
  try {
    data.value = await $fetch<MySignRequestsDto>(props.base)
  }
  catch (error) {
    if (lockedBy(error)) return
    loadError.value = errorMessage(error)
  }
}
onMounted(load)

/** The tablet's sign unlock is over: say so and hand back to the start page (nothing of the person stays on screen). */
function lockedBy(error: unknown): boolean {
  // A PDF fetched as bytes (the fill view) carries no JSON body: then the status text has the code.
  const code = errorCode(error) ?? (error as { statusMessage?: string } | null)?.statusMessage
  if (code !== 'sign_locked') return false
  toast.add({ title: de.errors.sign_locked, color: 'warning' })
  signing.value = null
  emit('locked')
  return true
}

const signing = ref<MySignRequestDto | null>(null)
const signOpen = ref(false)
function startSigning(request: MySignRequestDto) {
  signing.value = request
  signOpen.value = true
}
function onSignOpen(value: boolean) {
  if (!value) signing.value = null
}

async function finished(text: string) {
  toast.add({ title: text, color: 'success' })
  await load()
  emit('changed')
}

/** The fill view's „Unterschreiben“: the confirmation, a placed signature, the footer line, then the signed copy is sent. */
const submit = computed(() => {
  const request = signing.value
  const name = data.value?.employeeName ?? ''
  return {
    label: t.sign, icon: 'i-lucide-signature', confirm: t.signConfirm, needsSignature: true,
    footer: (at: Date) => signatureFooter(name, at),
    handler: async (pdf: Blob) => {
      if (!request) return
      const body = new FormData()
      body.append('file', pdf, 'Unterschrieben.pdf')
      try {
        await $fetch<{ documentId: number }>(`${props.base}/${request.recipientId}/sign`, { method: 'POST', body })
      }
      catch (error) {
        if (lockedBy(error)) return
        throw error
      }
      await finished(t.signed)
    },
  }
})
const secondary = computed(() => {
  // Taken now: the fill view closes (and forgets the request) before it calls the handler.
  const request = signing.value
  return { label: t.decline, icon: 'i-lucide-circle-x', handler: () => { if (request) startDecline(request) } }
})

// „Nicht unterschreiben“ with a reason.
const declining = ref<MySignRequestDto | null>(null)
const declineOpen = ref(false)
const reason = ref('')
const busy = ref(false)
function startDecline(request: MySignRequestDto) {
  declining.value = request
  reason.value = ''
  declineOpen.value = true
}
async function decline() {
  const request = declining.value
  if (!request || busy.value || reason.value.trim() === '') return
  busy.value = true
  try {
    await $fetch<unknown>(`${props.base}/${request.recipientId}/decline`, { method: 'POST', body: { reason: reason.value } })
    declineOpen.value = false
    await finished(t.declined)
  }
  catch (error) {
    if (lockedBy(error)) declineOpen.value = false
    else toast.add({ title: errorMessage(error), color: 'error' })
  }
  finally {
    busy.value = false
  }
}

defineExpose({ reload: load })
</script>

<template>
  <div class="space-y-3">
    <UAlert v-if="loadError" color="warning" variant="soft" :title="loadError" />
    <p v-else-if="data && !data.requests.length" class="text-gray-600">{{ t.myNone }}</p>
    <ul v-else-if="data" class="space-y-3">
      <li
        v-for="request in data.requests" :key="request.recipientId" class="space-y-2 rounded-xl bg-white p-4 ring-1"
        :class="request.overdue ? 'ring-red-300' : request.remindedAt ? 'ring-amber-300' : 'ring-gray-200'"
      >
        <div class="flex flex-wrap items-center gap-2">
          <h2 class="min-w-0 flex-1 text-lg font-semibold break-words">{{ request.title }}</h2>
          <span v-if="request.overdue" class="rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-800">{{ t.overdue }}</span>
          <span v-else-if="request.remindedAt" class="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900">{{ t.reminder }}</span>
        </div>
        <p class="text-sm text-gray-600">
          {{ t.from(request.sentBy, formatDate(todayIso(new Date(request.sentAt)))) }}
          <template v-if="request.dueDate"> · {{ t.dueOn(formatDate(request.dueDate)) }}</template>
          <template v-if="request.remindedAt"> · {{ t.remindedOn(formatDateTime(request.remindedAt)) }}</template>
        </p>
        <p v-if="request.note" class="whitespace-pre-line text-sm text-gray-800">{{ request.note }}</p>
        <div class="flex flex-wrap gap-2">
          <UButton size="lg" icon="i-lucide-signature" :label="t.open" @click="startSigning(request)" />
          <UButton size="lg" color="neutral" variant="outline" icon="i-lucide-circle-x" :label="t.decline" @click="startDecline(request)" />
        </div>
      </li>
    </ul>
    <p v-if="data && data.requests.length" class="text-xs text-gray-500">{{ t.simpleSignature }}</p>

    <PdfFillDialog
      v-if="signing" v-model:open="signOpen" :source="{ url: `${base}/${signing.recipientId}/file`, title: signing.title }"
      :submit="submit" :secondary="secondary" :subtitle="data?.employeeName" :hint="t.signHint" @update:open="onSignOpen" @load-failed="lockedBy"
    />

    <UModal v-model:open="declineOpen" :title="declining ? t.declineTitle(declining.title) : t.decline" :dismissible="!busy">
      <template #body>
        <form class="space-y-3" @submit.prevent="decline">
          <UFormField :label="t.declineReason" required>
            <UTextarea v-model="reason" :rows="3" :maxlength="DECLINE_REASON_MAX" class="w-full" required autofocus />
          </UFormField>
          <div class="flex gap-2">
            <UButton type="submit" color="error" :label="t.decline" :loading="busy" :disabled="busy || !reason.trim()" />
            <UButton type="button" color="neutral" variant="ghost" :label="de.common.cancel" :disabled="busy" @click="declineOpen = false" />
          </div>
        </form>
      </template>
    </UModal>
  </div>
</template>
