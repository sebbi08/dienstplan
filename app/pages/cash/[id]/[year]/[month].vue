<script setup lang="ts">
import { canClose, formatCents, monthKey } from '#shared/domain/cash'
import { parseIsoDate, todayIso } from '#shared/domain/dates'
import type { CashBoxDto, CashMonthDto, CashMonthRowDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { cashMonthPath } from '~/utils/cash'
import { errorMessage } from '~/utils/errors'
import { formatDate, formatDateTime, monthTitle, shiftMonth } from '~/utils/format'

/** One month's sheet of a box (Kassenblatt): header like the template, entries, closing, log (spec Kasse §4). */
const route = useRoute()
const boxId = computed(() => Number(route.params.id))
const year = computed(() => Number(route.params.year))
const month = computed(() => Number(route.params.month))
const { user } = useUserSession()
const isProvider = computed(() => user.value?.role === 'provider')

const { data, error, refresh } = await useFetch<CashMonthDto>(() => `/api/cash/boxes/${boxId.value}/${year.value}/${month.value}`)
const { data: boxes, refresh: refreshBoxes } = await useFetch<CashBoxDto[]>('/api/cash/boxes', { default: () => [] })
useHead({ title: () => data.value ? `${de.cash.title} ${data.value.box.name}` : de.cash.title })

async function reload() {
  await Promise.all([refresh(), refreshBoxes()])
}

const today = todayIso()
const current = parseIsoDate(today)
const startMonth = computed(() => data.value ? { year: data.value.box.startYear, month: data.value.box.startMonth } : undefined)
const title = computed(() => monthTitle(year.value, month.value))

function navigate(nextYear: number, nextMonth: number) {
  return navigateTo(cashMonthPath(boxId.value, nextYear, nextMonth))
}

const closedMonth = computed(() => data.value?.closed ?? null)
const archived = computed(() => data.value?.box.archived ?? false)
const editable = computed(() => !!data.value && !archived.value && !closedMonth.value)

/** Closed months are always the start month up to `closedThrough` (closing goes in order, reopening opens all later ones). */
const closedSet = computed(() => {
  const set = new Set<string>()
  const box = boxes.value.find(item => item.id === boxId.value)
  if (!box?.closedThrough || !startMonth.value) return set
  for (let at = startMonth.value; at.year * 12 + at.month <= box.closedThrough.year * 12 + box.closedThrough.month; at = shiftMonth(at.year, at.month, 1)) {
    set.add(monthKey(at.year, at.month))
  }
  return set
})
const closeCheck = computed(() => startMonth.value
  ? canClose({ year: year.value, month: month.value, today, startMonth: startMonth.value, closed: closedSet.value })
  : 'before_start')
const closeHint = computed(() => closeCheck.value === 'ok' || closeCheck.value === 'already_closed'
  ? ''
  : de.errors[`cash_close_${closeCheck.value}` as keyof typeof de.errors] as string)

const run = useAction(reload)
const confirm = useConfirm()

async function closeMonth() {
  if (!(await confirm(de.cash.closeConfirm(title.value), { confirmLabel: de.cash.closeLabel, danger: false }))) return
  await run(() => $fetch(`/api/cash/boxes/${boxId.value}/close`, { method: 'POST', body: { year: year.value, month: month.value } }), de.cash.closedToast)
}

const reopenOpen = ref(false)
const reopenReason = ref('')
function openReopen() {
  reopenReason.value = ''
  reopenOpen.value = true
}
async function reopen() {
  const body = { year: year.value, month: month.value, reason: reopenReason.value.trim() }
  if (await run(() => $fetch(`/api/cash/boxes/${boxId.value}/reopen`, { method: 'POST', body }), de.cash.reopened)) reopenOpen.value = false
}

const dialogOpen = ref(false)
const dialogMode = ref<'in' | 'out' | 'transfer'>('in')
const dialogRow = ref<CashMonthRowDto | null>(null)
function openNew(mode: 'in' | 'out' | 'transfer') {
  dialogMode.value = mode
  dialogRow.value = null
  dialogOpen.value = true
}
function openRow(row: CashMonthRowDto) {
  if (!editable.value) return
  dialogMode.value = row.transferId != null ? 'transfer' : row.direction
  dialogRow.value = row
  dialogOpen.value = true
}

/** Red only on cash boxes whose sheet went below 0 (never on EC/Konto). */
const negativeRow = (row: CashMonthRowDto) => !!data.value?.negative && row.balanceAfter < 0
const receiptUrl = (row: CashMonthRowDto) => `/api/cash/receipts/${row.receiptId}`
const csvMonth = computed(() => `/api/cash/boxes/${boxId.value}/csv?year=${year.value}&month=${month.value}`)
const csvYear = computed(() => `/api/cash/boxes/${boxId.value}/csv?year=${year.value}`)
</script>

<template>
  <div class="max-w-5xl space-y-4">
    <div class="flex flex-wrap items-center gap-2">
      <UButton to="/cash" color="neutral" variant="ghost" icon="i-lucide-arrow-left" :label="de.cash.title" />
      <MonthNav :year="year" :month="month" :min="startMonth" :max="current" @change="navigate" />
    </div>
    <p v-if="error" class="text-red-700">{{ errorMessage(error) }}</p>

    <template v-if="data">
      <section class="rounded-lg bg-white p-4 ring-1 ring-gray-200">
        <div class="text-xs uppercase tracking-wide text-gray-500">{{ de.cash.sheet }}</div>
        <h2 class="flex flex-wrap items-center gap-2 text-lg font-semibold">
          {{ de.cash.boxLabel(data.box.name) }}
          <UBadge color="neutral" variant="subtle" size="sm" :label="de.cash.kinds[data.box.kind]" />
          <span class="text-sm font-normal text-gray-500">{{ data.box.groupName ?? de.cash.facility }}</span>
        </h2>
        <div class="text-sm text-gray-600">{{ de.cash.monthYear(title) }}</div>
        <dl class="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <div><dt class="text-xs text-gray-500">{{ de.cash.opening }}</dt><dd class="font-semibold tabular-nums">{{ formatCents(data.opening) }}</dd></div>
          <div><dt class="text-xs text-gray-500">{{ de.cash.income }}</dt><dd class="font-semibold tabular-nums text-green-700">{{ formatCents(data.income) }}</dd></div>
          <div><dt class="text-xs text-gray-500">{{ de.cash.expense }}</dt><dd class="font-semibold tabular-nums">{{ formatCents(data.expense) }}</dd></div>
          <div>
            <dt class="text-xs text-gray-500">{{ de.cash.closing }}</dt>
            <dd class="font-semibold tabular-nums" :class="data.negative && data.closing < 0 ? 'text-red-600' : ''">{{ formatCents(data.closing) }}</dd>
          </div>
        </dl>
      </section>

      <UAlert v-if="data.negative" color="error" variant="subtle" icon="i-lucide-triangle-alert" :title="de.cash.negative" :description="de.cash.negativeHint" />
      <UAlert v-if="archived" color="neutral" variant="subtle" icon="i-lucide-archive" :description="de.cash.archivedHint" />
      <UAlert
        v-if="closedMonth" color="info" variant="subtle" icon="i-lucide-lock"
        :description="de.cash.closedHint(formatDateTime(closedMonth.at), closedMonth.by)"
      />

      <div class="flex flex-wrap gap-2">
        <template v-if="editable">
          <UButton icon="i-lucide-plus" :label="de.cash.addIncome" @click="openNew('in')" />
          <UButton icon="i-lucide-minus" :label="de.cash.addExpense" @click="openNew('out')" />
          <UButton color="neutral" variant="outline" icon="i-lucide-arrow-left-right" :label="de.cash.transfer" @click="openNew('transfer')" />
        </template>
        <UButton v-if="!closedMonth" color="neutral" variant="outline" icon="i-lucide-lock" :label="de.cash.closeMonth" :disabled="closeCheck !== 'ok'" @click="closeMonth" />
        <UButton v-if="closedMonth && isProvider" color="neutral" variant="outline" icon="i-lucide-lock-open" :label="de.cash.reopen" @click="openReopen" />
        <UButton color="neutral" variant="outline" icon="i-lucide-printer" :label="de.cash.print" :to="`/admin/print/cash/${boxId}/${year}/${month}`" target="_blank" />
        <UButton color="neutral" variant="outline" icon="i-lucide-file-spreadsheet" :label="de.cash.csvMonth" :to="csvMonth" external />
        <UButton color="neutral" variant="outline" icon="i-lucide-file-spreadsheet" :label="de.cash.csvYear" :to="csvYear" external />
      </div>
      <p v-if="!closedMonth && closeHint" class="text-xs text-gray-500">{{ de.cash.closeMonth }}: {{ closeHint }}</p>

      <p v-if="!data.rows.length" class="text-sm text-gray-500">{{ de.cash.noEntries }}</p>
      <template v-else>
        <!-- Table from md up -->
        <table class="hidden w-full overflow-hidden rounded-lg bg-white text-sm ring-1 ring-gray-200 md:table">
          <thead class="bg-gray-100 text-left text-xs text-gray-600">
            <tr>
              <th class="px-3 py-2">{{ de.cash.number }}</th>
              <th class="px-3 py-2">{{ de.cash.date }}</th>
              <th class="px-3 py-2">{{ de.cash.type }}</th>
              <th class="px-3 py-2 text-right">{{ de.cash.amount }}</th>
              <th class="px-3 py-2">{{ de.cash.purpose }}</th>
              <th class="px-3 py-2">{{ de.cash.receipt }}</th>
              <th class="px-3 py-2 text-right">{{ de.cash.balance }}</th>
              <th v-if="editable" class="w-10" />
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in data.rows" :key="row.id" class="border-t border-gray-100" :class="negativeRow(row) ? 'bg-red-50 text-red-700' : ''">
              <td class="px-3 py-2 tabular-nums">{{ row.number }}.</td>
              <td class="whitespace-nowrap px-3 py-2">{{ formatDate(row.date) }}</td>
              <td class="px-3 py-2">{{ de.cash.directions[row.direction] }}</td>
              <td class="whitespace-nowrap px-3 py-2 text-right tabular-nums" :class="row.direction === 'in' ? 'text-green-700' : ''">
                {{ row.direction === 'out' ? '−' : '' }}{{ formatCents(row.cents) }}
              </td>
              <td class="px-3 py-2">
                <span class="break-words">{{ row.purpose }}</span>
                <UBadge v-if="row.transferId != null" class="ml-1" color="neutral" variant="outline" size="sm" icon="i-lucide-arrow-left-right" :label="de.cash.transferTag" />
              </td>
              <td class="px-3 py-2">
                <a v-if="row.receiptId != null" :href="receiptUrl(row)" target="_blank" rel="noopener" class="inline-flex items-center gap-1 text-sky-700 hover:underline">
                  <UIcon name="i-lucide-file-text" class="size-4" aria-hidden="true" />{{ de.cash.receiptView }}
                </a>
                <span v-else class="text-xs text-gray-400">{{ de.cash.receiptNone }}</span>
              </td>
              <td class="whitespace-nowrap px-3 py-2 text-right tabular-nums">{{ formatCents(row.balanceAfter) }}</td>
              <td v-if="editable" class="px-2 py-2 text-right">
                <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-pencil" :aria-label="de.cash.editEntry(de.cash.directions[row.direction], row.number, formatDate(row.date))" @click="openRow(row)" />
              </td>
            </tr>
          </tbody>
        </table>

        <!-- Cards on phones -->
        <ul class="space-y-2 md:hidden">
          <li
            v-for="row in data.rows" :key="row.id" class="rounded-lg bg-white p-3 text-sm ring-1"
            :class="negativeRow(row) ? 'bg-red-50 ring-red-200' : 'ring-gray-200'"
          >
            <div class="flex items-start gap-2">
              <div class="min-w-0 flex-1">
                <div class="text-xs text-gray-500">{{ de.cash.directions[row.direction] }} {{ row.number }}. · {{ formatDate(row.date) }}</div>
                <div class="break-words">{{ row.purpose }}</div>
              </div>
              <div class="text-right">
                <div class="whitespace-nowrap font-semibold tabular-nums" :class="row.direction === 'in' ? 'text-green-700' : ''">
                  {{ row.direction === 'out' ? '−' : '' }}{{ formatCents(row.cents) }}
                </div>
                <div class="whitespace-nowrap text-xs tabular-nums" :class="negativeRow(row) ? 'text-red-700' : 'text-gray-500'">{{ de.cash.balance }} {{ formatCents(row.balanceAfter) }}</div>
              </div>
            </div>
            <div class="mt-2 flex flex-wrap items-center gap-2">
              <UBadge v-if="row.transferId != null" color="neutral" variant="outline" size="sm" icon="i-lucide-arrow-left-right" :label="de.cash.transferTag" />
              <a v-if="row.receiptId != null" :href="receiptUrl(row)" target="_blank" rel="noopener" class="inline-flex items-center gap-1 text-sky-700 hover:underline">
                <UIcon name="i-lucide-file-text" class="size-4" aria-hidden="true" />{{ de.cash.receiptView }}
              </a>
              <span v-else class="text-xs text-gray-400">{{ de.cash.receiptNone }}</span>
              <UButton v-if="editable" class="ml-auto" size="xs" color="neutral" variant="outline" icon="i-lucide-pencil" :label="de.common.edit" :aria-label="de.cash.editEntry(de.cash.directions[row.direction], row.number, formatDate(row.date))" @click="openRow(row)" />
            </div>
          </li>
        </ul>
      </template>

      <details class="rounded-lg bg-white ring-1 ring-gray-200">
        <summary class="cursor-pointer px-3 py-2 text-sm font-medium text-gray-600">{{ de.cash.log(data.log.length) }}</summary>
        <p v-if="!data.log.length" class="border-t border-gray-100 px-3 py-2 text-sm text-gray-500">{{ de.cash.logEmpty }}</p>
        <ul v-else class="divide-y divide-gray-100 border-t border-gray-100 text-sm">
          <li v-for="line in data.log" :key="line.id" class="px-3 py-2">
            <div class="text-xs text-gray-500">{{ formatDateTime(line.at) }} · {{ line.actor }}</div>
            <div class="break-words"><span class="font-medium">{{ de.cash.logActions[line.action] ?? line.action }}:</span> {{ line.detail }}</div>
          </li>
        </ul>
      </details>

      <CashEntryDialog v-model:open="dialogOpen" :mode="dialogMode" :row="dialogRow" :box="data.box" :boxes="boxes" :year="year" :month="month" @saved="reload" />

      <UModal v-model:open="reopenOpen" :title="de.cash.reopenTitle(title)">
        <template #body>
          <form class="space-y-3" @submit.prevent="reopen">
            <p class="text-sm text-gray-600">{{ de.cash.reopenHint }}</p>
            <UFormField :label="de.cash.reason" required>
              <UTextarea v-model="reopenReason" maxlength="200" :rows="3" class="w-full" required autofocus />
            </UFormField>
            <div class="flex justify-end gap-2">
              <UButton color="neutral" variant="ghost" :label="de.common.cancel" @click="reopenOpen = false" />
              <UButton type="submit" :label="de.cash.reopen" :disabled="!reopenReason.trim()" />
            </div>
          </form>
        </template>
      </UModal>
    </template>
  </div>
</template>
