import { describe, expect, it } from 'vitest'
import { isSettingsPath, settingsFacilityHeader } from '../../app/utils/settingsFacility'

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
})
