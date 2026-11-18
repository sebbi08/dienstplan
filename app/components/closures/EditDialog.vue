<script setup lang="ts">
import type { ClosureDto, ClosureMode } from '#shared/types/api'
import { de } from '~/locales/de'

/**
 * Changes a closure (the create form's fields; the server checks them the same way, 366 days at most). New dates or a
 * new mode change the plan, so they are confirmed first; a new label alone is saved straight away.
 */
const props = defineProps<{ closure: ClosureDto | null }>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ saved: [closure: ClosureDto] }>()

const run = useAction()
const confirm = useConfirm()
const form = reactive<{ startDate: string; endDate: string; label: string; mode: ClosureMode }>({
  startDate: '', endDate: '', label: '', mode: 'vacation',
})
const modeItems = (['vacation', 'closure_day'] as const).map(mode => ({ label: de.closures.modes[mode], value: mode }))

watch(open, (isOpen) => {
  const closure = props.closure
  if (isOpen && closure) Object.assign(form, { startDate: closure.startDate, endDate: closure.endDate, label: closure.label, mode: closure.mode })
})

async function save() {
  const closure = props.closure
  if (!closure) return
  const replans = form.startDate !== closure.startDate || form.endDate !== closure.endDate || form.mode !== closure.mode
  if (replans && !await confirm(de.closures.confirmReplan, { confirmLabel: de.common.save, danger: false })) return
  const result: { saved?: ClosureDto } = {}
  await run(async () => {
    result.saved = await $fetch<ClosureDto>(`/api/closures/${closure.id}`, { method: 'PUT', body: { ...form } })
  }, de.common.saved)
  if (result.saved) {
    open.value = false
    emit('saved', result.saved)
  }
}
</script>

<template>
  <UModal v-model:open="open" :title="de.closures.edit">
    <template #body>
      <form class="grid gap-3 sm:grid-cols-2" @submit.prevent="save()">
        <UFormField :label="de.closures.from"><DateTextInput v-model="form.startDate" :label="de.closures.from" class="w-full" required /></UFormField>
        <UFormField :label="de.closures.to"><DateTextInput v-model="form.endDate" :label="de.closures.to" class="w-full" required /></UFormField>
        <UFormField :label="de.closures.label"><UInput v-model="form.label" maxlength="100" class="w-full" required /></UFormField>
        <UFormField :label="de.closures.mode"><USelect v-model="form.mode" :items="modeItems" class="w-full" /></UFormField>
        <div class="flex gap-2 sm:col-span-2">
          <UButton class="ml-auto" color="neutral" variant="ghost" :label="de.common.cancel" @click="open = false" />
          <UButton type="submit" icon="i-lucide-check" :label="de.common.save" />
        </div>
      </form>
    </template>
  </UModal>
</template>
