import type { StaffingEstimatesDto } from '#shared/types/api'

/**
 * The Personalschlüssel at full occupancy per group and for the facility the settings show, shared by key between the
 * group list and the group's page. Its users refresh it themselves (watchers in GroupStaffingSection and
 * GroupListSection; FacilityGroups after adding or deleting a group).
 */
export function useStaffingEstimate() {
  return useFetch<StaffingEstimatesDto>('/api/staffing/estimate', { key: 'staffing-estimate' })
}
