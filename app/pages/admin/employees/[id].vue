<script setup lang="ts">
import { parseIsoDate, todayIso } from '#shared/domain/dates'
import { PIN_LENGTH, isValidPin } from '#shared/domain/pin'
import { shareOf } from '#shared/domain/staffing/calc'
import { QUALIFICATIONS, type Qualification } from '#shared/domain/staffing/types'
import { BREAK_MODES, STAMP_CHANNELS, type BreakMode, type StampChannel } from '#shared/domain/stamping'
import { formatSignedDuration, parseDuration } from '#shared/domain/time'
import type { EmployeeDetailDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { balanceClass } from '~/utils/colors'
import { formatClockTime, formatDate, formatHours, formatNumber, hoursToMinutes } from '~/utils/format'
import { inState } from '~/utils/states'
import { workdaysText } from '~/utils/workdays'

const route = useRoute()
const id = Number(route.params.id)
const { data: employee, refresh } = await useFetch<EmployeeDetailDto>(`/api/employees/${id}`)
const run = useAction(refresh)
const toast = useToast()
const { user } = useUserSession()
// Contract data is only sent to the Träger (editable) or, when allowed, to the Leitung (read-only).
const isProvider = computed(() => user.value?.role === 'provider')
/** The select's value for "qualification not entered" ('none' is a qualification of its own). */
const NO_QUALIFICATION = 'unset'

/**
 * groupId 0 = Springer (the select needs a non-null value); only shown and sent when the facility has groups.
 * birthdayDay / birthdayMonth 0 = no birthday (both empty); the birthday is sent as MM-DD.
 */
const master = reactive({
  name: '', shortName: '', leftOn: '', groupId: 0, birthdayDay: 0, birthdayMonth: 0,
  qualification: NO_QUALIFICATION as Qualification | typeof NO_QUALIFICATION, staffingShare: '',
})
watch(employee, (value) => {
  if (!value) return
  const [month = 0, day = 0] = value.birthday ? value.birthday.split('-').map(Number) : []
  Object.assign(master, {
    name: value.name, shortName: value.shortName, leftOn: value.leftOn ?? '', groupId: value.groupId ?? 0,
    birthdayDay: day, birthdayMonth: month,
    qualification: value.qualification ?? NO_QUALIFICATION, staffingShare: value.staffingShare === null ? '' : String(value.staffingShare),
  })
}, { immediate: true })

// Personalschlüssel: the qualification and the counting share (empty = the state's default, shown as placeholder).
const { data: staffingSettings } = useStaffingSettings()
const qualificationItems = [
  { label: de.staffing.qualificationNone, value: NO_QUALIFICATION },
  ...QUALIFICATIONS.map(key => ({ label: de.staffing.qualifications[key], value: key })),
]
const qualificationValue = () => (master.qualification === NO_QUALIFICATION ? null : master.qualification)
const sharePlaceholder = computed(() => {
  const rules = staffingSettings.value?.effective
  return rules ? de.staffing.sharePlaceholder(shareOf(rules, qualificationValue(), null)) : ''
})
/** null = empty field (the state's default), undefined = not a whole number from 0 to 100. */
function shareValue(): number | null | undefined {
  const text = String(master.staffingShare).trim()
  if (!text) return null
  const value = Number(text)
  return Number.isInteger(value) && value >= 0 && value <= 100 ? value : undefined
}
const birthdayDayItems = [
  { label: de.employees.birthdayNone, value: 0 },
  ...Array.from({ length: 31 }, (_, index) => ({ label: String(index + 1), value: index + 1 })),
]
const birthdayMonthItems = [{ label: de.employees.birthdayNone, value: 0 }, ...de.months.map((label, index) => ({ label, value: index + 1 }))]
/** MM-DD, null without a birthday, undefined when only the day or only the month is chosen. */
function birthdayValue(): string | null | undefined {
  const { birthdayDay: day, birthdayMonth: month } = master
  if (!day && !month) return null
  if (!day || !month) return undefined
  return `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}
const { data: groups, hasGroups } = useGroups()
const groupItems = computed(() => [
  ...(groups.value ?? []).map(group => ({ label: group.name, value: group.id })),
  { label: de.groups.springerOption, value: 0 },
])

const confirm = useConfirm()
const hoursForm = reactive({ weeklyHours: 39, validFrom: todayIso(), workdays: 31 })
const adjustmentForm = reactive({ date: todayIso(), sign: 1, amount: '', reason: '' })
const entitlementForm = reactive({ year: parseIsoDate(todayIso()).year, days: 30, carriedOverDays: 0 })

// Where the person clocks in and out, and whether breaks are clocked or deducted automatically (Leitung decides).
const stamping = reactive<{ stampVia: StampChannel; breakMode: BreakMode }>({ stampVia: 'both', breakMode: 'stamp' })
watch(employee, (value) => {
  if (value) Object.assign(stamping, { stampVia: value.stampVia, breakMode: value.breakMode })
}, { immediate: true })
const stampViaItems = STAMP_CHANNELS.map(channel => ({ label: de.employees.stampChannels[channel], value: channel }))
const breakModeItems = BREAK_MODES.map(mode => ({ label: de.employees.breakModes[mode], value: mode }))
function saveStamping() {
  run(() => $fetch<unknown>(`/api/employees/${id}/stamping`, { method: 'PUT', body: { ...stamping } }), de.common.saved)
}

const pin = ref('')
async function savePin() {
  if (!isValidPin(pin.value)) {
    toast.add({ title: de.errors.pin_format, color: 'error' })
    return
  }
  const ok = await run(() => $fetch<unknown>(`/api/employees/${id}/pin`, { method: 'PUT', body: { pin: pin.value } }), de.common.saved)
  if (ok) pin.value = ''
}
/** „PIN freischalten“ after too many wrong tries (also the lasting lock); a new PIN does the same. */
function unlockPin() {
  run(() => $fetch<unknown>(`/api/employees/${id}/pin/unlock`, { method: 'POST' }), de.employees.pinUnlocked)
}
/** The lock as loaded; a timed lock that has run out meanwhile still shows until the next refresh. */
const pinLockText = computed(() => {
  if (!employee.value) return ''
  if (employee.value.pinLockedPermanently) return de.employees.pinLockedPermanently
  return employee.value.pinLockedUntil ? de.employees.pinLockedUntil(formatClockTime(employee.value.pinLockedUntil)) : ''
})
async function removePin() {
  if (await confirm(de.common.confirmDelete)) run(() => $fetch<unknown>(`/api/employees/${id}/pin`, { method: 'DELETE' }), de.common.deleted)
}

function saveMaster() {
  const birthday = birthdayValue()
  if (birthday === undefined) return void toast.add({ title: de.errors.employee_birthday_invalid, color: 'error' })
  const staffingShare = shareValue()
  if (staffingShare === undefined) return void toast.add({ title: de.errors.staffing_share_invalid, color: 'error' })
  run(() => $fetch<unknown>(`/api/employees/${id}`, {
    method: 'PUT',
    body: {
      name: master.name, shortName: master.shortName, leftOn: master.leftOn || null, birthday,
      qualification: qualificationValue(), staffingShare,
      ...(hasGroups.value ? { groupId: master.groupId || null } : {}),
    },
  }), de.common.saved)
}

// Träger only: move the person to another facility (the employee is then no longer part of the active one).
const { data: facilities } = useFacilities()
const runMove = useAction()
const targetFacilityId = ref<number | undefined>(undefined)
const otherFacilities = computed(() => (facilities.value?.facilities ?? [])
  .filter(facility => facility.id !== facilities.value?.activeId)
  .map(facility => ({ label: facility.name, value: facility.id, state: facility.state })))
async function moveFacility() {
  const target = otherFacilities.value.find(item => item.value === targetFacilityId.value)
  if (!target) return
  // Other holidays then apply to this person, also for past days.
  const current = facilities.value?.facilities.find(facility => facility.id === facilities.value?.activeId)
  const stateHint = current && current.state !== target.state ? ` ${de.facilities.moveStateHint(inState(target.state))}` : ''
  if (!await confirm(de.facilities.moveConfirm(target.label) + stateHint, { confirmLabel: de.facilities.moveAction, danger: false })) return
  // No `run`: it would refresh this employee, who is no longer part of the active facility.
  if (await runMove(() => $fetch<unknown>(`/api/employees/${id}/facility`, { method: 'PUT', body: { facilityId: target.value } }), de.common.saved)) {
    await navigateTo('/admin/employees')
  }
}

function addHours() {
  run(() => $fetch<unknown>(`/api/employees/${id}/hours`, {
    method: 'POST', body: { weeklyMinutes: hoursToMinutes(hoursForm.weeklyHours), validFrom: hoursForm.validFrom, workdays: hoursForm.workdays },
  }), de.common.saved)
}

async function deleteHours(hoursId: number) {
  if (await confirm(de.common.confirmDelete)) run(() => $fetch<unknown>(`/api/employee-hours/${hoursId}`, { method: 'DELETE' }))
}

async function addAdjustment() {
  const minutes = parseDuration(adjustmentForm.amount)
  if (minutes === null) {
    toast.add({ title: de.employees.invalidDuration, color: 'error' })
    return
  }
  const ok = await run(() => $fetch<unknown>(`/api/employees/${id}/adjustments`, {
    method: 'POST',
    body: { date: adjustmentForm.date, minutes: minutes * adjustmentForm.sign, reason: adjustmentForm.reason },
  }), de.common.saved)
  if (ok) Object.assign(adjustmentForm, { amount: '', reason: '' })
}

async function deleteAdjustment(adjustmentId: number) {
  if (await confirm(de.common.confirmDelete)) run(() => $fetch<unknown>(`/api/balance-adjustments/${adjustmentId}`, { method: 'DELETE' }))
}

function saveEntitlement() {
  run(() => $fetch<unknown>(`/api/employees/${id}/leave/${entitlementForm.year}`, {
    method: 'PUT', body: { days: entitlementForm.days, carriedOverDays: entitlementForm.carriedOverDays },
  }), de.common.saved)
}

function editEntitlement(entitlement: EmployeeDetailDto['entitlements'][number]) {
  Object.assign(entitlementForm, { year: entitlement.year, days: entitlement.days, carriedOverDays: entitlement.carriedOverDays })
}
</script>

<template>
  <div v-if="employee" class="max-w-4xl space-y-4">
    <NuxtLink to="/admin/employees" class="text-sm text-sky-700 hover:underline">← {{ de.employees.back }}</NuxtLink>
    <h1 class="text-2xl font-semibold">{{ employee.name }}</h1>

    <form class="grid gap-3 rounded-lg bg-white p-4 ring-1 ring-gray-200 sm:grid-cols-4 sm:items-end" @submit.prevent="saveMaster">
      <h2 class="font-semibold sm:col-span-4">{{ de.employees.masterData }}</h2>
      <UFormField :label="de.employees.name" class="sm:col-span-2"><UInput v-model="master.name" class="w-full" required /></UFormField>
      <UFormField :label="de.employees.shortName"><UInput v-model="master.shortName" maxlength="10" class="w-full" /></UFormField>
      <UFormField :label="de.employees.leftOn"><UInput v-model="master.leftOn" type="date" class="w-full" /></UFormField>
      <UFormField v-if="hasGroups" :label="de.groups.employeeGroup" class="sm:col-span-2">
        <USelect v-model="master.groupId" :items="groupItems" class="w-full" />
      </UFormField>
      <UFormField :label="de.employees.birthday" :help="de.employees.birthdayHint" class="sm:col-span-2">
        <span class="flex gap-2">
          <USelect v-model="master.birthdayDay" :items="birthdayDayItems" class="w-20" :aria-label="de.employees.birthdayDay" />
          <USelect v-model="master.birthdayMonth" :items="birthdayMonthItems" class="w-36" :aria-label="de.employees.birthdayMonth" />
        </span>
      </UFormField>
      <UFormField :label="de.staffing.qualification" class="sm:col-span-2">
        <USelect v-model="master.qualification" :items="qualificationItems" class="w-full" />
      </UFormField>
      <UFormField :label="de.staffing.share" :help="de.staffing.shareHint" class="sm:col-span-2">
        <UInput v-model="master.staffingShare" type="number" min="0" max="100" step="1" :placeholder="sharePlaceholder" class="w-full" />
      </UFormField>
      <div class="sm:col-span-4"><UButton type="submit" :label="de.common.save" /></div>
    </form>

    <form v-if="isProvider && otherFacilities.length" class="flex flex-wrap items-end gap-3 rounded-lg bg-white p-4 ring-1 ring-gray-200" @submit.prevent="moveFacility">
      <h2 class="w-full font-semibold">{{ de.facilities.move }}</h2>
      <UFormField :label="de.facilities.active">
        <USelect v-model="targetFacilityId" :items="otherFacilities" class="w-56" />
      </UFormField>
      <UButton type="submit" :disabled="targetFacilityId === undefined" :label="de.facilities.moveAction" />
    </form>

    <EmployeesContractSection
      v-if="employee.contract" :employee-id="id" :contract="employee.contract" :editable="isProvider" @saved="refresh"
    />

    <section class="space-y-3 rounded-lg bg-white p-4 ring-1 ring-gray-200">
      <h2 class="font-semibold">{{ de.employees.pin }}</h2>
      <p class="text-sm text-gray-600">{{ employee.hasPin ? de.employees.pinSet : de.employees.pinNotSet }}</p>
      <div v-if="employee.hasPin && pinLockText" class="flex flex-wrap items-center gap-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
        <span>{{ pinLockText }}</span>
        <UButton size="sm" color="neutral" variant="outline" icon="i-lucide-lock-open" :label="de.employees.unlockPin" @click="unlockPin" />
      </div>
      <form class="flex flex-wrap items-end gap-3" @submit.prevent="savePin">
        <UFormField :label="de.employees.pin">
          <UInput v-model="pin" inputmode="numeric" :maxlength="PIN_LENGTH" autocomplete="off" required />
        </UFormField>
        <UButton type="submit" :label="de.employees.savePin" />
        <UButton v-if="employee.hasPin" color="error" variant="ghost" :label="de.employees.removePin" @click="removePin" />
      </form>
      <p class="text-xs text-gray-500">{{ de.employees.pinHint }} {{ de.employees.pinLockHint }}</p>
    </section>

    <form class="space-y-3 rounded-lg bg-white p-4 ring-1 ring-gray-200" @submit.prevent="saveStamping">
      <h2 class="font-semibold">{{ de.employees.stamping }}</h2>
      <div class="grid gap-3 sm:grid-cols-2">
        <UFormField :label="de.employees.stampVia">
          <USelect v-model="stamping.stampVia" :items="stampViaItems" class="w-full" />
        </UFormField>
        <UFormField :label="de.employees.breakMode">
          <USelect v-model="stamping.breakMode" :items="breakModeItems" class="w-full" />
        </UFormField>
      </div>
      <p class="text-xs text-gray-500">{{ de.employees.stampingHint }}</p>
      <UButton type="submit" :label="de.common.save" />
    </form>

    <section class="space-y-3 rounded-lg bg-white p-4 ring-1 ring-gray-200">
      <h2 class="font-semibold">{{ de.employees.hoursHistory }}</h2>
      <table class="w-full text-sm">
        <thead class="text-left text-xs text-gray-500"><tr><th>{{ de.employees.validFrom }}</th><th>{{ de.employees.weeklyHours }}</th><th>{{ de.employees.workdays }}</th><th /></tr></thead>
        <tbody>
          <tr v-for="period in employee.hours" :key="period.id" class="border-t border-gray-100">
            <td class="py-1">{{ formatDate(period.validFrom) }}</td>
            <td class="py-1">{{ formatHours(period.weeklyMinutes) }}</td>
            <td class="py-1">{{ workdaysText(period.workdays) }}</td>
            <td class="py-1 text-right"><UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" :aria-label="de.common.delete" @click="deleteHours(period.id)" /></td>
          </tr>
        </tbody>
      </table>
      <form class="flex flex-wrap items-end gap-3" @submit.prevent="addHours">
        <UFormField :label="de.employees.weeklyHours"><UInput v-model.number="hoursForm.weeklyHours" type="number" step="0.25" min="0" /></UFormField>
        <UFormField :label="de.employees.validFrom"><UInput v-model="hoursForm.validFrom" type="date" required /></UFormField>
        <UFormField :label="de.employees.workdays"><WorkdayPicker v-model="hoursForm.workdays" /></UFormField>
        <UButton type="submit" icon="i-lucide-plus" :label="de.employees.addHours" />
      </form>
      <p class="text-xs text-gray-500">{{ de.employees.validFromHint }}</p>
    </section>

    <section class="space-y-3 rounded-lg bg-white p-4 ring-1 ring-gray-200">
      <h2 class="font-semibold">{{ de.employees.adjustments }}</h2>
      <p class="text-xs text-gray-500">{{ de.employees.adjustmentsHint }}</p>
      <p v-if="employee.adjustments.length === 0" class="text-sm text-gray-500">{{ de.employees.noEntries }}</p>
      <table v-else class="w-full text-sm">
        <tbody>
          <tr v-for="adjustment in employee.adjustments" :key="adjustment.id" class="border-t border-gray-100">
            <td class="py-1">{{ formatDate(adjustment.date) }}</td>
            <td class="py-1 font-medium" :class="balanceClass(adjustment.minutes)">{{ formatSignedDuration(adjustment.minutes) }}</td>
            <td class="py-1">{{ adjustment.reason }}</td>
            <td class="py-1 text-right"><UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" :aria-label="de.common.delete" @click="deleteAdjustment(adjustment.id)" /></td>
          </tr>
        </tbody>
      </table>
      <form class="flex flex-wrap items-end gap-3" @submit.prevent="addAdjustment">
        <UFormField :label="de.employees.date"><UInput v-model="adjustmentForm.date" type="date" required /></UFormField>
        <UFormField :label="de.employees.sign">
          <select v-model.number="adjustmentForm.sign" class="h-8 rounded-md border border-gray-300 bg-white px-2 text-sm">
            <option :value="1">{{ de.employees.plus }}</option>
            <option :value="-1">{{ de.employees.minus }}</option>
          </select>
        </UFormField>
        <UFormField :label="de.employees.amount"><UInput v-model="adjustmentForm.amount" placeholder="12:30" required /></UFormField>
        <UFormField :label="de.employees.reason"><UInput v-model="adjustmentForm.reason" maxlength="200" required /></UFormField>
        <UButton type="submit" icon="i-lucide-plus" :label="de.employees.addAdjustment" />
      </form>
    </section>

    <section class="space-y-3 rounded-lg bg-white p-4 ring-1 ring-gray-200">
      <h2 class="font-semibold">{{ de.employees.entitlements }}</h2>
      <p class="text-sm text-gray-500">{{ de.employees.entitlementsHint }}</p>
      <table class="w-full text-sm">
        <thead class="text-left text-xs text-gray-500"><tr><th>{{ de.employees.year }}</th><th>{{ de.employees.days }}</th><th>{{ de.employees.carriedOver }}</th><th /></tr></thead>
        <tbody>
          <tr v-for="entitlement in employee.entitlements" :key="entitlement.id" class="border-t border-gray-100">
            <td class="py-1">{{ entitlement.year }}</td>
            <td class="py-1">{{ formatNumber(entitlement.days) }}</td>
            <td class="py-1">
              {{ formatNumber(entitlement.carriedOverDays) }}
              <span v-if="entitlement.carriedAutomatically" class="text-xs text-gray-500">{{ de.employees.carriedAutomatically }}</span>
            </td>
            <td class="py-1 text-right"><UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-pencil" :aria-label="de.common.edit" @click="editEntitlement(entitlement)" /></td>
          </tr>
        </tbody>
      </table>
      <form class="flex flex-wrap items-end gap-3" @submit.prevent="saveEntitlement">
        <UFormField :label="de.employees.year"><UInput v-model.number="entitlementForm.year" type="number" min="2000" max="2100" /></UFormField>
        <UFormField :label="de.employees.days"><UInput v-model.number="entitlementForm.days" type="number" step="0.5" min="0" /></UFormField>
        <UFormField :label="de.employees.carriedOver"><UInput v-model.number="entitlementForm.carriedOverDays" type="number" step="0.5" min="0" /></UFormField>
        <UButton type="submit" :label="de.employees.saveEntitlement" />
      </form>
    </section>

    <EmployeesRequirementsSection :employee-id="id" />
  </div>
</template>
