import { describe, expect, it } from 'vitest'
import { setupChecklist, setupItems, type SetupFacts } from '../../shared/domain/setupChecklist'

type Employee = SetupFacts['employees'][number]
const employee = (id: number, over: Partial<Employee> = {}): Employee => ({
  id, name: `E${id}`, hasPin: true, pinLocked: false, hasQualification: true, hasBirthday: true, hasAccount: true, ...over,
})

/** A facility where everything is entered. */
const complete = (over: Partial<SetupFacts> = {}): SetupFacts => ({
  openingHoursEntered: true,
  hasTerminalAccount: true,
  capacitySet: true,
  usesGroupTypes: true,
  timeTrackingOn: true,
  groups: [{ id: 1, name: 'Bären', groupType: 'krippe', documentationOn: true }],
  employees: [employee(1)],
  children: [{ id: 1, name: 'Kind Muster', hasCareType: true }],
  ...over,
})

const keys = (facts: SetupFacts) => setupItems(facts).map(item => item.key)

describe('setup checklist', () => {
  it('has nothing open when everything is entered', () => {
    expect(setupItems(complete())).toEqual([])
    expect(setupChecklist(complete(), { isProvider: true }, [])).toEqual({ open: [], hidden: [] })
  })

  it('lists the facility items until they are entered', () => {
    expect(setupItems(complete({ openingHoursEntered: false }))).toEqual([{
      key: 'opening_hours', area: 'facility', count: 1, names: [], to: '/admin/settings/facility#section-facility-hours', providerOnly: false,
    }])
    expect(keys(complete({ hasTerminalAccount: false }))).toEqual(['terminal_account'])
    expect(setupItems(complete({ capacitySet: false }))).toMatchObject([{ key: 'facility_capacity', providerOnly: true }])
  })

  it('asks for group types only where the state uses them', () => {
    const groups = [{ id: 4, name: 'Bären', groupType: null, documentationOn: true }]
    expect(setupItems(complete({ groups }))).toEqual([{
      key: 'group_type', area: 'facility', count: 1, names: [{ name: 'Bären', to: '/admin/settings/groups/4' }],
      to: '/admin/settings/groups/4', providerOnly: false,
    }])
    expect(keys(complete({ groups, usesGroupTypes: false }))).toEqual([])
  })

  it('asks for PINs only while time tracking is on, and shows locked PINs', () => {
    const employees = [employee(1, { hasPin: false }), employee(2, { pinLocked: true })]
    expect(keys(complete({ employees }))).toEqual(['employee_pin', 'employee_pin_locked'])
    expect(keys(complete({ employees, timeTrackingOn: false }))).toEqual(['employee_pin_locked'])
    expect(setupItems(complete({ employees }))[0]!.names).toEqual([{ name: 'E1', to: '/admin/employees/1?tab=stamping' }])
  })

  it('lists staff without qualification, birthday or access with links to the tab', () => {
    const employees = [employee(1, { hasQualification: false, hasBirthday: false, hasAccount: false })]
    expect(setupItems(complete({ employees })).map(item => [item.key, item.area, item.to])).toEqual([
      ['employee_qualification', 'staff', '/admin/employees/1?tab=qualification'],
      ['employee_birthday', 'staff', '/admin/employees/1?tab=master'],
      ['employee_access', 'staff', '/admin/employees/1?tab=access'],
    ])
  })

  it('counts everyone but names at most five, and links to the list for several', () => {
    const employees = Array.from({ length: 7 }, (_, index) => employee(index + 1, { hasBirthday: false }))
    const [item] = setupItems(complete({ employees }))
    expect(item!.count).toBe(7)
    expect(item!.names.map(entry => entry.name)).toEqual(['E1', 'E2', 'E3', 'E4', 'E5'])
    expect(item!.to).toBe('/admin/employees')
  })

  it('lists children without care type and groups without development documentation', () => {
    const facts = complete({
      children: [{ id: 9, name: 'Mia Muster', hasCareType: false }],
      groups: [{ id: 2, name: 'Igel', groupType: 'krippe', documentationOn: false }],
    })
    expect(setupItems(facts).map(item => [item.key, item.area, item.to])).toEqual([
      ['child_care_type', 'children', '/children/9'],
      ['group_documentation', 'children', '/admin/settings/groups/2'],
    ])
  })

  it('leaves the Träger items out for the Leitung', () => {
    const facts = complete({ capacitySet: false, hasTerminalAccount: false })
    expect(setupChecklist(facts, { isProvider: true }, []).open.map(item => item.key)).toEqual(['terminal_account', 'facility_capacity'])
    expect(setupChecklist(facts, { isProvider: false }, []).open.map(item => item.key)).toEqual(['terminal_account'])
    expect(setupChecklist(facts, { isProvider: false }, ['facility_capacity']).hidden).toEqual([])
  })

  it('moves hidden items out of the open ones', () => {
    const facts = complete({ openingHoursEntered: false, hasTerminalAccount: false })
    const list = setupChecklist(facts, { isProvider: false }, ['terminal_account', 'employee_birthday'])
    expect(list.open.map(item => item.key)).toEqual(['opening_hours'])
    expect(list.hidden.map(item => item.key)).toEqual(['terminal_account'])
  })
})
