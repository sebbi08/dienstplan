<script setup lang="ts">
import { confirmsName } from '#shared/domain/confirmName'
import { parseIsoDate, todayIso } from '#shared/domain/dates'
import { mayDeleteEmployeeByHand, type RetentionSettings } from '#shared/domain/retention'
import { MONDAY_TO_FRIDAY } from '#shared/domain/targets'
import { formatSignedDuration, parseDuration } from '#shared/domain/time'
import type {
  AppSettingsDto, BalanceDto, DueRequirementDto, EmployeeListItemDto, LeaveAccountDto, LevelUpDto, UserDto,
} from '#shared/types/api'
import { de } from '~/locales/de'
import { balanceClass } from '~/utils/colors'
import { formatDate, formatHours, formatNumber, hoursToMinutes } from '~/utils/format'
import { splitLeavers } from '~/utils/leavers'
import { archiveRetentionText } from '~/utils/retentionText'
import { staffBadges, type StaffBadge } from '~/utils/staffList'
import { workdaysText } from '~/utils/workdays'

/**
 * All employees in one compact list: group, weekly hours, overtime balance today and the leave left in the chosen
 * month's year, plus small badges for what is missing. Everything else is on the person's page.
 */
const today = parseIsoDate(todayIso())
const { user } = useUserSession()
const isProvider = computed(() => user.value?.role === 'provider')
const { data: appSettings, refresh: refreshAppSettings } = await useFetch<AppSettingsDto>('/api/app-settings')
const runVisibility = useAction(refreshAppSettings)
function setContractVisible(visible: boolean) {
  runVisibility(() => $fetch<unknown>('/api/contract-visibility', { method: 'PUT', body: { visible } }), de.common.saved)
}
const year = ref(today.year)
const month = ref(today.month)

const { data: list, refresh } = await useFetch<EmployeeListItemDto[]>('/api/employees')
/** Who left before today is listed apart at the end (the move arrows work on the active list only). */
const split = computed(() => splitLeavers(list.value ?? [], todayIso()))
// The home group, only when the facility has groups (null = Springer).
const { data: groups, hasGroups } = useGroups()
const groupText = (groupId: number | null) => groups.value?.find(group => group.id === groupId)?.name ?? de.groups.springer
/** 0 = Springer (the select needs a non-null value). */
const groupItems = computed(() => [
  ...(groups.value ?? []).map(group => ({ label: group.name, value: group.id })),
  { label: de.groups.springerOption, value: 0 },
])
// „Stundenkonto heute“ does not depend on the month chosen above (only Resturlaub follows it): always today's month.
const { data: balances, refresh: refreshBalances } = await useFetch<BalanceDto[]>('/api/balances', { query: { year: today.year, month: today.month } })
const { data: leave, refresh: refreshLeave } = await useFetch<LeaveAccountDto[]>('/api/leave', { query: { year } })
// For the badges: the accounts (linked to whom) and the people in the notice of mandatory appointments.
const { data: users, refresh: refreshUsers } = await useFetch<UserDto[]>('/api/users')
const { data: due, refresh: refreshDue } = await useFetch<DueRequirementDto[]>('/api/requirements/due')
const { data: levelUps, refresh: refreshLevelUps } = await useFetch<LevelUpDto[]>('/api/level-ups')
const run = useAction(async () => {
  await Promise.all([refresh(), refreshBalances(), refreshLeave(), refreshUsers(), refreshDue()])
})

const balanceOf = computed(() => new Map((balances.value ?? []).map(balance => [balance.employeeId, balance])))
const leaveOf = computed(() => new Map((leave.value ?? []).map(row => [row.employeeId, row.account])))
const linked = computed(() => new Set((users.value ?? []).map(account => account.employeeId).filter(id => id !== null)))
const withDue = computed(() => new Set((due.value ?? []).map(row => row.employeeId)))
const badgesOf = computed(() => new Map(split.value.active.map(employee => [employee.id, staffBadges(employee, {
  requirementsOpen: withDue.value.has(employee.id), hasAccount: linked.value.has(employee.id),
})])))
const BADGE_COLOR: Record<StaffBadge, 'warning' | 'error' | 'neutral'> = {
  pinMissing: 'warning', pinLocked: 'error', qualificationMissing: 'warning', requirementsOpen: 'warning', noAccess: 'neutral',
}

// The notices fold into one line; the Träger's switch for the contract data sits in there as well.
const noticesOpen = ref(false)
const noticeCount = computed(() => (levelUps.value?.length ?? 0) + withDue.value.size)
const noticeLine = computed(() => {
  const line = de.employees.notices(noticeCount.value)
  if (!isProvider.value || !appSettings.value) return line
  return `${line} · ${appSettings.value.contractVisibleToAdmins ? de.contract.visibleOn : de.contract.visibleOff}`
})
async function levelChanged() {
  await Promise.all([refresh(), refreshLevelUps()])
}

const toast = useToast()
const emptyForm = () => ({
  name: '', shortName: '', weeklyHours: 39, validFrom: todayIso(), workdays: MONDAY_TO_FRIDAY,
  vacationDays: null as number | null, carriedOverDays: null as number | null, openingBalance: '', groupId: 0,
})
const form = reactive(emptyForm())
const createOpen = ref(false)

/** "12:30" → 750, "-3:00" → -180, empty → null, invalid → undefined. */
function signedDuration(text: string): number | null | undefined {
  const trimmed = text.trim().replace('−', '-')
  if (!trimmed) return null
  const negative = trimmed.startsWith('-')
  const minutes = parseDuration(trimmed.replace(/^[+-]/, ''))
  return minutes === null ? undefined : negative ? -minutes : minutes
}

async function create() {
  if (form.workdays === 0) {
    toast.add({ title: de.employees.workdaysRequired, color: 'error' })
    return
  }
  const openingBalanceMinutes = signedDuration(form.openingBalance)
  if (openingBalanceMinutes === undefined) {
    toast.add({ title: de.employees.invalidDuration, color: 'error' })
    return
  }
  const ok = await run(() => $fetch<unknown>('/api/employees', {
    method: 'POST',
    body: {
      name: form.name, shortName: form.shortName, weeklyMinutes: hoursToMinutes(form.weeklyHours), validFrom: form.validFrom,
      workdays: form.workdays, vacationDays: form.vacationDays, carriedOverDays: form.carriedOverDays, openingBalanceMinutes,
      ...(hasGroups.value ? { groupId: form.groupId || null } : {}),
    },
  }), de.common.saved)
  if (ok) {
    Object.assign(form, emptyForm())
    createOpen.value = false
  }
}

// The facility's Löschfristen: when the data of each person in the archive is deleted, and who may delete by hand.
const { data: retention } = await useFetch<RetentionSettings>('/api/retention-settings', { key: 'employees-retention-settings' })
const retentionLine = (employee: EmployeeListItemDto) =>
  retention.value && employee.leftOn ? archiveRetentionText(employee.leftOn, retention.value, todayIso()) : null

/**
 * „Endgültig löschen“ in the archive: the dialog lists what goes, warns that the Löschfristen are not kept, and asks
 * for the exact name. Only as far as the Träger setting allows it for the role, not for the own record, and for a
 * Leitung not for a person with a Träger account (the server refuses all of these as well).
 */
const deleting = ref<EmployeeListItemDto | null>(null)
const deleteName = ref('')
const accountOf = (employeeId: number) => users.value?.find(account => account.employeeId === employeeId) ?? null
const mayDelete = (employee: EmployeeListItemDto) => !!retention.value
  && mayDeleteEmployeeByHand(retention.value.employeeDelete, user.value?.role)
  && employee.id !== user.value?.employeeId
  && (isProvider.value || accountOf(employee.id)?.role !== 'provider')
const deleteAccount = computed(() => deleting.value ? accountOf(deleting.value.id) : null)
const nameConfirmed = computed(() => deleting.value !== null && confirmsName(deleteName.value, deleting.value.name))
/** While the request runs the button waits (a second click would only bring „nicht gefunden“). */
const deletePending = ref(false)
function askDelete(employee: EmployeeListItemDto) {
  deleting.value = employee
  deleteName.value = ''
}
async function confirmDelete() {
  const employee = deleting.value
  if (!employee || !nameConfirmed.value || deletePending.value) return
  deletePending.value = true
  try {
    const ok = await run(() => $fetch<unknown>(`/api/employees/${employee.id}`, { method: 'DELETE', body: { confirm: deleteName.value } }),
      de.employees.deleteDone(employee.name))
    if (ok) deleting.value = null
  }
  finally {
    deletePending.value = false
  }
}

/** The move arrows only show while „Reihenfolge ändern“ is on. */
const reordering = ref(false)
function move(id: number, direction: 'up' | 'down') {
  run(() => $fetch<unknown>(`/api/employees/${id}/move`, { method: 'POST', body: { direction } }))
}

function change(nextYear: number, nextMonth: number) {
  year.value = nextYear
  month.value = nextMonth
}

const groupTitle = 'mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500'
const hint = 'text-xs text-gray-500'
const th = 'px-3 py-2 font-medium'
const td = 'px-3 py-2'
</script>

<template>
  <div class="max-w-4xl space-y-4">
    <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
      <h1 class="text-2xl font-semibold">{{ de.employees.title }}</h1>
      <MonthNav :year="year" :month="month" @change="change" />
      <div class="flex flex-wrap gap-2 sm:ml-auto">
        <UButton icon="i-lucide-plus" :label="de.employees.create" @click="createOpen = true" />
        <UButton
          color="neutral" :variant="reordering ? 'solid' : 'outline'" :icon="reordering ? 'i-lucide-check' : 'i-lucide-arrow-up-down'"
          :label="reordering ? de.employees.reorderDone : de.employees.reorder" :aria-pressed="reordering" @click="reordering = !reordering"
        />
      </div>
    </div>

    <!-- The notices in one line; open on tap. Kept in the page (v-show), so they load with it. -->
    <div v-if="noticeCount > 0 || isProvider" class="rounded-lg bg-white text-sm ring-1 ring-gray-200">
      <button
        type="button" class="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left" :aria-expanded="noticesOpen"
        aria-controls="employee-notices" @click="noticesOpen = !noticesOpen"
      >
        <UIcon name="i-lucide-info" class="size-4 shrink-0" :class="noticeCount > 0 ? 'text-amber-600' : 'text-gray-400'" aria-hidden="true" />
        <span class="min-w-0 flex-1 font-medium" :class="noticeCount > 0 ? 'text-amber-800' : 'text-gray-600'">{{ noticeLine }}</span>
        <UIcon :name="noticesOpen ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="size-4 shrink-0 text-gray-500" aria-hidden="true" />
      </button>
      <div v-show="noticesOpen" id="employee-notices" class="space-y-3 border-t border-gray-100 p-3">
        <LevelUpNotice @changed="levelChanged" />
        <RequirementNotice />
        <div v-if="isProvider && appSettings" class="flex flex-wrap items-center gap-2">
          <USwitch :model-value="appSettings.contractVisibleToAdmins" :label="de.contract.visible" @update:model-value="setContractVisible" />
          <span class="text-xs text-gray-500">{{ de.contract.visibleHint }}</span>
        </div>
      </div>
    </div>

    <!-- From sm on a table, on a phone one compact card per person. -->
    <table class="hidden w-full overflow-hidden rounded-lg bg-white text-sm shadow-sm ring-1 ring-gray-200 sm:table">
      <thead class="bg-gray-50 text-left text-xs text-gray-500">
        <tr>
          <th :class="th">{{ de.employees.name }}</th>
          <th v-if="hasGroups" :class="th">{{ de.employees.group }}</th>
          <th :class="[th, 'text-right']">{{ de.employees.weeklyHours }}</th>
          <th :class="[th, 'text-right']">{{ de.employees.balanceToday }}</th>
          <th :class="[th, 'text-right']">{{ de.employees.leaveLeft(year) }}</th>
          <th :class="th"><span class="sr-only">{{ de.employees.badgesLabel }}</span></th>
          <th v-if="reordering" :class="th"><span class="sr-only">{{ de.employees.order }}</span></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(employee, index) in split.active" :key="employee.id" class="border-t border-gray-100 align-top">
          <td :class="td">
            <NuxtLink :to="`/admin/employees/${employee.id}`" class="font-semibold text-sky-700 hover:underline">{{ employee.name }}</NuxtLink>
            <span v-if="employee.shortName" class="ml-1.5 text-gray-500">{{ employee.shortName }}</span>
            <div v-if="employee.leftOn" class="text-xs text-gray-500">{{ de.employees.leftOn }} {{ formatDate(employee.leftOn) }}</div>
          </td>
          <td v-if="hasGroups" :class="td">{{ groupText(employee.groupId) }}</td>
          <td :class="[td, 'whitespace-nowrap text-right']" :title="workdaysText(employee.currentWorkdays)">{{ formatHours(employee.currentWeeklyMinutes) }}</td>
          <td :class="[td, 'whitespace-nowrap text-right']">
            <span v-if="balanceOf.get(employee.id)" class="font-semibold" :class="balanceClass(balanceOf.get(employee.id)!.today)">
              {{ formatSignedDuration(balanceOf.get(employee.id)!.today) }}
            </span>
            <span v-else class="text-gray-400">–</span>
          </td>
          <td :class="[td, 'whitespace-nowrap text-right']">
            <span v-if="leaveOf.get(employee.id)" :class="leaveOf.get(employee.id)!.available < 0 ? 'font-semibold text-red-700' : ''">
              {{ formatNumber(leaveOf.get(employee.id)!.available) }}
            </span>
            <span v-else class="text-gray-400">–</span>
          </td>
          <td :class="td">
            <span class="flex flex-wrap gap-1">
              <UBadge v-for="badge in badgesOf.get(employee.id)" :key="badge" size="sm" variant="soft" :color="BADGE_COLOR[badge]" :label="de.employees.badges[badge]" />
            </span>
          </td>
          <td v-if="reordering" :class="[td, 'whitespace-nowrap py-1']">
            <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-arrow-up" :aria-label="de.employees.moveUp" :disabled="index === 0" @click="move(employee.id, 'up')" />
            <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-arrow-down" :aria-label="de.employees.moveDown" :disabled="index === split.active.length - 1" @click="move(employee.id, 'down')" />
          </td>
        </tr>
      </tbody>
    </table>

    <ul class="space-y-2 sm:hidden">
      <li v-for="(employee, index) in split.active" :key="employee.id" class="rounded-lg bg-white px-3 py-2 text-sm shadow-sm ring-1 ring-gray-200">
        <div class="flex items-start gap-2">
          <div class="min-w-0 flex-1">
            <NuxtLink :to="`/admin/employees/${employee.id}`" class="font-semibold text-sky-700 hover:underline">{{ employee.name }}</NuxtLink>
            <span v-if="employee.shortName" class="ml-1.5 text-gray-500">{{ employee.shortName }}</span>
          </div>
          <span v-if="reordering" class="-my-1 flex shrink-0">
            <UButton size="sm" color="neutral" variant="ghost" icon="i-lucide-arrow-up" :aria-label="de.employees.moveUp" :disabled="index === 0" @click="move(employee.id, 'up')" />
            <UButton size="sm" color="neutral" variant="ghost" icon="i-lucide-arrow-down" :aria-label="de.employees.moveDown" :disabled="index === split.active.length - 1" @click="move(employee.id, 'down')" />
          </span>
        </div>
        <div class="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-gray-600">
          <span v-if="hasGroups">{{ groupText(employee.groupId) }}</span>
          <span>{{ formatHours(employee.currentWeeklyMinutes) }} {{ de.employees.hoursShort }}</span>
          <span>
            {{ de.employees.balanceShort }}
            <span v-if="balanceOf.get(employee.id)" class="font-semibold" :class="balanceClass(balanceOf.get(employee.id)!.today)">{{ formatSignedDuration(balanceOf.get(employee.id)!.today) }}</span>
            <span v-else class="text-gray-400">–</span>
          </span>
          <span>
            {{ de.employees.leaveLeftShort }}
            <span v-if="leaveOf.get(employee.id)" :class="leaveOf.get(employee.id)!.available < 0 ? 'font-semibold text-red-700' : 'font-semibold'">{{ formatNumber(leaveOf.get(employee.id)!.available) }}</span>
            <span v-else class="text-gray-400">–</span>
          </span>
          <span v-if="employee.leftOn" class="text-xs">{{ de.employees.leftOn }} {{ formatDate(employee.leftOn) }}</span>
        </div>
        <div v-if="badgesOf.get(employee.id)?.length" class="mt-1.5 flex flex-wrap gap-1">
          <UBadge v-for="badge in badgesOf.get(employee.id)" :key="badge" size="sm" variant="soft" :color="BADGE_COLOR[badge]" :label="de.employees.badges[badge]" />
        </div>
      </li>
    </ul>
    <p :class="hint">{{ de.employees.listHint(isProvider || appSettings?.contractVisibleToAdmins === true) }}</p>

    <!-- Who already left: closed by default; the detail page stays as it is until someone deletes the person for good. -->
    <details v-if="split.archived.length" class="rounded-lg bg-white px-4 py-3 text-sm shadow-sm ring-1 ring-gray-200">
      <summary class="cursor-pointer font-semibold text-gray-700">{{ de.employees.archived(split.archived.length) }}</summary>
      <ul class="mt-2 divide-y divide-gray-100">
        <li v-for="employee in split.archived" :key="employee.id" class="flex flex-wrap items-center gap-x-4 gap-y-1 py-1.5">
          <NuxtLink :to="`/admin/employees/${employee.id}`" class="font-medium text-sky-700 hover:underline">{{ employee.name }}</NuxtLink>
          <span v-if="employee.shortName" class="text-gray-600">{{ employee.shortName }}</span>
          <span v-if="hasGroups" class="text-gray-600">{{ de.groups.employeeGroup }}: {{ groupText(employee.groupId) }}</span>
          <span class="text-gray-600">{{ de.employees.leftOn }} {{ formatDate(employee.leftOn!) }}</span>
          <UButton
            v-if="mayDelete(employee)" size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" class="sm:ml-auto"
            :label="de.employees.deleteForGood" @click="askDelete(employee)"
          />
          <p v-if="retentionLine(employee)" class="basis-full text-xs text-gray-500">{{ retentionLine(employee) }}</p>
        </li>
      </ul>
    </details>

    <UModal
      :open="deleting !== null" :title="deleting ? de.employees.deleteTitle(deleting.name) : ''"
      @update:open="open => { if (!open && !deletePending) deleting = null }"
    >
      <template #body>
        <form v-if="deleting" class="space-y-3 text-sm" @submit.prevent="confirmDelete">
          <p class="font-medium">{{ de.employees.deleteIntro }}</p>
          <ul class="list-disc space-y-0.5 pl-5 text-gray-700">
            <li v-for="item in de.employees.deleteItems" :key="item">{{ item }}</li>
            <li v-if="deleteAccount && deleteAccount.role !== 'provider'">{{ de.employees.deleteAccount(deleteAccount.username) }}</li>
          </ul>
          <p v-if="deleteAccount?.role === 'provider'" class="text-gray-700">{{ de.employees.deleteProviderAccount(deleteAccount.username) }}</p>
          <p class="text-gray-600">{{ de.employees.deleteKept }}</p>
          <p class="font-medium text-red-700">{{ de.employees.deleteRetentionWarning }}</p>
          <p class="font-medium text-amber-800">{{ de.employees.deleteBackupHint }}</p>
          <UFormField :label="de.employees.deleteTypeName(deleting.name)">
            <UInput v-model="deleteName" class="w-full" autocomplete="off" />
          </UFormField>
          <div class="flex flex-wrap justify-end gap-2 border-t border-gray-100 pt-3">
            <UButton color="neutral" variant="ghost" :label="de.common.cancel" @click="deleting = null" />
            <UButton
              type="submit" color="error" icon="i-lucide-trash-2" :label="de.employees.deleteForGood"
              :loading="deletePending" :disabled="!nameConfirmed || deletePending"
            />
          </div>
        </form>
      </template>
    </UModal>

    <UModal v-model:open="createOpen" :title="de.employees.create" :ui="{ content: 'sm:max-w-2xl' }">
      <template #body>
        <form class="space-y-5" @submit.prevent="create">
          <fieldset class="space-y-3">
            <legend :class="groupTitle">{{ de.employees.groupPerson }}</legend>
            <div class="grid gap-3 sm:grid-cols-4">
              <UFormField :label="de.employees.name" class="sm:col-span-3"><UInput v-model="form.name" class="w-full" required /></UFormField>
              <UFormField :label="de.employees.shortName"><UInput v-model="form.shortName" maxlength="10" class="w-full" /></UFormField>
              <UFormField v-if="hasGroups" :label="de.groups.employeeGroup" class="sm:col-span-2">
                <USelect v-model="form.groupId" :items="groupItems" class="w-full" />
              </UFormField>
            </div>
          </fieldset>

          <fieldset class="space-y-3 border-t border-gray-100 pt-4">
            <legend :class="groupTitle">{{ de.employees.groupContract }}</legend>
            <div class="grid gap-3 sm:grid-cols-4 sm:items-end">
              <UFormField :label="de.employees.weeklyHours"><UInput v-model.number="form.weeklyHours" type="number" step="0.25" min="0" class="w-full" /></UFormField>
              <UFormField :label="de.employees.validFrom"><UInput v-model="form.validFrom" type="date" class="w-full" required /></UFormField>
              <UFormField :label="de.employees.workdays" class="sm:col-span-2"><WorkdayPicker v-model="form.workdays" /></UFormField>
            </div>
            <p :class="hint">{{ de.employees.contractHint }}</p>
          </fieldset>

          <fieldset class="space-y-3 border-t border-gray-100 pt-4">
            <legend :class="groupTitle">{{ de.employees.groupCarryOver }}</legend>
            <div class="grid gap-3 sm:grid-cols-3">
              <UFormField :label="de.employees.vacationDays">
                <UInput v-model.number="form.vacationDays" type="number" step="0.5" min="0" max="100" placeholder="30" class="w-full" />
              </UFormField>
              <UFormField :label="de.employees.carriedOverDays">
                <UInput v-model.number="form.carriedOverDays" type="number" step="0.5" min="0" max="100" placeholder="0" class="w-full" />
              </UFormField>
              <UFormField :label="de.employees.openingBalance">
                <UInput v-model="form.openingBalance" placeholder="0:00" class="w-full" />
              </UFormField>
            </div>
            <p :class="hint">{{ de.employees.carryOverHint }}</p>
          </fieldset>

          <div class="flex flex-wrap justify-end gap-2 border-t border-gray-100 pt-4">
            <UButton color="neutral" variant="ghost" :label="de.common.cancel" @click="createOpen = false" />
            <UButton type="submit" icon="i-lucide-plus" :label="de.employees.create" />
          </div>
        </form>
      </template>
    </UModal>
  </div>
</template>
