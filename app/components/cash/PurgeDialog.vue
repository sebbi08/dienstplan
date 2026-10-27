<script setup lang="ts">
import { confirmsName } from '#shared/domain/confirmName'
import { de } from '~/locales/de'

/**
 * „Kasse … endgültig löschen“ for an archived box whose retention period has run out (page „Löschfristen“, Träger only):
 * lists what goes, says what happens to transfers, asks for a backup and for the box's name. Open while `name` is set;
 * `confirm` carries the typed name once it matches. While `pending` the dialog stays open and the button waits.
 */
const props = defineProps<{ name: string | null; pending: boolean }>()
const emit = defineEmits<{ confirm: [typed: string]; close: [] }>()

const typed = ref('')
watch(() => props.name, () => { typed.value = '' })
const confirmed = computed(() => props.name !== null && confirmsName(typed.value, props.name))

function submit() {
  if (confirmed.value && !props.pending) emit('confirm', typed.value)
}
</script>

<template>
  <UModal
    :open="name !== null" :title="name !== null ? de.cash.purgeTitle(name) : ''"
    @update:open="open => { if (!open && !pending) emit('close') }"
  >
    <template #body>
      <form v-if="name !== null" class="space-y-3 text-sm" @submit.prevent="submit">
        <p class="font-medium">{{ de.cash.purgeIntro }}</p>
        <ul class="list-disc space-y-0.5 pl-5 text-gray-700">
          <li v-for="item in de.cash.purgeItems" :key="item">{{ item }}</li>
        </ul>
        <p class="text-gray-600">{{ de.cash.purgeTransfers }}</p>
        <p class="font-medium text-amber-800">{{ de.cash.purgeBackupHint }}</p>
        <UFormField :label="de.cash.purgeTypeName(name)">
          <UInput v-model="typed" class="w-full" autocomplete="off" />
        </UFormField>
        <div class="flex flex-wrap justify-end gap-2 border-t border-gray-100 pt-3">
          <UButton color="neutral" variant="ghost" :label="de.common.cancel" :disabled="pending" @click="emit('close')" />
          <UButton
            type="submit" color="error" icon="i-lucide-trash-2" :label="de.cash.purge"
            :loading="pending" :disabled="!confirmed || pending"
          />
        </div>
      </form>
    </template>
  </UModal>
</template>
