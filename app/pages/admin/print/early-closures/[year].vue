<script setup lang="ts">
import { todayIso, weekday } from '#shared/domain/dates'
import { formatTime } from '#shared/domain/time'
import type { EarlyClosureDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'
import { formatDate, formatDayShort } from '~/utils/format'

definePageMeta({ layout: false })

const year = Number(useRoute().params.year)
const { data: list, error } = await useFetch<EarlyClosureDto[]>('/api/early-closures', { query: { year } })

</script>

<template>
  <div class="mx-auto max-w-3xl bg-white p-6 text-gray-900">
    <div class="mb-4 flex flex-wrap items-baseline gap-3">
      <h1 class="text-2xl font-semibold">{{ de.earlyClosures.printTitle(year) }}</h1>
      <span v-if="list" class="text-sm text-gray-600">{{ de.earlyClosures.count(list.length) }}</span>
      <PrintActions :file-name="`Fruehere-Schliessungen-${year}`" />
    </div>
    <p v-if="error" class="text-red-700">{{ errorMessage(error) }}</p>
    <p v-else-if="!list?.length" class="text-sm text-gray-600">{{ de.earlyClosures.empty }}</p>
    <table v-else class="w-full border-collapse text-sm">
      <thead>
        <tr class="text-left">
          <th class="border border-gray-400 px-2 py-1">{{ de.earlyClosures.date }}</th>
          <th class="border border-gray-400 px-2 py-1">{{ de.earlyClosures.closedFrom }}</th>
          <th class="border border-gray-400 px-2 py-1">{{ de.earlyClosures.reason }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="closure in list" :key="closure.id" class="break-inside-avoid">
          <td class="whitespace-nowrap border border-gray-400 px-2 py-1">{{ formatDayShort(closure.date, weekday(closure.date)) }}{{ year }}</td>
          <td class="whitespace-nowrap border border-gray-400 px-2 py-1">{{ formatTime(closure.closedFrom) }} Uhr</td>
          <td class="border border-gray-400 px-2 py-1">{{ closure.reason }}</td>
        </tr>
      </tbody>
    </table>
    <p class="mt-4 text-xs text-gray-500">{{ de.time.printedAt(formatDate(todayIso())) }}</p>
  </div>
</template>
