<script setup lang="ts">
import type { IsoDate } from '#shared/domain/types'
import type { AttendanceAnnouncementInput, AttendanceChildDto } from '#shared/types/api'
import { de } from '~/locales/de'

/**
 * "Abholer ankündigen" (spec §3.3): a person who picks the child up on this day only (name required, "angekündigt von"
 * optional). Lists the persons announced for the day so far, each removable.
 */
const props = defineProps<{ child: AttendanceChildDto; date: IsoDate; reload: () => Promise<unknown> }>()
const open = defineModel<boolean>('open', { default: false })
const { busy, run } = useBusyAction(() => props.reload())
const s = de.attendance

const form = reactive({ name: '', announcedBy: '' })
const error = ref('')
watch(open, (value) => {
  if (!value) return
  Object.assign(form, { name: '', announcedBy: '' })
  error.value = ''
}, { immediate: true })

async function save() {
  if (form.name.trim() === '') {
    error.value = de.errors.name_required
    return
  }
  error.value = ''
  const body: AttendanceAnnouncementInput = { childId: props.child.childId, date: props.date, name: form.name, announcedBy: form.announcedBy }
  if (await run(() => $fetch<unknown>('/api/attendance/announcements', { method: 'POST', body }), de.common.saved)) open.value = false
}

const remove = (id: number) => run(() => $fetch<unknown>(`/api/attendance/announcements/${id}`, { method: 'DELETE' }), de.common.deleted)
</script>

<template>
  <UModal v-model:open="open" :title="s.announce.title(child.name)">
    <template #body>
      <div class="space-y-4">
        <div v-if="child.announcements.length" class="space-y-2">
          <h3 class="text-sm font-medium">{{ s.announce.current }}</h3>
          <ul class="divide-y divide-gray-100 rounded-lg ring-1 ring-gray-200">
            <li v-for="entry in child.announcements" :key="entry.id" class="flex items-center gap-3 px-3 py-2">
              <div class="min-w-0 flex-1">
                <p class="font-medium">{{ entry.name }}</p>
                <p v-if="entry.announcedBy" class="text-sm text-gray-600">{{ s.announce.by(entry.announcedBy) }}</p>
              </div>
              <UButton size="lg" color="error" variant="ghost" icon="i-lucide-trash-2" :label="s.announce.remove" :disabled="busy" @click="remove(entry.id)" />
            </li>
          </ul>
        </div>
        <form class="space-y-3" @submit.prevent="save">
          <UFormField :label="s.announce.name" required>
            <UInput v-model="form.name" size="xl" maxlength="100" class="w-full" />
          </UFormField>
          <UFormField :label="s.announce.announcedBy">
            <UInput v-model="form.announcedBy" size="xl" maxlength="100" :placeholder="s.announce.announcedByPlaceholder" class="w-full" />
          </UFormField>
          <p class="text-sm text-gray-500">{{ s.announce.hint }}</p>
          <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
          <div class="flex gap-2">
            <UButton type="submit" size="xl" icon="i-lucide-user-plus" :label="s.actions.announce" :loading="busy" :disabled="busy" />
            <UButton type="button" size="xl" color="neutral" variant="ghost" :label="de.common.close" :disabled="busy" @click="open = false" />
          </div>
        </form>
      </div>
    </template>
  </UModal>
</template>
