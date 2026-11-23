<script setup lang="ts">
import { PIN_LENGTH } from '#shared/domain/pin'
import type { KnowledgeConfirmResultDto, KnowledgeEntryDto, TerminalPersonDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorCode, errorMessage } from '~/utils/errors'

/**
 * „Gelesen und verstanden“ at the facility's tablet: the person taps their name (the tablet's list, as for stamping) and
 * enters their PIN; the confirmation is theirs. The PIN counts like stamping (the same attempts and lock). The version
 * shown is sent along: an entry changed meanwhile is refused before the PIN is looked at, the dialog closes and the list reloads (changed).
 */
const props = defineProps<{ entry: KnowledgeEntryDto | null }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ confirmed: [result: KnowledgeConfirmResultDto]; changed: [message: string] }>()

const t = de.knowledge.tablet
const people = ref<TerminalPersonDto[]>([])
const loadError = ref('')
const person = ref<TerminalPersonDto | null>(null)
const pin = ref('')
const busy = ref(false)
const failure = ref('')

watch(open, async (isOpen) => {
  if (!isOpen) return
  person.value = null
  pin.value = ''
  failure.value = ''
  loadError.value = ''
  try {
    people.value = await $fetch<TerminalPersonDto[]>('/api/terminal/status')
  }
  catch (error) {
    loadError.value = errorMessage(error)
  }
})

function choose(next: TerminalPersonDto) {
  person.value = next
  pin.value = ''
  failure.value = ''
}

// The PIN is sent as soon as all its digits are typed, as at stamping.
watch(pin, async (value) => {
  if (value.length !== PIN_LENGTH || !person.value || !props.entry || busy.value) return
  busy.value = true
  failure.value = ''
  try {
    const result = await $fetch<KnowledgeConfirmResultDto>(`/api/knowledge/${props.entry.id}/confirm`, {
      method: 'POST', body: { version: props.entry.version, employeeId: person.value.employeeId, pin: value },
    })
    open.value = false
    emit('confirmed', result)
  }
  catch (error) {
    failure.value = errorMessage(error)
    pin.value = ''
    // The entry changed meanwhile: back to the list, which loads it again (and says why).
    if (errorCode(error) === 'knowledge_entry_changed') {
      open.value = false
      emit('changed', failure.value)
    }
  }
  finally {
    busy.value = false
  }
})
</script>

<template>
  <UModal v-model:open="open" :title="t.title" :description="entry?.title">
    <template #body>
      <UAlert v-if="loadError" color="warning" variant="soft" :title="loadError" />
      <div v-else-if="!person" class="space-y-3">
        <p class="text-sm font-medium">{{ t.who }}</p>
        <p v-if="!people.length" class="text-sm text-gray-500">{{ t.noPeople }}</p>
        <div v-else class="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <UButton
            v-for="candidate in people" :key="candidate.employeeId" size="xl" color="neutral" variant="outline" class="min-h-14 justify-center"
            :label="candidate.name" @click="choose(candidate)"
          />
        </div>
      </div>
      <div v-else class="mx-auto flex max-w-xs flex-col items-center gap-3">
        <p class="text-sm font-medium">{{ t.pinFor(person.name) }}</p>
        <TerminalPinPad v-model="pin" :busy="busy" @back="person = null">
          <p v-if="failure" class="text-sm text-red-700" role="alert">{{ failure }}</p>
        </TerminalPinPad>
      </div>
    </template>
  </UModal>
</template>
