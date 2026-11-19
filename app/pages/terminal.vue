<script setup lang="ts">
import { parseIsoDate, todayIso } from '#shared/domain/dates'
import { PIN_LENGTH } from '#shared/domain/pin'
import { formatTime } from '#shared/domain/time'
import type { StampAction, TabletUnlockStatusDto, TerminalPersonDto, TimeRecordDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'
import { shiftMonth } from '~/utils/format'
import { isServerUnreachable, tabletClockTime } from '~/utils/offlineQueue'
import { pinFailureText } from '~/utils/pin'

type Mode = 'start' | 'stamp' | 'children'
/** A person of the list; clockedIn null = not known (the list kept for stamping without network has names only). */
type Person = Omit<TerminalPersonDto, 'clockedIn'> & { clockedIn: boolean | null }

const { onTablet, unlock, lock } = useChildRights()
// The tablet starts with the choice between stamping and the child records; anybody else only stamps here.
const mode = ref<Mode>(onTablet.value ? 'start' : 'stamp')
// Loaded in the browser (not with the page), so the page the tablet keeps for use without network carries no team data.
const people = ref<Person[] | null>(null)
const error = ref<unknown>(null)
// Stamping without network (docs/BETRIEB.md „Stempeln ohne Netz am Tablet“): only the tablet keeps stamps.
const offlineStamps = useOfflineStamps(onTablet.value, () => refresh())
const isOffline = computed(() => onTablet.value && offlineStamps.offline.value)

/**
 * The list with who is clocked in. Without an answer from the server the tablet shows the names it kept (who is clocked
 * in is not known then); every answer replaces the kept names and sends waiting stamps.
 */
async function refresh() {
  try {
    const list = await $fetch<TerminalPersonDto[]>('/api/terminal/status')
    people.value = list
    error.value = null
    if (onTablet.value) {
      offlineStamps.rememberTeam(list)
      offlineStamps.noteReachable()
    }
  }
  catch (caught) {
    if (onTablet.value && offlineStamps.available && isServerUnreachable(caught)) {
      offlineStamps.noteUnreachable()
      const kept = await offlineStamps.cachedTeam()
      people.value = kept.map(person => ({ ...person, clockedIn: null }))
      error.value = null
    }
    else error.value = caught
  }
}
const chosenId = ref<number | null>(null)
// Derived from the refreshed list so a poll updates the clock-in/out state of the button.
const chosen = computed(() => people.value?.find(person => person.employeeId === chosenId.value) ?? null)
/** Without network, or when not known, both buttons (Kommt and Geht) are offered. */
const bothActions = computed(() => isOffline.value || chosen.value?.clockedIn === null)
const printMenuOpen = ref(false)
/** This month's and next month's plan printout (the server shows the released plan only). */
/** The plan printout of this month (offset 0) or the next (1), by today's Berlin date at the moment of the tap. */
async function printPlan(offset: 0 | 1) {
  const today = parseIsoDate(todayIso())
  const target = shiftMonth(today.year, today.month, offset)
  printMenuOpen.value = false
  // The same tab, so a kiosk browser has no second window to get lost in; the printout leads back to the start page.
  await navigateTo(`/print/${target.year}/${target.month}`)
}
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
  refresh()
  poll = setInterval(() => refresh(), 30_000)
  // Coming (back) to the start page ends any unlock of the child records.
  lock()
  if (onTablet.value) offlineStamps.registerShell()
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

function choose(person: Person) {
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

/** The confirmation stays 5 seconds, then the list shows again. */
function confirmed(text: string) {
  message.value = text
  failure.value = ''
  pin.value = ''
  clearTimeout(resetTimer)
  resetTimer = setTimeout(backToList, 5000)
}

/** Keeps the stamp on the tablet with its clock now (PIN encrypted); it is sent once the server is reachable. */
async function keepOffline(person: Person, action: StampAction, pinValue: string, isStale: () => boolean) {
  try {
    const at = await offlineStamps.keep({ employeeId: person.employeeId, name: person.name, action, pin: pinValue })
    if (!isStale()) confirmed(de.terminal.offlineSaved(person.name, action, tabletClockTime(at)))
  }
  catch {
    if (isStale()) return
    failure.value = de.terminal.offlineUnavailable
    pin.value = ''
  }
}

async function submit(action: StampAction) {
  const person = chosen.value
  if (busy.value || !person || pin.value.length !== PIN_LENGTH) return
  const startedEpoch = epoch
  const isStale = () => unmounted || startedEpoch !== epoch || chosenId.value !== person.employeeId
  const pinValue = pin.value
  busy.value = true
  try {
    // Stamps still waiting go first, so the server gets them in order; while they cannot be sent, this one waits too.
    if (onTablet.value && offlineStamps.pending.value > 0) await offlineStamps.sync()
    if (onTablet.value && offlineStamps.available && (isOffline.value || offlineStamps.pending.value > 0)) {
      await keepOffline(person, action, pinValue, isStale)
      return
    }
    const record = await $fetch<TimeRecordDto>('/api/terminal/stamp', { method: 'POST', body: { employeeId: person.employeeId, pin: pinValue, action } })
    if (onTablet.value) offlineStamps.noteReachable()
    if (isStale()) return
    confirmed(de.time.stamped(action, formatTime(action === 'in' ? record.start : record.end ?? record.start)))
  }
  catch (caught) {
    if (onTablet.value && offlineStamps.available && isServerUnreachable(caught)) {
      offlineStamps.noteUnreachable()
      await keepOffline(person, action, pinValue, isStale)
      return
    }
    if (isStale()) return
    failure.value = pinFailureText(caught)
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
    // The child records are online only.
    if (isServerUnreachable(caught)) {
      offlineStamps.noteUnreachable()
      failure.value = de.terminal.childrenOffline
    }
    else failure.value = pinFailureText(caught)
    pin.value = ''
  }
  finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-4">
    <div
      v-if="isOffline || offlineStamps.pending.value > 0" role="status"
      class="space-y-0.5 rounded-xl bg-yellow-100 px-4 py-3 text-lg font-medium text-yellow-900 ring-1 ring-yellow-300"
    >
      <p v-if="isOffline" class="flex items-center gap-2">
        <UIcon name="i-lucide-wifi-off" class="size-6 shrink-0" />{{ de.terminal.offlineBar }}
      </p>
      <p v-if="offlineStamps.pending.value > 0">{{ de.terminal.offlinePending(offlineStamps.pending.value) }}</p>
    </div>

    <template v-if="mode === 'start'">
      <h1 class="text-2xl font-semibold">{{ de.terminal.startTitle }}</h1>
      <div class="grid gap-4 sm:grid-cols-2">
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
        <!-- The facility's notes, to read: no child data, so no PIN is needed either. -->
        <NuxtLink
          to="/notes" class="flex flex-col items-center gap-3 rounded-xl bg-white p-10 text-2xl font-semibold ring-1 ring-gray-200 hover:bg-sky-50"
        >
          <UIcon name="i-lucide-sticky-note" class="size-12 text-sky-700" />
          {{ de.terminal.notesTitle }}
        </NuxtLink>
        <!-- The released plan to print: nothing personal beyond what every employee sees, so no PIN. -->
        <div v-if="printMenuOpen" class="flex gap-3 sm:col-span-2">
          <button
            type="button" class="flex-1 rounded-xl bg-white p-6 text-center text-xl font-semibold ring-1 ring-gray-200 hover:bg-sky-50"
            @click="printPlan(0)"
          >
            {{ de.terminal.printPlanThisMonth }}
          </button>
          <button
            type="button" class="flex-1 rounded-xl bg-white p-6 text-center text-xl font-semibold ring-1 ring-gray-200 hover:bg-sky-50"
            @click="printPlan(1)"
          >
            {{ de.terminal.printPlanNextMonth }}
          </button>
        </div>
        <button
          v-else type="button" class="flex items-center justify-center gap-3 rounded-xl bg-white p-10 text-2xl font-semibold ring-1 ring-gray-200 hover:bg-sky-50 sm:col-span-2"
          @click="printMenuOpen = true"
        >
          <UIcon name="i-lucide-calendar-days" class="size-12 text-sky-700" />
          {{ de.terminal.printPlan }}
        </button>
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
        <p v-if="people && !people.length" class="text-gray-500">{{ de.terminal.empty }}</p>
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <button
            v-for="person in people ?? []" :key="person.employeeId" type="button"
            class="flex items-center gap-2 rounded-xl bg-white p-5 text-left text-lg font-medium ring-1 ring-gray-200 hover:bg-sky-50"
            @click="choose(person)"
          >
            <span v-if="mode === 'stamp' && person.clockedIn !== null" class="size-3 rounded-full" :class="person.clockedIn ? 'bg-green-500' : 'bg-gray-300'" />
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
          <div v-else-if="bothActions" class="grid grid-cols-2 gap-2">
            <UButton
              block size="xl" :disabled="pin.length !== PIN_LENGTH || busy" :loading="busy" color="success"
              :label="de.time.clockIn" @click="submit('in')"
            />
            <UButton
              block size="xl" :disabled="pin.length !== PIN_LENGTH || busy" :loading="busy" color="warning"
              :label="de.time.clockOut" @click="submit('out')"
            />
          </div>
          <UButton
            v-else block size="xl" :disabled="pin.length !== PIN_LENGTH || busy" :loading="busy" :color="chosen.clockedIn ? 'warning' : 'success'"
            :label="chosen.clockedIn ? de.time.clockOut : de.time.clockIn" @click="submit(chosen.clockedIn ? 'out' : 'in')"
          />
        </template>
      </section>
    </template>
  </div>
</template>
