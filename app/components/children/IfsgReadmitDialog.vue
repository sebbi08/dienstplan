<script setup lang="ts">
import { todayIso } from '#shared/domain/dates'
import type { IsoDate } from '#shared/domain/types'
import type { AttendanceChildDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { MAX_DOCUMENT_BYTES } from '~/utils/children'
import { ifsgDayText, ifsgEarliestText } from '~/utils/ifsg'

/**
 * „Kommt“ while a § 34 IfSG case is open: the red block, and for whoever may (Leitung/Träger, the child's own group) the
 * confirmation of the readmission with its day, a note and the attest as photo or PDF (required when the facility asks
 * for a written attest with a medical judgement). A day before the earliest readmission asks once more. After saving,
 * `readmitted` lets the list open „Kommt“. Everybody else only reads the block without the disease.
 */
const props = defineProps<{ child: AttendanceChildDto; date: IsoDate; reload: () => Promise<unknown> }>()
const emit = defineEmits<{ readmitted: [] }>()
const open = defineModel<boolean>('open', { default: false })
const { busy, run } = useBusyAction(() => props.reload())
const { onTablet } = useChildRights()
const ask = useQuestion()
const toast = useToast()
const s = de.ifsg

const info = computed(() => props.child.ifsg)
const form = reactive({ readmittedOn: props.date, note: '' })
const file = ref<File | null>(null)
const fromCamera = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
const cameraInput = ref<HTMLInputElement | null>(null)
watch(open, (value) => {
  if (!value) return
  Object.assign(form, { readmittedOn: props.date > todayIso() ? todayIso() : props.date, note: '' })
  file.value = null
  fromCamera.value = false
}, { immediate: true })

/** A medical judgement needs the attest when the facility asks for it. */
const attestRequired = computed(() => !!info.value?.requireAttest && info.value.proof === 'medical_certificate')
const valid = computed(() => form.readmittedOn !== '' && form.readmittedOn <= todayIso() && (!attestRequired.value || file.value !== null))

/** The chosen file and the photo feed the same upload; the other input is emptied so only one of them counts. */
function onFile(event: Event, camera = false) {
  file.value = (event.target as HTMLInputElement).files?.[0] ?? null
  fromCamera.value = camera && file.value !== null
  const other = camera ? fileInput.value : cameraInput.value
  if (other && file.value) other.value = ''
}

async function save() {
  const current = info.value
  if (!current || !valid.value) return
  if (file.value && file.value.size > MAX_DOCUMENT_BYTES) return void toast.add({ title: de.errors.document_too_large, color: 'error' })
  let confirmEarly = false
  if (current.earliest !== null && form.readmittedOn < current.earliest) {
    if (await ask(s.readmit.early(ifsgDayText(current.earliest)), { confirmLabel: s.readmit.earlyConfirm, danger: true }) !== true) return
    confirmEarly = true
  }
  const body = new FormData()
  body.append('readmittedOn', form.readmittedOn)
  body.append('note', form.note)
  body.append('confirmEarly', String(confirmEarly))
  if (file.value) body.append('file', file.value)
  const ok = await run(() => $fetch<{ ok: boolean }>(`/api/ifsg/cases/${current.caseId}/readmit`, { method: 'POST', body }), s.readmit.saved)
  if (!ok) return
  // The list opens „Kommt“ first (it still knows the child), then this dialog closes.
  emit('readmitted')
  open.value = false
}
</script>

<template>
  <UModal v-model:open="open" :title="s.readmit.title(child.name)">
    <template #body>
      <form class="space-y-4" @submit.prevent="save">
        <p class="flex items-start gap-2 rounded-lg bg-red-100 p-3 text-base font-semibold text-red-800 ring-1 ring-red-300" role="alert">
          <UIcon name="i-lucide-shield-alert" class="mt-0.5 size-5 shrink-0" aria-hidden="true" />{{ s.blockWarning }}
        </p>
        <div v-if="info?.diseaseName" class="space-y-1 rounded-lg bg-red-50 p-3 text-sm text-red-900 ring-1 ring-red-200">
          <p class="font-semibold">{{ info.diseaseName }}<template v-if="info.kind"> – {{ s.kinds[info.kind] }}</template></p>
          <p v-if="info.text">{{ info.text }}</p>
          <p class="font-medium">{{ ifsgEarliestText(info.earliest, info.condition ?? '') }}</p>
          <p v-if="info.proof">{{ s.proof(s.proofs[info.proof]) }}</p>
        </div>
        <template v-if="info?.canReadmit">
          <UFormField :label="s.readmit.date" required>
            <DateTextInput v-model="form.readmittedOn" :label="s.readmit.date" size="xl" :max="todayIso()" required />
          </UFormField>
          <UFormField :label="s.readmit.note">
            <UInput v-model="form.note" size="xl" maxlength="1000" class="w-full" :placeholder="s.readmit.notePlaceholder" />
          </UFormField>
          <UFormField :label="attestRequired ? s.readmit.attest : s.readmit.attestOptional" :required="attestRequired" :help="attestRequired ? s.readmit.attestRequired : undefined">
            <input
              ref="fileInput" type="file" accept="application/pdf,image/jpeg,image/png"
              class="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-gray-100 file:px-3 file:py-1.5 file:text-sm hover:file:bg-gray-200"
              @change="onFile($event)"
            >
            <div v-if="onTablet" class="mt-2 flex flex-wrap items-center gap-2">
              <UButton type="button" color="neutral" variant="outline" icon="i-lucide-camera" :label="de.childDocuments.takePhoto" @click="cameraInput?.click()" />
              <input ref="cameraInput" type="file" accept="image/*" capture="environment" class="hidden" @change="onFile($event, true)">
              <span v-if="fromCamera && file" class="text-sm text-gray-600">{{ de.childDocuments.photoChosen(file.name) }}</span>
            </div>
          </UFormField>
          <div class="flex flex-wrap gap-2">
            <UButton
              type="submit" size="xl" color="success" icon="i-lucide-check" :label="s.readmit.confirm[info.proof ?? 'medical_certificate']"
              :loading="busy" :disabled="busy || !valid"
            />
            <UButton type="button" size="xl" color="neutral" variant="ghost" :label="de.common.cancel" :disabled="busy" @click="open = false" />
          </div>
        </template>
        <template v-else>
          <p class="text-sm text-gray-700">{{ s.readmit.otherGroup }}</p>
          <UButton type="button" size="xl" color="neutral" variant="outline" :label="de.common.close" @click="open = false" />
        </template>
        <p class="text-xs text-gray-500">{{ s.footer }}</p>
      </form>
    </template>
  </UModal>
</template>
