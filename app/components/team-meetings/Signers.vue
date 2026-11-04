<script setup lang="ts">
import { PIN_LENGTH } from '#shared/domain/pin'
import type { TeamMeetingDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { formatDateTime } from '~/utils/format'
import { countsAsSigner, signingProgress } from '~/utils/teamMeetings'

/**
 * „Unterzeichnet“ under the minutes: every participant chosen from the staff, signed (with the time) or still open
 * (in the draft: after the release), and „N von M unterzeichnet“. With an own account the member signs for themselves
 * („Gelesen und unterzeichnen“, asked first); at the tablet one picks their name among the open participants and types
 * their PIN. Not shown when no participant was chosen.
 */
const props = defineProps<{ meeting: TeamMeetingDto; tablet: boolean }>()
const emit = defineEmits<{ signed: [meeting: TeamMeetingDto] }>()
const t = de.teamMeetings
const confirm = useConfirm()
const run = useAction()

const released = computed(() => props.meeting.state === 'released')
const progress = computed(() => signingProgress(props.meeting.signers))
// Only those still employees can sign (one deleted for good never can).
const openItems = computed(() => props.meeting.signers.flatMap(signer =>
  signer.signedAt === null && signer.employeeId !== null ? [{ label: signer.name, value: signer.employeeId }] : []))

const busy = ref(false)
async function sign(body: { employeeId?: number; pin?: string }): Promise<boolean> {
  busy.value = true
  const ok = await run(async () => {
    emit('signed', await $fetch<TeamMeetingDto>(`/api/team-meetings/${props.meeting.id}/sign`, { method: 'POST', body }))
  }, t.signed)
  busy.value = false
  return ok
}
async function signOwn() {
  if (!await confirm(t.signConfirm, { confirmLabel: t.sign, danger: false })) return
  await sign({})
}

const dialogOpen = ref(false)
const employeeId = ref<number | undefined>(undefined)
const pin = ref('')
function openDialog() {
  employeeId.value = openItems.value.length === 1 ? openItems.value[0]!.value : undefined
  pin.value = ''
  dialogOpen.value = true
}
async function signAtTablet() {
  if (employeeId.value === undefined || pin.value.length !== PIN_LENGTH) return
  const ok = await sign({ employeeId: employeeId.value, pin: pin.value })
  pin.value = ''
  if (ok) dialogOpen.value = false
}
</script>

<template>
  <section v-if="meeting.signers.length" class="space-y-3 rounded-lg bg-white p-3 ring-1 ring-gray-200 sm:p-4">
    <div class="flex flex-wrap items-center gap-2">
      <h2 class="font-semibold">{{ t.signersTitle }}</h2>
      <span class="text-sm text-gray-600">{{ t.signedCount(progress.signed, progress.total) }}</span>
    </div>
    <ul class="space-y-1 text-sm">
      <li v-for="(signer, index) in meeting.signers" :key="signer.employeeId ?? `deleted-${index}`" class="flex flex-wrap items-baseline gap-x-2">
        <template v-if="signer.signedAt">
          <span class="font-medium break-words"><span class="text-green-700" aria-hidden="true">✓</span> {{ signer.name }}</span>
          <span class="text-gray-600">{{ t.signedAt(formatDateTime(signer.signedAt)) }}</span>
        </template>
        <span v-else-if="!countsAsSigner(signer)" class="break-words text-gray-400">{{ signer.name }}</span>
        <template v-else>
          <span class="break-words">{{ signer.name }}</span>
          <span :class="released ? 'text-amber-700' : 'text-gray-500'">{{ released ? t.signOpen : t.signAfterRelease }}</span>
        </template>
      </li>
    </ul>
    <UButton
      v-if="!tablet && meeting.mineOpen" class="min-h-11" color="success" icon="i-lucide-pen-line" :label="t.sign"
      :loading="busy" @click="signOwn"
    />
    <UButton
      v-else-if="tablet && released && openItems.length" class="min-h-11" color="success" icon="i-lucide-pen-line"
      :label="t.signTablet" @click="openDialog"
    />

    <UModal v-model:open="dialogOpen" :title="t.signTablet" :description="meeting.title">
      <template #body>
        <form class="space-y-3" @submit.prevent="signAtTablet()">
          <UFormField :label="t.signName" required>
            <USelect v-model="employeeId" :items="openItems" size="xl" class="w-full" :aria-label="t.signName" />
          </UFormField>
          <UFormField :label="t.signPin" :description="t.signPinHint" required>
            <UInput
              v-model="pin" type="password" inputmode="numeric" :maxlength="PIN_LENGTH" autocomplete="off" size="xl"
              class="w-full"
            />
          </UFormField>
          <div class="flex flex-wrap justify-end gap-2">
            <UButton class="min-h-11" color="neutral" variant="ghost" :label="de.common.cancel" @click="dialogOpen = false" />
            <UButton
              type="submit" class="min-h-11" color="success" :label="t.signTablet" :loading="busy"
              :disabled="employeeId === undefined || pin.length !== PIN_LENGTH"
            />
          </div>
        </form>
      </template>
    </UModal>
  </section>
</template>
