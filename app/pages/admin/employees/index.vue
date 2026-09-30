<script setup lang="ts">
import { todayIso } from '#shared/domain/dates'
import type { EmployeeListItemDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { formatDate, formatHours, hoursToMinutes } from '~/utils/format'

const { data: list, refresh } = await useFetch<EmployeeListItemDto[]>('/api/employees')
const run = useAction(refresh)
const form = reactive({ name: '', shortName: '', weeklyHours: 39, validFrom: todayIso() })

async function create() {
  const ok = await run(() => $fetch<unknown>('/api/employees', {
    method: 'POST',
    body: { name: form.name, shortName: form.shortName, weeklyMinutes: hoursToMinutes(form.weeklyHours), validFrom: form.validFrom },
  }), de.common.saved)
  if (ok) Object.assign(form, { name: '', shortName: '' })
}

function move(id: number, direction: 'up' | 'down') {
  run(() => $fetch<unknown>(`/api/employees/${id}/move`, { method: 'POST', body: { direction } }))
}
</script>

<template>
  <div class="max-w-4xl space-y-4">
    <h1 class="text-2xl font-semibold">{{ de.employees.title }}</h1>
    <table class="w-full overflow-hidden rounded-lg bg-white text-sm ring-1 ring-gray-200">
      <thead class="bg-gray-100 text-left text-xs text-gray-600">
        <tr>
          <th class="px-3 py-2">{{ de.employees.name }}</th>
          <th class="px-3 py-2">{{ de.employees.shortName }}</th>
          <th class="px-3 py-2">{{ de.employees.weeklyHours }}</th>
          <th class="px-3 py-2">{{ de.employees.leftOn }}</th>
          <th class="px-3 py-2 text-right">{{ de.employees.order }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(employee, index) in list ?? []" :key="employee.id" class="border-t border-gray-100">
          <td class="px-3 py-2">
            <NuxtLink :to="`/admin/employees/${employee.id}`" class="text-sky-700 hover:underline">{{ employee.name }}</NuxtLink>
          </td>
          <td class="px-3 py-2">{{ employee.shortName }}</td>
          <td class="px-3 py-2">{{ formatHours(employee.currentWeeklyMinutes) }}</td>
          <td class="px-3 py-2">{{ employee.leftOn ? formatDate(employee.leftOn) : '' }}</td>
          <td class="px-3 py-2 text-right">
            <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-arrow-up" :aria-label="de.employees.moveUp" :disabled="index === 0" @click="move(employee.id, 'up')" />
            <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-arrow-down" :aria-label="de.employees.moveDown" :disabled="index === (list?.length ?? 0) - 1" @click="move(employee.id, 'down')" />
          </td>
        </tr>
      </tbody>
    </table>
    <form class="grid gap-3 rounded-lg bg-white p-4 ring-1 ring-gray-200 sm:grid-cols-5 sm:items-end" @submit.prevent="create">
      <h2 class="font-semibold sm:col-span-5">{{ de.employees.create }}</h2>
      <UFormField :label="de.employees.name" class="sm:col-span-2"><UInput v-model="form.name" class="w-full" required /></UFormField>
      <UFormField :label="de.employees.shortName"><UInput v-model="form.shortName" maxlength="10" class="w-full" /></UFormField>
      <UFormField :label="de.employees.weeklyHours"><UInput v-model.number="form.weeklyHours" type="number" step="0.25" min="0" class="w-full" /></UFormField>
      <UFormField :label="de.employees.validFrom"><UInput v-model="form.validFrom" type="date" class="w-full" required /></UFormField>
      <div class="sm:col-span-5"><UButton type="submit" icon="i-lucide-plus" :label="de.common.add" /></div>
    </form>
  </div>
</template>
