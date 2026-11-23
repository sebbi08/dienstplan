<script setup lang="ts">
import { todayIso } from '#shared/domain/dates'
import type { UpcomingSchoolChildDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { futureSchoolLabel } from '~/utils/contacts'
import { errorMessage } from '~/utils/errors'
import { formatDate } from '~/utils/format'
import { groupByDistrict } from '~/utils/schoolDistricts'

/**
 * The list „Schulkinder zum 1.9.“ (Kinder → Belegung) to print by school district (from the facility's street list,
 * computed from the addresses): one section per district with its count, „nicht eindeutig“, „nicht in der Liste“ and
 * the children without address last. Leitung and Träger (children.manage).
 */
definePageMeta({ layout: false })
useHead({ style: [{ innerHTML: '@page { size: A4 portrait !important; margin: 12mm !important; } @media print { html { font-size: 13px !important; } }' }] })

const { data, error } = await useFetch<UpcomingSchoolChildDto[]>('/api/children/school-children', { key: 'print-school-children' })
const lookups = useChildLookups()
await lookups.ready
const { groupName } = lookups
const sections = computed(() => groupByDistrict(data.value ?? []))
const asOf = computed(() => data.value?.find(child => child.schoolDistrict)?.schoolDistrict?.asOf ?? '')

const th = 'px-3 py-1.5'
const td = 'px-3 py-1.5'
</script>

<template>
  <div class="mx-auto max-w-3xl bg-white p-6 text-gray-900 print:max-w-none print:p-0">
    <div class="mb-4 flex flex-wrap items-baseline gap-3">
      <h1 class="text-2xl font-semibold">{{ de.schoolChildren.listTitle('1.9.') }} – {{ de.schoolDistricts.list.column }}</h1>
      <PrintActions file-name="Schulkinder-nach-Schulbezirk" />
    </div>
    <p v-if="error" class="text-red-700">{{ errorMessage(error) }}</p>
    <p v-else-if="!sections.length" class="text-sm text-gray-600">{{ de.children.empty }}</p>
    <template v-else>
      <p class="mb-3 text-sm">
        {{ sections.map(section => de.schoolDistricts.list.count(section.label, section.rows.length)).join(' · ') }}
        <span class="text-gray-600">{{ de.schoolDistricts.record.source(asOf) }}</span>
      </p>
      <section v-for="section in sections" :key="section.key" class="mb-5 break-inside-avoid">
        <h2 class="mb-1 text-lg font-semibold">{{ section.label }} ({{ section.rows.length }})</h2>
        <table class="w-full text-sm">
          <thead class="border-b border-gray-400 text-left text-xs text-gray-600 print:text-gray-900">
            <tr>
              <th :class="th">{{ de.children.fields.name }}</th>
              <th :class="th">{{ de.children.fields.group }}</th>
              <th :class="th">{{ de.schoolChildren.schoolStart }}</th>
              <th :class="th">{{ de.contacts.schoolColumn }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="child in section.rows" :key="child.id" class="break-inside-avoid border-b border-gray-200">
              <td :class="td" class="font-medium">{{ child.name }}</td>
              <td :class="td">{{ groupName(child.groupId) }}</td>
              <td :class="td" class="whitespace-nowrap">{{ formatDate(child.schoolStart) }}</td>
              <td :class="td">{{ futureSchoolLabel(child) ?? '' }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>
    <p class="mt-3 text-xs text-gray-500">{{ de.time.printedAt(formatDate(todayIso())) }}</p>
  </div>
</template>
