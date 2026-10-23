import type { Ref } from 'vue'
import { de } from '~/locales/de'
import { builtRows, mergeRows } from '~/utils/settingsForms'

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
 * one; save creates or updates, remove asks first. The rows follow the server's list after every reload (a row with
 * unsaved edits keeps them).
 * Call as `await useTypeList(...)` so the server renders the existing rows too.
 */
export async function useTypeList<Dto, Form extends { id: number | null }>(options: TypeListOptions<Dto, Form>) {
  // Everything that needs the component instance (composables, watch) is set up before the `await`.
  const fetched = useFetch<Dto[]>(options.url, { key: options.key })
  const { data, refresh } = fetched
  const { busy, run } = useBusyAction(async () => {
    await Promise.all([refresh(), refreshNuxtData(options.refreshKeys)])
  })
  const confirm = useConfirm()

  const forms = ref<Form[]>([])
  const newForm = ref<Form>(options.empty()) as Ref<Form>
  // After a reload, rows with unsaved edits keep them unless they were just saved.
  let built = new Map<number, string>()
  const justSaved = new Set<number>()
  const syncForms = () => {
    const fresh = (data.value ?? []).map(options.toForm)
    forms.value = mergeRows(forms.value as Form[], built, fresh, justSaved)
    built = builtRows(fresh)
    justSaved.clear()
  }
  watch(data, syncForms)
  useDirty(() => [...forms.value as Form[], newForm.value].some(isDirty))
  await fetched
  syncForms()

  /** A row differs from its stored entry (the new row: from the empty one). */
  function isDirty(form: Form): boolean {
    if (!form.id) return !sameValue(form, options.empty())
    const stored = (data.value ?? []).find(entry => options.toForm(entry).id === form.id)
    return !!stored && !sameValue(form, options.toForm(stored))
  }

  async function save(form: Form) {
    if (!isDirty(form)) return
    const body = options.toBody(form)
    if (!body) return
    const id = form.id
    const ok = await run(async () => {
      if (id) {
        await $fetch<unknown>(`${options.url}/${id}`, { method: 'PUT', body })
        justSaved.add(id)
      }
      else await $fetch<unknown>(options.url, { method: 'POST', body })
    }, de.common.saved)
    if (ok && !form.id) newForm.value = options.empty()
  }

  async function remove(form: Form) {
    if (form.id && await confirm(de.childSettings.confirmDeleteType)) run(() => $fetch<unknown>(`${options.url}/${form.id}`, { method: 'DELETE' }), de.common.deleted)
  }

  return { forms, newForm, busy, save, remove, isDirty }
}
