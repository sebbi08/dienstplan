import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { createEmployee, getEmployee, setContract, setEntitlement } from '../../server/services/employees'
import { listEmployeeListExtras } from '../../server/services/employeeListExtras'
import { markLeaveForfeitRead } from '../../server/services/leaveForfeit'
import { rolePermissions } from '../../server/services/permissions'
import { addRequirementRecord, listRequirementTypes } from '../../server/services/requirements'
import { applyToCells } from '../../server/services/entries'
import type { PermissionKey } from '../../shared/domain/permissions'
import type { SessionUser } from '../../shared/types/api'
import { addEmployee, addFacility, addUser, codeId, createTestDb } from '../helpers/fixtures'

const today = '2026-11-18'
const contract = { personnelNumber: null, employedSince: '2021-03-01', jobKey: 'educator' as const, jobOther: null, payGroup: 'S 8a' as const, payLevel: 3 }

describe('the employee list: next level, mandatory appointments, leave notice per person', () => {
  let db: Db
  let provider: SessionUser
  let anna: number
  let providerRights: ReadonlySet<PermissionKey>
  beforeEach(() => {
    db = createTestDb()
    provider = addUser(db, 'traeger', 'provider')
    providerRights = rolePermissions(db, 'provider')
    anna = createEmployee(db, provider, 1, { name: 'Anna', shortName: 'AN', weeklyMinutes: 2340, validFrom: '2020-01-01' })
  })
  const row = (id: number, viewer: ReadonlySet<PermissionKey> = providerRights, on = today) =>
    listEmployeeListExtras(db, 1, on, viewer).find(extra => extra.employeeId === id)!

  describe('„Nächste Stufe“', () => {
    it('names the next level and its day, later than a month away', () => {
      setContract(db, 1, anna, contract, today)
      expect(row(anna).level).toEqual({ final: false, fromLevel: 3, level: 4, on: '2027-03-01', state: 'later' })
    })
    it('is „soon“ within 30 days and „overdue“ after the day', () => {
      setContract(db, 1, anna, { ...contract, employedSince: '2025-12-10', payLevel: 1 }, today)
      expect(row(anna).level).toEqual({ final: false, fromLevel: 1, level: 2, on: '2026-12-10', state: 'soon' })
      setContract(db, 1, anna, { ...contract, payLevel: 2 }, today) // level 3 was due on 2024-03-01
      expect(row(anna).level).toEqual({ final: false, fromLevel: 2, level: 3, on: '2024-03-01', state: 'overdue' })
    })
    it('says „final“ at the top level and null without a level or a start of employment', () => {
      setContract(db, 1, anna, { ...contract, payLevel: 6 }, today)
      expect(row(anna).level).toEqual({ final: true })
      setContract(db, 1, anna, { ...contract, payLevel: null }, today)
      expect(row(anna).level).toBeNull()
      setContract(db, 1, anna, { ...contract, employedSince: null }, today)
      expect(row(anna).level).toBeNull()
    })
    it('counts from the end of a training in the facility', () => {
      setContract(db, 1, anna, { ...contract, payLevel: 1, trainingUntil: '2026-07-31' }, today)
      expect(row(anna).level).toEqual({ final: false, fromLevel: 1, level: 2, on: '2027-08-01', state: 'later' })
    })
    it('is not sent without „Vertragsangaben ansehen“ (the key is absent)', () => {
      setContract(db, 1, anna, contract, today)
      const leitung = rolePermissions(db, 'admin')
      expect(leitung.has('employees.contractView')).toBe(false)
      expect(row(anna, leitung)).not.toHaveProperty('level')
    })
    it('moves on to the following step once the due level is entered („übernehmen“ sends the contract with the new payLevel)', () => {
      setContract(db, 1, anna, { ...contract, payLevel: 2 }, today)
      const level = row(anna).level
      expect(level).toMatchObject({ final: false, level: 3, state: 'overdue' })
      const detail = getEmployee(db, 1, anna, today, providerRights)
      setContract(db, 1, anna, { ...detail.contract!, payLevel: (level as { level: number }).level }, today)
      expect(row(anna).level).toEqual({ final: false, fromLevel: 3, level: 4, on: '2027-03-01', state: 'later' })
    })
    it('lists no one who left before today', () => {
      const ben = addEmployee(db, 'Ben', { leftOn: '2026-11-01' })
      expect(listEmployeeListExtras(db, 1, today, providerRights).map(extra => extra.employeeId)).toEqual([anna])
      expect(ben).toBeGreaterThan(0)
    })
  })

  describe('„Pflichttermine“', () => {
    const kind = (name: string) => listRequirementTypes(db, 1).find(type => type.name === name)!.id
    it('lists every kind that is overdue, missing or due soon, the worst first', () => {
      addRequirementRecord(db, 1, anna, { typeId: kind('Betriebsarzt'), date: '2024-01-10' }, today) // 24 months: overdue since 2026-01-10
      addRequirementRecord(db, 1, anna, { typeId: kind('Erste-Hilfe-Kurs'), date: '2024-12-20' }, today) // due 2026-12-20: soon
      addRequirementRecord(db, 1, anna, { typeId: kind('Erweitertes Führungszeugnis'), date: '2025-01-01' }, today) // ok
      expect(row(anna).requirements).toEqual([
        { typeId: kind('Betriebsarzt'), typeName: 'Betriebsarzt', state: 'overdue', dueOn: '2026-01-10' },
        { typeId: kind('Masernimpfung (Nachweis)'), typeName: 'Masernimpfung (Nachweis)', state: 'missing', dueOn: null },
        { typeId: kind('Erste-Hilfe-Kurs'), typeName: 'Erste-Hilfe-Kurs', state: 'soon', dueOn: '2026-12-20' },
      ])
    })
    it('is empty when nothing is open', () => {
      for (const type of listRequirementTypes(db, 1)) addRequirementRecord(db, 1, anna, { typeId: type.id, date: '2026-10-01' }, today)
      expect(row(anna).requirements).toEqual([])
    })
    it('comes without the contract right, for everyone who sees the list', () => {
      const leitung = rolePermissions(db, 'admin')
      expect(row(anna, leitung).requirements).toHaveLength(4)
    })
    it('only covers the facility', () => {
      const krippe = addFacility(db, 'Krippe')
      const other = addEmployee(db, 'Fremd', { facilityId: krippe })
      expect(listEmployeeListExtras(db, 1, today, providerRights).map(extra => extra.employeeId)).toEqual([anna])
      expect(listEmployeeListExtras(db, krippe, today, providerRights).map(extra => extra.employeeId)).toEqual([other])
    })
  })

  describe('the leave notice', () => {
    const now = new Date('2026-11-19T10:00:00Z')
    let ben: number
    let annaUser: SessionUser
    beforeEach(() => {
      ben = addEmployee(db, 'Ben', { validFrom: '2020-01-01' })
      setEntitlement(db, 1, anna, 2026, { days: 10, carriedOverDays: 0 })
      setEntitlement(db, 1, ben, 2026, { days: 10, carriedOverDays: 0 })
      annaUser = addUser(db, 'anna', 'observer', anna)
    })

    it('gives „open“ with an account and „no_account“ without one, from 1 October', () => {
      expect(row(anna).forfeit).toEqual({ year: 2026, status: 'open', readAt: null })
      expect(row(ben).forfeit).toEqual({ year: 2026, status: 'no_account', readAt: null })
    })
    it('gives „read“ with the time once the person clicked „Gelesen“', () => {
      markLeaveForfeitRead(db, annaUser, 2026, '2026-11-19', now)
      expect(row(anna, providerRights, '2026-11-19').forfeit).toEqual({ year: 2026, status: 'read', readAt: now.toISOString() })
    })
    it('is null outside the window (before 1 October, after the forfeiture date)', () => {
      expect(row(anna, providerRights, '2026-09-30').forfeit).toBeNull()
      expect(row(anna, providerRights, '2027-03-31').forfeit).toEqual({ year: 2026, status: 'open', readAt: null })
      expect(row(anna, providerRights, '2027-04-01').forfeit).toBeNull()
    })
    it('is null for someone without leave left', () => {
      const sam = addEmployee(db, 'Sam', { validFrom: '2020-01-01' })
      setEntitlement(db, 1, sam, 2026, { days: 1, carriedOverDays: 0 })
      applyToCells(db, provider, 1, [{ employeeId: sam, date: '2026-08-03' }], 'replace', { kind: 'code', codeId: codeId(db, 'vacation') })
      expect(row(sam).forfeit).toBeNull()
    })
    it('is null once the leave is used up, even when the notice was read before', () => {
      const sam = addEmployee(db, 'Sam', { validFrom: '2020-01-01' })
      setEntitlement(db, 1, sam, 2026, { days: 1, carriedOverDays: 0 })
      const samUser = addUser(db, 'sam', 'observer', sam)
      markLeaveForfeitRead(db, samUser, 2026, '2026-11-19', now)
      expect(row(sam, providerRights, '2026-11-19').forfeit).toMatchObject({ status: 'read' })
      applyToCells(db, provider, 1, [{ employeeId: sam, date: '2026-12-01' }], 'replace', { kind: 'code', codeId: codeId(db, 'vacation') })
      expect(row(sam, providerRights, '2026-11-19').forfeit).toBeNull()
    })
    it('is not sent without „Urlaubsübersicht aller“ (the key is absent)', () => {
      const viewer: ReadonlySet<PermissionKey> = new Set<PermissionKey>(['employees.view'])
      expect(row(anna, viewer)).not.toHaveProperty('forfeit')
      expect(row(anna, viewer).requirements).toHaveLength(4)
    })
  })
})

describe('where the notices live now', () => {
  const page = (...parts: string[]) => readFileSync(join(process.cwd(), 'app', 'pages', ...parts), 'utf8')

  it('no longer shows the level-up, appointment or leave notices on the plan pages', () => {
    for (const source of [page('plan', '[year]', '[month].vue'), page('my', 'plan', '[year]', '[month].vue')]) {
      expect(source).not.toMatch(/LevelUpNotice|RequirementNotice|LeaveForfeitNotice/)
    }
  })
  it('keeps the leave notice on „Mein Urlaub“, where it is read and confirmed', () => {
    expect(page('my', 'leave.vue')).toContain('<LeaveForfeitNotice')
  })
  it('replaces the notices above the employee list by columns fed from one request', () => {
    const source = page('admin', 'employees', 'index.vue')
    expect(source).not.toMatch(/LevelUpNotice|RequirementNotice/)
    expect(source).toContain('/api/employees/list-extras')
    expect(source).not.toContain('/api/level-ups')
    expect(source).not.toContain('/api/requirements/due')
    expect(source).toContain('de.employees.nextLevel')
    expect(source).toContain('de.employees.requirementsColumn')
  })
})
