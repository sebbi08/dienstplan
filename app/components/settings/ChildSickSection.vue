<script setup lang="ts">
import { CHILD_SICK_DEFAULTS, CHILD_SICK_SETTING_KEYS, CHILD_SICK_SETTING_MAX } from '#shared/domain/childSickDays'
import type { ChildSickSettingsDto } from '#shared/types/api'
import { de } from '~/locales/de'

/**
 * Einstellungen → Personal → Kinderkrankentage (§ 45 SGB V): days per child and per year, and the same for single
 * parents. One setting for all facilities; the Träger changes it, the Leitung sees it read-only (the server checks as
 * well). Entering „Kind krank“ is never blocked, the plan only warns.
 */
const t = de.staffChildren.settings
const { data, refresh } = await useFetch<ChildSickSettingsDto>('/api/child-sick-settings', { key: 'child-sick-settings' })
const { can } = useCan()
const canEdit = computed(() => can('settings.absenceCodes'))
const { busy, run } = useBusyAction(refresh)

const form = reactive<ChildSickSettingsDto>({ ...CHILD_SICK_DEFAULTS })
watch(data, (value) => { if (value) Object.assign(form, value) }, { immediate: true })
const dirty = useDirty(() => canEdit.value && !!data.value && CHILD_SICK_SETTING_KEYS.some(key => form[key] !== data.value![key]))
const save = () => dirty.value && run(() => $fetch<ChildSickSettingsDto>('/api/child-sick-settings', { method: 'PUT', body: { ...form } }), de.common.saved)
</script>

<template>
  <section class="space-y-3 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <h2 class="font-semibold">{{ t.title }}</h2>
    <p class="text-sm text-gray-600">{{ t.intro }}</p>
    <p v-if="!canEdit" class="text-xs text-gray-500">{{ t.providerOnly }}</p>
    <form class="grid gap-3 sm:grid-cols-2" @submit.prevent="save">
      <UFormField v-for="key in CHILD_SICK_SETTING_KEYS" :key="key" :label="t[key]">
        <div class="flex items-center gap-2">
          <UInput
            v-model.number="form[key]" type="number" min="0" :max="CHILD_SICK_SETTING_MAX" step="1" required class="w-24"
            :disabled="!canEdit"
          />
          <span class="text-sm text-gray-600">{{ t.days }}</span>
        </div>
      </UFormField>
      <p class="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 sm:col-span-2">{{ t.check }}</p>
      <div v-if="canEdit" class="sm:col-span-2">
        <UButton type="submit" :label="de.common.save" :loading="busy" :disabled="busy || !dirty" />
      </div>
    </form>
  </section>
</template>
