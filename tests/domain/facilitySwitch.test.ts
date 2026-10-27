import { describe, expect, it } from 'vitest'
import { pathAfterFacilitySwitch } from '../../app/utils/facilitySwitch'

describe('pathAfterFacilitySwitch', () => {
  it('stays on the same page of an area', () => {
    expect(pathAfterFacilitySwitch('/plan/2026/10')).toBe('/plan/2026/10')
    expect(pathAfterFacilitySwitch('/admin/employees')).toBe('/admin/employees')
    expect(pathAfterFacilitySwitch('/children')).toBe('/children')
    expect(pathAfterFacilitySwitch('/admin/settings/roster')).toBe('/admin/settings/roster')
    expect(pathAfterFacilitySwitch('/admin/forms')).toBe('/admin/forms')
  })

  it('goes from one record of the old facility to the list of its area', () => {
    expect(pathAfterFacilitySwitch('/admin/employees/12')).toBe('/admin/employees')
    expect(pathAfterFacilitySwitch('/children/5')).toBe('/children')
    expect(pathAfterFacilitySwitch('/cash/3/2026/10')).toBe('/cash')
    expect(pathAfterFacilitySwitch('/team-meetings/4')).toBe('/team-meetings')
    expect(pathAfterFacilitySwitch('/admin/settings/groups/7')).toBe('/admin/settings/groups')
    expect(pathAfterFacilitySwitch('/my/talks/9')).toBe('/my/talks')
  })

  it('drops the query, which may name records of the old facility', () => {
    expect(pathAfterFacilitySwitch('/admin/time?employee=5&year=2026&month=10')).toBe('/admin/time')
    expect(pathAfterFacilitySwitch('/admin/employees/12?tab=talks')).toBe('/admin/employees')
    expect(pathAfterFacilitySwitch('/')).toBe('/')
  })
})
