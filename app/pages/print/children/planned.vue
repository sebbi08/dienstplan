<script setup lang="ts">
import { todayIso } from '#shared/domain/dates'
import type { PlannedChildrenDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { ageAtStartText } from '~/utils/children'
import { errorMessage } from '~/utils/errors'
import { formatDate } from '~/utils/format'

definePageMeta({ layout: false })

const { data, error } = await useFetch<PlannedChildrenDto>('/api/children/planned', { key: 'print-children-planned' })
const lookups = useChildLookups()
await lookups.ready
const { groupName } = lookups

const a = de.children.admission
const lists = computed(() => [
  { key: 'waitlist', title: a.waitlistTitle, rows: data.value?.waitlist ?? [], start: a.desiredStart, group: a.desiredGroup, waitlisted: true },
  { key: 'contracted', title: a.contractedTitle, rows: data.value?.contracted ?? [], start: a.contractStart, group: a.assignedGroup, waitlisted: false },
])

const th = 'px-2 py-1.5'
const td = 'px-2 py-1.5'
</script>

<template>
  <div class="mx-auto max-w-5xl bg-white p-6 text-gray-900">
    <div class="mb-4 flex flex-wrap items-baseline gap-3">
      <h1 class="text-2xl font-semibold">{{ de.children.printPlanned }}</h1>
      <PrintActions file-name="Vormerkungen-und-Vertraege" />
    </div>
    <p v-if="error" class="text-red-700">{{ errorMessage(error) }}</p>
    <template v-else>
      <section v-for="list in lists" :key="list.key" class="mb-6">
        <h2 class="mb-1 text-lg font-semibold">{{ list.title }} ({{ list.rows.length }})</h2>
        <p v-if="!list.rows.length" class="text-sm text-gray-600">{{ de.children.empty }}</p>
        <table v-else class="w-full text-xs">
          <thead class="border-b border-gray-400 text-left text-gray-600">
            <tr>
              <th :class="th">{{ de.children.fields.name }}</th>
              <th :class="th">{{ de.children.fields.birthDate }}</th>
              <th :class="th">{{ a.ageAtStart }}</th>
              <th :class="th">{{ list.start }}</th>
              <th :class="th">{{ list.group }}</th>
              <th :class="th">{{ de.children.fields.careType }}</th>
              <th :class="th">{{ a.phone }}</th>
              <th :class="th">{{ de.children.fields.note }}</th>
              <th v-if="list.waitlisted" :class="th">{{ a.waitlistedOn }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="child in list.rows" :key="child.id" class="break-inside-avoid border-b border-gray-200 align-top">
              <td :class="td" class="font-medium">{{ child.lastName }}, {{ child.firstName }}</td>
              <td :class="td" class="whitespace-nowrap">{{ formatDate(child.birthDate) }}</td>
              <td :class="td" class="whitespace-nowrap">{{ ageAtStartText(child.birthDate, child.plannedStart) }}</td>
              <td :class="td" class="whitespace-nowrap">{{ child.plannedStart ? formatDate(child.plannedStart) : de.children.noValue }}</td>
              <td :class="td">{{ child.groupId === null ? de.children.noValue : groupName(child.groupId) }}</td>
              <td :class="td">{{ child.careTypeName ?? de.children.noValue }}</td>
              <td :class="td" class="whitespace-nowrap">{{ child.phone || de.children.noValue }}</td>
              <td :class="td" class="whitespace-pre-line break-words">{{ child.note || de.children.noValue }}</td>
              <td v-if="list.waitlisted" :class="td" class="whitespace-nowrap">{{ child.waitlistedOn ? formatDate(child.waitlistedOn) : de.children.noValue }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>
    <p class="mt-3 text-xs text-gray-500">{{ de.time.printedAt(formatDate(todayIso())) }}</p>
  </div>
</template>
