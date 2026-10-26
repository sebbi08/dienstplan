<script setup lang="ts">
import { FORM_LIMITS, type FormAnswer, type FormContent, type MilestoneAnswer, type RatingAnswer, type RatingValue } from '#shared/domain/forms'
import { RATING_LEGEND } from '#shared/domain/forms/starters'
import { de } from '~/locales/de'
import { formatDate } from '~/utils/format'
import { sectionBlocks, sectionHasRating } from '~/utils/forms'

/**
 * A form's own content (its copy of the template) with the answers, to fill in (`readonly` false) or to read. The
 * answers hold an entry for every answerable item (see filledAnswers); saving is up to the parent. Made for phones too:
 * everything stacks, nothing is wider than the screen.
 */
const props = defineProps<{ content: FormContent; readonly?: boolean }>()
const answers = defineModel<Record<string, FormAnswer>>('answers', { required: true })
const uid = useId()
const fieldId = (itemId: string) => `${uid}-${itemId}`

const textOf = (id: string) => (typeof answers.value[id] === 'string' ? answers.value[id] as string : '')
const choicesOf = (id: string) => (Array.isArray(answers.value[id]) ? answers.value[id] as string[] : [])
const ratingOf = (id: string) => answers.value[id] as RatingAnswer
const milestoneOf = (id: string) => answers.value[id] as MilestoneAnswer
const dateOf = (id: string) => (typeof answers.value[id] === 'string' ? answers.value[id] as string : '')

function setAnswer(id: string, value: FormAnswer) {
  answers.value[id] = value
}
function toggleChoice(id: string, optionId: string) {
  const picked = choicesOf(id)
  setAnswer(id, picked.includes(optionId) ? picked.filter(entry => entry !== optionId) : [...picked, optionId])
}
/** Tapping the chosen value again clears it (no rating). */
function pickRating(id: string, value: RatingValue) {
  const current = ratingOf(id)
  setAnswer(id, { value: current.value === value ? null : value, remark: current.remark })
}
function setRemark(id: string, remark: string) {
  const current = answers.value[id] as RatingAnswer | MilestoneAnswer
  setAnswer(id, { ...current, remark } as FormAnswer)
}
function setReached(id: string, reached: boolean) {
  setAnswer(id, { ...milestoneOf(id), reached })
}

const ratingButton = (selected: boolean) => selected
  ? 'bg-sky-600 text-white ring-sky-600'
  : 'bg-white text-gray-800 ring-gray-300 hover:bg-gray-50'
const chip = (selected: boolean) => selected
  ? 'bg-sky-50 text-sky-900 ring-sky-500 font-medium'
  : 'bg-white text-gray-700 ring-gray-300 hover:bg-gray-50'
</script>

<template>
  <div class="space-y-4">
    <section
      v-for="section in props.content.sections" :key="section.id"
      class="min-w-0 space-y-3 rounded-lg bg-white p-3 ring-1 ring-gray-200 sm:p-4"
    >
      <h3 class="font-semibold break-words">{{ section.title }}</h3>
      <p v-if="section.hint" class="text-sm whitespace-pre-line text-gray-600">{{ section.hint }}</p>
      <div v-if="sectionHasRating(section)" class="rounded-md bg-gray-50 p-2 text-xs text-gray-700">
        <p>{{ RATING_LEGEND.intro }}</p>
        <ul class="mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
          <li v-for="entry in RATING_LEGEND.entries" :key="entry.value"><strong>{{ entry.symbol }}</strong> = {{ entry.label }}</li>
        </ul>
      </div>

      <template v-for="(block, index) in sectionBlocks(section)" :key="index">
        <template v-if="block.type === 'item'">
          <p v-if="block.item.kind === 'note'" class="text-sm whitespace-pre-line text-gray-700">{{ block.item.text }}</p>

          <div v-else-if="block.item.kind === 'text'" class="space-y-1">
            <label :for="fieldId(block.item.id)" class="block text-sm font-medium break-words">{{ block.item.question }}</label>
            <p v-if="props.readonly" :id="fieldId(block.item.id)" class="text-sm whitespace-pre-line break-words text-gray-800">
              {{ textOf(block.item.id) || de.forms.noAnswer }}
            </p>
            <UTextarea
              v-else :id="fieldId(block.item.id)" :model-value="textOf(block.item.id)" autoresize :rows="2"
              :maxlength="FORM_LIMITS.textAnswer" class="w-full" @update:model-value="setAnswer(block.item.id, String($event ?? ''))"
            />
          </div>

          <fieldset v-else-if="block.item.kind === 'choices'" class="space-y-1.5">
            <legend v-if="block.item.question" class="mb-1 text-sm font-medium break-words">{{ block.item.question }}</legend>
            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="option in block.item.options" :key="option.id" type="button" role="checkbox"
                :aria-checked="choicesOf(block.item.id).includes(option.id)" :disabled="props.readonly"
                class="inline-flex max-w-full items-center gap-1 rounded-full px-3 py-1 text-left text-sm ring-1 break-words disabled:cursor-default"
                :class="chip(choicesOf(block.item.id).includes(option.id))"
                @click="toggleChoice(block.item.id, option.id)"
              >
                <UIcon v-if="choicesOf(block.item.id).includes(option.id)" name="i-lucide-check" class="size-4 shrink-0" />
                <span class="min-w-0">{{ option.label }}</span>
              </button>
            </div>
          </fieldset>

          <div v-else-if="block.item.kind === 'date'" class="space-y-1">
            <label :for="fieldId(block.item.id)" class="block text-sm font-medium break-words">{{ block.item.question }}</label>
            <p v-if="props.readonly" class="text-sm">{{ dateOf(block.item.id) ? formatDate(dateOf(block.item.id)) : de.forms.noAnswer }}</p>
            <DateTextInput
              v-else :id="fieldId(block.item.id)" :model-value="dateOf(block.item.id)" :label="block.item.question" class="w-48"
              @update:model-value="setAnswer(block.item.id, $event || null)"
            />
          </div>
        </template>

        <ul v-else-if="block.type === 'ratings'" class="divide-y divide-gray-100">
          <li v-for="item in block.items" :key="item.id" class="space-y-1.5 py-2">
            <p :id="fieldId(item.id)" class="text-sm break-words">{{ item.criterion }}</p>
            <div class="flex flex-wrap items-center gap-2">
              <div role="group" :aria-labelledby="fieldId(item.id)" class="inline-flex gap-1">
                <button
                  v-for="entry in RATING_LEGEND.entries" :key="entry.value" type="button"
                  :aria-pressed="ratingOf(item.id).value === entry.value" :disabled="props.readonly"
                  :aria-label="de.forms.ratingPick(item.criterion, entry.label)" :title="entry.label"
                  class="size-9 rounded-md text-base font-bold ring-1 disabled:cursor-default"
                  :class="ratingButton(ratingOf(item.id).value === entry.value)"
                  @click="pickRating(item.id, entry.value)"
                >
                  {{ entry.symbol }}
                </button>
              </div>
              <p v-if="props.readonly" class="min-w-0 flex-1 text-sm break-words text-gray-700">{{ ratingOf(item.id).remark }}</p>
              <UInput
                v-else :model-value="ratingOf(item.id).remark" :maxlength="FORM_LIMITS.ratingRemark" size="sm"
                :placeholder="de.forms.remark" :aria-label="`${de.forms.remark}: ${item.criterion}`" class="min-w-40 flex-1"
                @update:model-value="setRemark(item.id, String($event ?? ''))"
              />
            </div>
          </li>
        </ul>

        <div v-else-if="block.type === 'milestones'" class="grid gap-3 lg:grid-cols-2">
          <div v-for="group in block.groups" :key="group.ageLabel" class="min-w-0 rounded-md ring-1 ring-gray-200">
            <h4 class="rounded-t-md bg-gray-50 px-2 py-1 text-sm font-semibold">{{ group.ageLabel }}</h4>
            <ul class="divide-y divide-gray-100 px-2">
              <li v-for="item in group.items" :key="item.id" class="space-y-1 py-1.5">
                <UCheckbox
                  :model-value="milestoneOf(item.id).reached" :disabled="props.readonly" :label="item.text"
                  :ui="{ label: 'break-words' }" @update:model-value="setReached(item.id, $event === true)"
                />
                <p v-if="props.readonly && milestoneOf(item.id).remark" class="pl-6 text-xs break-words text-gray-600">{{ milestoneOf(item.id).remark }}</p>
                <UInput
                  v-else-if="!props.readonly" :model-value="milestoneOf(item.id).remark" :maxlength="FORM_LIMITS.milestoneRemark"
                  size="xs" :placeholder="de.forms.remark" :aria-label="`${de.forms.remark}: ${item.text}`" class="w-full"
                  @update:model-value="setRemark(item.id, String($event ?? ''))"
                />
              </li>
            </ul>
          </div>
        </div>
      </template>
    </section>
  </div>
</template>
