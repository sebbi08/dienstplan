<script setup lang="ts">
import { todayIso } from '#shared/domain/dates'
import { formatTime, parseTime } from '#shared/domain/time'
import type { FormTemplateDto, StaffTalkDto } from '#shared/types/api'
import { de } from '~/locales/de'

/**
 * „Gespräch anlegen“ (talk = null: date, time, participants, period and the forms from the active staff templates,
 * the two starter templates ticked) or „Angaben ändern“ of a talk (only the header fields).
 */
const props = defineProps<{ employeeId: number; talk: StaffTalkDto | null; templates: FormTemplateDto[] }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ saved: [] }>()
const run = useAction()

const STARTERS = ['staff_self_assessment', 'staff_assessment']
const form = reactive({ date: '', start: '', participants: '', period: '', templateIds: [] as number[] })
const active = computed(() => props.templates.filter(template => !template.archived))

watch(open, (isOpen) => {
  if (!isOpen) return
  const talk = props.talk
  Object.assign(form, talk
    ? { date: talk.date, start: talk.start === null ? '' : formatTime(talk.start), participants: talk.participants, period: talk.period, templateIds: [] }
    : {
        date: todayIso(), start: '', participants: '', period: '',
        templateIds: active.value.filter(template => template.starterKey && STARTERS.includes(template.starterKey)).map(template => template.id),
      })
})

function toggleTemplate(id: number, on: boolean) {
  form.templateIds = on ? [...form.templateIds, id] : form.templateIds.filter(entry => entry !== id)
}

async function save() {
  // No time typed: none; an unreadable one goes to the server as -1, so it answers with its German text.
  const start = form.start.trim() ? (parseTime(form.start) ?? -1) : null
  const body = { date: form.date, start, participants: form.participants, period: form.period }
  const talk = props.talk
  const ok = talk
    ? await run(() => $fetch<unknown>(`/api/staff-talks/${talk.id}`, { method: 'PUT', body }), de.common.saved)
    : await run(() => $fetch<unknown>('/api/staff-talks', {
        method: 'POST', body: { ...body, employeeId: props.employeeId, templateIds: form.templateIds },
      }), de.talks.created)
  if (ok) {
    open.value = false
    emit('saved')
  }
}
</script>

<template>
  <UModal v-model:open="open" :title="talk ? de.talks.editHeader : de.talks.create">
    <template #body>
      <form class="grid grid-cols-2 gap-3" @submit.prevent="save()">
        <UFormField :label="de.talks.date" class="col-span-2 sm:col-span-1">
          <DateTextInput v-model="form.date" required :label="de.talks.date" class="w-full" />
        </UFormField>
        <UFormField :label="de.talks.start" class="col-span-2 sm:col-span-1">
          <TimeInput v-model="form.start" any-minute class="w-full" :aria-label="de.talks.start" />
        </UFormField>
        <UFormField :label="de.talks.participants" class="col-span-2">
          <UInput v-model="form.participants" maxlength="300" class="w-full" />
        </UFormField>
        <UFormField :label="de.talks.period" class="col-span-2">
          <UInput v-model="form.period" maxlength="60" class="w-full" :placeholder="de.talks.periodPlaceholder" />
        </UFormField>
        <fieldset v-if="!talk" class="col-span-2 space-y-1">
          <legend class="mb-1 text-sm font-medium">{{ de.talks.forms }}</legend>
          <p v-if="!active.length" class="text-sm text-gray-500">{{ de.talks.noTemplates }}</p>
          <UCheckbox
            v-for="template in active" :key="template.id" :model-value="form.templateIds.includes(template.id)"
            :label="template.name" :description="template.selfAssessment ? de.talks.roles.self : de.talks.roles.assessment"
            @update:model-value="toggleTemplate(template.id, $event === true)"
          />
        </fieldset>
        <div class="col-span-2 flex flex-wrap justify-end gap-2">
          <UButton color="neutral" variant="ghost" :label="de.common.cancel" @click="open = false" />
          <UButton type="submit" :label="talk ? de.common.save : de.talks.create" :disabled="!form.date || (!talk && !form.templateIds.length)" />
        </div>
      </form>
    </template>
  </UModal>
</template>
