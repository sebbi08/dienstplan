<script setup lang="ts">
import { parseIsoDate, todayIso } from '#shared/domain/dates'
import type { LeaveAccountDto, LeaveSettingsDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { showsComingYear } from '~/utils/comingYear'
import { errorMessage } from '~/utils/errors'
import { formatDate, formatNumber } from '~/utils/format'
import { specialDays, specialLeaveReasonText, specialRanges } from '~/utils/specialLeave'

const today = todayIso()
const year = ref(parseIsoDate(today).year)
const { data, error, refresh } = await useFetch<LeaveAccountDto>('/api/my/leave', { query: { year } })
// The request form only exists while the Träger has switched leave requests on.
const { data: leaveSettings } = await useFetch<LeaveSettingsDto>('/api/leave-settings')

// From 1 October the coming year is shown below the current one (a second request, same route).
const showComing = computed(() => showsComingYear(today, year.value))
const { data: comingData, error: comingError, refresh: refreshComing } = await useFetch<LeaveAccountDto>('/api/my/leave', {
  query: { year: computed(() => year.value + 1) }, enabled: showComing,
})
function refreshAll() {
  return Promise.all([refresh(), showComing.value ? refreshComing() : Promise.resolve()])
}

function cardsOf(dto: LeaveAccountDto | null | undefined) {
  const account = dto?.account
  if (!account) return []
  return [
    { label: de.leave.entitlement, value: account.entitlement, highlight: false },
    // „Zusatztag nur für dieses Jahr“: a card only when the year has some (the reasons are listed below the cards).
    ...(account.extraDays ? [{ label: de.leaveExtraDays.card, value: account.extraDays, highlight: false }] : []),
    { label: de.leave.carriedOver, value: account.carriedOver, highlight: false },
    { label: de.leave.taken, value: account.taken, highlight: false },
    { label: de.leave.planned, value: account.planned, highlight: false },
    { label: de.leave.available, value: account.available, highlight: true },
  ]
}
const blocks = computed(() => {
  const list: { dto: LeaveAccountDto; coming: boolean; cards: ReturnType<typeof cardsOf>; empty: boolean }[] = []
  if (data.value) list.push({ dto: data.value, coming: false, cards: cardsOf(data.value), empty: false })
  // Without any entitlement (recorded for the year or before) the account is all zero: say so instead.
  if (showComing.value && comingData.value) {
    list.push({ dto: comingData.value, coming: true, cards: cardsOf(comingData.value), empty: !comingData.value.hasEntitlement })
  }
  return list
})
</script>

<template>
  <div class="max-w-3xl space-y-4">
    <div class="flex items-center gap-3">
      <h1 class="text-2xl font-semibold">{{ de.leave.myTitle }}</h1>
      <YearNav v-model="year" />
    </div>
    <UAlert v-if="error" color="warning" variant="soft" :title="errorMessage(error)" />
    <UAlert v-if="showComing && comingError" color="warning" variant="soft" :title="errorMessage(comingError)" />
    <LeaveForfeitNotice />
    <LeaveRequestSection v-if="leaveSettings?.enabled" @changed="refreshAll" />
    <template v-for="block in blocks" :key="block.dto.year">
      <h2 v-if="blocks.length > 1" class="pt-2 text-xl font-semibold">{{ block.dto.year }}</h2>
      <p v-if="block.empty" class="text-sm text-gray-500">{{ de.leave.noComingYear(block.dto.year) }}</p>
      <template v-else>
        <div class="grid grid-cols-2 gap-3" :class="block.cards.length > 5 ? 'sm:grid-cols-6' : 'sm:grid-cols-5'">
          <div
            v-for="card in block.cards" :key="card.label" class="rounded-lg bg-white p-3"
            :class="card.highlight ? 'ring-2 ring-sky-500' : 'ring-1 ring-gray-200'"
          >
            <div class="text-xs text-gray-500">{{ card.label }}</div>
            <div class="text-2xl font-semibold">{{ formatNumber(card.value) }}</div>
          </div>
        </div>
        <p v-if="block.coming && block.dto.carriedAutomatically" class="text-xs text-gray-500">{{ de.leave.carryForecast(block.dto.year - 1) }}</p>
        <p v-if="block.dto.parentalLeaveCut" class="text-sm text-gray-600">{{ de.parentalLeave.leaveCut(formatNumber(block.dto.parentalLeaveCut)) }}</p>
        <p v-if="block.dto.parentalLeaveProtectedUntil" class="text-sm text-gray-600">
          {{ de.parentalLeave.leaveProtected(formatDate(block.dto.parentalLeaveProtectedUntil)) }}
        </p>
        <!-- „Zusatztag nur für dieses Jahr“ with its reasons (the person sees why). -->
        <section v-if="block.dto.extraDays.length" class="rounded-lg bg-white p-4 ring-1 ring-gray-200">
          <h3 class="mb-2 font-semibold">{{ de.leaveExtraDays.myTitle(block.dto.year) }}</h3>
          <ul class="divide-y divide-gray-100 text-sm">
            <li v-for="(extra, index) in block.dto.extraDays" :key="index" class="py-1.5">{{ de.leaveExtraDays.item(extra.days, extra.reason) }}</li>
          </ul>
        </section>
        <section v-if="block.dto.closures.length" class="rounded-lg bg-white p-4 ring-1 ring-gray-200">
          <LeaveClosureList :closures="block.dto.closures" />
        </section>
        <section class="rounded-lg bg-white p-4 ring-1 ring-gray-200">
          <h3 class="mb-2 font-semibold">{{ de.leave.ranges }}</h3>
          <p v-if="block.dto.ranges.length === 0" class="text-sm text-gray-500">{{ de.leave.noRanges }}</p>
          <ul v-else class="divide-y divide-gray-100 text-sm">
            <li v-for="range in block.dto.ranges" :key="range.from" class="flex justify-between py-1.5">
              <span>{{ range.from === range.to ? formatDate(range.from) : `${formatDate(range.from)} – ${formatDate(range.to)}` }}</span>
              <span class="text-gray-500">{{ de.leave.days(range.days) }} · {{ range.to < today ? de.leave.rangeTaken : de.leave.rangePlanned }}</span>
            </li>
          </ul>
        </section>
        <!-- The own Sonderurlaub with its reasons (only the person themselves sees them here). -->
        <section v-if="specialRanges(block.dto.entryRanges).length" class="rounded-lg bg-white p-4 ring-1 ring-gray-200">
          <h3 class="mb-2 font-semibold">{{ de.specialLeave.yearTitle(block.dto.year, de.leave.days(specialDays(block.dto.entryRanges))) }}</h3>
          <ul class="divide-y divide-gray-100 text-sm">
            <li v-for="range in specialRanges(block.dto.entryRanges)" :key="range.from" class="flex flex-wrap justify-between gap-x-3 py-1.5">
              <span>{{ range.from === range.to ? formatDate(range.from) : `${formatDate(range.from)} – ${formatDate(range.to)}` }}</span>
              <span class="text-gray-500">{{ de.leave.days(range.days) }}<template v-if="specialLeaveReasonText(range)"> · {{ specialLeaveReasonText(range) }}</template></span>
            </li>
          </ul>
        </section>
      </template>
    </template>
  </div>
</template>
