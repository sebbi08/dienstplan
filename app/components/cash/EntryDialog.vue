<script setup lang="ts">
import { parseCents } from '#shared/domain/cash'
import { daysInMonth, toIsoDate, todayIso } from '#shared/domain/dates'
import type { CashBoxDto, CashBoxInfoDto, CashMonthRowDto } from '#shared/types/api'
import { de } from '~/locales/de'
import { centsInput } from '~/utils/cash'
import { MAX_DOCUMENT_BYTES } from '~/utils/children'

/**
 * A new income or expense (`mode` in/out), a new transfer (`mode` transfer), or the clicked row to change or delete
 * (a transfer row changes both of its rows through the transfer routes). The date stays inside the sheet's month.
 */
const props = defineProps<{
  mode: 'in' | 'out' | 'transfer'
  row: CashMonthRowDto | null
  box: CashBoxInfoDto
  /** All boxes of the facility, for the transfer's other box. */
  boxes: CashBoxDto[]
  year: number
  month: number
}>()
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ saved: [] }>()

const run = useAction()
const confirm = useConfirm()
const toast = useToast()
const listId = useId()

const form = reactive({ date: '', amount: '', purpose: '', fromBoxId: 0, toBoxId: 0 })
const error = ref('')
const receiptFile = ref<File | null>(null)
const removeReceipt = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
const cameraInput = ref<HTMLInputElement | null>(null)

const isTransfer = computed(() => props.mode === 'transfer' || props.row?.transferId != null)
const minDate = computed(() => toIsoDate(props.year, props.month, 1))
const maxDate = computed(() => {
  const last = toIsoDate(props.year, props.month, daysInMonth(props.year, props.month))
  const today = todayIso()
  return today < last ? today : last
})
const activeBoxes = computed(() => props.boxes.filter(box => !box.archived))
const fromItems = computed(() => activeBoxes.value.map(box => ({ label: box.name, value: box.id })))
const toItems = computed(() => activeBoxes.value.filter(box => box.id !== form.fromBoxId).map(box => ({ label: box.name, value: box.id })))

const title = computed(() => {
  if (props.row) return props.row.transferId != null ? de.cash.editTransfer : props.row.direction === 'in' ? de.cash.editIncome : de.cash.editExpense
  return props.mode === 'transfer' ? de.cash.newTransfer : props.mode === 'in' ? de.cash.newIncome : de.cash.newExpense
})

watch(open, (isOpen) => {
  if (!isOpen) return
  const row = props.row
  const others = activeBoxes.value.filter(box => box.id !== props.box.id)
  Object.assign(form, row
    ? { date: row.date, amount: centsInput(row.cents), purpose: row.transfer ? row.transfer.text : row.purpose, fromBoxId: 0, toBoxId: 0 }
    : { date: maxDate.value, amount: '', purpose: props.mode === 'transfer' ? de.cash.transferDefault : '', fromBoxId: props.box.id, toBoxId: others[0]?.id ?? 0 })
  error.value = ''
  receiptFile.value = null
  removeReceipt.value = false
  suggestions.value = []
})

watch(() => form.fromBoxId, () => {
  if (form.toBoxId === form.fromBoxId) form.toBoxId = toItems.value[0]?.value ?? 0
})

// Suggestions for the purpose from earlier entries of the facility, asked while typing (not for transfers).
const suggestions = ref<string[]>([])
let timer: ReturnType<typeof setTimeout> | undefined
// Only the answer to the latest request counts; a slower older one must not overwrite it.
let latestRequest = 0
watch(() => form.purpose, (text) => {
  clearTimeout(timer)
  if (!open.value || isTransfer.value) return
  timer = setTimeout(async () => {
    const request = ++latestRequest
    let found: string[] = []
    try {
      found = await $fetch<string[]>('/api/cash/purposes', { query: { q: text.trim() } })
    }
    catch {
      // No suggestions then.
    }
    if (request === latestRequest) suggestions.value = found
  }, 250)
})
onBeforeUnmount(() => clearTimeout(timer))

function pick(event: Event) {
  const input = event.target as HTMLInputElement
  const chosen = input.files?.[0] ?? null
  input.value = ''
  if (!chosen) return
  // Fail early instead of after a long upload; the server checks the size and the real file type again.
  if (chosen.size > MAX_DOCUMENT_BYTES) return void toast.add({ title: de.errors.document_too_large, color: 'error' })
  receiptFile.value = chosen
  removeReceipt.value = false
}

const hasReceipt = computed(() => props.row?.receiptId != null && !removeReceipt.value)

async function writeFacts(cents: number): Promise<number> {
  const facts = { date: form.date, cents, purpose: form.purpose.trim() }
  const row = props.row
  if (row?.transferId != null) {
    await $fetch(`/api/cash/transfers/${row.transferId}`, { method: 'PUT', body: facts })
    return row.id
  }
  if (row) {
    await $fetch(`/api/cash/entries/${row.id}`, { method: 'PUT', body: facts })
    return row.id
  }
  if (props.mode === 'transfer') {
    const result = await $fetch<{ id: number }>('/api/cash/transfers', { method: 'POST', body: { ...facts, fromBoxId: form.fromBoxId, toBoxId: form.toBoxId } })
    return result.id
  }
  const result = await $fetch<{ id: number }>('/api/cash/entries', { method: 'POST', body: { ...facts, boxId: props.box.id, direction: props.mode } })
  return result.id
}

async function submit() {
  const cents = parseCents(form.amount)
  if (cents === null) {
    error.value = de.cash.invalidAmount
    return
  }
  if (props.mode === 'transfer' && !props.row && !form.toBoxId) {
    error.value = de.cash.noOtherBox
    return
  }
  let entryId = 0
  if (!(await run(async () => { entryId = await writeFacts(cents) }, de.common.saved))) return
  // The entry is saved; a failed receipt upload only shows its error (the dialog closes so nothing is saved twice).
  const file = receiptFile.value
  if (file) {
    const body = new FormData()
    body.append('file', file)
    await run(() => $fetch(`/api/cash/entries/${entryId}/receipt`, { method: 'PUT', body }))
  }
  else if (removeReceipt.value && props.row?.receiptId != null) {
    await run(() => $fetch(`/api/cash/entries/${entryId}/receipt`, { method: 'DELETE' }))
  }
  open.value = false
  emit('saved')
}

async function remove() {
  const row = props.row
  if (!row) return
  const transfer = row.transferId != null
  if (!(await confirm(transfer ? de.cash.deleteTransferConfirm : de.cash.deleteEntryConfirm))) return
  const url = transfer ? `/api/cash/transfers/${row.transferId}` : `/api/cash/entries/${row.id}`
  if (await run(() => $fetch(url, { method: 'DELETE' }), de.common.deleted)) {
    open.value = false
    emit('saved')
  }
}

async function askRemoveReceipt() {
  if (await confirm(de.cash.receiptRemoveConfirm, { confirmLabel: de.cash.receiptRemove })) removeReceipt.value = true
}
</script>

<template>
  <UModal v-model:open="open" :title="title">
    <template #body>
      <form class="grid grid-cols-2 gap-3" @submit.prevent="submit">
        <template v-if="mode === 'transfer' && !row">
          <UFormField :label="de.cash.fromBox" class="col-span-2 sm:col-span-1">
            <USelect v-model="form.fromBoxId" :items="fromItems" class="w-full" />
          </UFormField>
          <UFormField :label="de.cash.toBox" class="col-span-2 sm:col-span-1">
            <USelect v-if="toItems.length" v-model="form.toBoxId" :items="toItems" class="w-full" />
            <p v-else class="text-sm text-red-600">{{ de.cash.noOtherBox }}</p>
          </UFormField>
        </template>
        <p v-else-if="row?.transfer" class="col-span-2 text-sm text-gray-600">{{ row.direction === 'out' ? de.cash.transferTo(row.transfer.otherBoxName) : de.cash.transferFrom(row.transfer.otherBoxName) }} · {{ de.cash.transferEditHint }}</p>
        <UFormField :label="de.cash.date">
          <DateTextInput v-model="form.date" :label="de.cash.date" :min="minDate" :max="maxDate" class="w-full" required />
        </UFormField>
        <UFormField :label="`${de.cash.amount} (€)`">
          <UInput v-model="form.amount" inputmode="decimal" :placeholder="de.cash.amountPlaceholder" class="w-full" required autofocus />
        </UFormField>
        <UFormField :label="de.cash.purpose" class="col-span-2">
          <UInput v-model="form.purpose" maxlength="200" class="w-full" :list="listId" autocomplete="off" required />
          <datalist :id="listId">
            <option v-for="text in suggestions" :key="text" :value="text" />
          </datalist>
        </UFormField>

        <div class="col-span-2 space-y-2">
          <div class="text-sm font-medium">{{ de.cash.receipt }}</div>
          <p class="text-xs text-gray-500">{{ de.cash.receiptHint }}<template v-if="isTransfer">{{ ` ${de.cash.receiptTransferHint}` }}</template></p>
          <div class="flex flex-wrap items-center gap-2">
            <UButton
              v-if="hasReceipt && !receiptFile" size="sm" color="neutral" variant="outline" icon="i-lucide-file-text"
              :to="`/api/cash/receipts/${row!.receiptId}`" target="_blank" external :label="de.cash.receiptView"
            />
            <UButton v-if="hasReceipt && !receiptFile" size="sm" color="error" variant="ghost" icon="i-lucide-trash-2" :label="de.cash.receiptRemove" @click="askRemoveReceipt" />
            <UButton size="sm" color="neutral" variant="outline" icon="i-lucide-camera" :label="de.cash.receiptPhoto" @click="cameraInput?.click()" />
            <UButton size="sm" color="neutral" variant="outline" icon="i-lucide-paperclip" :label="de.cash.receiptFile" @click="fileInput?.click()" />
            <input ref="cameraInput" type="file" accept="image/jpeg,image/png" capture="environment" class="hidden" @change="pick">
            <input ref="fileInput" type="file" accept="image/jpeg,image/png,application/pdf" class="hidden" @change="pick">
          </div>
          <p v-if="receiptFile" class="break-all text-xs text-gray-600">{{ de.cash.receiptChosen(receiptFile.name) }}</p>
        </div>

        <p v-if="error" class="col-span-2 text-sm text-red-600">{{ error }}</p>
        <div class="col-span-2 flex gap-2">
          <UButton v-if="row" color="error" variant="ghost" icon="i-lucide-trash-2" :label="de.common.delete" @click="remove" />
          <UButton class="ml-auto" color="neutral" variant="ghost" :label="de.common.cancel" @click="open = false" />
          <UButton type="submit" :label="de.common.save" />
        </div>
      </form>
    </template>
  </UModal>
</template>
