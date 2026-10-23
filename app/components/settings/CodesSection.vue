<script setup lang="ts">
import type { CreditMode } from '#shared/domain/types'
import { COLOR_KEYS, type CodeDto, type SettingsDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { builtRows, mergeRows } from '~/utils/settingsForms'

/** Einstellungen → Dienstplan → Codes. They apply to every facility: only the Träger changes them, the Leitung sees them read-only. */
const { data: settings, refresh } = await useFetch<SettingsDto>('/api/settings', { key: 'settings' })
const run = useAction(refresh)
const confirm = useConfirm()
const { user } = useUserSession()
const isProvider = computed(() => user.value?.role === 'provider')

const codes = ref<CodeDto[]>([])
// Any save on the page reloads the shared settings: rows with unsaved edits keep them unless they were just saved.
let built = new Map<number, string>()
const justSaved = new Set<number>()
watch(settings, (value) => {
  const fresh = (value?.codes ?? []).map(code => ({ ...code }))
  codes.value = mergeRows(codes.value, built, fresh, justSaved)
  built = builtRows(fresh)
  justSaved.clear()
}, { immediate: true })

const colorItems = COLOR_KEYS.map(color => ({ label: de.colors[color], value: color }))
const creditItems = (['daily_target', 'timed', 'none'] as CreditMode[]).map(mode => ({ label: de.creditModes[mode], value: mode }))

function rowDirty(code: CodeDto): boolean {
  const saved = settings.value?.codes.find(candidate => candidate.id === code.id)
  return !!saved && !sameValue([code.label, code.color, code.creditMode], [saved.label, saved.color, saved.creditMode])
}
useDirty(() => isProvider.value && codes.value.some(rowDirty))

async function saveCode(code: CodeDto) {
  if (!rowDirty(code)) return
  const saved = settings.value?.codes.find(candidate => candidate.id === code.id)
  if (saved && saved.creditMode !== code.creditMode
    && !await confirm(de.settings.creditModeConfirm, { confirmLabel: de.common.save, danger: false })) return
  run(async () => {
    await $fetch<unknown>(`/api/absence-codes/${code.id}`, {
      method: 'PUT', body: { label: code.label, color: code.color, creditMode: code.creditMode },
    })
    justSaved.add(code.id)
  }, de.common.saved)
}

const cell = 'px-1 py-1'
const textInput = 'w-full min-w-24 rounded border border-gray-300 px-1 py-0.5'
</script>

<template>
  <section class="space-y-2 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <h2 class="font-semibold">{{ de.settings.codes }}</h2>
    <p v-if="!isProvider" class="text-xs text-gray-500">{{ de.settings.codesProviderOnly }}</p>
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="text-left text-xs text-gray-500">
          <tr><th :class="cell">{{ de.settings.label }}</th><th :class="cell">{{ de.settings.color }}</th><th :class="cell">{{ de.settings.creditMode }}</th><th v-if="isProvider" /></tr>
        </thead>
        <tbody>
          <tr v-for="code in codes" :key="code.id" class="border-t border-gray-100">
            <template v-if="isProvider">
              <td :class="cell"><input v-model="code.label" maxlength="50" :class="textInput" :aria-label="de.settings.label"></td>
              <td :class="cell"><USelect v-model="code.color" :items="colorItems" class="w-32" :aria-label="de.settings.color" /></td>
              <td :class="cell"><USelect v-model="code.creditMode" :items="creditItems" class="w-44" :aria-label="de.settings.creditMode" /></td>
              <td :class="cell" class="text-right"><UButton v-if="rowDirty(code)" size="xs" :label="de.common.save" @click="saveCode(code)" /></td>
            </template>
            <template v-else>
              <td :class="cell">{{ code.label }}</td>
              <td :class="cell">{{ de.colors[code.color] }}</td>
              <td :class="cell">{{ de.creditModes[code.creditMode] }}</td>
            </template>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
