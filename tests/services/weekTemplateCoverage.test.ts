import { describe, expect, it } from 'vitest'
import { coverageRules } from '../../server/db/schema'
import { setFacilityOpeningHours, setGroupOpeningHours } from '../../server/services/openingHours'
import { loadCoverageRules } from '../../server/services/queries'
import { createCoverageRule } from '../../server/services/settings'
import { weekTemplateCoverage } from '../../server/services/weekTemplates'
import { addFacility, addGroup, createTestDb } from '../helpers/fixtures'

describe('what the week template editor checks a template against', () => {
  it('gives the plan\'s active Pflichtdienste (group rules named) and opening hours of the own facility only', () => {
    const db = createTestDb()
    const baeren = addGroup(db, 1, 'Bären')
    const other = addFacility(db, 'Zweite Kita')
    const groupRule = createCoverageRule(db, 1, { label: 'Früh Bären', start: 420, end: null, minCount: 1, active: true, groupId: baeren })
    createCoverageRule(db, 1, { label: 'aus', start: 480, end: null, minCount: 1, active: false })
    const open = { open: 390, close: 1020, closed: false }
    setFacilityOpeningHours(db, 1, { days: [open, open, open, open, open], minAtOpening: 2, minAtClosing: 1 })
    setGroupOpeningHours(db, 1, baeren, { days: [open, open, open, open, { open: null, close: null, closed: true }], minAtOpening: 1, minAtClosing: 1 })

    const coverage = weekTemplateCoverage(db, 1)
    const active = loadCoverageRules(db, 1)
    expect(coverage.rules.map(rule => rule.id)).toEqual(active.map(rule => rule.id))
    expect(coverage.rules.find(rule => rule.label === 'aus')).toBeUndefined()
    expect(coverage.rules.find(rule => rule.id === groupRule.id)).toMatchObject({ groupId: baeren, groupName: 'Bären' })
    expect(coverage.hours.facility).toMatchObject({ minAtOpening: 2, days: [open, open, open, open, open] })
    expect(coverage.hours.groups).toEqual([expect.objectContaining({ groupId: baeren, groupName: 'Bären' })])
    // The other facility's rules (copies of the first one's) are not among them.
    const otherIds = new Set(db.select({ id: coverageRules.id, facilityId: coverageRules.facilityId }).from(coverageRules).all()
      .filter(row => row.facilityId === other).map(row => row.id))
    expect(coverage.rules.some(rule => otherIds.has(rule.id))).toBe(false)
  })
})
