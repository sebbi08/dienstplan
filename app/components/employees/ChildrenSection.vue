<script setup lang="ts">
import type { EmployeeChildrenDto, EmployeeChildrenInput } from '#shared/types/api'
import { de } from '~/locales/de'
import { errorMessage } from '~/utils/errors'
import { formatDate } from '~/utils/format'

/**
 * „Kinder“ in the tab „Stammdaten“, next to the personal data and with the same rights (the page mounts it only with
 * employees.personal; changing needs employees.edit as well): „alleinerziehend“ and the children with birth date and
 * „Kind mit Behinderung, auf Hilfe angewiesen“. They give the Kinderkrankentage and the parent status in „Lohn und
 * Steuer“. „Bearbeiten“ opens the form, which saves the whole section at once.
 */
const props = defineProps<{ employeeId: number }>()
const emit = defineEmits<{ saved: [] }>()
const t = de.staffChildren
const url = `/api/employees/${props.employeeId}/children`
const { data, error, refresh } = await useFetch<EmployeeChildrenDto>(url)
const { can } = useCan()
const canEdit = computed(() => can('employees.edit'))
const { busy, run } = useBusyAction(() => refresh())
const loadError = computed(() => (error.value && (error.value as { statusCode?: number }).statusCode !== 404 ? errorMessage(error.value) : null))

type Row = { id: number | null; firstName: string; birthDate: string; disabledDependent: boolean }
const editing = ref(false)
const form = reactive<{ singleParent: boolean; children: Row[] }>({ singleParent: false, children: [] })
const formOf = (value: EmployeeChildrenDto | null | undefined) => ({
  singleParent: value?.singleParent ?? false,
  children: (value?.children ?? []).map(child => ({
    id: child.id, firstName: child.firstName ?? '', birthDate: child.birthDate, disabledDependent: child.disabledDependent,
  })),
})
const input = (): EmployeeChildrenInput => ({
  singleParent: form.singleParent,
  children: form.children.map(child => ({
    id: child.id, firstName: child.firstName.trim() || null, birthDate: child.birthDate, disabledDependent: child.disabledDependent,
  })),
})
const savedInput = (): EmployeeChildrenInput => ({
  singleParent: data.value?.singleParent ?? false,
  children: (data.value?.children ?? []).map(child => ({
    id: child.id, firstName: child.firstName, birthDate: child.birthDate, disabledDependent: child.disabledDependent,
  })),
})
// An open form with changes makes the page ask before another tab or page.
useDirty(() => editing.value && JSON.stringify(input()) !== JSON.stringify(savedInput()))

function startEdit() {
  Object.assign(form, formOf(data.value))
  editing.value = true
}
function addChild() {
  form.children.push({ id: null, firstName: '', birthDate: '', disabledDependent: false })
}
async function save() {
  if (await run(() => $fetch<EmployeeChildrenDto>(url, { method: 'PUT', body: input() }), de.common.saved)) {
    editing.value = false
    emit('saved')
  }
}
</script>

<template>
  <section class="space-y-3 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <div class="flex flex-wrap items-center gap-2">
      <h2 class="font-semibold">{{ t.title }}</h2>
      <UButton
        v-if="canEdit && data && !editing" size="xs" color="neutral" variant="outline" icon="i-lucide-pencil" class="ml-auto"
        :label="de.common.edit" @click="startEdit"
      />
    </div>
    <p class="text-sm text-gray-500">{{ t.hint }}</p>
    <UAlert v-if="loadError" color="error" variant="soft" :title="loadError" />

    <template v-else-if="data && !editing">
      <p class="text-sm"><span class="text-gray-500">{{ t.singleParent }}:</span> {{ data.singleParent ? t.yes : t.no }}</p>
      <p v-if="!data.children.length" class="text-sm text-gray-500">{{ t.none }}</p>
      <ul v-else class="space-y-1 text-sm">
        <li v-for="child in data.children" :key="child.id">
          {{ t.childLabel(child.firstName, formatDate(child.birthDate)) }}
          <span v-if="child.disabledDependent" class="text-gray-500"> · {{ t.disabledDependent }}</span>
        </li>
      </ul>
    </template>

    <form v-else-if="editing" class="space-y-3" @submit.prevent="save">
      <UCheckbox v-model="form.singleParent" :label="t.singleParent" />
      <p v-if="!form.children.length" class="text-sm text-gray-500">{{ t.none }}</p>
      <div v-for="(child, index) in form.children" :key="index" class="grid gap-3 rounded-md bg-gray-50 p-3 sm:grid-cols-[1fr_12rem_auto] sm:items-end">
        <UFormField :label="t.firstName">
          <UInput v-model="child.firstName" maxlength="100" autocomplete="off" class="w-full" />
        </UFormField>
        <UFormField :label="t.birthDate">
          <DateTextInput v-model="child.birthDate" :label="t.birthDate" class="w-full" required />
        </UFormField>
        <UButton color="error" variant="ghost" icon="i-lucide-trash-2" :label="t.remove" @click="form.children.splice(index, 1)" />
        <UCheckbox v-model="child.disabledDependent" :label="t.disabledDependent" class="sm:col-span-3" />
      </div>
      <UButton type="button" size="sm" color="neutral" variant="outline" icon="i-lucide-plus" :label="t.add" @click="addChild" />
      <div class="flex flex-wrap gap-2">
        <UButton type="submit" :label="de.common.save" :loading="busy" :disabled="busy || form.children.some(child => !child.birthDate)" />
        <UButton type="button" color="neutral" variant="ghost" :label="de.common.cancel" @click="editing = false" />
      </div>
    </form>
  </section>
</template>
