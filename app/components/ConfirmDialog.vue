<script setup lang="ts">
import { de } from '~/locales/de'

const { request, settle } = useConfirmRequest()
const open = computed({
  get: () => request.value !== null,
  set: (value: boolean) => { if (!value) settle(false) },
})
</script>

<template>
  <UModal v-model:open="open" :title="de.common.confirmTitle">
    <template #body>
      <p class="text-sm">{{ request?.message }}</p>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="ghost" :label="de.common.cancel" @click="settle(false)" />
        <UButton :color="request?.danger ? 'error' : 'primary'" :label="request?.confirmLabel" @click="settle(true)" />
      </div>
    </template>
  </UModal>
</template>
