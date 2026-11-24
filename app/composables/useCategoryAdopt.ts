import { spansFacilities } from '#shared/domain/documentTargets'
import { categoryPath } from '#shared/domain/templateCategories'
import type { MissingCategoriesDto } from '#shared/types/api'
import { de } from '~/locales/de'
import type { TargetsForm } from '~/utils/documentTargets'
import { errorMessage } from '~/utils/errors'

/**
 * Before saving an item of the Träger for several or all facilities (Vorlagen, „Wissen“, Kontakte): asks the server
 * which facilities of its „Gilt für“ lack its category (› subcategory) and, if any, whether it should be created there.
 * Resolves to true („Ja, dort anlegen“: send `createCategories`), false („Nein“: save as before, „Vom Träger“ there),
 * null (cancelled, or the check failed with a message: do not save) or undefined (nothing to ask).
 */
export function useCategoryAdopt(area: 'print-templates' | 'knowledge' | 'contacts') {
  const ask = useQuestion()
  const toast = useToast()
  return async function decide(targets: TargetsForm, categoryName: string, subcategoryName = ''): Promise<boolean | null | undefined> {
    if (!spansFacilities(targets.scope, targets.facilityIds) || categoryName.trim() === '') return undefined
    let missing: MissingCategoriesDto
    try {
      missing = await $fetch<MissingCategoriesDto>(`/api/${area}/missing-categories`, {
        method: 'POST', body: { scope: targets.scope, facilityIds: targets.facilityIds, categoryName, subcategoryName },
      })
    }
    catch (error) {
      toast.add({ title: errorMessage(error), color: 'error' })
      return null
    }
    if (missing.facilities.length === 0) return undefined
    const t = de.categoryAdopt
    const path = categoryPath(categoryName.trim(), subcategoryName.trim())
    return ask(t.question(path, missing.facilities.map(facility => facility.name)), {
      confirmLabel: t.create, cancelLabel: t.keep, dismissLabel: de.common.cancel, danger: false,
    })
  }
}
