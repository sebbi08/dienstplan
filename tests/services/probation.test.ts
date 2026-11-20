import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { employees } from '../../server/db/schema'
import { createEmployee, setContract } from '../../server/services/employees'
import { listEmployeeListExtras } from '../../server/services/employeeListExtras'
import { rolePermissions } from '../../server/services/permissions'
import { probationReminders } from '../../server/services/probation'
import { listReminders } from '../../server/services/reminders'
import { setRoleBundle } from '../../server/services/rights'
import type { PermissionKey } from '../../shared/domain/permissions'
import type { SessionUser } from '../../shared/types/api'
import { addUser, asChildViewer, createTestDb } from '../helpers/fixtures'

const contract = { personnelNumber: null, employedSince: '2026-07-01', jobKey: 'educator' as const, jobOther: null, payGroup: 'S 8a' as const, payLevel: 1 }

describe('Probezeit: reminder and the employee list', () => {
  let db: Db
  let provider: SessionUser
  let anna: number
  beforeEach(() => {
    db = createTestDb()
    provider = addUser(db, 'traeger', 'provider')
    anna = createEmployee(db, provider, 1, { name: 'Anna Muster', shortName: '', weeklyMinutes: 2340, validFrom: '2026-07-01' })
    setContract(db, 1, anna, { ...contract, probationUntil: '2026-12-31' }, '2026-11-19')
  })
  const viewer = (permissions: ReadonlySet<PermissionKey>, onTablet = false) => ({ facilityId: 1, permissions, onTablet })
  const remindedOn = (today: string, permissions = rolePermissions(db, 'provider')) =>
    probationReminders(db, viewer(permissions), today).map(item => [item.state, item.date, item.name])

  it('reminds from 28 days before through the last day, none after', () => {
    expect(remindedOn('2026-12-02')).toEqual([])
    expect(remindedOn('2026-12-03')).toEqual([['upcoming', '2026-12-31', 'Anna Muster']])
    expect(remindedOn('2026-12-31')).toEqual([['today', '2026-12-31', 'Anna Muster']])
    expect(remindedOn('2027-01-01')).toEqual([])
    expect(probationReminders(db, viewer(rolePermissions(db, 'provider')), '2026-12-10')[0]).toMatchObject({
      kind: 'probation', childId: null, canDone: false, probation: { employeeId: anna },
    })
  })

  it('reminds whoever sees the contract data: the Träger, the Leitung only with „Vertragsangaben ansehen“; never at the tablet', () => {
    expect(remindedOn('2026-12-10', rolePermissions(db, 'admin'))).toEqual([])
    expect(remindedOn('2026-12-10', rolePermissions(db, 'observer'))).toEqual([])
    setRoleBundle(db, 'admin', 'contractView', true)
    expect(remindedOn('2026-12-10', rolePermissions(db, 'admin'))).toHaveLength(1)
    expect(probationReminders(db, viewer(rolePermissions(db, 'provider'), true), '2026-12-10')).toEqual([])
  })

  it('is part of the box „Erinnerungen“', () => {
    expect(listReminders(db, asChildViewer(provider), '2026-12-10').filter(item => item.kind === 'probation').map(item => item.name))
      .toEqual(['Anna Muster'])
  })

  it('does not remind of someone who leaves before the probation period ends, nor without a date', () => {
    db.update(employees).set({ leftOn: '2026-12-15' }).where(eq(employees.id, anna)).run()
    expect(remindedOn('2026-12-10')).toEqual([])
    db.update(employees).set({ leftOn: null, probationUntil: null }).where(eq(employees.id, anna)).run()
    expect(remindedOn('2026-12-10')).toEqual([])
  })

  it('shows „in Probezeit bis …“ in the list while it runs, only with the contract data', () => {
    const extras = (today: string, permissions = rolePermissions(db, 'provider')) =>
      listEmployeeListExtras(db, 1, today, permissions).find(row => row.employeeId === anna)!
    expect(extras('2026-11-19').probationUntil).toBe('2026-12-31')
    expect(extras('2026-12-31').probationUntil).toBe('2026-12-31')
    expect(extras('2027-01-01').probationUntil).toBeNull()
    expect(extras('2026-11-19', rolePermissions(db, 'admin'))).not.toHaveProperty('probationUntil')
  })
})
