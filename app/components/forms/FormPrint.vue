<script setup lang="ts">
import { todayIso } from '#shared/domain/dates'
import { RATING_LEGEND, type ChoicesAnswer, type DateAnswer, type FormAnswers, type MilestoneAnswer, type RatingAnswer } from '#shared/domain/forms'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'
import { formatDate, formatDateTime } from '~/utils/format'
import { isBlank, milestoneColumns, sectionBlocks, sectionHasRating, type FormSheet } from '~/utils/forms'

/**
 * The printout of a form, A4 portrait like the paper form: title, the header fields (two per row), the sections
 * (ratings as a table + / ~ / − / Anmerkungen, choices with ☐/☒, milestones as a table by age — one column per age
 * when the ages are like „3;0 Jahre“ —, empty free texts as writing lines) and the signature lines (or, for a team
 * meeting, „freigegeben am … von …“ in their place). The sheet (see talkSheet, childSheet, teamSheet) says what goes
 * into the header and under the form.
 */
const props = defineProps<{ sheet: FormSheet | null | undefined; error?: unknown }>()
const { user } = useUserSession()

const answers = computed<FormAnswers>(() => props.sheet?.answers ?? {})
const textOf = (id: string) => (typeof answers.value[id] === 'string' ? answers.value[id] as string : '')
const picked = (id: string, optionId: string) => ((answers.value[id] as ChoicesAnswer | undefined) ?? []).includes(optionId)
const ratingOf = (id: string) => (answers.value[id] as RatingAnswer | undefined) ?? { value: null, remark: '' }
const milestoneOf = (id: string) => (answers.value[id] as MilestoneAnswer | undefined) ?? { reached: false, remark: '' }
const dateOf = (id: string) => (answers.value[id] as DateAnswer | undefined) ?? null
const box = (on: boolean) => (on ? '☒' : '☐')

const fileName = computed(() => props.sheet?.fileName ?? 'Bogen')
/** The header fields two per row: label, value, label, value. */
const headerRows = computed(() => {
  const fields = props.sheet?.header ?? []
  const rows: string[][] = []
  for (let index = 0; index < fields.length; index += 2) rows.push([...fields[index]!, ...(fields[index + 1] ?? ['', ''])])
  return rows
})
const cell = 'border border-gray-500 px-1.5 py-1 align-top'
</script>

<template>
  <div class="mx-auto max-w-3xl bg-white p-6 text-sm text-gray-900 print:max-w-none print:p-0 print:text-[11px]">
    <div class="mb-3 flex flex-wrap items-baseline gap-3">
      <h1 class="text-2xl font-bold print:text-[18px]">{{ props.sheet?.title ?? '' }}</h1>
      <PrintActions v-if="props.sheet" :file-name="fileName" />
    </div>
    <p v-if="props.error" class="text-red-700">{{ errorMessage(props.error) }}</p>
    <template v-if="props.sheet">
      <table class="mb-4 w-full table-fixed border-collapse">
        <tbody>
          <!-- Blank: rows high enough to write in by hand -->
          <tr v-for="row in headerRows" :key="row[0]" :class="props.sheet.blank ? 'h-9' : ''">
            <th :class="[cell, 'w-[16%] bg-gray-100 text-left font-semibold']">{{ row[0] }}</th>
            <td :class="[cell, 'w-[34%] break-words']">{{ row[1] }}</td>
            <th :class="[cell, 'w-[16%] bg-gray-100 text-left font-semibold']">{{ row[2] }}</th>
            <td :class="[cell, 'w-[34%] break-words']">{{ row[3] }}</td>
          </tr>
        </tbody>
      </table>

      <!-- A rating section is a short table: kept on one page, so its heading never stays behind on the previous page. -->
      <section
        v-for="section in props.sheet.content.sections" :key="section.id" class="mb-4 space-y-2"
        :class="sectionHasRating(section) ? 'break-inside-avoid' : ''"
      >
        <h2 class="border-b border-gray-400 pb-0.5 text-base font-bold break-after-avoid print:text-[13px]">{{ section.title }}</h2>
        <p v-if="section.hint" class="whitespace-pre-line text-gray-700">{{ section.hint }}</p>
        <div v-if="sectionHasRating(section)" class="text-xs text-gray-700 print:text-[10px]">
          {{ RATING_LEGEND.intro }}
          <span v-for="entry in RATING_LEGEND.entries" :key="entry.value" class="ml-3"><strong>{{ entry.symbol }}</strong> = {{ entry.label }}</span>
        </div>

        <template v-for="(block, index) in sectionBlocks(section)" :key="index">
          <template v-if="block.type === 'item'">
            <p v-if="block.item.kind === 'note'" class="whitespace-pre-line text-gray-700">{{ block.item.text }}</p>
            <div v-else-if="block.item.kind === 'text'" class="break-inside-avoid">
              <p class="font-semibold">{{ block.item.question }}</p>
              <p v-if="!isBlank(textOf(block.item.id))" class="whitespace-pre-line break-words">{{ textOf(block.item.id) }}</p>
              <div v-else aria-hidden="true">
                <div v-for="line in 3" :key="line" class="h-6 border-b border-gray-400" />
              </div>
            </div>
            <div v-else-if="block.item.kind === 'choices'" class="break-inside-avoid">
              <p v-if="block.item.question" class="font-semibold">{{ block.item.question }}</p>
              <ul class="flex flex-wrap gap-x-4 gap-y-0.5">
                <li v-for="option in block.item.options" :key="option.id">{{ box(picked(block.item.id, option.id)) }} {{ option.label }}</li>
              </ul>
            </div>
            <div v-else-if="block.item.kind === 'date'" class="flex flex-wrap items-end gap-2 break-inside-avoid">
              <span class="font-semibold">{{ block.item.question }}</span>
              <span v-if="dateOf(block.item.id)">{{ formatDate(dateOf(block.item.id)!) }}</span>
              <span v-else class="inline-block h-5 w-40 border-b border-gray-400" aria-hidden="true" />
            </div>
          </template>

          <table v-else-if="block.type === 'ratings'" class="w-full table-fixed border-collapse">
            <thead>
              <tr class="bg-gray-100">
                <th :class="[cell, 'w-[45%] text-left']">{{ de.forms.criterion }}</th>
                <th v-for="entry in RATING_LEGEND.entries" :key="entry.value" :class="[cell, 'w-[6%] text-center']">{{ entry.symbol }}</th>
                <th :class="[cell, 'text-left']">{{ de.forms.remarks }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in block.items" :key="item.id" class="break-inside-avoid">
                <td :class="[cell, 'break-words']">{{ item.criterion }}</td>
                <td v-for="entry in RATING_LEGEND.entries" :key="entry.value" :class="[cell, 'text-center text-base print:text-[13px]']">
                  {{ box(ratingOf(item.id).value === entry.value) }}
                </td>
                <td :class="[cell, 'break-words']">{{ ratingOf(item.id).remark }}</td>
              </tr>
            </tbody>
          </table>

          <!-- Ages like „3;0 Jahre“: one column per age as on the paper form, the sentence ticked in its own age's column. -->
          <table v-else-if="block.type === 'milestones' && milestoneColumns(block.groups)" class="w-full table-fixed border-collapse">
            <thead>
              <tr class="bg-gray-100">
                <th :class="[cell, 'text-left']">{{ de.forms.itemKinds.milestone }}</th>
                <th v-for="group in block.groups" :key="group.ageLabel" :class="[cell, 'w-[9%] text-center']">{{ group.ageLabel }}</th>
                <th :class="[cell, 'w-[24%] text-left']">{{ de.forms.remark }}</th>
              </tr>
            </thead>
            <tbody>
              <template v-for="group in block.groups" :key="group.ageLabel">
                <tr v-for="item in group.items" :key="item.id" class="break-inside-avoid">
                  <td :class="[cell, 'break-words']">{{ item.text }}</td>
                  <td
                    v-for="column in block.groups" :key="column.ageLabel"
                    :class="[cell, 'text-center text-base print:text-[13px]', column.ageLabel === group.ageLabel ? 'bg-green-50' : '']"
                  >
                    {{ column.ageLabel === group.ageLabel ? box(milestoneOf(item.id).reached) : '' }}
                  </td>
                  <td :class="[cell, 'break-words']">{{ milestoneOf(item.id).remark }}</td>
                </tr>
              </template>
            </tbody>
          </table>

          <table v-else-if="block.type === 'milestones'" class="w-full table-fixed border-collapse">
            <thead>
              <tr class="bg-gray-100">
                <th :class="[cell, 'w-[14%] text-left']">{{ de.forms.age }}</th>
                <th :class="[cell, 'text-left']">{{ de.forms.itemKinds.milestone }}</th>
                <th :class="[cell, 'w-[10%] text-center']">{{ de.forms.reached }}</th>
                <th :class="[cell, 'w-[28%] text-left']">{{ de.forms.remark }}</th>
              </tr>
            </thead>
            <tbody>
              <template v-for="group in block.groups" :key="group.ageLabel">
                <tr v-for="(item, itemIndex) in group.items" :key="item.id" class="break-inside-avoid">
                  <th v-if="itemIndex === 0" :rowspan="group.items.length" :class="[cell, 'text-left font-semibold']">{{ group.ageLabel }}</th>
                  <td :class="[cell, 'break-words']">{{ item.text }}</td>
                  <td :class="[cell, 'text-center text-base print:text-[13px]']">{{ box(milestoneOf(item.id).reached) }}</td>
                  <td :class="[cell, 'break-words']">{{ milestoneOf(item.id).remark }}</td>
                </tr>
              </template>
            </tbody>
          </table>
        </template>
      </section>

      <div v-if="props.sheet.signatures.length" class="mt-12 grid grid-cols-2 gap-10 break-inside-avoid">
        <div v-for="line in props.sheet.signatures" :key="line" class="border-t border-gray-700 pt-1 text-xs print:text-[10px]">{{ line }}</div>
      </div>
      <div v-if="props.sheet.closing.length" class="mt-8 space-y-0.5 border-t border-gray-700 pt-2 break-inside-avoid">
        <p v-for="line in props.sheet.closing" :key="line" class="break-words first:font-semibold">{{ line }}</p>
      </div>
      <div v-if="!props.sheet.blank" class="mt-6 space-y-0.5 text-xs text-gray-600 print:text-[9px]">
        <p v-for="line in props.sheet.stamps" :key="line">{{ line }}</p>
        <p>{{ de.forms.lastChanged(props.sheet.updatedBy, formatDateTime(props.sheet.updatedAt)) }}</p>
        <p>{{ de.forms.printedBy(formatDate(todayIso()), user?.username ?? '') }}</p>
      </div>
    </template>
  </div>
</template>
