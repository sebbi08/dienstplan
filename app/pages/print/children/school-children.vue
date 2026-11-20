<script setup lang="ts">
import { todayIso } from '#shared/domain/dates'
import type { UpcomingSchoolChildDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { groupBySchool } from '~/utils/contacts'
import { errorMessage } from '~/utils/errors'
import { formatDate } from '~/utils/format'

/**
 * The list „Schulkinder zum 1.9.“ (Kinder → Belegung) to print, one section per future school (from the child's record,
 * „ohne künftige Schule“ last), e.g. to hand each school its children. Leitung and Träger (children.manage).
 */
definePageMeta({ layout: false })
useHead({ style: [{ innerHTML: '@page { size: A4 portrait !important; margin: 12mm !important; } @media print { html { font-size: 13px !important; } }' }] })

const { data, error } = await useFetch<UpcomingSchoolChildDto[]>('/api/children/school-children', { key: 'print-school-children' })
const lookups = useChildLookups()
await lookups.ready
const { groupName } = lookups
const sections = computed(() => groupBySchool(data.value ?? []))

const th = 'px-3 py-1.5'
const td = 'px-3 py-1.5'
</script>

<template>
  <div class="mx-auto max-w-3xl bg-white p-6 text-gray-900 print:max-w-none print:p-0">
    <div class="mb-4 flex flex-wrap items-baseline gap-3">
      <h1 class="text-2xl font-semibold">{{ de.contacts.schoolChildrenTitle('1.9.') }}</h1>
      <PrintActions file-name="Schulkinder-nach-Schule" />
    </div>
    <p v-if="error" class="text-red-700">{{ errorMessage(error) }}</p>
    <p v-else-if="!sections.length" class="text-sm text-gray-600">{{ de.children.empty }}</p>
    <section v-for="section in sections" :key="section.school ?? ''" class="mb-5 break-inside-avoid">
      <h2 class="mb-1 text-lg font-semibold">{{ section.school ?? de.contacts.noSchool }} ({{ section.rows.length }})</h2>
      <table class="w-full text-sm">
        <thead class="border-b border-gray-400 text-left text-xs text-gray-600 print:text-gray-900">
          <tr>
            <th :class="th">{{ de.children.fields.name }}</th>
            <th :class="th">{{ de.children.fields.group }}</th>
            <th :class="th">{{ de.schoolChildren.schoolStart }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="child in section.rows" :key="child.id" class="break-inside-avoid border-b border-gray-200">
            <td :class="td" class="font-medium">{{ child.name }}</td>
            <td :class="td">{{ groupName(child.groupId) }}</td>
            <td :class="td" class="whitespace-nowrap">{{ formatDate(child.schoolStart) }}</td>
          </tr>
        </tbody>
      </table>
    </section>
    <p class="mt-3 text-xs text-gray-500">{{ de.time.printedAt(formatDate(todayIso())) }}</p>
  </div>
</template>
