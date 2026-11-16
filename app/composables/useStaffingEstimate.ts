import type { StaffingEstimatesDto } from '#shared/types/api'

/**
 * The Personalschlüssel at full occupancy per group and for the facility the settings show, shared by key between the
 * group list and the group's page; the group type, places and opening hours sections refresh it after a change.
 */
export function useStaffingEstimate() {
  return useFetch<StaffingEstimatesDto>('/api/staffing/estimate', { key: 'staffing-estimate' })
}
