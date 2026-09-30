<script setup lang="ts">
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'

const { user, fetch: refreshSession } = useUserSession()
const toast = useToast()
const form = reactive({ currentPassword: '', newPassword: '', repeat: '' })
const error = ref('')

async function submit() {
  error.value = ''
  if (form.newPassword !== form.repeat) {
    error.value = de.password.mismatch
    return
  }
  try {
    await $fetch('/api/auth/password', {
      method: 'POST', body: { currentPassword: form.currentPassword, newPassword: form.newPassword },
    })
    await refreshSession()
    toast.add({ title: de.password.saved, color: 'success' })
    await navigateTo('/')
  }
  catch (caught) {
    error.value = errorMessage(caught)
  }
}
</script>

<template>
  <form class="mx-auto max-w-md space-y-4 rounded-lg bg-white p-6 ring-1 ring-gray-200" @submit.prevent="submit">
    <h1 class="text-xl font-semibold">{{ de.password.title }}</h1>
    <UAlert v-if="user?.mustChangePassword" color="warning" variant="soft" :title="de.password.mustChange" />
    <UFormField :label="de.password.current">
      <UInput v-model="form.currentPassword" type="password" autocomplete="current-password" class="w-full" required />
    </UFormField>
    <UFormField :label="de.password.next">
      <UInput v-model="form.newPassword" type="password" autocomplete="new-password" class="w-full" required />
    </UFormField>
    <UFormField :label="de.password.repeat">
      <UInput v-model="form.repeat" type="password" autocomplete="new-password" class="w-full" required />
    </UFormField>
    <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
    <UButton type="submit" :label="de.password.submit" />
  </form>
</template>
