<script setup lang="ts">
import { parseIsoDate, todayIso } from '#shared/domain/dates'
import { PIN_LENGTH } from '#shared/domain/pin'
import { SIGN_UNLOCK_IDLE_MS } from '#shared/domain/signRequests'
import { formatTime } from '#shared/domain/time'
import type { ContactsDto, MySignRequestsDto, StampAction, TabletUnlockStatusDto, TerminalPersonDto, TimeRecordDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorCode, errorMessage } from '~/utils/errors'
import { shiftMonth } from '~/utils/format'
import { isServerUnreachable, REQUEST_TIMEOUT_MS, tabletClockTime } from '~/utils/offlineQueue'
import { pinFailureText } from '~/utils/pin'
import { CHILD_COUNTS_PATH } from '~/utils/routeAccess'
import { tabletStartTiles } from '~/utils/tabletStart'

type Mode = 'start' | 'stamp' | 'children' | 'sign'
/** A person of the list; clockedIn null = not known (the list kept for stamping without network has names only). */
type Person = Omit<TerminalPersonDto, 'clockedIn'> & { clockedIn: boolean | null }

const { onTablet, unlock, lock, lockPending, lockConfirmed } = useChildRights()
// The tablet starts with the choice between stamping and the child records; anybody else only stamps here.
const mode = ref<Mode>(onTablet.value ? 'start' : 'stamp')
// Loaded in the browser (not with the page), so the page the tablet keeps for use without network carries no team data.
const people = ref<Person[] | null>(null)
const error = ref<unknown>(null)
// Stamping without network (docs/BETRIEB.md „Stempeln ohne Netz am Tablet“): only the tablet keeps stamps.
const offlineStamps = useOfflineStamps(onTablet.value, () => refresh())
/** The server is not reachable and stamps can be kept on this device. */
const isOffline = computed(() => onTablet.value && offlineStamps.available && offlineStamps.offline.value)
/** The server is not reachable, but this device cannot keep stamps (no IndexedDB or Web Crypto). */
const offlineWithoutStorage = computed(() => onTablet.value && !offlineStamps.available && offlineStamps.offline.value)

/**
 * The list with who is clocked in. Without an answer from the server the tablet shows the names it kept (who is clocked
 * in is not known then); every answer replaces the kept names and sends waiting stamps.
 */
async function refresh() {
  try {
    const list = await $fetch<TerminalPersonDto[]>('/api/terminal/status', { timeout: onTablet.value ? REQUEST_TIMEOUT_MS : undefined })
    people.value = list
    error.value = null
    if (onTablet.value) {
      offlineStamps.rememberTeam(list)
      offlineStamps.noteReachable()
    }
  }
  catch (caught) {
    if (onTablet.value && isServerUnreachable(caught)) {
      offlineStamps.noteUnreachable()
      // Without storage on this device the list stays as it was (stamping is not possible then anyway).
      if (offlineStamps.available) {
        const kept = await offlineStamps.cachedTeam()
        people.value = kept.map(person => ({ ...person, clockedIn: null }))
      }
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
// The start page is the tablet's one hub (its header only leads back here): „Kontakte“ only while the facility has contacts
// for the staff (the tablet sees just those), the plan of this month and the team meetings as tiles too.
const { data: tabletContacts } = useFetch<ContactsDto>('/api/contacts', { key: 'tablet-contacts', server: false, immediate: onTablet.value })
const showContacts = computed(() => (tabletContacts.value?.contacts.length ?? 0) > 0)
const thisMonth = parseIsoDate(todayIso())
const planPath = `/plan/${thisMonth.year}/${thisMonth.month}`
const startTiles = computed(() => tabletStartTiles({ showContacts: showContacts.value, planPath }))
const bigTiles = computed(() => startTiles.value.filter(item => item.big))
const smallTiles = computed(() => startTiles.value.filter(item => !item.big))
/** The tiles' look: the two main ones larger, the others smaller so all fit a 10" tablet without scrolling. */
const bigTile = 'flex flex-col items-center justify-center gap-2 rounded-xl bg-white p-6 text-2xl font-semibold ring-1 ring-gray-200 hover:bg-sky-50 focus-visible:outline-2 focus-visible:outline-primary'
const tile = 'flex min-h-28 flex-col items-center justify-center gap-1.5 rounded-xl bg-white p-4 text-center text-lg font-semibold ring-1 ring-gray-200 hover:bg-sky-50 focus-visible:outline-2 focus-visible:outline-primary'
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
  // Coming (back) to the start page ends any unlock of the child records, and one for signing left from before a reload.
  lock()
  lockSigning()
  if (onTablet.value) offlineStamps.registerShell()
})
onBeforeUnmount(() => {
  if (signer.value) lockSigning()
  unmounted = true
  clearInterval(poll)
  clearTimeout(resetTimer)
})

/** Start page and stamping lock the child records, so the next person never inherits the previous unlock. */
function setMode(next: Mode) {
  backToList()
  mode.value = next
  if (signer.value) lockSigning()
  signer.value = null
  if (next !== 'children') lock()
}

/**
 * „Zu unterschreiben“: the person enters their PIN for a sign-only unlock (never the child records; short on the server,
 * server/services/signUnlock.ts) and sees only their own requests to sign. After signing or declining, with „Fertig“,
 * after SIGN_UNLOCK_IDLE_MS without a touch, and when the server says it is over, the tablet locks and returns to the
 * start page.
 */
const signer = ref<{ name: string } | null>(null)
const toast = useToast()
let signIdle: ReturnType<typeof setTimeout> | undefined
/** When the server last heard of the person signing (it counts only its own requests as use). */
let signSeen = 0
const SIGN_EVENTS = ['pointerdown', 'keydown', 'wheel'] as const
function lockSigning() {
  clearTimeout(signIdle)
  for (const event of SIGN_EVENTS) window.removeEventListener(event, touchSigning, true)
  void $fetch<unknown>('/api/terminal/sign-requests/lock', { method: 'POST' }).catch(() => {})
}
/**
 * Any touch, key or scrolling while signing counts as use: the idle timer starts again, and at most once a minute the
 * server hears of it too (drawing and filling in send nothing otherwise). If the unlock is over there (10 minutes after
 * the PIN at the latest), the tablet locks.
 */
function touchSigning() {
  clearTimeout(signIdle)
  signIdle = setTimeout(finishSigning, SIGN_UNLOCK_IDLE_MS)
  if (!signer.value || Date.now() - signSeen < 60_000) return
  signSeen = Date.now()
  $fetch<MySignRequestsDto>('/api/terminal/sign-requests').catch((error) => {
    if (signer.value && errorCode(error) === 'sign_locked') {
      toast.add({ title: de.errors.sign_locked, color: 'warning' })
      finishSigning()
    }
  })
}
function startSigning(name: string) {
  signer.value = { name }
  signSeen = Date.now()
  for (const event of SIGN_EVENTS) window.addEventListener(event, touchSigning, { capture: true, passive: true })
  touchSigning()
}
function finishSigning() {
  setMode('start')
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
    // Online with stamps waiting: they go first, so the server gets them in order (bounded by the request timeout).
    // Known to be offline: no waiting for a sync that fails, the retry timer sends them later.
    if (onTablet.value && !isOffline.value && offlineStamps.pending.value > 0) await offlineStamps.sync()
    // Kept on the tablet only while the server cannot be reached; after a refusal by the server it is stamped online.
    if (isOffline.value) {
      await keepOffline(person, action, pinValue, isStale)
      return
    }
    const record = await $fetch<TimeRecordDto>('/api/terminal/stamp', {
      method: 'POST', body: { employeeId: person.employeeId, pin: pinValue, action }, timeout: onTablet.value ? REQUEST_TIMEOUT_MS : undefined,
    })
    if (onTablet.value) offlineStamps.noteReachable()
    if (isStale()) return
    confirmed(de.time.stamped(action, formatTime(action === 'in' ? record.start : record.end ?? record.start)))
  }
  catch (caught) {
    if (onTablet.value && isServerUnreachable(caught)) {
      offlineStamps.noteUnreachable()
      if (offlineStamps.available) {
        await keepOffline(person, action, pinValue, isStale)
        return
      }
      if (isStale()) return
      failure.value = de.terminal.offlineUnavailable
      pin.value = ''
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
  const forSigning = mode.value === 'sign'
  const startedEpoch = epoch
  const isStale = () => unmounted || startedEpoch !== epoch || chosenId.value !== person.employeeId || mode.value !== (forSigning ? 'sign' : 'children')
  busy.value = true
  try {
    if (forSigning) {
      await $fetch<unknown>('/api/terminal/sign-requests/unlock', { method: 'POST', body: { employeeId: person.employeeId, pin: pin.value } })
      if (isStale()) return lockSigning()
      startSigning(person.name)
      return
    }
    const status = await $fetch<TabletUnlockStatusDto>('/api/terminal/children/unlock', { method: 'POST', body: { employeeId: person.employeeId, pin: pin.value } })
    // The server ended every earlier unlock of this tablet: a lock still waiting to be sent must not end this one.
    lockConfirmed()
    if (isStale()) {
      // The person went back meanwhile: do not leave the records unlocked behind their back.
      lock()
      return
    }
    unlock.value = status
    // A person with „Nur Kinderzahlen“ gets „Kinder heute“ (names-free numbers) instead of the child records.
    await navigateTo(status.unlocked && status.countsOnly ? CHILD_COUNTS_PATH : '/children')
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
      v-if="isOffline || offlineWithoutStorage || offlineStamps.pending.value > 0" role="status"
      class="space-y-0.5 rounded-xl bg-yellow-100 px-4 py-3 text-lg font-medium text-yellow-900 ring-1 ring-yellow-300"
    >
      <p v-if="isOffline || offlineWithoutStorage" class="flex items-center gap-2">
        <UIcon name="i-lucide-wifi-off" class="size-6 shrink-0" />{{ isOffline ? de.terminal.offlineBar : de.terminal.offlineNoStorage }}
      </p>
      <p v-if="offlineStamps.pending.value > 0">{{ de.terminal.offlinePending(offlineStamps.pending.value) }}</p>
      <!-- The server answered the sending with an error: the stamps wait (retried later), new ones are stamped online. -->
      <p v-if="offlineStamps.pending.value > 0 && offlineStamps.syncFailed.value" class="text-red-700">
        {{ de.terminal.syncFailed(offlineStamps.pending.value) }}
      </p>
    </div>
    <!-- The server has not confirmed the lock yet (no answer): it is sent again until it has. -->
    <p
      v-if="onTablet && lockPending" role="status"
      class="flex items-center gap-2 rounded-xl bg-amber-100 px-4 py-3 text-lg font-medium text-amber-900 ring-1 ring-amber-300"
    >
      <UIcon name="i-lucide-loader-circle" class="size-6 shrink-0 animate-spin" aria-hidden="true" />{{ de.terminal.lockPending }}
    </p>

    <template v-if="mode === 'start'">
      <h1 class="text-2xl font-semibold">{{ de.terminal.startTitle }}</h1>
      <!-- The tiles by how often they are used (utils/tabletStart.ts); every destination of the tablet is here (its header
           only has „Start“). Stamping and the children first and larger. No PIN for pages without child data; the
           children, signing and „Gelesen und verstanden“ ask for name and PIN. -->
      <div class="grid grid-cols-2 gap-3">
        <button v-for="item in bigTiles" :key="item.key" type="button" :class="bigTile" @click="item.action.kind === 'mode' && setMode(item.action.mode)">
          <UIcon :name="item.icon" class="size-12 text-sky-700" aria-hidden="true" />
          {{ item.label }}
        </button>
      </div>
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <template v-for="item in smallTiles" :key="item.key">
          <NuxtLink v-if="item.action.kind === 'link'" :to="item.action.to" :class="tile">
            <UIcon :name="item.icon" class="size-8 text-sky-700" aria-hidden="true" />
            {{ item.label }}
            <span v-if="item.hint" class="text-sm font-normal text-gray-600">{{ item.hint }}</span>
          </NuxtLink>
          <button v-else-if="item.action.kind === 'mode'" type="button" :class="tile" @click="item.action.kind === 'mode' && setMode(item.action.mode)">
            <UIcon :name="item.icon" class="size-8 text-sky-700" aria-hidden="true" />
            {{ item.label }}
          </button>
          <!-- The released plan to print: nothing personal beyond what every employee sees, so no PIN. -->
          <template v-else-if="printMenuOpen">
            <button type="button" :class="tile" @click="printPlan(0)">
              <UIcon :name="item.icon" class="size-8 text-sky-700" aria-hidden="true" />
              {{ de.terminal.printPlanThisMonth }}
            </button>
            <button type="button" :class="tile" @click="printPlan(1)">
              <UIcon :name="item.icon" class="size-8 text-sky-700" aria-hidden="true" />
              {{ de.terminal.printPlanNextMonth }}
            </button>
          </template>
          <button v-else type="button" :class="tile" @click="printMenuOpen = true">
            <UIcon :name="item.icon" class="size-8 text-sky-700" aria-hidden="true" />
            {{ item.label }}
          </button>
        </template>
      </div>
    </template>

    <template v-else>
      <div class="flex items-center gap-3">
        <h1 class="text-2xl font-semibold">{{ mode === 'children' ? de.terminal.childrenTitle : mode === 'sign' ? de.signRequests.tabletTitle : de.terminal.title }}</h1>
        <UButton v-if="onTablet" class="ml-auto" size="lg" color="neutral" variant="outline" icon="i-lucide-arrow-left" :label="de.terminal.toStart" @click="setMode('start')" />
      </div>
      <UAlert v-if="error" color="warning" variant="soft" :title="errorMessage(error)" />

      <!-- Unlocked for signing: only this person's requests. -->
      <section v-else-if="mode === 'sign' && signer" class="space-y-3">
        <div class="flex flex-wrap items-center gap-3">
          <h2 class="text-xl font-semibold">{{ signer.name }}</h2>
          <UButton class="ml-auto" size="lg" color="neutral" variant="outline" icon="i-lucide-lock" :label="de.signRequests.tabletDone" @click="finishSigning" />
        </div>
        <SignRequestsMyList base="/api/terminal/sign-requests" @changed="finishSigning" @locked="finishSigning" />
      </section>

      <template v-else-if="!chosen">
        <p class="text-gray-600">{{ mode === 'children' ? de.terminal.chooseChildren : mode === 'sign' ? de.signRequests.tabletChoose : de.terminal.choose }}</p>
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
            v-if="mode === 'children' || mode === 'sign'" block size="xl" :disabled="pin.length !== PIN_LENGTH || busy" :loading="busy"
            :label="mode === 'sign' ? de.signRequests.tabletUnlock : de.terminal.unlock" @click="openChildren"
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
