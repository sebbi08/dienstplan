<script setup lang="ts">
import { parseIsoDate, todayIso } from '#shared/domain/dates'
import {
  DEFAULT_LEAVE_FORFEIT_TEXT, fillLeaveForfeitText, forfeitDateOf, isValidForfeitDate, isValidForfeitText, LEAVE_FORFEIT_NOTICE_MONTH,
  LEAVE_FORFEIT_TEXT_MAX,
} from '#shared/domain/leaveForfeit'
import type { LeaveForfeitSettingsDto } from '#shared/types/api'
import { de } from '~/locales/de'

/**
 * Einstellungen → Dienstplan, below „Urlaub an Heiligabend und Silvester“ (per facility, „Einstellungen für“ applies):
 * the day remaining leave lapses in the year after and the text of the notice the employees see from 1 October. Leitung
 * and Träger change it (settings.facility, the server checks as well).
 */
const t = de.leaveForfeit
const { data, refresh } = await useFetch<LeaveForfeitSettingsDto>('/api/leave-forfeit-settings', { key: 'leave-forfeit-settings' })
const { busy, run } = useBusyAction(refresh)

const form = reactive({ day: 31, month: 3, text: '' })
watch(data, (value) => { if (value) Object.assign(form, { day: value.day, month: value.month, text: value.text }) }, { immediate: true })

const monthItems = de.months.slice(0, LEAVE_FORFEIT_NOTICE_MONTH - 1).map((label, index) => ({ label, value: index + 1 }))
const dayItems = Array.from({ length: 31 }, (_, index) => ({ label: String(index + 1), value: index + 1 }))
const validDate = computed(() => isValidForfeitDate(form))
const validText = computed(() => isValidForfeitText(form.text))

// The preview with 5 days of the current year.
const preview = computed(() => {
  if (!validDate.value || !validText.value) return ''
  const year = parseIsoDate(todayIso()).year
  return fillLeaveForfeitText(form.text.trim() || DEFAULT_LEAVE_FORFEIT_TEXT, { days: 5, year, forfeitDate: forfeitDateOf(year, form) })
})

const dirty = useDirty(() => !!data.value
  && (form.day !== data.value.day || form.month !== data.value.month || form.text.trim() !== data.value.text))
const save = () => dirty.value && validDate.value && validText.value && run(() => $fetch<LeaveForfeitSettingsDto>('/api/leave-forfeit-settings', {
  method: 'PUT', body: { day: form.day, month: form.month, text: form.text },
}), de.common.saved)
</script>

<template>
  <section class="space-y-3 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <h2 class="font-semibold">{{ t.title }}</h2>
    <MoreHint class="text-xs text-gray-500" :text="t.settingsHint" :more="t.settingsHintMore" />
    <form class="space-y-3" @submit.prevent="save">
      <UFormField :label="t.dateLabel" :hint="t.dateHint" :error="validDate ? undefined : de.errors.invalid_forfeit_date">
        <div class="flex flex-wrap gap-2">
          <USelect v-model="form.day" :items="dayItems" :aria-label="t.day" class="w-20" />
          <USelect v-model="form.month" :items="monthItems" :aria-label="t.month" class="w-40" />
        </div>
      </UFormField>
      <UFormField :label="t.textLabel" :hint="t.textHint" :error="validText ? undefined : de.errors.invalid_forfeit_text">
        <UTextarea v-model="form.text" :rows="3" :maxlength="LEAVE_FORFEIT_TEXT_MAX" autoresize class="w-full" />
      </UFormField>
      <UButton
        size="xs" color="neutral" variant="outline" :label="t.defaultText" :disabled="form.text === DEFAULT_LEAVE_FORFEIT_TEXT"
        @click="form.text = DEFAULT_LEAVE_FORFEIT_TEXT"
      />
      <p v-if="preview" class="rounded bg-amber-50 p-2 text-sm"><span class="font-medium">{{ t.preview }}:</span> {{ preview }}</p>
      <UButton type="submit" :label="de.common.save" :loading="busy" :disabled="busy || !dirty || !validDate || !validText" />
    </form>
  </section>
</template>
