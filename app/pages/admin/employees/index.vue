<script setup lang="ts">
import { parseIsoDate, todayIso } from '#shared/domain/dates'
import { MONDAY_TO_FRIDAY } from '#shared/domain/targets'
import { formatSignedDuration, parseDuration } from '#shared/domain/time'
import type { AppSettingsDto, BalanceDto, EmployeeListItemDto, LeaveAccountDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { balanceClass } from '~/utils/colors'
import { contractSummary } from '~/utils/contract'
import { formatDate, formatHours, formatNumber, hoursToMinutes } from '~/utils/format'
import { workdaysText } from '~/utils/workdays'

/** All employees in one place: master data, overtime balance (chosen month) and leave account (that month's year). */
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
// The home group, only when the facility has groups (null = Springer).
const { data: groups, hasGroups } = useGroups()
const groupText = (groupId: number | null) => groups.value?.find(group => group.id === groupId)?.name ?? de.groups.springer
/** 0 = Springer (the select needs a non-null value). */
const groupItems = computed(() => [
  ...(groups.value ?? []).map(group => ({ label: group.name, value: group.id })),
  { label: de.groups.springerOption, value: 0 },
])
const { data: balances, refresh: refreshBalances } = await useFetch<BalanceDto[]>('/api/balances', { query: { year, month } })
const { data: leave, refresh: refreshLeave } = await useFetch<LeaveAccountDto[]>('/api/leave', { query: { year } })
const nextYear = computed(() => year.value + 1)
const { data: nextLeave, refresh: refreshNextLeave } = await useFetch<LeaveAccountDto[]>('/api/leave', { query: { year: nextYear } })
const run = useAction(async () => {
  await Promise.all([refresh(), refreshBalances(), refreshLeave(), refreshNextLeave()])
})

const balanceOf = computed(() => new Map((balances.value ?? []).map(balance => [balance.employeeId, balance])))
const leaveOf = computed(() => new Map((leave.value ?? []).map(row => [row.employeeId, row])))
const nextLeaveOf = computed(() => new Map((nextLeave.value ?? []).map(row => [row.employeeId, row])))

/**
 * This year's leave, plus next year's as soon as it has anything (an entitlement, also one carried over from an earlier
 * year, or planned leave).
 */
function leaveRows(employeeId: number): { year: number; account: LeaveAccountDto['account'] | undefined; inheritedFrom: number | null }[] {
  const current = leaveOf.value.get(employeeId)
  const rows = [{ year: year.value, account: current?.account, inheritedFrom: current?.inheritedFrom ?? null }]
  const nextRow = nextLeaveOf.value.get(employeeId)
  const next = nextRow?.account
  if (next && (next.entitlement || next.carriedOver || next.planned)) rows.push({ year: nextYear.value, account: next, inheritedFrom: nextRow!.inheritedFrom })
  return rows
}

const toast = useToast()
const emptyForm = () => ({
  name: '', shortName: '', weeklyHours: 39, validFrom: todayIso(), workdays: MONDAY_TO_FRIDAY,
  vacationDays: null as number | null, carriedOverDays: null as number | null, openingBalance: '', groupId: 0,
})
const form = reactive(emptyForm())

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
  if (ok) Object.assign(form, emptyForm())
}

function move(id: number, direction: 'up' | 'down') {
  run(() => $fetch<unknown>(`/api/employees/${id}/move`, { method: 'POST', body: { direction } }))
}

function change(nextYear: number, nextMonth: number) {
  year.value = nextYear
  month.value = nextMonth
}

const label = 'w-32 whitespace-nowrap px-3 py-1.5 text-xs font-medium text-gray-500'
const value = 'px-3 py-1.5'
const groupTitle = 'mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500'
const hint = 'text-xs text-gray-500'
</script>

<template>
  <div class="max-w-4xl space-y-4">
    <div class="flex flex-wrap items-center gap-3">
      <h1 class="text-2xl font-semibold">{{ de.employees.title }}</h1>
      <MonthNav :year="year" :month="month" @change="change" />
    </div>
    <LevelUpNotice @changed="refresh" />
    <RequirementNotice />
    <div v-if="isProvider && appSettings" class="flex flex-wrap items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm ring-1 ring-gray-200">
      <USwitch :model-value="appSettings.contractVisibleToAdmins" :label="de.contract.visible" @update:model-value="setContractVisible" />
      <span class="text-xs text-gray-500">{{ de.contract.visibleHint }}</span>
    </div>

    <!-- One card per employee, with space in between. -->
    <div class="space-y-5">
      <table
        v-for="(employee, index) in list ?? []" :key="employee.id"
        class="w-full overflow-hidden rounded-lg bg-white text-sm shadow-sm ring-1 ring-gray-200"
      >
      <tbody>
        <tr class="bg-gray-50">
          <td colspan="2" class="px-3 py-2">
            <div class="flex flex-wrap items-center gap-x-4 gap-y-1">
              <NuxtLink :to="`/admin/employees/${employee.id}`" class="font-semibold text-sky-700 hover:underline">{{ employee.name }}</NuxtLink>
              <span v-if="employee.shortName" class="text-gray-600">{{ employee.shortName }}</span>
              <span v-if="hasGroups" class="text-gray-600">{{ de.groups.employeeGroup }}: {{ groupText(employee.groupId) }}</span>
              <span class="text-gray-600">{{ de.employees.weeklyHours }}: {{ formatHours(employee.currentWeeklyMinutes) }} ({{ workdaysText(employee.currentWorkdays) }})</span>
              <span v-if="employee.leftOn" class="text-gray-600">{{ de.employees.leftOn }} {{ formatDate(employee.leftOn) }}</span>
              <span v-if="employee.stampVia !== 'both'" class="text-gray-600">{{ de.employees.stampVia }}: {{ de.employees.stampChannels[employee.stampVia] }}</span>
              <span v-if="employee.breakMode === 'auto'" class="text-gray-600">{{ de.employees.breakMode }}: {{ de.employees.breakModes.auto }}</span>
              <span class="ml-auto">
                <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-arrow-up" :aria-label="de.employees.moveUp" :disabled="index === 0" @click="move(employee.id, 'up')" />
                <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-arrow-down" :aria-label="de.employees.moveDown" :disabled="index === (list?.length ?? 0) - 1" @click="move(employee.id, 'down')" />
              </span>
            </div>
          </td>
        </tr>
        <tr v-if="employee.contract" class="border-t border-gray-100">
          <td :class="label">{{ de.contract.rowLabel }}</td>
          <td :class="value">{{ contractSummary(employee.contract, todayIso()) || de.contract.empty }}</td>
        </tr>
        <tr class="border-t border-gray-100">
          <td :class="label">{{ de.balances.account }}</td>
          <td :class="value">
            <template v-if="balanceOf.get(employee.id)">
              {{ de.balances.today }}:
              <span class="font-semibold" :class="balanceClass(balanceOf.get(employee.id)!.today)">{{ formatSignedDuration(balanceOf.get(employee.id)!.today) }}</span>
              <span class="mx-2 text-gray-300">|</span>
              {{ de.balances.monthEnd }}:
              <span class="font-semibold" :class="balanceClass(balanceOf.get(employee.id)!.monthEnd)">{{ formatSignedDuration(balanceOf.get(employee.id)!.monthEnd) }}</span>
            </template>
            <span v-else class="text-gray-400">–</span>
          </td>
        </tr>
        <tr v-for="row in leaveRows(employee.id)" :key="row.year" class="border-t border-gray-100">
          <td :class="label">{{ de.leave.title }} {{ row.year }}</td>
          <td :class="value">
            <template v-if="row.account">
              <span v-for="(item, itemIndex) in [
                [de.leave.entitlement, row.account.entitlement],
                [de.leave.carriedOver, row.account.carriedOver],
                [de.leave.taken, row.account.taken],
                [de.leave.planned, row.account.planned],
              ] as const" :key="item[0]">
                <span v-if="itemIndex > 0" class="mx-2 text-gray-300">|</span>{{ item[0] }}: {{ formatNumber(item[1]) }}
                <span v-if="itemIndex === 0 && row.inheritedFrom !== null" class="text-xs text-gray-500">{{ de.leave.inheritedFrom(row.inheritedFrom) }}</span>
              </span>
              <span class="mx-2 text-gray-300">|</span>{{ de.leave.available }}:
              <span class="font-semibold" :class="row.account.available < 0 ? 'text-red-700' : ''">
                {{ formatNumber(row.account.available) }}
              </span>
            </template>
            <span v-else class="text-gray-400">–</span>
          </td>
        </tr>
      </tbody>
      </table>
    </div>
    <p class="text-xs text-gray-500">{{ de.balances.hint }}</p>

    <form class="space-y-5 rounded-lg bg-white p-5 shadow-sm ring-1 ring-gray-200" @submit.prevent="create">
      <h2 class="text-lg font-semibold">{{ de.employees.create }}</h2>

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

      <div class="border-t border-gray-100 pt-4">
        <UButton type="submit" icon="i-lucide-plus" :label="de.employees.create" />
      </div>
    </form>
  </div>
</template>
