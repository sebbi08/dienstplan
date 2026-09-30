<script setup lang="ts">
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'

definePageMeta({ layout: false })

const { fetch: refreshSession } = useUserSession()
const form = reactive({ username: '', password: '' })
const error = ref('')
const loading = ref(false)

async function submit() {
  loading.value = true
  error.value = ''
  try {
    await $fetch('/api/auth/login', { method: 'POST', body: form })
    await refreshSession()
    await navigateTo('/')
  }
  catch (caught) {
    error.value = errorMessage(caught)
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-gray-50 p-4">
    <form class="w-full max-w-sm space-y-4 rounded-lg bg-white p-6 ring-1 ring-gray-200" @submit.prevent="submit">
      <h1 class="text-xl font-semibold">{{ de.appName }} · {{ de.login.title }}</h1>
      <UFormField :label="de.login.username">
        <UInput v-model="form.username" autocomplete="username" class="w-full" required />
      </UFormField>
      <UFormField :label="de.login.password">
        <UInput v-model="form.password" type="password" autocomplete="current-password" class="w-full" required />
      </UFormField>
      <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
      <UButton type="submit" block :loading="loading" :label="de.login.submit" />
    </form>
  </div>
</template>
