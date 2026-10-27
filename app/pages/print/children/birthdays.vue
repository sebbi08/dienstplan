<script setup lang="ts">
import { parseIsoDate, todayIso } from '#shared/domain/dates'
import type { BirthdayDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'
import { formatDate } from '~/utils/format'

definePageMeta({ layout: false })
// A short list: A4 portrait over the full page width, readable text (the shared print rule is landscape with 10px).
useHead({ style: [{ innerHTML: '@page { size: A4 portrait !important; margin: 12mm !important; } @media print { html { font-size: 13.5px !important; } table td, table th { padding-top: 2px !important; padding-bottom: 2px !important; } }' }] })

const { data, error } = await useFetch<BirthdayDto[]>('/api/children/birthdays', { key: 'print-children-birthdays' })
const lookups = useChildLookups()
await lookups.ready
const { groupName } = lookups

// The endpoint sorts by the next birthday; the print list runs through the calendar year, January to December.
const monthDay = (iso: string) => {
  const { month, day } = parseIsoDate(iso)
  return month * 100 + day
}
const entries = computed(() => [...(data.value ?? [])].sort((a, b) => monthDay(a.birthDate) - monthDay(b.birthDate) || a.name.localeCompare(b.name, 'de')))
const showGroups = computed(() => entries.value.some(entry => entry.groupId !== null))
const dayMonth = (iso: string) => {
  const { month, day } = parseIsoDate(iso)
  return `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}.`
}

const th = 'px-3 py-1.5'
const td = 'px-3 py-1.5'
</script>

<template>
  <div class="mx-auto max-w-3xl bg-white p-6 text-gray-900 print:max-w-none print:p-0">
    <div class="mb-4 flex flex-wrap items-baseline gap-3">
      <h1 class="text-2xl font-semibold">{{ de.children.printBirthdays }}</h1>
      <PrintActions file-name="Geburtstage-Kinder" />
    </div>
    <p v-if="error" class="text-red-700">{{ errorMessage(error) }}</p>
    <p v-else-if="!entries.length" class="text-sm text-gray-600">{{ de.children.empty }}</p>
    <table v-else class="w-full text-sm">
      <thead class="border-b border-gray-400 text-left text-xs text-gray-600 print:text-gray-900">
        <tr>
          <th :class="th">{{ de.children.birthdayOn }}</th>
          <th :class="th">{{ de.children.fields.name }}</th>
          <th :class="th">{{ de.children.fields.birthDate }}</th>
          <th v-if="showGroups" :class="th">{{ de.children.fields.group }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="entry in entries" :key="entry.childId" class="break-inside-avoid border-b border-gray-200">
          <td :class="td" class="whitespace-nowrap font-medium">{{ dayMonth(entry.birthDate) }}</td>
          <td :class="td">{{ entry.name }}</td>
          <td :class="td" class="whitespace-nowrap">{{ formatDate(entry.birthDate) }}</td>
          <td v-if="showGroups" :class="td">{{ groupName(entry.groupId) }}</td>
        </tr>
      </tbody>
    </table>
    <p class="mt-3 text-xs text-gray-500">{{ de.time.printedAt(formatDate(todayIso())) }}</p>
  </div>
</template>
