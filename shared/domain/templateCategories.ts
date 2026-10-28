import type { Role } from '../types/api'

/**
 * Who sees a category of print templates and the templates in it: everyone who opens the templates (Leitung, Träger,
 * the tablet and Mitarbeiter accounts), only Leitung and Träger, or only the Träger.
 */
export const TEMPLATE_VISIBILITIES = ['all', 'managers', 'provider'] as const
export type TemplateVisibility = typeof TEMPLATE_VISIBILITIES[number]

/** The widest visibility a role sees: the Träger everything, the Leitung all but the Träger's, everyone else 'all'. */
export function templateViewLevel(role: Role): TemplateVisibility {
  if (role === 'provider') return 'provider'
  if (role === 'admin') return 'managers'
  return 'all'
}

/** The visibilities a viewer of the role sees, in catalog order. */
export function visibleTemplateLevels(role: Role): TemplateVisibility[] {
  return TEMPLATE_VISIBILITIES.slice(0, TEMPLATE_VISIBILITIES.indexOf(templateViewLevel(role)) + 1)
}

/** Whether a viewer of the role sees a category of that visibility. */
export function seesTemplateCategory(role: Role, visibility: TemplateVisibility): boolean {
  return visibleTemplateLevels(role).includes(visibility)
}
