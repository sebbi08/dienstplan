import type { Ref } from 'vue'
import { de } from '~/locales/de'

interface TypeListOptions<Dto, Form> {
  /** Collection route, e.g. `/api/care-types` (items are PUT/DELETE at `${url}/${id}`). */
  url: string
  /** Fetch key of this list; `refreshKeys` are the other fetches of the same data (child pages) to reload after a change. */
  key: string
  refreshKeys: string[]
  empty: () => Form
  toForm: (dto: Dto) => Form
  /** The request body for a form, or null when it is not valid (the callback reports why itself). */
  toBody: (form: Form) => object | null
}

/**
 * Settings table of an editable list (care types, document types): one editable row per entry plus a row for a new
 * one; save creates or updates, remove asks first. The rows follow the server's list after every reload.
 */
export function useTypeList<Dto, Form extends { id: number | null }>(options: TypeListOptions<Dto, Form>) {
  const { data, refresh } = useFetch<Dto[]>(options.url, { key: options.key })
  const { busy, run } = useBusyAction(async () => {
    await Promise.all([refresh(), refreshNuxtData(options.refreshKeys)])
  })
  const confirm = useConfirm()

  const forms = ref<Form[]>([])
  const newForm = ref<Form>(options.empty()) as Ref<Form>
  watch(data, (value) => { forms.value = (value ?? []).map(options.toForm) }, { immediate: true })

  async function save(form: Form) {
    const body = options.toBody(form)
    if (!body) return
    const ok = await run(() => form.id
      ? $fetch<unknown>(`${options.url}/${form.id}`, { method: 'PUT', body })
      : $fetch<unknown>(options.url, { method: 'POST', body }), de.common.saved)
    if (ok && !form.id) newForm.value = options.empty()
  }

  async function remove(form: Form) {
    if (form.id && await confirm(de.childSettings.confirmDeleteType)) run(() => $fetch<unknown>(`${options.url}/${form.id}`, { method: 'DELETE' }), de.common.deleted)
  }

  return { forms, newForm, busy, save, remove }
}
