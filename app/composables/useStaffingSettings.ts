import type { StaffingSettingsDto } from '#shared/types/api'

/**
 * Einstellungen → Personalschlüssel of the facility the manager works in, shared by key between the settings section,
 * the group types and the employee page (default shares). null while loading or when it fails (e.g. no facility).
 */
export function useStaffingSettings() {
  return useFetch<StaffingSettingsDto>('/api/staffing-settings', { key: 'staffing-settings' })
}
