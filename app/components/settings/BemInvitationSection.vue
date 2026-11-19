<script setup lang="ts">
import { BEM_DEFAULT_INVITATION_TEXT, BEM_LIMITS, bemAnswerBy, fillBemInvitationText } from '#shared/domain/bem'
import { todayIso } from '#shared/domain/dates'
import type { BemSettingsDto } from '#shared/types/api'
import { de } from '~/locales/de'

/**
 * Einstellungen → Personal → „BEM-Einladung (Text)“ (per facility, „Einstellungen für“ applies): the text of the
 * invitation to a BEM that Leitung and Träger print on the employee page. Leitung and Träger change it
 * (settings.facility, the server checks as well); empty means the default text.
 */
const t = de.bem.settings
const { data, refresh } = await useFetch<BemSettingsDto>('/api/bem-settings', { key: 'bem-settings' })
const { busy, run } = useBusyAction(refresh)

const text = ref('')
watch(data, (value) => { if (value) text.value = value.text }, { immediate: true })

// The preview with a sample name, today's answer date and the default 3 years.
const preview = computed(() => fillBemInvitationText(text.value.trim() || BEM_DEFAULT_INVITATION_TEXT, {
  name: 'Anna Muster', answerBy: bemAnswerBy(todayIso()), years: 3,
}))

const dirty = useDirty(() => !!data.value && text.value.trim() !== data.value.text.trim())
const save = () => dirty.value && run(() => $fetch<BemSettingsDto>('/api/bem-settings', { method: 'PUT', body: { text: text.value } }), de.common.saved)
</script>

<template>
  <section class="space-y-3 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <h2 class="font-semibold">{{ t.title }}</h2>
    <p class="text-xs text-gray-500">{{ t.hint }}</p>
    <form class="space-y-3" @submit.prevent="save">
      <UFormField :label="t.textLabel" :hint="t.textHint">
        <UTextarea v-model="text" :rows="10" :maxlength="BEM_LIMITS.invitationText" autoresize class="w-full" />
      </UFormField>
      <UButton
        size="xs" color="neutral" variant="outline" :label="t.defaultText" :disabled="text === BEM_DEFAULT_INVITATION_TEXT"
        @click="text = BEM_DEFAULT_INVITATION_TEXT"
      />
      <details class="rounded bg-gray-50 p-2 text-sm">
        <summary class="cursor-pointer font-medium">{{ t.preview }}</summary>
        <p class="mt-2 whitespace-pre-line">{{ preview }}</p>
      </details>
      <UButton type="submit" :label="de.common.save" :loading="busy" :disabled="busy || !dirty" />
    </form>
  </section>
</template>
