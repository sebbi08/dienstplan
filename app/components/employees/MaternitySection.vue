<script setup lang="ts">
import { todayIso } from '#shared/domain/dates'
import { EMPLOYMENT_BAN_KINDS, MATERNITY_NOTE_MAX, MISCARRIAGE_MAX_WEEK, protectionPeriods, type EmploymentBanKind } from '#shared/domain/maternity'
import type {
  EmployeeMaternityDto, MaternityBookingDto, MaternityCaseDto, MaternityCaseInput, MaternitySaveDto,
} from '#shared/types/api'
import { de } from '~/locales/de'
import { errorCode, errorMessage } from '~/utils/errors'
import { formatDate } from '~/utils/format'

/**
 * „Mutterschutz“ in the tab „Gesundheit“ (only with employees.sickness, never on the own page): the cases with their
 * protection periods (§ 3 MuSchG, computed as the server does), the notice to the authority, the risk assessment, the
 * employment ban and the breastfeeding time; „Schutzfristen eintragen“ and „Beschäftigungsverbot eintragen“ book the
 * plan (with plan.edit; duties are replaced only after asking). Health data: loaded once the tab is opened; the server
 * checks every request.
 */
const props = defineProps<{ employeeId: number; active: boolean }>()
const t = de.maternity
const { data, status, error, execute, refresh } = useFetch<EmployeeMaternityDto>(
  `/api/employees/${props.employeeId}/maternity`, { server: false, immediate: false },
)
const { busy, run } = useBusyAction(() => refresh())
const confirm = useConfirm()
const toast = useToast()
const today = todayIso()

onMounted(() => {
  watch(() => props.active, (active) => {
    if (active && status.value === 'idle') void execute()
  }, { immediate: true })
})

const loadError = computed(() => (error.value ? errorMessage(error.value) : null))
const dateOrNull = (date: string | null) => (date ? formatDate(date) : null)

/** The protection periods of a case as lines (after a miscarriage: its graded period, § 3 Abs. 5). */
function periodLines(item: MaternityCaseDto): string[] {
  const periods = protectionPeriods(item)
  const before = periods.before ? t.before(formatDate(periods.before.from), formatDate(periods.before.to)) : null
  if (periods.miscarriage) {
    const after = periods.after
      ? t.miscarriagePeriod(formatDate(periods.after.from), formatDate(periods.after.to), periods.afterWeeks)
      : item.miscarriageWaived ? t.miscarriageDeclined : t.miscarriageNone
    return [t.miscarriageLine(formatDate(item.miscarriageOn!), item.miscarriageWeek ?? 0), ...(before ? [before] : []), after]
  }
  return [
    before ?? t.beforeNone,
    t.after(formatDate(periods.after!.from), formatDate(periods.after!.to), periods.afterWeeks, periods.carriedOver),
  ]
}

// ---- the form (new or changed) ----
type Form = Omit<MaternityCaseInput, 'actualBirth' | 'breastfeedingUntil' | 'authorityNotifiedOn' | 'riskAssessmentOn' | 'banFrom' | 'banTo' | 'endedOn' | 'miscarriageOn' | 'miscarriageWeek' | 'miscarriageWaived'> & {
  actualBirth: string; breastfeedingUntil: string; authorityNotifiedOn: string; riskAssessmentOn: string; banFrom: string; banTo: string
  endedOn: string; miscarriage: boolean; miscarriageOn: string; miscarriageWeek: string; miscarriageWaived: boolean
}
const formOpen = ref(false)
const editing = ref<MaternityCaseDto | null>(null)
const emptyForm = (): Form => ({
  notifiedOn: today, expectedBirth: '', actualBirth: '', extendedAfter: false, breastfeedingUntil: '', authorityNotifiedOn: '',
  riskAssessmentOn: '', employmentBan: 'none', banFrom: '', banTo: '', banNote: '', endedOn: '', miscarriage: false, miscarriageOn: '',
  miscarriageWeek: '', miscarriageWaived: false,
})
const form = reactive<Form>(emptyForm())
const banItems = EMPLOYMENT_BAN_KINDS.map(value => ({ label: t.banKinds[value], value }))

function openForm(item?: MaternityCaseDto) {
  editing.value = item ?? null
  Object.assign(form, item
    ? {
        notifiedOn: item.notifiedOn, expectedBirth: item.expectedBirth, actualBirth: item.actualBirth ?? '', extendedAfter: item.extendedAfter,
        breastfeedingUntil: item.breastfeedingUntil ?? '', authorityNotifiedOn: item.authorityNotifiedOn ?? '',
        riskAssessmentOn: item.riskAssessmentOn ?? '', employmentBan: item.employmentBan, banFrom: item.banFrom ?? '',
        banTo: item.banTo ?? '', banNote: item.banNote, endedOn: item.endedOn ?? '', miscarriage: item.miscarriageOn !== null,
        miscarriageOn: item.miscarriageOn ?? '', miscarriageWeek: item.miscarriageWeek === null ? '' : String(item.miscarriageWeek), miscarriageWaived: item.miscarriageWaived,
      }
    : emptyForm())
  formOpen.value = true
}

const orNull = (value: string) => (value === '' ? null : value)
const body = (): MaternityCaseInput => ({
  notifiedOn: form.notifiedOn, expectedBirth: form.expectedBirth, actualBirth: form.miscarriage ? null : orNull(form.actualBirth),
  extendedAfter: form.extendedAfter, breastfeedingUntil: form.miscarriage ? null : orNull(form.breastfeedingUntil),
  authorityNotifiedOn: orNull(form.authorityNotifiedOn), riskAssessmentOn: orNull(form.riskAssessmentOn), employmentBan: form.employmentBan,
  banFrom: form.employmentBan === 'none' ? null : orNull(form.banFrom), banTo: form.employmentBan === 'none' ? null : orNull(form.banTo),
  banNote: form.banNote, endedOn: orNull(form.endedOn),
  miscarriageOn: form.miscarriage ? orNull(form.miscarriageOn) : null,
  miscarriageWeek: form.miscarriage && String(form.miscarriageWeek) !== '' ? Number(form.miscarriageWeek) : null,
  miscarriageWaived: form.miscarriage && form.miscarriageWaived,
})

/**
 * After saving: what booking again did in the plan, never silently: duties left in the period after the birth must go
 * (offered to replace them), duties and leave on new days before it are named with the button that replaces them.
 */
async function afterSave(item: MaternityCaseDto | null, result: MaternitySaveDto) {
  if (result.planOutdated) toast.add({ title: t.planOutdated, color: 'warning' })
  for (const kind of ['protection', 'ban'] as const) {
    const done: MaternityBookingDto | null = result[kind]
    if (!done) continue
    const button = kind === 'protection' ? t.bookProtection : t.bookBan
    toast.add({ title: t.rebookResult(t.codeNames[kind], done.booked, done.removed), color: 'success' })
    if (done.skippedOccupied) toast.add({ title: t.rebookSkipped(done.skippedOccupied, button), color: 'warning' })
    if (done.keptLeave) toast.add({ title: t.rebookLeave(done.keptLeave, button), color: 'warning' })
    if (!done.protectedDuties) continue
    if (kind === 'ban' || !item) {
      toast.add({ title: `${t.protectedDuties(done.protectedDuties)} ${t.protectedDutiesBan}`, color: 'error' })
      continue
    }
    if (await confirm(`${t.protectedDuties(done.protectedDuties)} ${t.protectedDutiesReplace}`, { confirmLabel: t.replaceDuties, danger: false })) {
      await book(item, 'protection', true)
    }
  }
}

async function save() {
  if (!form.notifiedOn || !form.expectedBirth) return
  const before = editing.value
  // „Beendet am“ removes the booked days after it: say so first.
  if (before && form.endedOn && form.endedOn !== before.endedOn && (before.protectionBooked || before.banBooked)
    && !await confirm(t.endedConfirm(formatDate(form.endedOn)), { confirmLabel: de.common.save, danger: false })) return
  let result: MaternitySaveDto | null = null
  const request = before === null
    ? () => $fetch<{ id: number }>(`/api/employees/${props.employeeId}/maternity`, { method: 'POST', body: body() })
    : async () => {
      result = await $fetch<MaternitySaveDto>(`/api/maternity/${before.id}`, { method: 'PUT', body: body() })
    }
  if (!await run(request, de.common.saved)) return
  formOpen.value = false
  const saved = result as MaternitySaveDto | null
  if (saved) await afterSave(data.value?.cases.find(item => item.id === before?.id) ?? before, saved)
}

/** Deleting: with booked days, the question whether they leave the plan too (only with plan.edit). */
async function remove(item: MaternityCaseDto) {
  if (!await confirm(t.removeConfirm, { confirmLabel: t.remove })) return
  const removeEntries = data.value?.canBook === true && (item.protectionBooked || item.banBooked)
    && await confirm(t.removeEntriesConfirm, { confirmLabel: t.removeEntries, cancelLabel: t.keepEntries, danger: true })
  let removed = 0
  const ok = await run(async () => {
    removed = (await $fetch<{ removed: number }>(`/api/maternity/${item.id}${removeEntries ? '?removeEntries=1' : ''}`, { method: 'DELETE' })).removed
  }, t.removed)
  if (ok && removed) toast.add({ title: t.removedDays(removed), color: 'success' })
}

async function checkBan(item: MaternityCaseDto) {
  await run(() => $fetch<{ ok: boolean }>(`/api/maternity/${item.id}/ban-check`, { method: 'PUT' }), de.common.saved)
}

/**
 * „Schutzfristen eintragen“ / „Beschäftigungsverbot eintragen“: duties and leave on the days are replaced only after
 * asking (leave is given back). `afterBirthOnly`: only the period after the birth, the duties there replaced at once.
 */
async function book(item: MaternityCaseDto, kind: 'protection' | 'ban', afterBirthOnly = false) {
  const send = (overwrite: boolean) =>
    $fetch<MaternityBookingDto>(`/api/maternity/${item.id}/book`, { method: 'POST', body: { kind, overwrite, afterBirthOnly } })
  let result: MaternityBookingDto | null = null
  await run(async () => {
    try {
      result = await send(afterBirthOnly)
    }
    catch (failure) {
      if (errorCode(failure) !== 'cells_occupied') throw failure
      const details = (failure as { data?: { data?: { details?: { days?: number; leaveDays?: number } } } }).data?.data?.details
      const question = t.overwriteConfirm(details?.days ?? 0, details?.leaveDays ?? 0, t.codeNames[kind])
      if (!await confirm(question, { confirmLabel: de.leaveEntry.overwrite, danger: false })) return
      result = await send(true)
    }
  })
  const done = result as MaternityBookingDto | null
  if (done) toast.add({ title: t.bookResult(done.booked, done.keptAbsences, done.returnedLeave, done.removed), color: 'success' })
}

const banKindLabel = (kind: EmploymentBanKind) => t.banKinds[kind]
</script>

<template>
  <section class="space-y-4 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <div class="flex flex-wrap items-start gap-3">
      <div class="min-w-0 flex-1">
        <h2 class="font-semibold">{{ t.title }}</h2>
        <p class="text-sm text-gray-500">{{ t.intro }}</p>
      </div>
      <UButton v-if="data" icon="i-lucide-plus" :label="t.add" :disabled="busy" @click="openForm()" />
    </div>
    <UAlert v-if="loadError" color="error" variant="soft" :title="loadError" />
    <p v-else-if="!data" class="text-sm text-gray-500">{{ t.loading }}</p>
    <template v-else>
      <p v-if="!data.cases.length" class="text-sm text-gray-600">{{ t.none }}</p>
      <div v-for="item in data.cases" :key="item.id" class="space-y-2 rounded-md p-3 text-sm ring-1 ring-pink-200">
        <div class="flex flex-wrap items-center gap-2">
          <p class="font-medium">
            {{ t.notifiedLine(formatDate(item.notifiedOn)) }}
            <template v-if="!item.miscarriageOn">
              · {{ item.actualBirth ? t.birthLine(formatDate(item.actualBirth)) : t.expectedLine(formatDate(item.expectedBirth)) }}
            </template>
          </p>
          <span class="text-xs text-gray-500">{{ t.createdBy(formatDate(item.createdOn), item.createdBy) }}</span>
          <div class="ml-auto flex gap-1">
            <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-pencil" :aria-label="t.edit" :disabled="busy" @click="openForm(item)" />
            <UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" :aria-label="t.remove" :disabled="busy" @click="remove(item)" />
          </div>
        </div>
        <UAlert v-if="item.planOutdated" color="warning" variant="soft" :title="t.planOutdated" />
        <ul class="space-y-0.5 text-gray-700">
          <li v-for="line in periodLines(item)" :key="line">{{ line }}</li>
          <li v-if="item.breastfeedingUntil">{{ t.breastfeedingLine(formatDate(item.breastfeedingUntil)) }}</li>
          <li :class="item.authorityNotifiedOn ? '' : 'text-red-700'">{{ t.authorityLine(dateOrNull(item.authorityNotifiedOn)) }}</li>
          <li :class="item.riskAssessmentOn ? '' : 'text-red-700'">{{ t.riskLine(dateOrNull(item.riskAssessmentOn)) }}</li>
          <li>{{ t.banLine(banKindLabel(item.employmentBan), dateOrNull(item.banFrom), dateOrNull(item.banTo)) }}</li>
          <li v-if="item.banNote" class="whitespace-pre-line break-words text-gray-600">{{ item.banNote }}</li>
          <li v-if="item.banCheckedOn" class="text-gray-500">{{ t.banCheckedLine(formatDate(item.banCheckedOn)) }}</li>
          <li v-if="item.endedOn">{{ t.endedLine(formatDate(item.endedOn)) }}</li>
        </ul>
        <p class="text-gray-600">{{ t.leaveNote }}</p>
        <p class="text-xs text-gray-500">{{ t.planNote }}</p>
        <div class="flex flex-wrap gap-2">
          <UButton
            v-if="data.canBook" size="sm" color="neutral" variant="outline" icon="i-lucide-calendar-plus" :label="t.bookProtection"
            :trailing-icon="item.protectionBooked ? 'i-lucide-check' : undefined" :disabled="busy" @click="book(item, 'protection')"
          />
          <UButton
            v-if="data.canBook && item.employmentBan === 'full'" size="sm" color="neutral" variant="outline" icon="i-lucide-calendar-x"
            :label="t.bookBan" :trailing-icon="item.banBooked ? 'i-lucide-check' : undefined" :disabled="busy" @click="book(item, 'ban')"
          />
          <UButton
            v-if="!item.banCheckedOn && item.employmentBan === 'none'" size="sm" color="neutral" variant="ghost" icon="i-lucide-check"
            :label="t.checkBan" :disabled="busy" @click="checkBan(item)"
          />
        </div>
      </div>
    </template>

    <UModal v-model:open="formOpen" :title="editing === null ? t.add : t.editTitle">
      <template #body>
        <form class="grid gap-3" @submit.prevent="save">
          <UFormField :label="t.notifiedOn" :help="t.notifiedOnHint" required>
            <DateTextInput v-model="form.notifiedOn" :label="t.notifiedOn" :max="today" required class="w-44" />
          </UFormField>
          <UFormField :label="t.expectedBirth" required>
            <DateTextInput v-model="form.expectedBirth" :label="t.expectedBirth" required class="w-44" />
          </UFormField>
          <UCheckbox v-model="form.miscarriage" :label="t.miscarriage" />
          <template v-if="form.miscarriage">
            <p class="text-xs text-gray-500">{{ t.miscarriageHint }}</p>
            <div class="flex flex-wrap gap-3">
              <UFormField :label="t.miscarriageOn" required>
                <DateTextInput v-model="form.miscarriageOn" :label="t.miscarriageOn" :max="today" required class="w-44" />
              </UFormField>
              <UFormField :label="t.miscarriageWeek" required>
                <UInput v-model="form.miscarriageWeek" type="number" min="1" :max="MISCARRIAGE_MAX_WEEK" step="1" required class="w-32" />
              </UFormField>
            </div>
            <p class="text-xs text-gray-500">{{ t.stillbirthHint }}</p>
            <UCheckbox v-model="form.miscarriageWaived" :label="t.miscarriageWaived" />
          </template>
          <template v-else>
            <UFormField :label="t.actualBirth" :help="t.actualBirthHint">
              <DateTextInput v-model="form.actualBirth" :label="t.actualBirth" :max="today" class="w-44" />
            </UFormField>
            <UCheckbox v-model="form.extendedAfter" :label="t.extendedAfter" />
            <UFormField :label="t.breastfeedingUntil" :help="t.breastfeedingHint">
              <DateTextInput v-model="form.breastfeedingUntil" :label="t.breastfeedingUntil" class="w-44" />
            </UFormField>
          </template>
          <UFormField :label="t.authorityNotifiedOn">
            <DateTextInput v-model="form.authorityNotifiedOn" :label="t.authorityNotifiedOn" :max="today" class="w-44" />
          </UFormField>
          <UFormField :label="t.riskAssessmentOn">
            <DateTextInput v-model="form.riskAssessmentOn" :label="t.riskAssessmentOn" :max="today" class="w-44" />
          </UFormField>
          <UFormField :label="t.employmentBan">
            <USelect v-model="form.employmentBan" :items="banItems" class="w-44" />
          </UFormField>
          <template v-if="form.employmentBan !== 'none'">
            <div class="flex flex-wrap gap-3">
              <UFormField :label="t.banFrom" required>
                <DateTextInput v-model="form.banFrom" :label="t.banFrom" required class="w-44" />
              </UFormField>
              <UFormField :label="t.banTo" :help="t.banToHint">
                <DateTextInput v-model="form.banTo" :label="t.banTo" class="w-44" />
              </UFormField>
            </div>
            <p v-if="form.employmentBan === 'partial'" class="text-xs text-gray-500">{{ t.partialHint }}</p>
          </template>
          <UFormField :label="t.banNote">
            <UTextarea v-model="form.banNote" :rows="2" :maxlength="MATERNITY_NOTE_MAX" :placeholder="t.banNotePlaceholder" autoresize class="w-full" />
          </UFormField>
          <UFormField :label="t.endedOn" :help="t.endedOnHint">
            <DateTextInput v-model="form.endedOn" :label="t.endedOn" class="w-44" />
          </UFormField>
          <div class="flex gap-2">
            <UButton type="submit" :label="de.common.save" :loading="busy" :disabled="busy || !form.notifiedOn || !form.expectedBirth" />
            <UButton type="button" color="neutral" variant="ghost" :label="de.common.cancel" @click="formOpen = false" />
          </div>
        </form>
      </template>
    </UModal>
  </section>
</template>
