import type { ChildFormsDto } from '#shared/types/api'

/**
 * The child's observation forms (with the viewer's rights and the templates to start one from), shared by the record's
 * sections „Beobachtungen“ and „Elterngespräche“ (one request), and `openRequest`: a form the meetings section asks the
 * „Beobachtungen“ section to open (it clears the request once it handled it).
 */
export function useChildForms(childId: number) {
  const { data, refresh } = useFetch<ChildFormsDto>(`/api/children/${childId}/forms`, {
    key: `child-forms-${childId}`, default: () => ({ forms: [], canCreate: false, templates: [] }),
  })
  const openRequest = useState<number | null>(`child-form-open-${childId}`, () => null)
  return { data, refresh, openRequest }
}
