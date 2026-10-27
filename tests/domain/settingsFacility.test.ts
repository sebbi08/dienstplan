import { describe, expect, it } from 'vitest'
import { afterSettingsNavigation, isSettingsPath, leavesSettings, settingsFacilityHeader } from '../../app/utils/settingsFacility'

describe('settings facility header (Träger edits another facility\'s settings)', () => {
  it('knows the settings pages, the areas and the group pages', () => {
    expect(isSettingsPath('/admin/settings')).toBe(true)
    expect(isSettingsPath('/admin/settings/facility')).toBe(true)
    expect(isSettingsPath('/admin/settings/groups/3')).toBe(true)
    expect(isSettingsPath('/admin/settingsx')).toBe(false)
    expect(isSettingsPath('/admin/users')).toBe(false)
    expect(isSettingsPath('/plan/2026/10')).toBe(false)
  })
  it('sends the chosen facility only on a settings page and only when it is not the active one', () => {
    expect(settingsFacilityHeader('/admin/settings/facility', 2, 1)).toBe('2')
    expect(settingsFacilityHeader('/admin/settings/facility', 1, 1)).toBeNull()
    expect(settingsFacilityHeader('/admin/settings/facility', null, 1)).toBeNull()
    expect(settingsFacilityHeader('/plan/2026/10', 2, 1)).toBeNull()
  })
  it('keeps the choice when a navigation out of the settings is refused (unsaved edits stay on screen)', () => {
    expect(afterSettingsNavigation({ toPath: '/plan/2026/10', failed: true, chosen: 2, signedIn: true })).toBe('keep')
  })
  it('keeps the choice within the settings and drops it on really leaving them', () => {
    expect(afterSettingsNavigation({ toPath: '/admin/settings/groups/4', failed: false, chosen: 2, signedIn: true })).toBe('keep')
    expect(afterSettingsNavigation({ toPath: '/plan/2026/10', failed: false, chosen: null, signedIn: true })).toBe('keep')
    expect(afterSettingsNavigation({ toPath: '/plan/2026/10', failed: false, chosen: 2, signedIn: true })).toBe('drop')
  })
  it('drops the choice quietly when signed out (no refetch burst answering 401)', () => {
    expect(afterSettingsNavigation({ toPath: '/login', failed: false, chosen: 2, signedIn: false })).toBe('quietly')
  })
  it('knows which links of the settings lead out of them', () => {
    expect(leavesSettings('/admin/employees/3?tab=contract')).toBe(true)
    expect(leavesSettings('/children/5')).toBe(true)
    expect(leavesSettings('/admin/settings/time-tracking#section-time-tracking')).toBe(false)
    expect(leavesSettings('/admin/settings?x=1')).toBe(false)
  })
})
