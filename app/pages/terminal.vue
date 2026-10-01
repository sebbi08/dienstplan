<script setup lang="ts">
import { formatTime } from '#shared/domain/time'
import type { StampAction, TerminalPersonDto, TimeRecordDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'

const { data: people, refresh, error } = await useFetch<TerminalPersonDto[]>('/api/terminal/status')
const chosenId = ref<number | null>(null)
// Derived from the refreshed list so a poll updates the clock-in/out state of the button.
const chosen = computed(() => people.value?.find(person => person.employeeId === chosenId.value) ?? null)
const pin = ref('')
const message = ref('')
const failure = ref('')
const busy = ref(false)
let resetTimer: ReturnType<typeof setTimeout> | undefined
let poll: ReturnType<typeof setInterval> | undefined
let unmounted = false
// Incremented on every choose/back so late responses of an earlier selection are ignored.
let epoch = 0

// Keep the green dots current when several people use the tablet (client only).
onMounted(() => {
  poll = setInterval(() => refresh(), 30_000)
})
onBeforeUnmount(() => {
  unmounted = true
  clearInterval(poll)
  clearTimeout(resetTimer)
})

function choose(person: TerminalPersonDto) {
  epoch++
  chosenId.value = person.employeeId
  pin.value = ''
  failure.value = ''
  message.value = ''
}

function backToList() {
  epoch++
  clearTimeout(resetTimer)
  chosenId.value = null
  pin.value = ''
  failure.value = ''
  message.value = ''
  refresh()
}

function press(digit: string) {
  if (!busy.value && pin.value.length < 4) pin.value += digit
}

async function submit(action: StampAction) {
  const person = chosen.value
  if (busy.value || !person || pin.value.length !== 4) return
  const startedEpoch = epoch
  const isStale = () => unmounted || startedEpoch !== epoch || chosenId.value !== person.employeeId
  busy.value = true
  try {
    const record = await $fetch<TimeRecordDto>('/api/terminal/stamp', { method: 'POST', body: { employeeId: person.employeeId, pin: pin.value, action } })
    if (isStale()) return
    message.value = de.time.stamped(action, formatTime(action === 'in' ? record.start : record.end ?? record.start))
    failure.value = ''
    pin.value = ''
    clearTimeout(resetTimer)
    resetTimer = setTimeout(backToList, 5000)
  }
  catch (caught) {
    if (isStale()) return
    failure.value = errorMessage(caught)
    pin.value = ''
  }
  finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-4">
    <h1 class="text-2xl font-semibold">{{ de.terminal.title }}</h1>
    <UAlert v-if="error" color="warning" variant="soft" :title="errorMessage(error)" />

    <template v-else-if="!chosen">
      <p class="text-gray-600">{{ de.terminal.choose }}</p>
      <p v-if="!people?.length" class="text-gray-500">{{ de.terminal.empty }}</p>
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <button
          v-for="person in people ?? []" :key="person.employeeId" type="button"
          class="flex items-center gap-2 rounded-xl bg-white p-5 text-left text-lg font-medium ring-1 ring-gray-200 hover:bg-sky-50"
          @click="choose(person)"
        >
          <span class="size-3 rounded-full" :class="person.clockedIn ? 'bg-green-500' : 'bg-gray-300'" />
          {{ person.name }}
        </button>
      </div>
    </template>

    <section v-else class="mx-auto max-w-sm space-y-4 rounded-xl bg-white p-5 text-center ring-1 ring-gray-200">
      <h2 class="text-xl font-semibold">{{ chosen.name }}</h2>
      <template v-if="message">
        <p class="text-2xl font-semibold text-green-700">{{ message }}</p>
        <UButton size="xl" color="neutral" variant="outline" :label="de.terminal.back" @click="backToList" />
      </template>
      <template v-else>
        <div class="text-3xl tracking-[0.5em]" :aria-label="de.terminal.pin">{{ '•'.repeat(pin.length).padEnd(4, '–') }}</div>
        <p v-if="failure" class="text-sm text-red-600">{{ failure }}</p>
        <div class="grid grid-cols-3 gap-2">
          <UButton v-for="digit in ['1', '2', '3', '4', '5', '6', '7', '8', '9']" :key="digit" size="xl" color="neutral" variant="outline" class="justify-center" :disabled="busy" :label="digit" @click="press(digit)" />
          <UButton size="xl" color="neutral" variant="ghost" class="justify-center" icon="i-lucide-delete" :disabled="busy" :aria-label="de.common.delete" @click="pin = pin.slice(0, -1)" />
          <UButton size="xl" color="neutral" variant="outline" class="justify-center" :disabled="busy" label="0" @click="press('0')" />
          <UButton size="xl" color="neutral" variant="ghost" class="justify-center" icon="i-lucide-x" :aria-label="de.terminal.back" @click="backToList" />
        </div>
        <UButton
          block size="xl" :disabled="pin.length !== 4 || busy" :loading="busy" :color="chosen.clockedIn ? 'warning' : 'success'"
          :label="chosen.clockedIn ? de.time.clockOut : de.time.clockIn" @click="submit(chosen.clockedIn ? 'out' : 'in')"
        />
      </template>
    </section>
  </div>
</template>
