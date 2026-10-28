<script setup lang="ts">
import { parseIsoDate, todayIso } from '#shared/domain/dates'
import { PIN_LENGTH, isValidPin, mayManagePins } from '#shared/domain/pin'
import { shareOf } from '#shared/domain/staffing/calc'
import { QUALIFICATIONS } from '#shared/domain/staffing/types'
import { BREAK_MODES, STAMP_CHANNELS, type BreakMode, type StampChannel } from '#shared/domain/stamping'
import { hasSevereDisabilityIn, statutoryLeaveOf } from '#shared/domain/statutoryLeave'
import { formatSignedDuration, parseDuration } from '#shared/domain/time'
import type { BalanceDto, EmployeeDetailDto, LeaveAccountDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { balanceClass } from '~/utils/colors'
import {
  NO_QUALIFICATION, masterFieldsOf, masterUpdate, qualificationFieldsOf, qualificationUpdate, qualificationValue, reloadedFields,
  type MasterFields, type QualificationFields,
} from '~/utils/employeeForms'
import { formatDate, formatHours, formatNumber, hoursToMinutes, monthTitle, shiftMonth } from '~/utils/format'
import { errorCode } from '~/utils/errors'
import {
  DISABILITY_DEGREES, fieldErrorOf, fullBirthDate, personalFieldsOf, personalInput, sensitiveFieldsOf, sensitiveInput,
  type FieldErrorCode, type PersonalFields, type SensitiveFields,
} from '~/utils/personnel'
import { pinStateText } from '~/utils/pin'
import {
  employeeSections, employeeTabs, requestedEmployeeSection, requestedEmployeeTab, type EmployeeSection, type EmployeeTab,
} from '~/utils/staffList'
import { inState } from '~/utils/states'
import { workdaysText } from '~/utils/workdays'

const route = useRoute()
const id = Number(route.params.id)
const { data: employee, refresh: refreshEmployee } = await useFetch<EmployeeDetailDto>(`/api/employees/${id}`)
// What the compact list does not show: the balance today and at the end of a chosen month, the leave account of a
// chosen year (Anspruch, Übertrag, genommen, verplant, frei).
const now = parseIsoDate(todayIso())
const balanceMonth = reactive({ year: now.year, month: now.month })
const leaveYear = ref(now.year)
const { data: todayBalances, refresh: refreshTodayBalances } = await useFetch<BalanceDto[]>('/api/balances', { query: { year: now.year, month: now.month } })
const { data: monthBalances, refresh: refreshMonthBalances } = await useFetch<BalanceDto[]>('/api/balances', {
  query: { year: computed(() => balanceMonth.year), month: computed(() => balanceMonth.month) },
})
const { data: leave, refresh: refreshLeave } = await useFetch<LeaveAccountDto[]>('/api/leave', { query: { year: leaveYear } })
async function refresh() {
  await Promise.all([refreshEmployee(), refreshTodayBalances(), refreshMonthBalances(), refreshLeave()])
}
const run = useAction(refresh)
const todayBalance = computed(() => todayBalances.value?.find(row => row.employeeId === id) ?? null)
const monthBalance = computed(() => monthBalances.value?.find(row => row.employeeId === id) ?? null)
/** A month that is over shows its final balance, the current and later ones the expected one. */
const monthIsOver = computed(() => balanceMonth.year * 12 + balanceMonth.month < now.year * 12 + now.month)
function changeBalanceMonth(delta: number) {
  Object.assign(balanceMonth, shiftMonth(balanceMonth.year, balanceMonth.month, delta))
}
const leaveRow = computed(() => leave.value?.find(row => row.employeeId === id) ?? null)
const toast = useToast()
const { user } = useUserSession()
const { can } = useCan()
// Contract data is only sent to the Träger (editable: employees.contractEdit) or, when allowed, to the Leitung (read-only).
const canEditContract = computed(() => can('employees.contractEdit'))
const canMoveFacility = computed(() => can('employees.moveFacility'))
// PINs are set, cleared and unlocked only by the Leitung and the Träger (the server checks this as well).
const canManagePins = computed(() => mayManagePins(user.value?.role, can))
// The own stamping settings feed the own credited time: only the Träger changes them (server: own_account).
const canEditStamping = computed(() => user.value?.employeeId !== id || can('users.providerAccounts'))

/**
 * The forms „Stammdaten“ and „Qualifikation“ of the tab „Stammdaten“ (one route, but each form saves only its own
 * fields). A reload keeps what is typed and not saved yet in a form; the form just saved shows the saved values.
 */
const master = reactive<MasterFields>({ name: '', shortName: '', leftOn: '', groupId: 0, birthdayDay: 0, birthdayMonth: 0 })
const qualificationForm = reactive<QualificationFields>({ qualification: NO_QUALIFICATION, staffingShare: '' })
// Personalakte: the personal block (employees.personal) and the sensitive one (employees.sensitive) are part of
// „Stammdaten“ and saved with it, each only when the employee answer holds it (sending a block without its key is 403).
const personal = reactive<PersonalFields>(personalFieldsOf(undefined))
const sensitive = reactive<SensitiveFields>(sensitiveFieldsOf(undefined))
// The stored values as last loaded; the Stammdaten form compares against them (see useDirty below).
const loadedMaster = shallowRef<MasterFields | null>(null)
let loadedQualification: QualificationFields | null = null
const loadedPersonal = shallowRef<PersonalFields | null>(null)
const loadedSensitive = shallowRef<SensitiveFields | null>(null)
const justSaved = { master: false, qualification: false }
watch(employee, (value) => {
  if (!value) return
  const nextMaster = masterFieldsOf(value)
  const nextQualification = qualificationFieldsOf(value)
  const nextPersonal = personalFieldsOf(value.personal)
  const nextSensitive = sensitiveFieldsOf(value.sensitive)
  Object.assign(master, reloadedFields({ ...master }, loadedMaster.value, nextMaster, justSaved.master))
  Object.assign(qualificationForm, reloadedFields({ ...qualificationForm }, loadedQualification, nextQualification, justSaved.qualification))
  Object.assign(personal, reloadedFields({ ...personal }, loadedPersonal.value, nextPersonal, justSaved.master))
  Object.assign(sensitive, reloadedFields({ ...sensitive }, loadedSensitive.value, nextSensitive, justSaved.master))
  loadedMaster.value = nextMaster
  loadedQualification = nextQualification
  loadedPersonal.value = nextPersonal
  loadedSensitive.value = nextSensitive
  justSaved.master = justSaved.qualification = false
}, { immediate: true })
// Typed and not saved yet in „Stammdaten“ (master, personal and sensitive fields): leaving the page or the tab asks first.
useDirty(() => !!loadedMaster.value
  && !(sameValue({ ...master }, loadedMaster.value) && sameValue({ ...personal }, loadedPersonal.value) && sameValue({ ...sensitive }, loadedSensitive.value)))
/** Format errors of the personal and sensitive fields, shown at the field (from here or from the server). */
const masterErrors = ref<Record<string, FieldErrorCode>>({})
const masterError = (field: string) => (masterErrors.value[field] ? de.errors[masterErrors.value[field]] : undefined)
/** The full birth date as TT.MM.JJJJ while day, month and year form one. */
const birthDateText = computed(() => {
  const iso = fullBirthDate(master.birthdayDay, master.birthdayMonth, personal.birthYear)
  return iso ? formatDate(iso) : null
})
const disabilityDegreeItems = [
  { label: de.personnel.disabilityDegreeNone, value: 0 },
  ...DISABILITY_DEGREES.map(degree => ({ label: String(degree), value: degree })),
]

// Personalschlüssel: the qualification and the counting share (empty = the state's default, shown as placeholder).
const { data: staffingSettings } = useStaffingSettings()
const qualificationItems = [
  { label: de.staffing.qualificationNone, value: NO_QUALIFICATION },
  ...QUALIFICATIONS.map(key => ({ label: de.staffing.qualifications[key], value: key })),
]
const sharePlaceholder = computed(() => {
  const rules = staffingSettings.value?.effective
  return rules ? de.staffing.sharePlaceholder(shareOf(rules, qualificationValue(qualificationForm), null)) : ''
})
const birthdayDayItems = [
  { label: de.employees.birthdayNone, value: 0 },
  ...Array.from({ length: 31 }, (_, index) => ({ label: String(index + 1), value: index + 1 })),
]
const birthdayMonthItems = [{ label: de.employees.birthdayNone, value: 0 }, ...de.months.map((label, index) => ({ label, value: index + 1 }))]
const { data: groups, hasGroups } = useGroups()
const groupItems = computed(() => [
  ...(groups.value ?? []).map(group => ({ label: group.name, value: group.id })),
  { label: de.groups.springerOption, value: 0 },
])

const confirm = useConfirm()
const hoursForm = reactive({ weeklyHours: 39, validFrom: todayIso(), workdays: 31 })
const adjustmentForm = reactive({ date: todayIso(), sign: 1, amount: '', reason: '', paidOut: false })
const entitlementForm = reactive({ year: parseIsoDate(todayIso()).year, days: 30, carriedOverDays: 0 })
/**
 * Gesetzlicher Mindesturlaub of a year, only a hint (null outside the employment). The severe disability counts only
 * from the personnel file block the viewer was sent (employees.sensitive), so nothing about it shows without the right.
 */
function statutoryLeaveIn(year: number): number | null {
  if (!employee.value || !Number.isInteger(year) || year < 2000 || year > 2100) return null
  const days = statutoryLeaveOf(employee.value, year, hasSevereDisabilityIn(employee.value.sensitive, year)).inYear
  return days > 0 ? days : null
}
/** The minimum per year of the saved entitlements (missing outside the employment). */
const statutoryMinimums = computed(() => {
  const byYear: Record<number, number> = {}
  for (const { year } of employee.value?.entitlements ?? []) {
    const days = statutoryLeaveIn(year)
    if (days !== null) byYear[year] = days
  }
  return byYear
})
const formStatutoryLeave = computed(() => statutoryLeaveIn(entitlementForm.year))

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
/**
 * „PIN freischalten“ whenever there was a lock since the last right PIN: ends a running or lasting lock and starts the
 * escalation again at 15 minutes. A new PIN does the same.
 */
function unlockPin() {
  run(() => $fetch<unknown>(`/api/employees/${id}/pin/unlock`, { method: 'POST' }), de.employees.pinUnlocked)
}
/** The locks as loaded; a timed lock that has run out meanwhile still shows as running until the next refresh. */
const pinLock = computed(() => (employee.value ? pinStateText(employee.value) : null))
async function removePin() {
  if (await confirm(de.common.confirmDelete)) run(() => $fetch<unknown>(`/api/employees/${id}/pin`, { method: 'DELETE' }), de.common.deleted)
}

/**
 * Saves one form's fields („Stammdaten“ or „Qualifikation“); a check that fails is shown right away.
 * „Stammdaten“ adds the personal and sensitive blocks the viewer was sent (and only those).
 */
async function saveEmployee(part: 'master' | 'qualification') {
  if (!employee.value) return
  const update = part === 'master' ? masterUpdate(master, hasGroups.value) : qualificationUpdate(employee.value, qualificationForm)
  if ('error' in update) return void toast.add({ title: de.errors[update.error], color: 'error' })
  let body: object = update.body
  if (part === 'master') {
    masterErrors.value = {}
    const personalBlock = employee.value.personal ? personalInput(personal) : null
    if (personalBlock && 'error' in personalBlock) return void (masterErrors.value = { birthYear: personalBlock.error })
    body = {
      ...update.body,
      ...(personalBlock ? { personal: personalBlock.value } : {}),
      ...(employee.value.sensitive ? { sensitive: sensitiveInput(sensitive) } : {}),
    }
  }
  justSaved[part] = true
  const ok = await run(async () => {
    try {
      await $fetch<unknown>(`/api/employees/${id}`, { method: 'PUT', body })
    }
    catch (failure) {
      if (part === 'master') masterErrors.value = fieldErrorOf(errorCode(failure))
      throw failure
    }
  }, de.common.saved)
  if (!ok) justSaved[part] = false
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
    body: { date: adjustmentForm.date, minutes: minutes * adjustmentForm.sign, reason: adjustmentForm.reason, paidOut: adjustmentForm.paidOut },
  }), de.common.saved)
  if (ok) Object.assign(adjustmentForm, { amount: '', reason: '', paidOut: false })
}

/** „ausgezahlt“ on a booked adjustment, also afterwards (it keeps the booking for the longer period after leaving). */
async function setPaidOut(adjustmentId: number, paidOut: boolean) {
  const ok = await run(() => $fetch<unknown>(`/api/employees/${id}/adjustments/${adjustmentId}`, { method: 'PATCH', body: { paidOut } }), de.common.saved)
  // On failure the checkbox would still show the new state: reload what is saved.
  if (!ok) await refresh()
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

// The page's tabs; `?tab=` opens one directly (nothing is remembered). A former tab key (`?tab=stamping`) opens the tab
// that holds its section now and scrolls to it; the old anchor #requirements still leads to its tab.
const router = useRouter()
const visibleSections = computed(() => employeeSections(can, user.value?.employeeId === id))
const visibleTabs = computed(() => employeeTabs(can, user.value?.employeeId === id))
const shows = (section: EmployeeSection) => visibleSections.value.includes(section)
// A form of a talk opened in „Gespräche“ may hold unsaved answers: leaving the page asks first.
useUnsavedGuard()
const requestedTab = () => requestedEmployeeTab(route.query.tab, route.hash, visibleTabs.value)
const tab = ref<EmployeeTab>(requestedTab())
function scrollToRequestedSection() {
  const section = requestedEmployeeSection(route.query.tab, visibleSections.value)
  if (section) nextTick(() => document.getElementById(`employee-section-${section}`)?.scrollIntoView({ block: 'start' }))
}
onMounted(scrollToRequestedSection)
watch(() => [route.query.tab, route.hash], () => {
  tab.value = requestedTab()
  scrollToRequestedSection()
})
/** The attributes of a tab's panel (all panels stay mounted, only the open one shows). */
const panel = (key: EmployeeTab) => ({ id: `employee-panel-${key}`, role: 'tabpanel', 'aria-labelledby': `employee-tab-${key}`, class: 'space-y-4' })
async function selectTab(next: EmployeeTab) {
  // Unsaved edits (e.g. an open form in „Gespräche“) survive another tab, but are not saved yet: ask before leaving.
  if (next !== tab.value && hasUnsavedChanges()
    && !await confirm(de.forms.tabSwitchConfirm, { confirmLabel: de.forms.tabSwitch, danger: false })) return
  tab.value = next
  router.replace({ query: { ...route.query, tab: next }, hash: '' })
}
/** Arrow keys, Home and End move between the tabs (and open the one reached), as in a tab list. */
async function onTabKey(event: KeyboardEvent) {
  const keys = visibleTabs.value
  const index = keys.indexOf(tab.value)
  const last = keys.length - 1
  const next = { ArrowRight: index === last ? 0 : index + 1, ArrowLeft: index <= 0 ? last : index - 1, Home: 0, End: last }[event.key]
  if (next === undefined || !keys[next]) return
  event.preventDefault()
  const target = keys[next]
  await selectTab(target)
  if (tab.value === target) nextTick(() => document.getElementById(`employee-tab-${target}`)?.focus())
}
</script>

<template>
  <div v-if="employee" class="max-w-4xl space-y-4">
    <NuxtLink to="/admin/employees" class="text-sm text-sky-700 hover:underline">← {{ de.employees.back }}</NuxtLink>
    <h1 class="text-2xl font-semibold">{{ employee.name }}</h1>

    <!-- The tabs wrap on a phone instead of scrolling the page sideways. -->
    <div role="tablist" :aria-label="de.employees.tabsLabel" class="flex flex-wrap gap-1.5">
      <button
        v-for="key in visibleTabs" :id="`employee-tab-${key}`" :key="key" type="button" role="tab"
        :aria-selected="tab === key" :tabindex="tab === key ? 0 : -1" :aria-controls="`employee-panel-${key}`"
        class="min-h-10 rounded-full px-3.5 text-sm ring-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        :class="tab === key ? 'bg-sky-50 font-semibold text-sky-800 ring-sky-400' : 'bg-white text-gray-700 ring-gray-200 hover:bg-gray-50'"
        @click="selectTab(key)" @keydown="onTabKey"
      >
        {{ de.employees.tabs[key] }}
      </button>
    </div>

    <!-- All tabs stay mounted (v-show): what is typed in one survives a look at another. -->
    <div v-show="tab === 'master'" v-bind="panel('master')">
    <form class="grid gap-3 rounded-lg bg-white p-4 ring-1 ring-gray-200 sm:grid-cols-4 sm:items-end" @submit.prevent="saveEmployee('master')">
      <h2 class="font-semibold sm:col-span-4">{{ de.employees.masterData }}</h2>
      <UFormField :label="de.employees.name" class="sm:col-span-2"><UInput v-model="master.name" class="w-full" required /></UFormField>
      <UFormField :label="de.employees.shortName"><UInput v-model="master.shortName" maxlength="10" class="w-full" /></UFormField>
      <UFormField :label="de.employees.leftOn"><DateTextInput v-model="master.leftOn" :label="de.employees.leftOn" class="w-full" /></UFormField>
      <UFormField v-if="hasGroups" :label="de.groups.employeeGroup" class="sm:col-span-2">
        <USelect v-model="master.groupId" :items="groupItems" class="w-full" />
      </UFormField>
      <UFormField
        :label="de.employees.birthday" :help="employee.personal ? de.personnel.birthYearHint : de.employees.birthdayHint"
        :error="masterError('birthYear')" class="sm:col-span-2"
      >
        <span class="flex flex-wrap items-center gap-2">
          <USelect v-model="master.birthdayDay" :items="birthdayDayItems" class="w-20" :aria-label="de.employees.birthdayDay" />
          <USelect v-model="master.birthdayMonth" :items="birthdayMonthItems" class="w-36" :aria-label="de.employees.birthdayMonth" />
          <UInput
            v-if="employee.personal" v-model="personal.birthYear" inputmode="numeric" maxlength="4" class="w-24"
            :placeholder="de.personnel.birthYear" :aria-label="de.personnel.birthYear"
          />
          <span v-if="employee.personal && birthDateText" class="text-sm text-gray-600">{{ de.personnel.birthDate(birthDateText) }}</span>
        </span>
      </UFormField>

      <!-- Personalakte §2: only when the answer holds the block (employees.personal / employees.sensitive). -->
      <template v-if="employee.personal">
        <div class="border-t border-gray-100 pt-3 sm:col-span-4">
          <h3 class="font-semibold">{{ de.personnel.personalTitle }}</h3>
          <p class="text-xs text-gray-500">{{ de.personnel.personalHint }}</p>
        </div>
        <UFormField :label="de.personnel.street" class="sm:col-span-2">
          <UInput v-model="personal.street" maxlength="200" autocomplete="off" class="w-full" />
        </UFormField>
        <UFormField :label="de.personnel.postalCode" :error="masterError('postalCode')">
          <UInput v-model="personal.postalCode" inputmode="numeric" maxlength="5" autocomplete="off" class="w-full" />
        </UFormField>
        <UFormField :label="de.personnel.city">
          <UInput v-model="personal.city" maxlength="100" autocomplete="off" class="w-full" />
        </UFormField>
        <UFormField :label="de.personnel.phone" class="sm:col-span-2">
          <UInput v-model="personal.phone" type="tel" maxlength="50" autocomplete="off" class="w-full" />
        </UFormField>
        <UFormField :label="de.personnel.email" :error="masterError('email')" class="sm:col-span-2">
          <UInput v-model="personal.email" type="email" maxlength="200" autocomplete="off" class="w-full" />
        </UFormField>
      </template>

      <template v-if="employee.sensitive">
        <div class="border-t border-gray-100 pt-3 sm:col-span-4">
          <h3 class="font-semibold">{{ de.personnel.sensitiveTitle }}</h3>
          <p class="text-xs text-gray-500">{{ de.personnel.sensitiveHint }}</p>
        </div>
        <UFormField :label="de.personnel.nationality" class="sm:col-span-2">
          <UInput v-model="sensitive.nationality" maxlength="100" autocomplete="off" class="w-full" />
        </UFormField>
        <UFormField :label="de.personnel.disability" class="sm:col-span-2">
          <USwitch v-model="sensitive.disability" :label="sensitive.disability ? de.personnel.disabilityYes : de.personnel.disabilityNo" class="pt-1.5" />
        </UFormField>
        <template v-if="sensitive.disability">
          <UFormField :label="de.personnel.disabilityDegree" :error="masterError('disabilityDegree')">
            <USelect v-model="sensitive.disabilityDegree" :items="disabilityDegreeItems" class="w-full" />
          </UFormField>
          <UFormField :label="de.personnel.disabilityUntil" :error="masterError('disabilityUntil')">
            <DateTextInput v-model="sensitive.disabilityUntil" :label="de.personnel.disabilityUntil" class="w-full" />
          </UFormField>
          <UCheckbox v-model="sensitive.disabilityEqual" :label="de.personnel.disabilityEqual" class="sm:col-span-2 sm:pb-2" />
        </template>
      </template>
      <div class="sm:col-span-4"><UButton type="submit" :label="de.common.save" /></div>
    </form>

    <EmployeesEmergencyContactsSection :employee-id="id" />

    <!-- The same route as the master data, but only the qualification and the share are sent from here. -->
    <form
      id="employee-section-qualification" class="grid scroll-mt-32 gap-3 rounded-lg bg-white p-4 ring-1 ring-gray-200 sm:grid-cols-4 sm:items-end"
      @submit.prevent="saveEmployee('qualification')"
    >
      <h2 class="font-semibold sm:col-span-4">{{ de.staffing.qualification }}</h2>
      <UFormField :label="de.staffing.qualification" class="sm:col-span-2">
        <USelect v-model="qualificationForm.qualification" :items="qualificationItems" class="w-full" />
      </UFormField>
      <UFormField :label="de.staffing.share" :help="de.staffing.shareHint" class="sm:col-span-2">
        <UInput v-model="qualificationForm.staffingShare" type="number" min="0" max="100" step="1" :placeholder="sharePlaceholder" class="w-full" />
      </UFormField>
      <div class="sm:col-span-4"><UButton type="submit" :label="de.common.save" /></div>
    </form>

    <form v-if="canMoveFacility && otherFacilities.length" class="flex flex-wrap items-end gap-3 rounded-lg bg-white p-4 ring-1 ring-gray-200" @submit.prevent="moveFacility">
      <h2 class="w-full font-semibold">{{ de.facilities.move }}</h2>
      <UFormField :label="de.facilities.active">
        <USelect v-model="targetFacilityId" :items="otherFacilities" class="w-56" />
      </UFormField>
      <UButton type="submit" :disabled="targetFacilityId === undefined" :label="de.facilities.moveAction" />
    </form>
    </div>

    <div v-show="tab === 'contract'" v-bind="panel('contract')">
    <section class="space-y-2 rounded-lg bg-white px-4 py-3 text-sm ring-1 ring-gray-200">
      <h2 class="font-semibold">{{ de.balances.account }}</h2>
      <p>
        {{ de.balances.today }}:
        <span v-if="todayBalance" class="font-semibold" :class="balanceClass(todayBalance.today)">{{ formatSignedDuration(todayBalance.today) }}</span>
        <span v-else class="text-gray-400">–</span>
      </p>
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span>{{ monthIsOver ? de.employees.monthEndOver : de.balances.monthEnd }}</span>
        <span class="flex items-center">
          <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-chevron-left" :aria-label="de.common.previousMonth" @click="changeBalanceMonth(-1)" />
          <span class="min-w-32 text-center font-medium">{{ monthTitle(balanceMonth.year, balanceMonth.month) }}</span>
          <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-chevron-right" :aria-label="de.common.nextMonth" @click="changeBalanceMonth(1)" />
        </span>
        <span v-if="monthBalance" class="font-semibold" :class="balanceClass(monthBalance.monthEnd)">{{ formatSignedDuration(monthBalance.monthEnd) }}</span>
        <span v-else class="text-gray-400">–</span>
      </div>
    </section>
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
        <UFormField :label="de.employees.validFrom"><DateTextInput v-model="hoursForm.validFrom" :label="de.employees.validFrom" class="w-44" required /></UFormField>
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
            <td class="py-1">
              <UCheckbox
                size="xs" :model-value="adjustment.paidOut" :label="de.employees.paidOut"
                @update:model-value="setPaidOut(adjustment.id, $event === true)"
              />
            </td>
            <td class="py-1 text-right"><UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" :aria-label="de.common.delete" @click="deleteAdjustment(adjustment.id)" /></td>
          </tr>
        </tbody>
      </table>
      <form class="flex flex-wrap items-end gap-3" @submit.prevent="addAdjustment">
        <UFormField :label="de.employees.date"><DateTextInput v-model="adjustmentForm.date" :label="de.employees.date" class="w-44" required /></UFormField>
        <UFormField :label="de.employees.sign">
          <select v-model.number="adjustmentForm.sign" class="h-8 rounded-md border border-gray-300 bg-white px-2 text-sm">
            <option :value="1">{{ de.employees.plus }}</option>
            <option :value="-1">{{ de.employees.minus }}</option>
          </select>
        </UFormField>
        <UFormField :label="de.employees.amount"><UInput v-model="adjustmentForm.amount" placeholder="12:30" required /></UFormField>
        <UFormField :label="de.employees.reason"><UInput v-model="adjustmentForm.reason" maxlength="200" required /></UFormField>
        <UCheckbox v-model="adjustmentForm.paidOut" :label="de.employees.paidOut" class="pb-1.5" />
        <UButton type="submit" icon="i-lucide-plus" :label="de.employees.addAdjustment" />
      </form>
      <p class="text-xs text-gray-500">{{ de.employees.paidOutHint }}</p>
    </section>

    <EmployeesContractSection
      v-if="employee.contract" :employee-id="id" :contract="employee.contract" :editable="canEditContract" @saved="refresh"
    />

    <!-- Personalakte: mounted only with the right, loaded in the browser only once the tab is opened. -->
    <div v-if="shows('payroll')" id="employee-section-payroll" class="scroll-mt-32">
      <EmployeesPayrollSection :employee-id="id" :active="tab === 'contract'" />
    </div>
    </div>

    <div v-show="tab === 'times'" v-bind="panel('times')">
    <section class="space-y-1 rounded-lg bg-white px-4 py-3 text-sm ring-1 ring-gray-200">
      <div class="flex flex-wrap items-center gap-x-2">
        <h2 class="font-semibold">{{ de.leave.title }}</h2>
        <YearNav v-model="leaveYear" />
      </div>
      <p v-if="leaveRow">
        {{ de.leave.entitlement }} {{ formatNumber(leaveRow.account.entitlement) }}
        <span v-if="leaveRow.inheritedFrom !== null" class="text-xs text-gray-500">{{ de.leave.inheritedFrom(leaveRow.inheritedFrom) }}</span>
        <span class="mx-1.5 text-gray-300">|</span>{{ de.leave.carriedOver }} {{ formatNumber(leaveRow.account.carriedOver) }}
        <span class="mx-1.5 text-gray-300">|</span>{{ de.leave.taken }} {{ formatNumber(leaveRow.account.taken) }}
        <span class="mx-1.5 text-gray-300">|</span>{{ de.leave.planned }} {{ formatNumber(leaveRow.account.planned) }}
        <span class="mx-1.5 text-gray-300">|</span>{{ de.leave.available }}
        <span class="font-semibold" :class="leaveRow.account.available < 0 ? 'text-red-700' : ''">{{ formatNumber(leaveRow.account.available) }}</span>
      </p>
      <p v-else class="text-gray-500">{{ de.employees.noLeaveYear }}</p>
    </section>
    <section class="space-y-3 rounded-lg bg-white p-4 ring-1 ring-gray-200">
      <h2 class="font-semibold">{{ de.employees.entitlements }}</h2>
      <p class="text-sm text-gray-500">{{ de.employees.entitlementsHint }}</p>
      <table class="w-full text-sm">
        <thead class="text-left text-xs text-gray-500"><tr><th>{{ de.employees.year }}</th><th>{{ de.employees.days }}</th><th>{{ de.employees.carriedOver }}</th><th /></tr></thead>
        <tbody>
          <tr v-for="entitlement in employee.entitlements" :key="entitlement.id" class="border-t border-gray-100">
            <td class="py-1">{{ entitlement.year }}</td>
            <td class="py-1">
              {{ formatNumber(entitlement.days) }}
              <template v-if="statutoryMinimums[entitlement.year] !== undefined">
                <span class="ml-1 text-xs text-gray-500">{{ de.employees.statutoryLeaveAtLeast(formatNumber(statutoryMinimums[entitlement.year]!)) }}</span>
                <span v-if="entitlement.days < statutoryMinimums[entitlement.year]!" class="mt-1 block rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-800">{{ de.employees.statutoryLeaveBelow }}</span>
              </template>
            </td>
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
      <template v-if="formStatutoryLeave !== null">
        <p class="text-xs text-gray-500">{{ de.employees.statutoryLeaveAtLeast(formatNumber(formStatutoryLeave)) }}</p>
        <p v-if="entitlementForm.days < formStatutoryLeave" class="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">{{ de.employees.statutoryLeaveBelow }}</p>
      </template>
    </section>

    <section id="employee-section-stamping" class="scroll-mt-32 space-y-3 rounded-lg bg-white p-4 ring-1 ring-gray-200">
      <h2 class="font-semibold">{{ de.employees.pin }}</h2>
      <p class="text-sm text-gray-600">{{ employee.hasPin ? de.employees.pinSet : de.employees.pinNotSet }}</p>
      <div
        v-if="pinLock" class="flex flex-wrap items-center gap-3 rounded-md px-3 py-2 text-sm"
        :class="pinLock.locked ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-800'"
      >
        <span>{{ pinLock.text }}</span>
        <UButton v-if="canManagePins" size="sm" color="neutral" variant="outline" icon="i-lucide-lock-open" :label="de.employees.unlockPin" @click="unlockPin" />
      </div>
      <form v-if="canManagePins" class="flex flex-wrap items-end gap-3" @submit.prevent="savePin">
        <UFormField :label="de.employees.pin">
          <UInput v-model="pin" inputmode="numeric" :maxlength="PIN_LENGTH" autocomplete="off" required />
        </UFormField>
        <UButton type="submit" :label="de.employees.savePin" />
        <UButton v-if="employee.hasPin" color="error" variant="ghost" :label="de.employees.removePin" @click="removePin" />
      </form>
      <p v-if="canManagePins" class="text-xs text-gray-500">{{ de.employees.pinHint }} {{ de.employees.pinLockHint }}</p>
      <p v-else class="text-xs text-gray-500">{{ de.errors.pin_managers_only }}</p>
    </section>

    <form class="space-y-3 rounded-lg bg-white p-4 ring-1 ring-gray-200" @submit.prevent="saveStamping">
      <h2 class="font-semibold">{{ de.employees.stamping }}</h2>
      <div class="grid gap-3 sm:grid-cols-2">
        <UFormField :label="de.employees.stampVia">
          <USelect v-model="stamping.stampVia" :items="stampViaItems" :disabled="!canEditStamping" class="w-full" />
        </UFormField>
        <UFormField :label="de.employees.breakMode">
          <USelect v-model="stamping.breakMode" :items="breakModeItems" :disabled="!canEditStamping" class="w-full" />
        </UFormField>
      </div>
      <p class="text-xs text-gray-500">{{ de.employees.stampingHint }}</p>
      <UButton v-if="canEditStamping" type="submit" :label="de.common.save" />
      <p v-else class="text-xs text-gray-500">{{ de.errors.own_account }}</p>
    </form>
    </div>

    <div v-show="tab === 'records'" v-bind="panel('records')">
      <EmployeesRequirementsSection :employee-id="id" />
      <!-- Personalakte: mounted only with the rights, loaded in the browser only once the tab is opened. -->
      <div v-if="shows('documents')" id="employee-section-documents" class="scroll-mt-32 space-y-4">
        <EmployeesDocumentsSection :employee-id="id" :active="tab === 'records'" />
      </div>
    </div>

    <div v-if="visibleTabs.includes('talks')" v-show="tab === 'talks'" v-bind="panel('talks')">
      <EmployeesTalksSection :employee-id="id" />
    </div>

    <div v-if="visibleTabs.includes('access')" v-show="tab === 'access'" v-bind="panel('access')">
      <EmployeesAccessSection :employee-id="id" :employee-name="employee.name" />
    </div>
  </div>
</template>
