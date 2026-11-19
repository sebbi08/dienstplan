<script setup lang="ts">
import type { IfsgSettingsDto } from '#shared/types/api'
import { de } from '~/locales/de'

/**
 * § 34 IfSG (Leitung and Träger): whether the readmission after a medical judgement needs a written attest, and the
 * local health office (name and phone) shown with its rules and in „Rücksprache“ cases.
 */
const { data, refresh } = await useFetch<IfsgSettingsDto>('/api/ifsg/settings', { key: 'ifsg-settings' })
const { busy, run } = useBusyAction(async () => {
  await refresh()
  await refreshNuxtData('ifsg-local-rules')
})
const s = de.ifsg.settings
const l = de.ifsg.local

const form = reactive({ requireAttest: false, healthOfficeName: '', healthOfficePhone: '' })
watch(data, (value) => {
  if (value) Object.assign(form, value)
}, { immediate: true })

const dirty = useDirty(() => !!data.value && (form.requireAttest !== data.value.requireAttest
  || form.healthOfficeName !== data.value.healthOfficeName || form.healthOfficePhone !== data.value.healthOfficePhone))
const save = () => dirty.value && run(() => $fetch<IfsgSettingsDto>('/api/ifsg/settings', { method: 'PUT', body: { ...form } }), de.common.saved)
</script>

<template>
  <section v-if="data" class="space-y-2 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <h2 class="font-semibold">{{ s.title }}</h2>
    <form class="space-y-3" @submit.prevent="save">
      <USwitch v-model="form.requireAttest" :label="s.requireAttest" />
      <div class="grid gap-3 sm:grid-cols-2">
        <UFormField :label="l.officeName">
          <UInput v-model="form.healthOfficeName" maxlength="200" class="w-full" :placeholder="l.officeNamePlaceholder" />
        </UFormField>
        <UFormField :label="l.officePhone">
          <UInput v-model="form.healthOfficePhone" maxlength="100" class="w-full" type="tel" />
        </UFormField>
      </div>
      <UButton type="submit" :label="de.common.save" :loading="busy" :disabled="busy || !dirty" />
    </form>
    <p class="text-xs text-gray-500">{{ s.hint }}</p>
    <p class="text-xs text-gray-500">{{ de.ifsg.footer }}</p>
  </section>
</template>
