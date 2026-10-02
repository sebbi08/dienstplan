<script setup lang="ts">
import { parseIsoDate, todayIso } from '#shared/domain/dates'
import { MONDAY_TO_FRIDAY } from '#shared/domain/targets'
import { formatSignedDuration, parseDuration } from '#shared/domain/time'
import type { BalanceDto, EmployeeListItemDto, LeaveAccountDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { balanceClass } from '~/utils/colors'
import { formatDate, formatHours, formatNumber, hoursToMinutes } from '~/utils/format'
import { workdaysText } from '~/utils/workdays'

/** All employees in one place: master data, overtime balance (chosen month) and leave account (that month's year). */
const today = parseIsoDate(todayIso())
const year = ref(today.year)
const month = ref(today.month)

const { data: list, refresh } = await useFetch<EmployeeListItemDto[]>('/api/employees')
const { data: balances, refresh: refreshBalances } = await useFetch<BalanceDto[]>('/api/balances', { query: { year, month } })
const { data: leave, refresh: refreshLeave } = await useFetch<LeaveAccountDto[]>('/api/leave', { query: { year } })
const run = useAction(async () => {
  await Promise.all([refresh(), refreshBalances(), refreshLeave()])
})

const balanceOf = computed(() => new Map((balances.value ?? []).map(balance => [balance.employeeId, balance])))
const leaveOf = computed(() => new Map((leave.value ?? []).map(row => [row.employeeId, row])))

const toast = useToast()
const emptyForm = () => ({
  name: '', shortName: '', weeklyHours: 39, validFrom: todayIso(), workdays: MONDAY_TO_FRIDAY,
  vacationDays: null as number | null, carriedOverDays: null as number | null, openingBalance: '',
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
</script>

<template>
  <div class="max-w-4xl space-y-4">
    <div class="flex flex-wrap items-center gap-3">
      <h1 class="text-2xl font-semibold">{{ de.employees.title }}</h1>
      <MonthNav :year="year" :month="month" @change="change" />
    </div>

    <table class="w-full overflow-hidden rounded-lg bg-white text-sm ring-1 ring-gray-200">
      <tbody v-for="(employee, index) in list ?? []" :key="employee.id" class="border-t-4 border-gray-100 first:border-t-0">
        <tr class="bg-gray-50">
          <td colspan="2" class="px-3 py-2">
            <div class="flex flex-wrap items-center gap-x-4 gap-y-1">
              <NuxtLink :to="`/admin/employees/${employee.id}`" class="font-semibold text-sky-700 hover:underline">{{ employee.name }}</NuxtLink>
              <span v-if="employee.shortName" class="text-gray-600">{{ employee.shortName }}</span>
              <span class="text-gray-600">{{ de.employees.weeklyHours }}: {{ formatHours(employee.currentWeeklyMinutes) }} ({{ workdaysText(employee.currentWorkdays) }})</span>
              <span v-if="employee.leftOn" class="text-gray-600">{{ de.employees.leftOn }} {{ formatDate(employee.leftOn) }}</span>
              <span class="ml-auto">
                <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-arrow-up" :aria-label="de.employees.moveUp" :disabled="index === 0" @click="move(employee.id, 'up')" />
                <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-arrow-down" :aria-label="de.employees.moveDown" :disabled="index === (list?.length ?? 0) - 1" @click="move(employee.id, 'down')" />
              </span>
            </div>
          </td>
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
        <tr class="border-t border-gray-100">
          <td :class="label">{{ de.leave.title }} {{ year }}</td>
          <td :class="value">
            <template v-if="leaveOf.get(employee.id)">
              <span v-for="(item, itemIndex) in [
                [de.leave.entitlement, leaveOf.get(employee.id)!.account.entitlement],
                [de.leave.carriedOver, leaveOf.get(employee.id)!.account.carriedOver],
                [de.leave.taken, leaveOf.get(employee.id)!.account.taken],
                [de.leave.planned, leaveOf.get(employee.id)!.account.planned],
              ] as const" :key="item[0]">
                <span v-if="itemIndex > 0" class="mx-2 text-gray-300">|</span>{{ item[0] }}: {{ formatNumber(item[1]) }}
              </span>
              <span class="mx-2 text-gray-300">|</span>{{ de.leave.available }}:
              <span class="font-semibold" :class="leaveOf.get(employee.id)!.account.available < 0 ? 'text-red-700' : ''">
                {{ formatNumber(leaveOf.get(employee.id)!.account.available) }}
              </span>
            </template>
            <span v-else class="text-gray-400">–</span>
          </td>
        </tr>
      </tbody>
    </table>
    <p class="text-xs text-gray-500">{{ de.balances.hint }}</p>

    <form class="grid gap-3 rounded-lg bg-white p-4 ring-1 ring-gray-200 sm:grid-cols-5 sm:items-end" @submit.prevent="create">
      <h2 class="font-semibold sm:col-span-5">{{ de.employees.create }}</h2>
      <UFormField :label="de.employees.name" class="sm:col-span-2"><UInput v-model="form.name" class="w-full" required /></UFormField>
      <UFormField :label="de.employees.shortName"><UInput v-model="form.shortName" maxlength="10" class="w-full" /></UFormField>
      <UFormField :label="de.employees.weeklyHours"><UInput v-model.number="form.weeklyHours" type="number" step="0.25" min="0" class="w-full" /></UFormField>
      <UFormField :label="de.employees.validFrom"><UInput v-model="form.validFrom" type="date" class="w-full" required /></UFormField>
      <UFormField :label="de.employees.workdays" class="sm:col-span-2"><WorkdayPicker v-model="form.workdays" /></UFormField>
      <UFormField :label="de.employees.vacationDays" :help="de.employees.vacationDaysHint">
        <UInput v-model.number="form.vacationDays" type="number" step="0.5" min="0" max="100" class="w-full" />
      </UFormField>
      <UFormField :label="de.employees.carriedOverDays" :help="de.employees.carriedOverHint">
        <UInput v-model.number="form.carriedOverDays" type="number" step="0.5" min="0" max="100" class="w-full" />
      </UFormField>
      <UFormField :label="de.employees.openingBalance" :help="de.employees.openingBalanceHint">
        <UInput v-model="form.openingBalance" placeholder="0:00" class="w-full" />
      </UFormField>
      <p class="text-xs text-gray-500 sm:col-span-5">{{ de.employees.validFromHint }}</p>
      <div class="sm:col-span-5"><UButton type="submit" icon="i-lucide-plus" :label="de.common.add" /></div>
    </form>
  </div>
</template>
