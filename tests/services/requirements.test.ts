import { asc, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../server/db/client'
import { employeeRequirements, employeeTrainings, employees, requirementTypes } from '../../server/db/schema'
import { moveEmployeeToFacility } from '../../server/services/employees'
import {
  addRequirementRecord, addTraining, createRequirementType, deleteRequirementRecord, deleteRequirementType, deleteTraining,
  getEmployeeRequirements, getMyRequirements, listDueRequirements, listRequirementTypes, updateRequirementType, updateTraining,
} from '../../server/services/requirements'
import {
  addEmployee, addFacility, addHelpOut, addUser, createTestDb, errorCode, requirementTypeId,
} from '../helpers/fixtures'

const today = '2026-10-12'

const BUILTINS = [
  { name: 'Betriebsarzt', intervalMonths: 24, builtinKey: 'company_doctor', sortOrder: 0 },
  { name: 'Erste-Hilfe-Kurs', intervalMonths: 24, builtinKey: 'first_aid', sortOrder: 1 },
  { name: 'Erweitertes Führungszeugnis', intervalMonths: 60, builtinKey: 'criminal_record', sortOrder: 2 },
  { name: 'Masernimpfung (Nachweis)', intervalMonths: null, builtinKey: 'measles', sortOrder: 3 },
]

/** Everything the feature stores, to prove that a refused call changed nothing. */
function stored(db: Db) {
  return {
    types: db.select().from(requirementTypes).orderBy(asc(requirementTypes.id)).all(),
    records: db.select().from(employeeRequirements).orderBy(asc(employeeRequirements.id)).all(),
    trainings: db.select().from(employeeTrainings).orderBy(asc(employeeTrainings.id)).all(),
  }
}

describe('kinds of mandatory appointments', () => {
  let db: Db
  beforeEach(() => {
    db = createTestDb()
  })

  const withoutIds = (facilityId: number) => listRequirementTypes(db, facilityId).map(({ id: _id, ...rest }) => rest)

  it('has the four built-in kinds in the first facility and in every new one', () => {
    expect(withoutIds(1)).toEqual(BUILTINS)
    // A new facility starts with the defaults, whatever the first facility made of its own kinds.
    updateRequirementType(db, 1, requirementTypeId(db, 'first_aid'), { name: 'Erste Hilfe am Kind', intervalMonths: 12 })
    createRequirementType(db, 1, { name: 'Hygienebelehrung', intervalMonths: 24 })
    const krippe = addFacility(db, 'Krippe')
    expect(withoutIds(krippe)).toEqual(BUILTINS)
    const ownIds = listRequirementTypes(db, 1).map(type => type.id)
    expect(listRequirementTypes(db, krippe).filter(type => ownIds.includes(type.id))).toEqual([])
    expect(withoutIds(1).map(type => type.name))
      .toEqual(['Betriebsarzt', 'Erste Hilfe am Kind', 'Erweitertes Führungszeugnis', 'Masernimpfung (Nachweis)', 'Hygienebelehrung'])
  })

  it('creates own kinds at the end, recurring or needed once', () => {
    const hygiene = createRequirementType(db, 1, { name: '  Hygienebelehrung ', intervalMonths: 24 })
    expect(hygiene).toEqual({ id: hygiene.id, name: 'Hygienebelehrung', intervalMonths: 24, builtinKey: null, sortOrder: 4 })
    const licence = createRequirementType(db, 1, { name: 'Führerschein', intervalMonths: null })
    expect(licence).toEqual({ id: licence.id, name: 'Führerschein', intervalMonths: null, builtinKey: null, sortOrder: 5 })
    expect(listRequirementTypes(db, 1).slice(4)).toEqual([hygiene, licence])
  })

  it('refuses empty names and names taken in the facility in any spelling, umlauts included', () => {
    const krippe = addFacility(db, 'Krippe')
    createRequirementType(db, 1, { name: 'Führerschein', intervalMonths: null })
    const before = stored(db)
    expect(errorCode(() => createRequirementType(db, 1, { name: '   ', intervalMonths: 12 }))).toBe('requirement_name_required')
    expect(errorCode(() => createRequirementType(db, 1, { name: 'FÜHRERSCHEIN', intervalMonths: 12 }))).toBe('requirement_name_taken')
    expect(errorCode(() => createRequirementType(db, 1, { name: ' führerschein ', intervalMonths: 12 }))).toBe('requirement_name_taken')
    // A built-in kind's name is taken as well.
    expect(errorCode(() => createRequirementType(db, 1, { name: 'betriebsarzt', intervalMonths: 12 }))).toBe('requirement_name_taken')
    expect(stored(db)).toEqual(before)
    // Names are unique per facility only.
    expect(createRequirementType(db, krippe, { name: 'Führerschein', intervalMonths: 12 }).sortOrder).toBe(4)
  })

  it('renames a kind and changes its interval, built-in ones included', () => {
    const doctor = requirementTypeId(db, 'company_doctor')
    updateRequirementType(db, 1, doctor, { name: ' Arbeitsmedizinische Vorsorge ', intervalMonths: 36 })
    expect(listRequirementTypes(db, 1)[0]).toEqual({
      id: doctor, name: 'Arbeitsmedizinische Vorsorge', intervalMonths: 36, builtinKey: 'company_doctor', sortOrder: 0,
    })
    // A recurring kind becomes one needed once, and the other way round.
    updateRequirementType(db, 1, doctor, { name: 'Arbeitsmedizinische Vorsorge', intervalMonths: null })
    expect(listRequirementTypes(db, 1)[0]).toMatchObject({ intervalMonths: null, builtinKey: 'company_doctor' })
    const measles = requirementTypeId(db, 'measles')
    updateRequirementType(db, 1, measles, { name: 'Masernimpfung (Nachweis)', intervalMonths: 120 })
    expect(listRequirementTypes(db, 1)[3]).toMatchObject({ intervalMonths: 120, builtinKey: 'measles' })

    const own = createRequirementType(db, 1, { name: 'Hygienebelehrung', intervalMonths: 24 })
    updateRequirementType(db, 1, own.id, { name: 'HYGIENEBELEHRUNG', intervalMonths: 12 }) // its own name in another spelling
    expect(listRequirementTypes(db, 1)[4]).toEqual({ ...own, name: 'HYGIENEBELEHRUNG', intervalMonths: 12 })

    const before = stored(db)
    expect(errorCode(() => updateRequirementType(db, 1, own.id, { name: 'erste-hilfe-kurs', intervalMonths: 12 }))).toBe('requirement_name_taken')
    expect(errorCode(() => updateRequirementType(db, 1, doctor, { name: 'Hygienebelehrung', intervalMonths: 12 }))).toBe('requirement_name_taken')
    expect(errorCode(() => updateRequirementType(db, 1, own.id, { name: '  ', intervalMonths: 12 }))).toBe('requirement_name_required')
    expect(errorCode(() => updateRequirementType(db, 1, 999, { name: 'Neu', intervalMonths: 12 }))).toBe('requirement_type_not_found')
    expect(stored(db)).toEqual(before)
  })

  it('deletes an own kind with its records and nothing else', () => {
    const anna = addEmployee(db, 'Anna')
    const ben = addEmployee(db, 'Ben')
    const hygiene = createRequirementType(db, 1, { name: 'Hygienebelehrung', intervalMonths: 24 })
    const fire = createRequirementType(db, 1, { name: 'Brandschutz', intervalMonths: 36 })
    const doctor = requirementTypeId(db, 'company_doctor')
    addRequirementRecord(db, 1, anna, { typeId: hygiene.id, date: '2025-03-01' }, today)
    addRequirementRecord(db, 1, anna, { typeId: hygiene.id, date: '2026-03-01' }, today)
    addRequirementRecord(db, 1, ben, { typeId: hygiene.id, date: '2026-04-01' }, today)
    const kept = [
      addRequirementRecord(db, 1, anna, { typeId: fire.id, date: '2026-05-01' }, today),
      addRequirementRecord(db, 1, anna, { typeId: doctor, date: '2026-06-01' }, today),
      addRequirementRecord(db, 1, ben, { typeId: doctor, date: '2026-07-01' }, today),
    ]
    const training = addTraining(db, 1, anna, { date: '2026-02-02', title: 'Hygiene in der Kita' })

    deleteRequirementType(db, 1, hygiene.id)

    expect(listRequirementTypes(db, 1).map(type => type.id))
      .toEqual([...['company_doctor', 'first_aid', 'criminal_record', 'measles'].map(key => requirementTypeId(db, key)), fire.id])
    expect(stored(db).records.map(record => record.id)).toEqual(kept)
    expect(stored(db).trainings.map(row => row.id)).toEqual([training])
    expect(db.select().from(employees).all()).toHaveLength(2)
    expect(errorCode(() => deleteRequirementType(db, 1, hygiene.id))).toBe('requirement_type_not_found')
  })

  it('refuses to delete a built-in kind, also when renamed', () => {
    const anna = addEmployee(db, 'Anna')
    const doctor = requirementTypeId(db, 'company_doctor')
    addRequirementRecord(db, 1, anna, { typeId: doctor, date: '2026-06-01' }, today)
    updateRequirementType(db, 1, doctor, { name: 'Vorsorge', intervalMonths: null })
    const before = stored(db)
    for (const key of ['company_doctor', 'first_aid', 'criminal_record', 'measles']) {
      expect(errorCode(() => deleteRequirementType(db, 1, requirementTypeId(db, key))), key).toBe('requirement_builtin')
    }
    expect(stored(db)).toEqual(before)
  })
})

describe('records and trainings of an employee', () => {
  let db: Db
  let anna: number
  let doctor: number
  let measles: number
  beforeEach(() => {
    db = createTestDb()
    anna = addEmployee(db, 'Anna')
    doctor = requirementTypeId(db, 'company_doctor')
    measles = requirementTypeId(db, 'measles')
  })

  const kind = (employeeId: number, typeId: number, on = today) =>
    getEmployeeRequirements(db, 1, employeeId, on).kinds.find(entry => entry.type.id === typeId)!

  it('lists every kind of the facility as missing for a new employee', () => {
    const own = createRequirementType(db, 1, { name: 'Hygienebelehrung', intervalMonths: 24 })
    const result = getEmployeeRequirements(db, 1, anna, today)
    expect(result.trainings).toEqual([])
    expect(result.kinds.map(entry => entry.type)).toEqual(listRequirementTypes(db, 1))
    expect(result.kinds.map(entry => entry.type.id)).toContain(own.id)
    for (const entry of result.kinds) {
      expect(entry).toEqual({ type: entry.type, state: 'missing', lastDate: null, dueOn: null, records: [] })
    }
  })

  it('adds records as a history in which the newest date counts', () => {
    const first = addRequirementRecord(db, 1, anna, { typeId: doctor, date: '2024-10-12', note: '  Dr. Sommer ' }, today)
    expect(kind(anna, doctor)).toEqual({
      type: listRequirementTypes(db, 1)[0], state: 'overdue', lastDate: '2024-10-12', dueOn: '2026-10-12',
      records: [{ id: first, date: '2024-10-12', note: 'Dr. Sommer' }],
    })
    // An older record entered later joins the history, but does not count.
    const older = addRequirementRecord(db, 1, anna, { typeId: doctor, date: '2022-09-01', note: '   ' }, today)
    expect(kind(anna, doctor)).toMatchObject({ state: 'overdue', lastDate: '2024-10-12', dueOn: '2026-10-12' })
    const newest = addRequirementRecord(db, 1, anna, { typeId: doctor, date: '2026-10-05' }, today)
    expect(kind(anna, doctor)).toEqual({
      type: listRequirementTypes(db, 1)[0], state: 'ok', lastDate: '2026-10-05', dueOn: '2028-10-05',
      records: [
        { id: newest, date: '2026-10-05', note: null }, { id: first, date: '2024-10-12', note: 'Dr. Sommer' },
        { id: older, date: '2022-09-01', note: null },
      ],
    })
    // The other kinds and other employees are untouched.
    expect(kind(anna, measles)).toMatchObject({ state: 'missing', records: [] })
    expect(kind(addEmployee(db, 'Ben'), doctor)).toMatchObject({ state: 'missing', records: [] })
  })

  it('follows the state rules: soon within two months, once is done for good, the interval can change', () => {
    addRequirementRecord(db, 1, anna, { typeId: doctor, date: '2024-12-12' }, today)
    expect(kind(anna, doctor)).toMatchObject({ state: 'soon', dueOn: '2026-12-12' })
    expect(kind(anna, doctor, '2026-10-11')).toMatchObject({ state: 'ok', dueOn: '2026-12-12' })
    expect(kind(anna, doctor, '2026-12-12')).toMatchObject({ state: 'overdue', dueOn: '2026-12-12' })
    addRequirementRecord(db, 1, anna, { typeId: measles, date: '2015-04-01' }, today)
    expect(kind(anna, measles)).toMatchObject({ state: 'ok', lastDate: '2015-04-01', dueOn: null })
    updateRequirementType(db, 1, doctor, { name: 'Betriebsarzt', intervalMonths: 36 })
    expect(kind(anna, doctor)).toMatchObject({ state: 'ok', dueOn: '2027-12-12' })
  })

  it('deletes a single record, after which the one before counts again', () => {
    const first = addRequirementRecord(db, 1, anna, { typeId: doctor, date: '2024-10-12' }, today)
    const second = addRequirementRecord(db, 1, anna, { typeId: doctor, date: '2026-10-05' }, today)
    deleteRequirementRecord(db, 1, second)
    expect(kind(anna, doctor)).toMatchObject({ state: 'overdue', lastDate: '2024-10-12', records: [{ id: first, date: '2024-10-12', note: null }] })
    deleteRequirementRecord(db, 1, first)
    expect(kind(anna, doctor)).toMatchObject({ state: 'missing', lastDate: null, records: [] })
    expect(errorCode(() => deleteRequirementRecord(db, 1, first))).toBe('requirement_not_found')
    expect(errorCode(() => deleteRequirementRecord(db, 1, 999))).toBe('requirement_not_found')
  })

  it('refuses records for unknown employees or kinds and impossible dates', () => {
    expect(errorCode(() => addRequirementRecord(db, 1, 999, { typeId: doctor, date: today }, today))).toBe('employee_not_found')
    expect(errorCode(() => addRequirementRecord(db, 1, anna, { typeId: 999, date: today }, today))).toBe('requirement_type_not_found')
    for (const bad of ['2026-02-30', '2026-13-01', '12.10.2026', '']) {
      expect(errorCode(() => addRequirementRecord(db, 1, anna, { typeId: doctor, date: bad }, today)), bad).toBe('invalid_date')
    }
    expect(errorCode(() => getEmployeeRequirements(db, 1, 999, today))).toBe('employee_not_found')
    expect(stored(db).records).toEqual([])
  })

  it('refuses a record dated after today, for recurring kinds and kinds needed once alike', () => {
    expect(errorCode(() => addRequirementRecord(db, 1, anna, { typeId: doctor, date: '2026-10-13' }, today))).toBe('date_in_future')
    expect(errorCode(() => addRequirementRecord(db, 1, anna, { typeId: measles, date: '2026-10-13' }, today))).toBe('date_in_future')
    expect(errorCode(() => addRequirementRecord(db, 1, anna, { typeId: doctor, date: '2027-01-01' }, today))).toBe('date_in_future')
    expect(stored(db).records).toEqual([])
    // Today itself is fine, and so is the day that was refused once it has come.
    const onTheDay = addRequirementRecord(db, 1, anna, { typeId: doctor, date: today }, today)
    const dayLater = addRequirementRecord(db, 1, anna, { typeId: doctor, date: '2026-10-13' }, '2026-10-13')
    expect(kind(anna, doctor).records).toEqual([{ id: dayLater, date: '2026-10-13', note: null }, { id: onTheDay, date: today, note: null }])
    // The other refusals come first: nothing is said about the date of an unknown employee or kind.
    expect(errorCode(() => addRequirementRecord(db, 1, 999, { typeId: doctor, date: '2027-01-01' }, today))).toBe('employee_not_found')
    expect(errorCode(() => addRequirementRecord(db, 1, anna, { typeId: 999, date: '2027-01-01' }, today))).toBe('requirement_type_not_found')
  })

  it('refuses records and trainings dated before 1900, so a mistyped year cannot settle a kind for good', () => {
    const training = addTraining(db, 1, anna, { date: '2026-03-10', title: 'Sprachförderung' })
    const before = stored(db)
    for (const bad of ['0202-10-05', '0001-01-01', '1899-12-31']) {
      expect(errorCode(() => addRequirementRecord(db, 1, anna, { typeId: doctor, date: bad }, today)), bad).toBe('invalid_date')
      expect(errorCode(() => addRequirementRecord(db, 1, anna, { typeId: measles, date: bad }, today)), bad).toBe('invalid_date')
      expect(errorCode(() => addTraining(db, 1, anna, { date: bad, title: 'Kinderschutz' })), bad).toBe('invalid_date')
      expect(errorCode(() => updateTraining(db, 1, training, { date: bad, title: 'Sprachförderung' })), bad).toBe('invalid_date')
    }
    expect(stored(db)).toEqual(before)
    expect(kind(anna, measles)).toMatchObject({ state: 'missing' })
    // The first day that counts is accepted.
    addRequirementRecord(db, 1, anna, { typeId: measles, date: '1900-01-01' }, today)
    expect(kind(anna, measles)).toMatchObject({ state: 'ok', lastDate: '1900-01-01' })
    updateTraining(db, 1, training, { date: '1900-01-01', title: 'Sprachförderung' })
    expect(getEmployeeRequirements(db, 1, anna, today).trainings.map(entry => entry.date)).toEqual(['1900-01-01'])
  })

  it('accepts trainings that are still to come', () => {
    const planned = addTraining(db, 1, anna, { date: '2027-02-15', title: 'Kinderschutz' })
    const moved = addTraining(db, 1, anna, { date: '2026-09-01', title: 'Sprachförderung' })
    updateTraining(db, 1, moved, { date: '2026-12-01', title: 'Sprachförderung' })
    expect(getEmployeeRequirements(db, 1, anna, today).trainings.map(training => [training.id, training.date]))
      .toEqual([[planned, '2027-02-15'], [moved, '2026-12-01']])
  })

  it('adds, changes and deletes trainings, listed newest first', () => {
    const spring = addTraining(db, 1, anna, { date: '2026-03-10', title: '  Sprachförderung ', note: ' 2 Tage, VHS ' })
    const autumn = addTraining(db, 1, anna, { date: '2026-09-21', title: 'Kinderschutz' })
    const sameDay = addTraining(db, 1, anna, { date: '2026-09-21', title: 'Erste Hilfe am Kind', note: '' })
    expect(getEmployeeRequirements(db, 1, anna, today).trainings).toEqual([
      { id: sameDay, date: '2026-09-21', title: 'Erste Hilfe am Kind', note: null },
      { id: autumn, date: '2026-09-21', title: 'Kinderschutz', note: null },
      { id: spring, date: '2026-03-10', title: 'Sprachförderung', note: '2 Tage, VHS' },
    ])

    updateTraining(db, 1, spring, { date: '2026-10-01', title: ' Sprachbildung ', note: null })
    expect(getEmployeeRequirements(db, 1, anna, today).trainings.map(training => [training.id, training.date, training.title, training.note]))
      .toEqual([[spring, '2026-10-01', 'Sprachbildung', null], [sameDay, '2026-09-21', 'Erste Hilfe am Kind', null], [autumn, '2026-09-21', 'Kinderschutz', null]])

    deleteTraining(db, 1, autumn)
    expect(getEmployeeRequirements(db, 1, anna, today).trainings.map(training => training.id)).toEqual([spring, sameDay])
    // Trainings are no mandatory appointments: the kinds stay missing.
    expect(getEmployeeRequirements(db, 1, anna, today).kinds.every(entry => entry.state === 'missing')).toBe(true)
  })

  it('refuses trainings without a title, with impossible dates or for unknown ids', () => {
    const training = addTraining(db, 1, anna, { date: '2026-03-10', title: 'Sprachförderung' })
    const before = stored(db)
    expect(errorCode(() => addTraining(db, 1, anna, { date: today, title: '   ' }))).toBe('title_required')
    expect(errorCode(() => addTraining(db, 1, anna, { date: '2026-02-30', title: 'Kinderschutz' }))).toBe('invalid_date')
    expect(errorCode(() => addTraining(db, 1, 999, { date: today, title: 'Kinderschutz' }))).toBe('employee_not_found')
    expect(errorCode(() => updateTraining(db, 1, training, { date: today, title: ' ' }))).toBe('title_required')
    expect(errorCode(() => updateTraining(db, 1, training, { date: '2026-04-31', title: 'Kinderschutz' }))).toBe('invalid_date')
    expect(errorCode(() => updateTraining(db, 1, 999, { date: today, title: 'Kinderschutz' }))).toBe('training_not_found')
    expect(errorCode(() => deleteTraining(db, 1, 999))).toBe('training_not_found')
    expect(stored(db)).toEqual(before)
  })

  it('removes records and trainings with the employee', () => {
    const ben = addEmployee(db, 'Ben')
    addRequirementRecord(db, 1, anna, { typeId: doctor, date: '2026-01-01' }, today)
    addTraining(db, 1, anna, { date: '2026-03-10', title: 'Sprachförderung' })
    const record = addRequirementRecord(db, 1, ben, { typeId: doctor, date: '2026-01-01' }, today)
    const training = addTraining(db, 1, ben, { date: '2026-03-10', title: 'Sprachförderung' })
    db.delete(employees).where(eq(employees.id, anna)).run()
    expect(stored(db).records.map(row => row.id)).toEqual([record])
    expect(stored(db).trainings.map(row => row.id)).toEqual([training])
  })
})

describe('notice of due mandatory appointments', () => {
  let db: Db
  let doctor: number
  let firstAid: number
  let record: number
  let measles: number
  beforeEach(() => {
    db = createTestDb()
    doctor = requirementTypeId(db, 'company_doctor')
    firstAid = requirementTypeId(db, 'first_aid')
    record = requirementTypeId(db, 'criminal_record')
    measles = requirementTypeId(db, 'measles')
  })

  /** Records that leave nothing to do, except for the kinds named in `open`. */
  function complete(employeeId: number, facilityId = 1, open: number[] = []) {
    for (const type of listRequirementTypes(db, facilityId)) {
      if (!open.includes(type.id)) addRequirementRecord(db, facilityId, employeeId, { typeId: type.id, date: '2026-09-01' }, today)
    }
  }

  it('lists overdue, then missing, then soon, each by name, and nothing that is fine', () => {
    const zoe = addEmployee(db, 'Zoe')
    const ben = addEmployee(db, 'Ben')
    const anna = addEmployee(db, 'Anna')
    const fine = addEmployee(db, 'Carla')
    complete(fine)
    complete(zoe, 1, [doctor, firstAid])
    addRequirementRecord(db, 1, zoe, { typeId: doctor, date: '2023-01-01' }, today) // overdue since 2025-01-01
    addRequirementRecord(db, 1, zoe, { typeId: firstAid, date: '2024-12-12' }, today) // due in exactly two months
    complete(anna, 1, [doctor, firstAid, measles])
    addRequirementRecord(db, 1, anna, { typeId: doctor, date: '2024-10-12' }, today) // due today
    addRequirementRecord(db, 1, anna, { typeId: firstAid, date: '2024-11-01' }, today) // due on 2026-11-01

    expect(listDueRequirements(db, 1, today)).toEqual([
      { employeeId: anna, employeeName: 'Anna', typeId: doctor, typeName: 'Betriebsarzt', state: 'overdue', dueOn: '2026-10-12' },
      { employeeId: zoe, employeeName: 'Zoe', typeId: doctor, typeName: 'Betriebsarzt', state: 'overdue', dueOn: '2025-01-01' },
      { employeeId: anna, employeeName: 'Anna', typeId: measles, typeName: 'Masernimpfung (Nachweis)', state: 'missing', dueOn: null },
      // A new employee with no records misses every kind, in the order of the kinds.
      { employeeId: ben, employeeName: 'Ben', typeId: doctor, typeName: 'Betriebsarzt', state: 'missing', dueOn: null },
      { employeeId: ben, employeeName: 'Ben', typeId: firstAid, typeName: 'Erste-Hilfe-Kurs', state: 'missing', dueOn: null },
      { employeeId: ben, employeeName: 'Ben', typeId: record, typeName: 'Erweitertes Führungszeugnis', state: 'missing', dueOn: null },
      { employeeId: ben, employeeName: 'Ben', typeId: measles, typeName: 'Masernimpfung (Nachweis)', state: 'missing', dueOn: null },
      { employeeId: anna, employeeName: 'Anna', typeId: firstAid, typeName: 'Erste-Hilfe-Kurs', state: 'soon', dueOn: '2026-11-01' },
      { employeeId: zoe, employeeName: 'Zoe', typeId: firstAid, typeName: 'Erste-Hilfe-Kurs', state: 'soon', dueOn: '2026-12-12' },
    ])
  })

  it('drops a row when a new record is entered, and brings it back as the next one comes close', () => {
    const anna = addEmployee(db, 'Anna')
    complete(anna, 1, [doctor])
    expect(listDueRequirements(db, 1, today).map(row => [row.typeId, row.state])).toEqual([[doctor, 'missing']])
    addRequirementRecord(db, 1, anna, { typeId: doctor, date: today }, today)
    expect(listDueRequirements(db, 1, today)).toEqual([])
    expect(listDueRequirements(db, 1, '2028-08-11').filter(row => row.typeId === doctor)).toEqual([])
    expect(listDueRequirements(db, 1, '2028-08-12').filter(row => row.typeId === doctor))
      .toEqual([{ employeeId: anna, employeeName: 'Anna', typeId: doctor, typeName: 'Betriebsarzt', state: 'soon', dueOn: '2028-10-12' }])
  })

  it('includes own kinds and follows renamed kinds and changed intervals', () => {
    const anna = addEmployee(db, 'Anna')
    complete(anna)
    expect(listDueRequirements(db, 1, today)).toEqual([])
    const hygiene = createRequirementType(db, 1, { name: 'Hygienebelehrung', intervalMonths: 24 })
    updateRequirementType(db, 1, doctor, { name: 'Vorsorge', intervalMonths: 1 })
    expect(listDueRequirements(db, 1, today)).toEqual([
      { employeeId: anna, employeeName: 'Anna', typeId: doctor, typeName: 'Vorsorge', state: 'overdue', dueOn: '2026-10-01' },
      { employeeId: anna, employeeName: 'Anna', typeId: hygiene.id, typeName: 'Hygienebelehrung', state: 'missing', dueOn: null },
    ])
  })

  it('counts only employees who are employed today', () => {
    const left = addEmployee(db, 'Gestern gegangen', { leftOn: '2026-10-11' })
    const lastDay = addEmployee(db, 'Heute letzter Tag', { leftOn: today })
    const firstDay = addEmployee(db, 'Heute erster Tag', { validFrom: today })
    const notYet = addEmployee(db, 'Morgen erster Tag', { validFrom: '2026-10-13' })
    // Overdue records do not bring back somebody who left.
    addRequirementRecord(db, 1, left, { typeId: doctor, date: '2020-01-01' }, today)

    expect([...new Set(listDueRequirements(db, 1, today).map(row => row.employeeId))]).toEqual([firstDay, lastDay])
    expect(listDueRequirements(db, 1, today).filter(row => row.employeeId === firstDay).map(row => row.state))
      .toEqual(['missing', 'missing', 'missing', 'missing'])
    expect([...new Set(listDueRequirements(db, 1, '2026-10-13').map(row => row.employeeId))]).toEqual([firstDay, notYet])
    // Their records can still be read and entered on the employee page.
    expect(getEmployeeRequirements(db, 1, left, today).kinds[0]).toMatchObject({ state: 'overdue', lastDate: '2020-01-01' })
    expect(getEmployeeRequirements(db, 1, notYet, today).kinds[0]).toMatchObject({ state: 'missing' })
  })

  it('lists only the facility\'s own staff with the facility\'s own kinds, helpers never', () => {
    const krippe = addFacility(db, 'Krippe')
    const anna = addEmployee(db, 'Anna')
    const kim = addEmployee(db, 'Kim', { facilityId: krippe })
    addHelpOut(db, anna, krippe, 2026, 10)
    createRequirementType(db, krippe, { name: 'Hygienebelehrung', intervalMonths: 24 })
    complete(anna, 1, [doctor])

    expect(listDueRequirements(db, 1, today)).toEqual([
      { employeeId: anna, employeeName: 'Anna', typeId: doctor, typeName: 'Betriebsarzt', state: 'missing', dueOn: null },
    ])
    const inKrippe = listDueRequirements(db, krippe, today)
    expect(inKrippe.map(row => row.employeeId)).toEqual([kim, kim, kim, kim, kim])
    expect(inKrippe.map(row => row.typeId)).toEqual(listRequirementTypes(db, krippe).map(type => type.id))
    expect(listDueRequirements(db, addFacility(db, 'Hort'), today)).toEqual([])
  })
})

describe('isolation between facilities', () => {
  let db: Db
  let krippe: number
  let anna: number
  let kim: number
  let foreignType: number
  let foreignOwnType: number
  let foreignRecord: number
  let foreignTraining: number
  beforeEach(() => {
    db = createTestDb()
    krippe = addFacility(db, 'Krippe')
    anna = addEmployee(db, 'Anna')
    kim = addEmployee(db, 'Kim', { facilityId: krippe })
    foreignType = requirementTypeId(db, 'company_doctor', krippe)
    foreignOwnType = createRequirementType(db, krippe, { name: 'Hygienebelehrung', intervalMonths: 24 }).id
    foreignRecord = addRequirementRecord(db, krippe, kim, { typeId: foreignType, date: '2026-01-01', note: 'Krippe' }, today)
    foreignTraining = addTraining(db, krippe, kim, { date: '2026-03-10', title: 'Krippenpädagogik' })
  })

  it('answers not found for another facility\'s employee, kind, record and training, and changes nothing', () => {
    const before = stored(db)
    const own = requirementTypeId(db, 'company_doctor')

    expect(errorCode(() => getEmployeeRequirements(db, 1, kim, today))).toBe('employee_not_found')
    expect(errorCode(() => addRequirementRecord(db, 1, kim, { typeId: own, date: today }, today))).toBe('employee_not_found')
    expect(errorCode(() => addRequirementRecord(db, 1, kim, { typeId: foreignType, date: today }, today))).toBe('employee_not_found')
    expect(errorCode(() => addTraining(db, 1, kim, { date: today, title: 'Kinderschutz' }))).toBe('employee_not_found')

    // The own employee never gets a record of another facility's kind.
    expect(errorCode(() => addRequirementRecord(db, 1, anna, { typeId: foreignType, date: today }, today))).toBe('requirement_type_not_found')
    expect(errorCode(() => addRequirementRecord(db, 1, anna, { typeId: foreignOwnType, date: today }, today))).toBe('requirement_type_not_found')
    expect(errorCode(() => updateRequirementType(db, 1, foreignOwnType, { name: 'Gekapert', intervalMonths: 1 }))).toBe('requirement_type_not_found')
    expect(errorCode(() => updateRequirementType(db, 1, foreignType, { name: 'Gekapert', intervalMonths: 1 }))).toBe('requirement_type_not_found')
    expect(errorCode(() => deleteRequirementType(db, 1, foreignOwnType))).toBe('requirement_type_not_found')
    // Not even that it is a built-in kind is confirmed.
    expect(errorCode(() => deleteRequirementType(db, 1, foreignType))).toBe('requirement_type_not_found')

    expect(errorCode(() => deleteRequirementRecord(db, 1, foreignRecord))).toBe('requirement_not_found')
    expect(errorCode(() => updateTraining(db, 1, foreignTraining, { date: today, title: 'Gekapert' }))).toBe('training_not_found')
    expect(errorCode(() => deleteTraining(db, 1, foreignTraining))).toBe('training_not_found')

    expect(stored(db)).toEqual(before)
    expect(listRequirementTypes(db, 1).map(type => type.id)).not.toContain(foreignOwnType)
    // The owning facility reaches all of it.
    expect(getEmployeeRequirements(db, krippe, kim, today).kinds[0]!.records).toEqual([{ id: foreignRecord, date: '2026-01-01', note: 'Krippe' }])
    deleteRequirementRecord(db, krippe, foreignRecord)
    deleteTraining(db, krippe, foreignTraining)
    deleteRequirementType(db, krippe, foreignOwnType)
    expect(stored(db).records).toEqual([])
    expect(stored(db).trainings).toEqual([])
  })

  it('shows the helping facility nothing of a helper', () => {
    addHelpOut(db, kim, 1, 2026, 10)
    const before = stored(db)
    expect(errorCode(() => getEmployeeRequirements(db, 1, kim, today))).toBe('employee_not_found')
    expect(errorCode(() => addRequirementRecord(db, 1, kim, { typeId: requirementTypeId(db, 'measles'), date: today }, today))).toBe('employee_not_found')
    expect(errorCode(() => addTraining(db, 1, kim, { date: today, title: 'Kinderschutz' }))).toBe('employee_not_found')
    expect(errorCode(() => deleteRequirementRecord(db, 1, foreignRecord))).toBe('requirement_not_found')
    expect(errorCode(() => deleteTraining(db, 1, foreignTraining))).toBe('training_not_found')
    expect(listDueRequirements(db, 1, today).map(row => row.employeeId)).toEqual([anna, anna, anna, anna])
    expect(stored(db)).toEqual(before)
  })
})

describe('moving an employee to another facility', () => {
  it('re-points the records to the new facility\'s kinds and keeps the trainings', () => {
    const db = createTestDb()
    const krippe = addFacility(db, 'Krippe')
    const provider = addUser(db, 'traeger', 'provider')
    const anna = addEmployee(db, 'Anna')
    const ben = addEmployee(db, 'Ben')
    // Built-in kinds are matched by their key, whatever they are called and however often they are due.
    updateRequirementType(db, 1, requirementTypeId(db, 'company_doctor'), { name: 'Vorsorge', intervalMonths: 36 })
    updateRequirementType(db, krippe, requirementTypeId(db, 'first_aid', krippe), { name: 'Erste Hilfe am Kind', intervalMonths: 12 })
    // Own kinds are matched by their name in any spelling; a missing one is created with the same interval.
    const hygiene = createRequirementType(db, 1, { name: 'Hygienebelehrung', intervalMonths: 12 })
    const fire = createRequirementType(db, 1, { name: 'Brandschutz', intervalMonths: 36 })
    const once = createRequirementType(db, 1, { name: 'Schweigepflicht', intervalMonths: null })
    createRequirementType(db, 1, { name: 'Unbenutzt', intervalMonths: 6 })
    const krippeHygiene = createRequirementType(db, krippe, { name: 'HYGIENEBELEHRUNG', intervalMonths: 24 })

    const doctorRecords = [
      addRequirementRecord(db, 1, anna, { typeId: requirementTypeId(db, 'company_doctor'), date: '2024-10-12', note: 'alt' }, today),
      addRequirementRecord(db, 1, anna, { typeId: requirementTypeId(db, 'company_doctor'), date: '2026-01-15' }, today),
    ]
    const firstAidRecord = addRequirementRecord(db, 1, anna, { typeId: requirementTypeId(db, 'first_aid'), date: '2026-02-01' }, today)
    const measlesRecord = addRequirementRecord(db, 1, anna, { typeId: requirementTypeId(db, 'measles'), date: '2020-03-01' }, today)
    const hygieneRecord = addRequirementRecord(db, 1, anna, { typeId: hygiene.id, date: '2026-03-01' }, today)
    const fireRecords = [
      addRequirementRecord(db, 1, anna, { typeId: fire.id, date: '2025-04-01' }, today),
      addRequirementRecord(db, 1, anna, { typeId: fire.id, date: '2026-04-01' }, today),
    ]
    const onceRecord = addRequirementRecord(db, 1, anna, { typeId: once.id, date: '2026-05-01' }, today)
    const training = addTraining(db, 1, anna, { date: '2026-03-10', title: 'Sprachförderung', note: 'VHS' })
    const benRecords = [
      addRequirementRecord(db, 1, ben, { typeId: fire.id, date: '2026-06-01' }, today),
      addRequirementRecord(db, 1, ben, { typeId: requirementTypeId(db, 'measles'), date: '2026-06-02' }, today),
    ]
    const benBefore = getEmployeeRequirements(db, 1, ben, today)
    const homeTypes = listRequirementTypes(db, 1)
    const recordsBefore = stored(db).records

    moveEmployeeToFacility(db, provider, anna, krippe, new Date(`${today}T08:00:00Z`))

    // The old facility keeps its kinds and the records of everybody else.
    expect(listRequirementTypes(db, 1)).toEqual(homeTypes)
    expect(getEmployeeRequirements(db, 1, ben, today)).toEqual(benBefore)
    expect(errorCode(() => getEmployeeRequirements(db, 1, anna, today))).toBe('employee_not_found')

    const krippeTypes = listRequirementTypes(db, krippe)
    expect(krippeTypes.map(({ id: _id, ...rest }) => rest)).toEqual([
      { name: 'Betriebsarzt', intervalMonths: 24, builtinKey: 'company_doctor', sortOrder: 0 },
      { name: 'Erste Hilfe am Kind', intervalMonths: 12, builtinKey: 'first_aid', sortOrder: 1 },
      { name: 'Erweitertes Führungszeugnis', intervalMonths: 60, builtinKey: 'criminal_record', sortOrder: 2 },
      { name: 'Masernimpfung (Nachweis)', intervalMonths: null, builtinKey: 'measles', sortOrder: 3 },
      { name: 'HYGIENEBELEHRUNG', intervalMonths: 24, builtinKey: null, sortOrder: 4 },
      { name: 'Brandschutz', intervalMonths: 36, builtinKey: null, sortOrder: 5 },
      { name: 'Schweigepflicht', intervalMonths: null, builtinKey: null, sortOrder: 6 },
    ])
    const idOf = (name: string) => krippeTypes.find(type => type.name === name)!.id
    expect(idOf('HYGIENEBELEHRUNG')).toBe(krippeHygiene.id)

    // No record is lost or changed apart from the kind it points to.
    const after = stored(db).records
    expect(after.map(({ typeId: _typeId, ...rest }) => rest)).toEqual(recordsBefore.map(({ typeId: _typeId, ...rest }) => rest))
    const typeOf = (id: number) => after.find(row => row.id === id)!.typeId
    expect(doctorRecords.map(typeOf)).toEqual([idOf('Betriebsarzt'), idOf('Betriebsarzt')])
    expect(typeOf(firstAidRecord)).toBe(idOf('Erste Hilfe am Kind'))
    expect(typeOf(measlesRecord)).toBe(idOf('Masernimpfung (Nachweis)'))
    expect(typeOf(hygieneRecord)).toBe(krippeHygiene.id)
    expect(fireRecords.map(typeOf)).toEqual([idOf('Brandschutz'), idOf('Brandschutz')])
    expect(typeOf(onceRecord)).toBe(idOf('Schweigepflicht'))
    expect(benRecords.map(typeOf)).toEqual([fire.id, requirementTypeId(db, 'measles')])

    const moved = getEmployeeRequirements(db, krippe, anna, today)
    expect(moved.trainings).toEqual([{ id: training, date: '2026-03-10', title: 'Sprachförderung', note: 'VHS' }])
    expect(moved.kinds.map(entry => [entry.type.name, entry.state, entry.lastDate, entry.dueOn, entry.records.length])).toEqual([
      ['Betriebsarzt', 'ok', '2026-01-15', '2028-01-15', 2],
      ['Erste Hilfe am Kind', 'ok', '2026-02-01', '2027-02-01', 1],
      ['Erweitertes Führungszeugnis', 'missing', null, null, 0],
      ['Masernimpfung (Nachweis)', 'ok', '2020-03-01', null, 1],
      ['HYGIENEBELEHRUNG', 'ok', '2026-03-01', '2028-03-01', 1],
      ['Brandschutz', 'ok', '2026-04-01', '2029-04-01', 2],
      ['Schweigepflicht', 'ok', '2026-05-01', null, 1],
    ])
  })

  it('moves back onto the kinds that are still there and creates nothing twice', () => {
    const db = createTestDb()
    const krippe = addFacility(db, 'Krippe')
    const provider = addUser(db, 'traeger', 'provider')
    const anna = addEmployee(db, 'Anna')
    const fire = createRequirementType(db, 1, { name: 'Brandschutz', intervalMonths: 36 })
    const record = addRequirementRecord(db, 1, anna, { typeId: fire.id, date: '2026-04-01' }, today)
    const doctorRecord = addRequirementRecord(db, 1, anna, { typeId: requirementTypeId(db, 'company_doctor'), date: '2026-04-02' }, today)
    const homeTypes = listRequirementTypes(db, 1)

    moveEmployeeToFacility(db, provider, anna, krippe, new Date(`${today}T08:00:00Z`))
    const krippeTypes = listRequirementTypes(db, krippe)
    expect(krippeTypes).toHaveLength(5)
    moveEmployeeToFacility(db, provider, anna, 1, new Date(`${today}T09:00:00Z`))
    moveEmployeeToFacility(db, provider, anna, 1, new Date(`${today}T09:30:00Z`)) // already there: nothing happens

    expect(listRequirementTypes(db, 1)).toEqual(homeTypes)
    expect(listRequirementTypes(db, krippe)).toEqual(krippeTypes)
    expect(stored(db).records.map(row => [row.id, row.employeeId, row.typeId]))
      .toEqual([[record, anna, fire.id], [doctorRecord, anna, requirementTypeId(db, 'company_doctor')]])
  })
})

describe('the employee\'s own view', () => {
  let db: Db
  let anna: number
  let ben: number
  beforeEach(() => {
    db = createTestDb()
    anna = addEmployee(db, 'Anna')
    ben = addEmployee(db, 'Ben')
    addRequirementRecord(db, 1, anna, { typeId: requirementTypeId(db, 'company_doctor'), date: '2024-11-02', note: 'Attest fehlte zunächst' }, today)
    addRequirementRecord(db, 1, anna, { typeId: requirementTypeId(db, 'company_doctor'), date: '2022-10-01', note: 'Erstuntersuchung' }, today)
    addRequirementRecord(db, 1, anna, { typeId: requirementTypeId(db, 'first_aid'), date: '2023-05-05', note: 'längst fällig' }, today)
    addTraining(db, 1, anna, { date: '2026-03-10', title: 'Sprachförderung', note: 'nur halb anwesend' })
    addTraining(db, 1, anna, { date: '2026-06-01', title: 'Kinderschutz' })
    addRequirementRecord(db, 1, ben, { typeId: requirementTypeId(db, 'measles'), date: '2020-03-01', note: 'Impfpass Ben' }, today)
    addTraining(db, 1, ben, { date: '2026-04-20', title: 'Elterngespräche führen', note: 'Ben' })
  })

  it('shows a Mitarbeiter their own kinds with last and due date and their trainings, nothing else', () => {
    const viewer = addUser(db, 'anna', 'observer', anna)
    const [doctor, firstAid, record, measles] = listRequirementTypes(db, 1)
    const mine = getMyRequirements(db, viewer, today)
    expect(mine).toEqual({
      kinds: [
        // Due soon and overdue for the Leitung; here only the plain dates.
        { type: { id: doctor!.id, name: 'Betriebsarzt', intervalMonths: 24 }, lastDate: '2024-11-02', dueOn: '2026-11-02' },
        { type: { id: firstAid!.id, name: 'Erste-Hilfe-Kurs', intervalMonths: 24 }, lastDate: '2023-05-05', dueOn: '2025-05-05' },
        { type: { id: record!.id, name: 'Erweitertes Führungszeugnis', intervalMonths: 60 }, lastDate: null, dueOn: null },
        { type: { id: measles!.id, name: 'Masernimpfung (Nachweis)', intervalMonths: null }, lastDate: null, dueOn: null },
      ],
      trainings: [
        { id: mine.trainings[0]!.id, date: '2026-06-01', title: 'Kinderschutz' },
        { id: mine.trainings[1]!.id, date: '2026-03-10', title: 'Sprachförderung' },
      ],
    })
  })

  it('leaves out the notes of the Leitung, the history and every state', () => {
    const viewer = addUser(db, 'anna', 'observer', anna)
    // What the Leitung sees of Anna has all of it.
    const managed = JSON.stringify(getEmployeeRequirements(db, 1, anna, today))
    for (const internal of ['Attest fehlte zunächst', 'Erstuntersuchung', 'längst fällig', 'nur halb anwesend', '"state"', '"records"', '"note"', 'overdue', 'soon', '2022-10-01']) {
      expect(managed, internal).toContain(internal)
    }
    const mine = getMyRequirements(db, viewer, today)
    const sent = JSON.stringify(mine)
    for (const internal of [
      'Attest fehlte zunächst', 'Erstuntersuchung', 'längst fällig', 'nur halb anwesend', 'note', 'state', 'records', 'overdue', 'soon', 'missing',
      '2022-10-01', 'builtinKey', 'sortOrder',
    ]) {
      expect(sent, internal).not.toContain(internal)
    }
    for (const kind of mine.kinds) {
      expect(Object.keys(kind).sort()).toEqual(['dueOn', 'lastDate', 'type'])
      expect(Object.keys(kind.type).sort()).toEqual(['id', 'intervalMonths', 'name'])
    }
    for (const training of mine.trainings) expect(Object.keys(training).sort()).toEqual(['date', 'id', 'title'])
    // Nothing of anybody else either.
    for (const foreign of ['Ben', 'Elterngespräche führen', '2020-03-01']) expect(sent, foreign).not.toContain(foreign)
  })

  it('shows a manager with an employee their own, in the employee\'s home facility', () => {
    const krippe = addFacility(db, 'Krippe')
    const kim = addEmployee(db, 'Kim', { facilityId: krippe })
    createRequirementType(db, krippe, { name: 'Hygienebelehrung', intervalMonths: 24 })
    addTraining(db, krippe, kim, { date: '2026-05-05', title: 'Krippenpädagogik' })
    // The Träger works in facility 1 at the moment, but is employed in the Krippe.
    const provider = addUser(db, 'traeger', 'provider', kim)
    expect(provider.facilityId).toBe(1)
    const mine = getMyRequirements(db, provider, today)
    expect(mine.kinds.map(entry => entry.type.id)).toEqual(listRequirementTypes(db, krippe).map(type => type.id))
    expect(mine.kinds.map(entry => entry.type.name)).toContain('Hygienebelehrung')
    expect(mine.trainings.map(training => training.title)).toEqual(['Krippenpädagogik'])
  })

  it('answers no_employee for an account without an employee', () => {
    expect(errorCode(() => getMyRequirements(db, addUser(db, 'ohne', 'observer'), today))).toBe('no_employee')
    expect(errorCode(() => getMyRequirements(db, addUser(db, 'leitung', 'admin'), today))).toBe('no_employee')
    const viewer = addUser(db, 'ben', 'observer', ben)
    db.delete(employees).where(eq(employees.id, ben)).run()
    expect(errorCode(() => getMyRequirements(db, viewer, today))).toBe('no_employee')
  })
})
