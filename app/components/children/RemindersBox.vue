<script setup lang="ts">
import { todayIso } from '#shared/domain/dates'
import { formatTime } from '#shared/domain/time'
import type { ReminderDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { formatDate, formatDayMonth, formatDayMonthNear } from '~/utils/format'

/**
 * The box „Erinnerungen“ above the tabs of the children page: documentation, parent meetings of the day, birthdays and
 * leavings, for the Träger the entries that may be deleted, for Leitung/Träger the accident reports still to be sent to
 * the Unfallkasse (an employee's has no child: `childId` null; already sorted by the server), for Leitung/Träger the health
 * office still to be notified of a § 34 IfSG case (with „Benachrichtigt“ and „Arztmeldung liegt vor“). Hidden without entries; closed
 * or open is remembered on the device.
 */
const { data, error, refresh } = await useFetch<ReminderDto[]>('/api/children/reminders', { key: 'children-reminders' })
const { busy, run } = useBusyAction(refresh)
const r = de.reminders

const COLLAPSED_KEY = 'dienstplan.remindersCollapsed'
const collapsed = ref(false)
// Read after mounting, so the server's page and the first render in the browser agree.
onMounted(() => {
  try {
    collapsed.value = localStorage.getItem(COLLAPSED_KEY) === '1'
  }
  catch {
    // Storage unavailable: the box starts open.
  }
})
function toggle() {
  collapsed.value = !collapsed.value
  try {
    if (collapsed.value) localStorage.setItem(COLLAPSED_KEY, '1')
    else localStorage.removeItem(COLLAPSED_KEY)
  }
  catch {
    // Not remembered; opening and closing still works on this page.
  }
}

const entries = computed(() => (error.value ? [] : data.value ?? []))

const icons: Record<ReminderDto['kind'], string> = {
  doc: 'i-lucide-notebook-pen', meeting: 'i-lucide-messages-square', birthday: 'i-lucide-cake', staffBirthday: 'i-lucide-party-popper',
  leaving: 'i-lucide-door-open', retention: 'i-lucide-trash-2', accident: 'i-lucide-bandage', ifsg: 'i-lucide-shield-alert', ifsgCluster: 'i-lucide-users-round',
}

/** The text around the name. A documentation's day carries the year when it is not this year (long overdue, or due next January). */
function textOf(entry: ReminderDto): { before: string; after: string } {
  const date = formatDayMonth(entry.date)
  switch (entry.kind) {
    case 'doc': {
      const docDate = formatDayMonthNear(entry.date, todayIso())
      return entry.state === 'overdue' ? r.doc.overdue(docDate) : entry.state === 'today' ? r.doc.today() : r.doc.upcoming(docDate)
    }
    case 'birthday':
      return entry.state === 'today' ? r.birthday.today(entry.age ?? 0) : r.birthday.upcoming(date, entry.age ?? 0)
    case 'staffBirthday':
      return entry.state === 'today' ? r.staffBirthday.today() : r.staffBirthday.upcoming(date)
    case 'leaving':
      return r.leaving(date)
    // „Elterngespräch ‹Name› heute ‹h:mm› (‹Art›)“; the server always sends a meeting's time and kind.
    case 'meeting':
      return r.meeting(entry.time === null ? '' : formatTime(entry.time), entry.meetingKind ? de.parentMeetings.kinds[entry.meetingKind] : '')
    // Rendered as one link instead (see the template); nothing around a name.
    case 'retention':
      return { before: '', after: '' }
    // An employee's report has no child; its wording names the 3 days of incapacity.
    case 'accident':
      return r.accident(formatDate(entry.date), entry.childId === null)
    // „Gesundheitsamt unverzüglich benachrichtigen (§ 34 Abs. 6 IfSG): ‹Krankheit› – ‹Kind›, ‹Gruppe›“.
    case 'ifsg': {
      const text = r.ifsg(entry.ifsg?.diseaseName ?? '', entry.ifsg?.groupName ?? '')
      const office = entry.ifsg?.healthOffice
      return { before: text.before, after: text.after + (office && (office.name || office.phone) ? r.ifsgOffice(office.name, office.phone) : '') }
    }
    // „Häufung: 2 Fälle ‹Krankheit› – Gesundheitsamt informieren (§ 34 Abs. 6 Satz 2 IfSG)“.
    case 'ifsgCluster':
      return r.ifsgCluster(entry.count ?? 0)
  }
}

/** § 34 IfSG: the health office was informed of a cluster today (§ 34 Abs. 6 Satz 2). */
async function ackCluster(entry: ReminderDto) {
  if (!entry.ifsgCluster || busy.value) return
  await run(() => $fetch<{ ok: boolean }>('/api/ifsg/clusters/ack', {
    method: 'POST', body: { disease: entry.ifsgCluster!.disease, acknowledgedOn: todayIso() },
  }), de.common.saved)
}

/** § 34 IfSG: the health office was notified today, or the physician's report is there (§ 6 IfSG); either ends the duty. */
const pendingCase = ref<number | null>(null)
async function settleIfsg(entry: ReminderDto, body: { healthOfficeNotifiedOn: string } | { physicianReported: true }) {
  if (!entry.ifsg || busy.value) return
  pendingCase.value = entry.ifsg.caseId
  try {
    await run(() => $fetch<{ ok: boolean }>(`/api/ifsg/cases/${entry.ifsg!.caseId}`, { method: 'PUT', body }), de.common.saved)
  }
  finally {
    pendingCase.value = null
  }
}

const rowClass = (entry: ReminderDto) =>
  entry.state === 'overdue' ? 'bg-red-50 text-red-800' : entry.state === 'today' ? 'bg-amber-50 font-medium' : ''

/** The child whose „Erledigt“ is being sent (its button shows the spinner; all are disabled meanwhile). */
const pendingChild = ref<number | null>(null)
async function markDone(entry: ReminderDto) {
  if (entry.childId === null || busy.value) return
  pendingChild.value = entry.childId
  try {
    await run(() => $fetch<unknown>(`/api/children/${entry.childId}/development-docs`, { method: 'POST' }), r.doneSaved)
  }
  finally {
    pendingChild.value = null
  }
}
</script>

<template>
  <section v-if="entries.length" class="rounded-lg bg-white ring-1 ring-gray-200">
    <h2 class="font-semibold">
      <button
        type="button" class="flex min-h-11 w-full items-center gap-2 px-4 py-2 text-left" :aria-expanded="!collapsed"
        :title="collapsed ? r.show : r.hide" @click="toggle"
      >
        <UIcon name="i-lucide-bell" class="size-5 text-sky-700" />
        <span>{{ r.title }}</span>
        <span class="rounded-full bg-gray-100 px-2 text-xs font-normal text-gray-700">{{ entries.length }}</span>
        <UIcon :name="collapsed ? 'i-lucide-chevron-down' : 'i-lucide-chevron-up'" class="ml-auto size-5 text-gray-500" />
      </button>
    </h2>
    <ul v-if="!collapsed" class="divide-y divide-gray-100 border-t border-gray-100 text-sm">
      <li
        v-for="(entry, index) in entries" :key="`${entry.kind}-${entry.childId ?? entry.name}-${index}`"
        class="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2" :class="rowClass(entry)"
      >
        <UIcon :name="icons[entry.kind]" class="size-5 shrink-0" :class="entry.state === 'overdue' ? 'text-red-600' : 'text-gray-500'" role="img" :aria-label="r.kinds[entry.kind]" />
        <span v-if="entry.kind === 'retention'" class="min-w-0 flex-1">
          <NuxtLink to="/admin/retention" class="font-medium text-sky-700 hover:underline">{{ r.retention(entry.count ?? 0) }}</NuxtLink>
        </span>
        <span v-else class="min-w-0 flex-1">
          {{ textOf(entry).before }}<NuxtLink
            v-if="entry.childId !== null" :to="`/children/${entry.childId}`" class="font-medium text-sky-700 hover:underline"
          >{{ entry.name }}</NuxtLink><span v-else class="font-medium">{{ entry.name }}</span>{{ textOf(entry).after }}
          <span v-if="entry.ownChild" class="ml-2 rounded bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800">{{ r.ownChild }}</span>
          <NuxtLink
            v-if="entry.kind === 'accident'" :to="`/admin/accidents?year=${entry.date.slice(0, 4)}`" class="ml-2 text-xs text-sky-700 hover:underline"
          >{{ r.accidentLink }}</NuxtLink>
          <NuxtLink v-if="entry.kind === 'ifsg'" to="/children?tab=ifsg" class="ml-2 text-xs text-sky-700 hover:underline">{{ r.ifsgLink }}</NuxtLink>
        </span>
        <UButton
          v-if="entry.kind === 'ifsgCluster' && entry.ifsgCluster" class="min-h-11" color="neutral" variant="outline" icon="i-lucide-phone"
          :label="r.ifsgClusterAck" :disabled="busy" @click="ackCluster(entry)"
        />
        <template v-if="entry.kind === 'ifsg' && entry.ifsg">
          <UButton
            class="min-h-11" color="neutral" variant="outline" icon="i-lucide-phone" :label="r.ifsgNotified"
            :loading="pendingCase === entry.ifsg.caseId" :disabled="busy" @click="settleIfsg(entry, { healthOfficeNotifiedOn: todayIso() })"
          />
          <UButton
            class="min-h-11" color="neutral" variant="outline" icon="i-lucide-stethoscope" :label="r.ifsgPhysician" :title="de.ifsg.overview.physician"
            :disabled="busy" @click="settleIfsg(entry, { physicianReported: true })"
          />
        </template>
        <UButton
          v-if="entry.canDone && entry.childId !== null" class="min-h-11" color="neutral" variant="outline" icon="i-lucide-check"
          :label="r.done" :loading="pendingChild === entry.childId" :disabled="busy" @click="markDone(entry)"
        />
      </li>
    </ul>
  </section>
</template>
