import { describe, expect, it } from 'vitest'
import {
  AREA_SECTIONS, FORMER_SECTIONS, GROUP_SECTIONS, SETTINGS_AREAS, areaOfSlug, areaPath, normalizeSearch, searchSettings,
  visibleSettingsAreas, type SettingsViewer,
} from '../../app/utils/settingsAreas'
import { effectivePermissions } from '../../shared/domain/permissionBundles'

/** The role's default permissions, as the session hands them over. */
function viewerOf(role: 'provider' | 'admin'): SettingsViewer {
  const permissions = effectivePermissions({ role })
  return { can: key => permissions.has(key) }
}
const provider = viewerOf('provider')
const leitung = viewerOf('admin')

const keysOf = (viewer: SettingsViewer) => visibleSettingsAreas(viewer).map(entry => [entry.area, entry.sections.map(section => section.key)])

describe('visibleSettingsAreas', () => {
  it('shows the Träger every area and section', () => {
    expect(keysOf(provider)).toEqual([
      ['facility', ['facilities', 'facility-contact', 'facility-hours', 'tablet', 'retention', 'backup']],
      ['groups', ['group-list']],
      ['roster', ['shift-templates', 'week-templates', 'codes', 'coverage-rules', 'requirement-types', 'leave-module', 'leave-counting', 'leave-forfeit']],
      ['time', ['time-tracking']],
      ['children', ['care-types', 'document-types', 'consent-questions', 'overview-sheets', 'school-children', 'school-districts', 'attendance', 'ifsg', 'ifsg-local', 'reminders']],
      ['staff', ['staffing', 'employee-retention', 'child-sick-days', 'bem-invitation', 'parental-leave']],
    ])
  })

  it('hides the Träger-only sections from the Leitung (Einrichtungen, Löschfrist, Datensicherung, Urlaubsanträge)', () => {
    expect(keysOf(leitung)).toEqual([
      ['facility', ['facility-contact', 'facility-hours', 'tablet']],
      ['groups', ['group-list']],
      ['roster', ['shift-templates', 'week-templates', 'codes', 'coverage-rules', 'requirement-types', 'leave-counting', 'leave-forfeit']],
      ['time', ['time-tracking']],
      ['children', ['care-types', 'document-types', 'consent-questions', 'overview-sheets', 'school-children', 'school-districts', 'attendance', 'ifsg', 'ifsg-local', 'reminders']],
      ['staff', ['staffing', 'employee-retention', 'child-sick-days', 'bem-invitation']],
    ])
  })

  it('gives each area its own address', () => {
    expect(visibleSettingsAreas(provider).map(entry => entry.path)).toEqual([
      '/admin/settings/facility', '/admin/settings/groups', '/admin/settings/roster', '/admin/settings/time-tracking',
      '/admin/settings/children', '/admin/settings/staff',
    ])
    for (const area of SETTINGS_AREAS) expect(areaOfSlug(areaPath(area).split('/').pop())).toBe(area)
    expect(areaOfSlug('unknown')).toBeNull()
    expect(areaOfSlug(undefined)).toBeNull()
  })
})

describe('the former sections', () => {
  const all = [...Object.values(AREA_SECTIONS).flat(), ...GROUP_SECTIONS]

  it('are each reachable in exactly one place', () => {
    const replaced = all.flatMap(section => section.replaces)
    for (const former of FORMER_SECTIONS) expect(replaced.filter(key => key === former), former).toHaveLength(1)
    expect(replaced).toHaveLength(FORMER_SECTIONS.length)
  })

  it('are all reachable for the Träger (the Leitung misses only the Träger-only ones)', () => {
    const replacedFor = (viewer: SettingsViewer) => new Set([
      ...visibleSettingsAreas(viewer).flatMap(entry => entry.sections.flatMap(section => section.replaces)),
      ...GROUP_SECTIONS.flatMap(section => section.replaces),
    ])
    expect([...replacedFor(provider)].sort()).toEqual([...FORMER_SECTIONS].sort())
    expect(FORMER_SECTIONS.filter(key => !replacedFor(leitung).has(key)).sort()).toEqual(['backup', 'facilities', 'leave-module', 'retention'])
  })

  it('have unique section keys', () => {
    const keys = all.map(section => section.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('searchSettings', () => {
  const firstHit = (query: string, viewer = provider) => searchSettings(query, viewer)[0]

  it('finds Anwesenheit & Essen by „Snack“ and „Essen“', () => {
    expect(firstHit('Snack')).toMatchObject({ key: 'attendance', where: 'Kinder', to: '/admin/settings/children#section-attendance' })
    expect(firstHit('essen')?.key).toBe('attendance')
  })

  it('finds the notice on remaining leave by „Resturlaub“ and „verfällt“, for the Leitung too', () => {
    expect(firstHit('Resturlaub')).toMatchObject({ key: 'leave-forfeit', to: '/admin/settings/roster#section-leave-forfeit' })
    expect(firstHit('verfällt', leitung)?.key).toBe('leave-forfeit')
  })

  it('finds the Schulbezirke by „Schulbezirk“ and „Straßenliste“, for the Leitung too', () => {
    expect(firstHit('Schulbezirk')).toMatchObject({ key: 'school-districts', to: '/admin/settings/children#section-school-districts' })
    expect(firstHit('Straßenliste', leitung)?.key).toBe('school-districts')
  })

  it('finds the Tablet by „PIN“', () => {
    expect(firstHit('PIN')).toMatchObject({ key: 'tablet', to: '/admin/settings/facility#section-tablet' })
    expect(firstHit('pin', leitung)?.key).toBe('tablet')
  })

  const facility = { groups: [{ id: 4, name: 'Bären' }], hasGroupTypes: true }

  it('leads „Farbe“ to the groups', () => {
    expect(searchSettings('Farbe', provider, facility)[0]).toMatchObject({ key: 'group-color', to: '/admin/settings/groups#section-group-list' })
  })

  it('offers the sections of a group\'s page only when the facility has groups, the Gruppenart only with group types', () => {
    expect(searchSettings('Farbe', provider).map(hit => hit.key)).not.toContain('group-color')
    expect(searchSettings('Öffnungszeiten', provider).map(hit => hit.key)).toEqual(['facility-hours'])
    expect(searchSettings('Gruppenart', provider, facility).map(hit => hit.key)).toContain('group-type')
    expect(searchSettings('Gruppenart', provider, { ...facility, hasGroupTypes: false }).map(hit => hit.key)).not.toContain('group-type')
    expect(searchSettings('Farbe', provider, { ...facility, hasGroupTypes: false }).map(hit => hit.key)).toContain('group-color')
  })

  it('prefers a name starting with the text over one containing it and over a keyword', () => {
    expect(searchSettings('Codes', provider).map(hit => hit.key)[0]).toBe('codes')
    expect(searchSettings('Öffnungszeiten', provider, facility).map(hit => hit.key)).toEqual(['facility-hours', 'group-hours'])
  })

  it('ignores case and umlauts', () => {
    expect(normalizeSearch('Schließung ÄÖÜ')).toBe('schliessung aou')
    expect(firstHit('oeffnung')).toBeUndefined()
    expect(firstHit('offnungszeiten')?.key).toBe('facility-hours')
    expect(firstHit('LÖSCHFRIST')?.key).toBe('retention')
  })

  it('finds the Löschfristen of the staff for the Träger and the Leitung (who only reads them)', () => {
    for (const viewer of [provider, leitung]) {
      expect(searchSettings('ausgezahlt', viewer)[0]).toMatchObject({ key: 'employee-retention', where: 'Personal', to: '/admin/settings/staff#section-employee-retention' })
      expect(searchSettings('Löschfristen', viewer).map(hit => hit.key)).toContain('employee-retention')
    }
  })

  it('finds the Kinderkrankentage of the staff for the Träger and the Leitung (who only reads them)', () => {
    for (const viewer of [provider, leitung]) {
      expect(searchSettings('Kind krank', viewer)[0]).toMatchObject({ key: 'child-sick-days', where: 'Personal', to: '/admin/settings/staff#section-child-sick-days' })
      expect(searchSettings('Kinderkrankentage', viewer).map(hit => hit.key)).toContain('child-sick-days')
expect(searchSettings('BEM', viewer)[0]).toMatchObject({ key: 'bem-invitation', where: 'Personal', to: '/admin/settings/staff#section-bem-invitation' })
    }
  })

  it('does not offer Träger-only sections to the Leitung', () => {
    expect(searchSettings('Datensicherung', provider).map(hit => hit.key)).toContain('backup')
    expect(searchSettings('Datensicherung', leitung).map(hit => hit.key)).not.toContain('backup')
    expect(searchSettings('Urlaubsanträge', leitung).map(hit => hit.key)).not.toContain('leave-module')
  })

  it('finds a group by its name and opens its page', () => {
    const groups = [{ id: 4, name: 'Bären' }, { id: 7, name: 'Füchse' }]
    expect(searchSettings('bär', leitung, { groups })).toEqual([{ key: 'group-4', title: 'Bären', where: 'Gruppen · Seite der Gruppe', to: '/admin/settings/groups/4' }])
  })

  it('needs at least two letters', () => {
    expect(searchSettings('', provider)).toEqual([])
    expect(searchSettings(' e ', provider)).toEqual([])
  })
})
