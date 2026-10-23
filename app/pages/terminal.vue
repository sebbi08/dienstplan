<script setup lang="ts">
import { PIN_LENGTH } from '#shared/domain/pin'
import { formatTime } from '#shared/domain/time'
import type { StampAction, TabletUnlockStatusDto, TerminalPersonDto, TimeRecordDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'

type Mode = 'start' | 'stamp' | 'children'

const { onTablet, unlock, lock } = useChildRights()
// The tablet starts with the choice between stamping and the child records; anybody else only stamps here.
const mode = ref<Mode>(onTablet.value ? 'start' : 'stamp')
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
  // Coming (back) to the start page ends any unlock of the child records.
  lock()
})
onBeforeUnmount(() => {
  unmounted = true
  clearInterval(poll)
  clearTimeout(resetTimer)
})

/** Start page and stamping lock the child records, so the next person never inherits the previous unlock. */
function setMode(next: Mode) {
  backToList()
  mode.value = next
  if (next !== 'children') lock()
}

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

async function submit(action: StampAction) {
  const person = chosen.value
  if (busy.value || !person || pin.value.length !== PIN_LENGTH) return
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

async function openChildren() {
  const person = chosen.value
  if (busy.value || !person || pin.value.length !== PIN_LENGTH) return
  const startedEpoch = epoch
  const isStale = () => unmounted || startedEpoch !== epoch || chosenId.value !== person.employeeId || mode.value !== 'children'
  busy.value = true
  try {
    const status = await $fetch<TabletUnlockStatusDto>('/api/terminal/children/unlock', { method: 'POST', body: { employeeId: person.employeeId, pin: pin.value } })
    if (isStale()) {
      // The person went back meanwhile: do not leave the records unlocked behind their back.
      lock()
      return
    }
    unlock.value = status
    await navigateTo('/children')
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
    <template v-if="mode === 'start'">
      <h1 class="text-2xl font-semibold">{{ de.terminal.startTitle }}</h1>
      <div class="grid gap-4 sm:grid-cols-3">
        <button
          type="button" class="flex flex-col items-center gap-3 rounded-xl bg-white p-10 text-2xl font-semibold ring-1 ring-gray-200 hover:bg-sky-50"
          @click="setMode('stamp')"
        >
          <UIcon name="i-lucide-clock" class="size-12 text-sky-700" />
          {{ de.terminal.title }}
        </button>
        <button
          type="button" class="flex flex-col items-center gap-3 rounded-xl bg-white p-10 text-2xl font-semibold ring-1 ring-gray-200 hover:bg-sky-50"
          @click="setMode('children')"
        >
          <UIcon name="i-lucide-baby" class="size-12 text-sky-700" />
          {{ de.terminal.childrenTitle }}
        </button>
        <!-- Blank forms to print: no child data, so no PIN is needed. -->
        <NuxtLink
          to="/templates" class="flex flex-col items-center gap-3 rounded-xl bg-white p-10 text-2xl font-semibold ring-1 ring-gray-200 hover:bg-sky-50"
        >
          <UIcon name="i-lucide-printer" class="size-12 text-sky-700" />
          {{ de.terminal.templatesTitle }}
        </NuxtLink>
      </div>
    </template>

    <template v-else>
      <div class="flex items-center gap-3">
        <h1 class="text-2xl font-semibold">{{ mode === 'children' ? de.terminal.childrenTitle : de.terminal.title }}</h1>
        <UButton v-if="onTablet" class="ml-auto" size="lg" color="neutral" variant="outline" icon="i-lucide-arrow-left" :label="de.terminal.toStart" @click="setMode('start')" />
      </div>
      <UAlert v-if="error" color="warning" variant="soft" :title="errorMessage(error)" />

      <template v-else-if="!chosen">
        <p class="text-gray-600">{{ mode === 'children' ? de.terminal.chooseChildren : de.terminal.choose }}</p>
        <p v-if="!people?.length" class="text-gray-500">{{ de.terminal.empty }}</p>
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <button
            v-for="person in people ?? []" :key="person.employeeId" type="button"
            class="flex items-center gap-2 rounded-xl bg-white p-5 text-left text-lg font-medium ring-1 ring-gray-200 hover:bg-sky-50"
            @click="choose(person)"
          >
            <span v-if="mode === 'stamp'" class="size-3 rounded-full" :class="person.clockedIn ? 'bg-green-500' : 'bg-gray-300'" />
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
          <TerminalPinPad v-model="pin" :busy="busy" @back="backToList">
            <p v-if="failure" class="text-sm text-red-600">{{ failure }}</p>
          </TerminalPinPad>
          <UButton
            v-if="mode === 'children'" block size="xl" :disabled="pin.length !== PIN_LENGTH || busy" :loading="busy"
            :label="de.terminal.unlock" @click="openChildren"
          />
          <UButton
            v-else block size="xl" :disabled="pin.length !== PIN_LENGTH || busy" :loading="busy" :color="chosen.clockedIn ? 'warning' : 'success'"
            :label="chosen.clockedIn ? de.time.clockOut : de.time.clockIn" @click="submit(chosen.clockedIn ? 'out' : 'in')"
          />
        </template>
      </section>
    </template>
  </div>
</template>
