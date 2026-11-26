import type { Role } from '../types/api'
import type { BundleOverride } from './permissionBundles'
import { isStaffRole } from './roles'

/**
 * „Nur Kinderzahlen (keine Namen, keine Akten)“, a setting of the person (Mitarbeitende → Person → Zugang): whoever has
 * it sees no child data anywhere – at the tablet and with an own account alike – and at the tablet only the names-free
 * numbers of the day („Kinder heute“). It wins over the role's settings and the person's exceptions: these revokes come
 * last. „Kinder: ansehen“ goes, and with it every switch that needs it (Anwesenheit, eintragen und Akten ändern,
 * verwalten, auch mit eigenem Zugang, the child forms, Unfälle verwalten); „Infogespräche führen“ too, since the info
 * visits carry the names of children to come. Everything else stays as the role and the exceptions say.
 */
export const COUNTS_ONLY_OVERRIDES: readonly BundleOverride[] = [
  { bundle: 'childrenView', effect: 'revoke', scope: null },
  { bundle: 'visitsManage', effect: 'revoke', scope: null },
]

/**
 * Whether the setting counts for a person whose rights come from `role` (their active account's role, 'observer' for a
 * person without an active account or a helper from another facility): only for Gruppenleitung and Mitarbeiter. The
 * checkbox is not offered for a Leitung or Träger account; one set before the account became one has no effect.
 */
export function countsOnlyApplies(flag: boolean, role: Role): boolean {
  return flag && isStaffRole(role)
}
