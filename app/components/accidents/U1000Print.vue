<script setup lang="ts">
import { fieldNumber, itemLabel, u1000Fields } from '#shared/domain/accidents'
import { todayIso } from '#shared/domain/dates'
import type { ChoicesAnswer, DateAnswer, FormItem } from '#shared/domain/forms'
import { richTextToPlain } from '#shared/domain/richText'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'
import { formatDate, formatDateTime } from '~/utils/format'
import { isBlank } from '~/utils/forms'
import { U1000_LAYOUT, type U1000Sheet } from '~/utils/u1000'

/**
 * An Unfallanzeige printed like page 1 of the official form U 1000 (A4 portrait, see app/utils/u1000.ts): numbered
 * boxes, ☒/☐ for the choices, empty boxes to fill in by hand, the signature row with field 29's phone number, then the
 * header ticks, the attachments and the legal hint in small print. Signed and sent to the Unfallkasse. Formatted free
 * texts keep bold/italic/underline but print their paragraphs and list items as lines (with „• “ / „1. “), so the
 * fixed boxes keep their layout.
 */
const props = defineProps<{ sheet: U1000Sheet | null | undefined; error?: unknown }>()
const { user } = useUserSession()
const a = de.accidents

const grouped = computed(() => (props.sheet ? u1000Fields(props.sheet.content) : { fields: new Map<number, FormItem[]>(), other: [] }))
const itemsOf = (field: number) => grouped.value.fields.get(field) ?? []
const textOf = (id: string) => {
  const value = props.sheet?.answers[id]
  return typeof value === 'string' ? value : ''
}
const picked = (id: string, optionId: string) => ((props.sheet?.answers[id] as ChoicesAnswer | undefined) ?? []).includes(optionId)
const dateOf = (id: string) => (props.sheet?.answers[id] as DateAnswer | undefined) ?? null
const box = (on: boolean) => (on ? '☒' : '☐')
/** The label without the leading number (the box shows its number itself). */
const labelWithoutNumber = (item: FormItem) => (fieldNumber(item) === null ? itemLabel(item) : itemLabel(item).replace(/^\d{1,2}\s+/, ''))
/** Field 29: the phone number for questions (the text answers of its items, as plain text on one line). */
const phone = computed(() => itemsOf(29).filter(item => item.kind === 'text')
  .map(item => richTextToPlain(textOf(item.id)).replace(/\s*\n\s*/g, ', ').trim()).filter(Boolean).join(', '))
// A box never splits across pages; the last boxes (27, 28) stay together with the signature row.
const cell = 'break-inside-avoid border-r border-b border-gray-700 px-1.5 pt-0.5 pb-1 align-top'
const LAST_BOXES = new Set([27, 28])
const parts = [
  { end: false, boxes: U1000_LAYOUT.filter(entry => !LAST_BOXES.has(entry.field)) },
  { end: true, boxes: U1000_LAYOUT.filter(entry => LAST_BOXES.has(entry.field)) },
]
</script>

<template>
  <div class="u1000 mx-auto max-w-3xl bg-white p-6 text-[12px] text-gray-900 print:max-w-none print:p-0 print:text-[9px]">
    <div class="mb-2 flex flex-wrap items-baseline gap-3 print:hidden">
      <PrintActions v-if="props.sheet" :file-name="props.sheet.fileName" />
    </div>
    <p v-if="props.error" class="text-red-700">{{ errorMessage(props.error) }}</p>
    <template v-if="props.sheet">
      <div class="mb-1 flex items-end justify-between gap-3">
        <span class="text-[10px] text-gray-600 print:text-[8px]">{{ props.sheet.title }}</span>
        <h1 class="text-xl font-bold tracking-wide print:text-[16px]">{{ a.u1000Title }}</h1>
      </div>
      <div class="border-t border-l border-gray-700">
      <div v-for="part in parts" :key="String(part.end)" class="grid grid-cols-12" :class="part.end ? 'break-inside-avoid' : ''">
        <div
          v-for="entry in part.boxes" :key="entry.field" :class="[cell, entry.tall ? 'min-h-24 print:min-h-20' : 'min-h-11 print:min-h-9']"
          :style="{ gridColumn: `span ${entry.span} / span ${entry.span}` }"
        >
          <!-- Field 15 is the form's header: Datum and Uhrzeit. -->
          <template v-if="entry.field === 15">
            <p class="text-[10px] print:text-[8px]"><span class="font-bold">15</span> {{ a.u1000Field15 }}</p>
            <p class="font-medium">{{ props.sheet.accidentTime }}</p>
          </template>
          <template v-else>
            <p v-if="!itemsOf(entry.field).length" class="text-[10px] font-bold print:text-[8px]">{{ entry.field }}</p>
            <div v-for="(item, index) in itemsOf(entry.field)" :key="item.id" :class="index > 0 ? 'mt-0.5' : ''">
              <p v-if="item.kind !== 'note' || index > 0" class="text-[10px] leading-tight text-gray-700 print:text-[8px]">
                <span v-if="index === 0" class="font-bold text-gray-900">{{ entry.field }}</span> {{ labelWithoutNumber(item) }}
              </p>
              <FormsRichText v-if="item.kind === 'text' && !isBlank(textOf(item.id))" :value="textOf(item.id)" inline />
              <p v-else-if="item.kind === 'date' && dateOf(item.id)">{{ formatDate(dateOf(item.id)!) }}</p>
              <p v-else-if="item.kind === 'choices'" class="flex flex-wrap gap-x-3">
                <span v-for="option in item.options" :key="option.id" class="whitespace-nowrap">{{ box(picked(item.id, option.id)) }} {{ option.label }}</span>
              </p>
              <p v-else-if="item.kind === 'checkbox'">{{ box(props.sheet.answers[item.id] === true) }}</p>
              <FormsTableAnswer v-else-if="item.kind === 'table'" :item="item" :value="props.sheet.answers[item.id]" :write-rows="2" />
            </div>
          </template>
        </div>
        <!-- Items without a box of their own (a changed copy of the starter). -->
        <div v-if="!part.end && grouped.other.length" :class="[cell, 'col-span-12']">
          <p class="text-[10px] font-bold print:text-[8px]">{{ a.u1000Other }}</p>
          <div v-for="item in grouped.other" :key="item.id">
            <p v-if="item.kind === 'note'" class="whitespace-pre-line text-gray-700">{{ item.text }}</p>
            <template v-else>
              <p class="text-[10px] text-gray-700 print:text-[8px]">{{ itemLabel(item) }}</p>
              <FormsRichText v-if="item.kind === 'text'" :value="textOf(item.id)" inline />
              <p v-else-if="item.kind === 'date' && dateOf(item.id)">{{ formatDate(dateOf(item.id)!) }}</p>
              <p v-else-if="item.kind === 'choices'" class="flex flex-wrap gap-x-3">
                <span v-for="option in item.options" :key="option.id">{{ box(picked(item.id, option.id)) }} {{ option.label }}</span>
              </p>
              <p v-else-if="item.kind === 'checkbox'">{{ box(props.sheet.answers[item.id] === true) }}</p>
              <FormsTableAnswer v-else-if="item.kind === 'table'" :item="item" :value="props.sheet.answers[item.id]" :write-rows="2" />
            </template>
          </div>
        </div>
        <!-- 29: the signature row. -->
        <template v-if="part.end">
          <div v-for="(label, index) in a.u1000Signature" :key="label" :class="[cell, 'col-span-3 min-h-14 print:min-h-12']">
            <p class="text-[10px] text-gray-700 print:text-[8px]"><span v-if="index === 0" class="font-bold text-gray-900">29</span> {{ label }}</p>
            <p v-if="index === 3 && phone" class="break-words">{{ phone }}</p>
          </div>
        </template>
      </div>
      </div>
      <p class="mt-1 text-[9px] text-gray-500 print:text-[7px]">U 1000</p>
      <div class="mt-3 space-y-0.5 text-[11px] text-gray-700 print:text-[8px]">
        <p v-for="line in props.sheet.notes" :key="line" class="break-words">{{ line }}</p>
        <template v-if="!props.sheet.blank">
          <p>{{ de.forms.lastChanged(props.sheet.updatedBy, formatDateTime(props.sheet.updatedAt)) }}</p>
          <p>{{ de.forms.printedBy(formatDate(todayIso()), user?.username ?? '') }}</p>
        </template>
      </div>
    </template>
  </div>
</template>
