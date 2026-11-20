import { describe, expect, it } from 'vitest'
import { de } from '../../app/locales/de'
import { staffingPathLabel } from '../../app/utils/staffing'
import { QUALIFICATION_TITLES } from '../../shared/domain/accidents'
import { isFachkraft, plannedFte, quotaLines, requiredFte, ruleSetProblems } from '../../shared/domain/staffing/calc'
import { applyOverrides, overridableValues, sameLawValue, type StaffingOverrides } from '../../shared/domain/staffing/overrides'
import { presetFor, presetVersions, sameLawValueOf } from '../../shared/domain/staffing/presets'
import { shares, TRAINEES_REVISED } from '../../shared/domain/staffing/presets/common'
import { QUALIFICATIONS, type StaffingRuleSet } from '../../shared/domain/staffing/types'
import { GERMAN_STATES, type GermanState } from '../../shared/domain/states'

const REVISED = '2026-11-01'
const BEFORE = '2026-10-31'
const weeks = 30 / 7

type Keys = 'studium_1' | 'studium_2' | 'studium_3' | 'azubi_1' | 'azubi_2' | 'azubi_3' | 'praktikant' | 'ergaenzung'

/** Requirement 3 of the brief: the shares from 01.11.2026 (percent). */
const EXPECTED: Record<GermanState, Record<Keys, number>> = {
  BW: { studium_1: 40, studium_2: 40, studium_3: 40, azubi_1: 40, azubi_2: 40, azubi_3: 40, praktikant: 100, ergaenzung: 0 },
  BY: { studium_1: 0, studium_2: 0, studium_3: 0, azubi_1: 0, azubi_2: 100, azubi_3: 100, praktikant: 100, ergaenzung: 100 },
  BE: { studium_1: 75, studium_2: 75, studium_3: 75, azubi_1: 75, azubi_2: 75, azubi_3: 75, praktikant: 0, ergaenzung: 0 },
  BB: { studium_1: 70, studium_2: 70, studium_3: 70, azubi_1: 70, azubi_2: 70, azubi_3: 70, praktikant: 0, ergaenzung: 80 },
  HB: { studium_1: 0, studium_2: 0, studium_3: 0, azubi_1: 0, azubi_2: 0, azubi_3: 0, praktikant: 0, ergaenzung: 100 },
  HH: { studium_1: 30, studium_2: 90, studium_3: 90, azubi_1: 30, azubi_2: 90, azubi_3: 90, praktikant: 0, ergaenzung: 100 },
  HE: { studium_1: 100, studium_2: 100, studium_3: 100, azubi_1: 100, azubi_2: 100, azubi_3: 100, praktikant: 50, ergaenzung: 100 },
  MV: { studium_1: 0, studium_2: 0, studium_3: 0, azubi_1: 0, azubi_2: 0, azubi_3: 50, praktikant: 0, ergaenzung: 80 },
  NI: { studium_1: 0, studium_2: 0, studium_3: 0, azubi_1: 0, azubi_2: 0, azubi_3: 0, praktikant: 0, ergaenzung: 100 },
  NW: { studium_1: 0, studium_2: 100, studium_3: 100, azubi_1: 100, azubi_2: 100, azubi_3: 100, praktikant: 100, ergaenzung: 100 },
  RP: { studium_1: 0, studium_2: 0, studium_3: 0, azubi_1: 0, azubi_2: 0, azubi_3: 0, praktikant: 0, ergaenzung: 100 },
  SL: { studium_1: 0, studium_2: 0, studium_3: 0, azubi_1: 0, azubi_2: 0, azubi_3: 0, praktikant: 0, ergaenzung: 100 },
  SN: { studium_1: 0, studium_2: 0, studium_3: 0, azubi_1: 0, azubi_2: 0, azubi_3: 0, praktikant: 0, ergaenzung: 100 },
  ST: { studium_1: 0, studium_2: 0, studium_3: 0, azubi_1: 0, azubi_2: 30, azubi_3: 70, praktikant: 100, ergaenzung: 0 },
  SH: { studium_1: 0, studium_2: 100, studium_3: 100, azubi_1: 0, azubi_2: 0, azubi_3: 100, praktikant: 0, ergaenzung: 100 },
  TH: { studium_1: 0, studium_2: 0, studium_3: 0, azubi_1: 0, azubi_2: 0, azubi_3: 0, praktikant: 0, ergaenzung: 100 },
}

/** The states whose preset got a correction version on 01.11.2026. */
const REVISED_STATES: GermanState[] = ['BW', 'BY', 'BE', 'BB', 'HH', 'HE', 'MV', 'NW', 'ST', 'SH', 'SN']

const KEYS = Object.keys(EXPECTED.BW) as Keys[]
const sharesOf = (land: GermanState, date: string) =>
  Object.fromEntries(KEYS.map(key => [key, presetFor(land, date).staffShares[key]]))

describe('qualifications – Studium praxisintegriert/dual', () => {
  it('adds studium_1/2/3 after the trainees (azubi_3, then the SPA-PiA years), with German labels', () => {
    expect([...QUALIFICATIONS]).toEqual([
      'fachkraft', 'ergaenzung', 'azubi_1', 'azubi_2', 'azubi_3', 'azubi_spa_1', 'azubi_spa_2', 'azubi_spa_3', 'studium_1',
      'studium_2', 'studium_3', 'praktikant', 'haushalt', 'none',
    ])
    expect(de.staffing.qualifications.studium_1).toBe('Studium praxisintegriert/dual (1. Studienjahr)')
    expect(de.staffing.qualifications.studium_2).toBe('Studium praxisintegriert/dual (2. Studienjahr)')
    expect(de.staffing.qualifications.studium_3).toBe('Studium praxisintegriert/dual (ab 3. Studienjahr)')
  })

  it('relabels none and praktikant and has a hint for students without a pedagogic degree', () => {
    expect(de.staffing.qualifications.none).toBe('keine pädagogische Kraft (z. B. Aushilfe, Werkstudent/in)')
    expect(de.staffing.qualifications.praktikant).toBe('Berufspraktikant/in (Anerkennungsjahr)')
    expect(de.staffing.qualificationHint).toBe(
      'Praxissemester, Pflichtpraktikum oder Werkstudent/in ohne pädagogischen Abschluss: ‚keine pädagogische Kraft‘ wählen.',
    )
    expect(staffingPathLabel('staffShares.studium_3', presetVersions('NW')))
      .toBe('Anrechnung je Qualifikation: Studium praxisintegriert/dual (ab 3. Studienjahr)')
  })

  it('maps the new and relabelled qualifications to job titles for the accident prefill', () => {
    // field 24 asks for an activity: „Studierende/r …“
    expect(QUALIFICATION_TITLES.studium_1).toBe('Studierende/r praxisintegriert/dual (1. Studienjahr)')
    expect(QUALIFICATION_TITLES.studium_2).toBe('Studierende/r praxisintegriert/dual (2. Studienjahr)')
    expect(QUALIFICATION_TITLES.studium_3).toBe('Studierende/r praxisintegriert/dual (ab 3. Studienjahr)')
    expect(QUALIFICATION_TITLES.praktikant).toBe('Berufspraktikant/in (Anerkennungsjahr)')
    // no pedagogic job title for `none`: the field stays empty
    expect(QUALIFICATION_TITLES.none).toBeUndefined()
    for (const q of QUALIFICATIONS) expect([q, q === 'none' || QUALIFICATION_TITLES[q] !== undefined]).toEqual([q, true])
  })

  it('counts the new keys with 0 % in the shares helper', () => {
    expect(shares()).toMatchObject({ studium_1: 0, studium_2: 0, studium_3: 0 })
  })
})

describe('presets – trainee and student shares from 01.11.2026', () => {
  it('dates the revision 01.11.2026', () => {
    expect(TRAINEES_REVISED).toBe(REVISED)
  })

  it.each(GERMAN_STATES)('%s: shares of trainees, students, Berufspraktikanten and Ergänzungskräfte', (land) => {
    expect(sharesOf(land, REVISED)).toEqual(EXPECTED[land])
    // and in every later version
    for (const version of presetVersions(land).filter(v => v.validFrom > REVISED)) {
      expect([version.validFrom, sharesOf(land, version.validFrom)]).toEqual([version.validFrom, EXPECTED[land]])
    }
  })

  it.each(REVISED_STATES)('%s: a new correction version from 01.11.2026; the earlier ones keep their values', (land) => {
    const revised = presetFor(land, REVISED)
    expect(revised.validFrom).toBe(REVISED)
    expect(ruleSetProblems(revised)).toEqual([])
    const before = presetFor(land, BEFORE)
    expect(before.validFrom < REVISED).toBe(true)
    for (const q of ['studium_1', 'studium_2', 'studium_3'] as const) expect(before.staffShares[q]).toBe(0)
    // everything but shares, quotas, Fachkraft set, note and source stays as it was
    const strip = ({ validFrom: _v, correction: _c, note: _n, source: _s, staffShares: _sh, quotas: _q, fachkraftQualifications: _f, ...rest }: typeof revised) => rest
    expect(strip(revised)).toEqual(strip(before))
    expect(revised.note).toContain('01.11.2026')
    expect(revised.correction).toBe(true)
  })

  it('keeps the values before 01.11.2026 (no rewritten history)', () => {
    expect(presetFor('SN', BEFORE).staffShares.praktikant).toBe(50)
    expect(presetFor('BW', BEFORE).staffShares.azubi_1).toBe(0)
    expect(presetFor('MV', BEFORE).staffShares.ergaenzung).toBe(100)
    expect(presetFor('BB', BEFORE).quotas[0]!.qualifications).toEqual(['fachkraft'])
    expect(presetFor('NW', BEFORE).fachkraftQualifications).toBeUndefined()
  })

  it.each([
    ['BW', ['40 %', 'KM-FAQ', '§ 7 Abs. 4']], ['BY', ['§ 16 Abs. 4 Nr. 2', 'BayMBl. 2024 Nr. 34', 'Kombinierte Ausbildung']],
    ['BE', ['§ 11 Abs. 3 Nr. 2', '5 Std./Woche', 'Studium']], ['BB', ['§ 17', '§ 15 Abs. 1 S. 2', 'Studierende']],
    ['HH', ['§ 3 Abs. 3', 'dualen Studiengängen']], ['HE', ['§ 25b Abs. 3 Nr. 1', '§ 25c Abs. 4', 'Studium']],
    ['MV', ['§ 14 Abs. 7', '§ 14 Abs. 9', '§ 14 Abs. 6', 'Studierende']],
    ['NW', ['§ 13', 'PersVO', '60 Leistungspunkten', '90 Leistungspunkten']], ['ST', ['MBl. LSA 2024 S. 584', 'Berufspraktikum']],
    ['SH', ['§ 4 Nr. 1 PQVO', '§ 4 Nr. 2 PQVO', '3. Semester']], ['SN', ['§ 5a', '2004']],
  ] as const)('%s: the note names the training or study and its legal basis', (land, parts) => {
    const note = presetFor(land, REVISED).note ?? ''
    for (const part of parts) expect([land, note.includes(part) ? part : `missing: ${part}`]).toEqual([land, part])
    expect(note).not.toMatch(/Auszubildende[^.]*nicht geprüft/)
  })
})

describe('presets – Fachkraft status and quotas of students and trainees', () => {
  const full = (land: GermanState) => presetFor(land, REVISED).fteHoursPerWeek * weeks

  it('NW: studium_3 counts as Fachkraft (also for the Fachkraftstunden), studium_2 and PiA do not', () => {
    const nw = presetFor('NW', REVISED)
    expect(isFachkraft(nw, 'studium_3')).toBe(true)
    expect(isFachkraft(nw, 'fachkraft')).toBe(true)
    for (const q of ['studium_1', 'studium_2', 'azubi_1', 'azubi_2', 'azubi_3', 'praktikant'] as const) expect(isFachkraft(nw, q)).toBe(false)
    const planned = plannedFte(nw, [
      { qualification: 'studium_3', share: null, hours: full('NW') },
      { qualification: 'studium_2', share: null, hours: full('NW') },
    ], weeks)
    expect(planned.fte).toBeCloseTo(2, 10)
    expect(planned.fachkraftFte).toBeCloseTo(1, 10)
    const required = requiredFte(nw, { groupType: 'gf1', openingMinutesPerDay: null, children: [{ ageBand: 'ue3', weeklyHours: 35 }] })
    const line = quotaLines(nw, required, planned).find(l => l.key === 'fachkraftstunden')!
    expect(line.have).toBeCloseTo(1, 10)
  })

  it('BB: trainees and students count toward the 80 % Fachkraft quota, not as Fachkraft for presence', () => {
    const bb = presetFor('BB', REVISED)
    const quota = bb.quotas.find(q => q.key === 'fachkraftquote')!
    expect(quota).toMatchObject({ kind: 'min_share', pct: 80, base: 'required', label: 'Fachkräfte (inkl. tätigkeitsbegleitende Qualifizierung)' })
    expect(presetFor('BB', BEFORE).quotas[0]!.label).toBe('Fachkräfte')
    expect([...quota.qualifications].sort()).toEqual(
      ['azubi_1', 'azubi_2', 'azubi_3', 'fachkraft', 'studium_1', 'studium_2', 'studium_3'].sort(),
    )
    expect(isFachkraft(bb, 'azubi_1')).toBe(false)
    expect(presetFor('BB', '2027-01-01').quotas.find(q => q.key === 'fachkraftquote')!.qualifications).toEqual(quota.qualifications)
    const planned = plannedFte(bb, [{ qualification: 'studium_1', share: null, hours: full('BB') }], weeks)
    expect(planned.fte).toBeCloseTo(0.7, 10)
    const required = requiredFte(bb, { groupType: null, openingMinutesPerDay: null, children: [{ ageBand: 'u3', weeklyHours: 40 }] })
    expect(quotaLines(bb, required, planned).find(l => l.key === 'fachkraftquote')!.have).toBeCloseTo(0.7, 10)
  })

  it('BW: trainees and students count 40 % but never as Fachkraft', () => {
    const bw = presetFor('BW', REVISED)
    for (const q of ['azubi_1', 'azubi_3', 'studium_1', 'studium_3', 'praktikant'] as const) expect(isFachkraft(bw, q)).toBe(false)
  })

  it('BE: trainees and students together at most a third of the planned staff', () => {
    const quota = presetFor('BE', REVISED).quotas.find(q => q.kind === 'max_share')!
    expect(quota).toMatchObject({ pct: 33, base: 'planned' })
    expect([...quota.qualifications].sort())
      .toEqual(['azubi_1', 'azubi_2', 'azubi_3', 'azubi_spa_1', 'azubi_spa_2', 'azubi_spa_3', 'studium_1', 'studium_2', 'studium_3'])
  })

  it('MV: Assistenzkräfte and trainees together at most 25 % of the required staff', () => {
    const quota = presetFor('MV', REVISED).quotas.find(q => q.kind === 'max_share')!
    expect(quota).toMatchObject({ pct: 25, base: 'required' })
    expect([...quota.qualifications].sort())
      .toEqual(['azubi_1', 'azubi_2', 'azubi_3', 'azubi_spa_1', 'azubi_spa_2', 'azubi_spa_3', 'ergaenzung'])
    expect(presetFor('MV', '2027-01-01').quotas).toEqual(presetFor('MV', REVISED).quotas)
  })

  it('the employee\'s own share still wins over the new defaults', () => {
    const hh = presetFor('HH', REVISED)
    const hours = full('HH')
    expect(plannedFte(hh, [{ qualification: 'studium_1', share: null, hours }], weeks).fte).toBeCloseTo(0.3, 10)
    expect(plannedFte(hh, [{ qualification: 'studium_1', share: 60, hours }], weeks).fte).toBeCloseTo(0.6, 10)
    expect(plannedFte(presetFor('SN', REVISED), [{ qualification: 'praktikant', share: null, hours: full('SN') }], weeks).fte).toBe(0)
    expect(plannedFte(presetFor('SN', REVISED), [{ qualification: 'praktikant', share: 50, hours: full('SN') }], weeks).fte).toBeCloseTo(0.5, 10)
    expect(plannedFte(presetFor('BY', REVISED), [{ qualification: 'studium_3', share: 100, hours: full('BY') }], weeks).fte).toBeCloseTo(1, 10)
  })
})

/** applyOverrides on the state's version of `date`, with the state's law-value comparison for that version. */
function apply(land: GermanState, date: string, overrides: StaffingOverrides) {
  const preset = presetFor(land, date)
  return applyOverrides(preset, overrides, sameLawValueOf(land, preset))
}

describe('Träger overrides and the correction of 01.11.2026', () => {
  it('an override of BW azubi_1 set before still applies after 01.11.2026', () => {
    const overrides = { 'staffShares.azubi_1': { value: 30, preset: 0 } }
    expect(apply('BW', BEFORE, overrides)).toMatchObject({ applied: ['staffShares.azubi_1'], ignored: [] })
    const after = apply('BW', REVISED, overrides)
    expect(after).toMatchObject({ applied: ['staffShares.azubi_1'], ignored: [] })
    expect(after.rules.staffShares.azubi_1).toBe(30)
  })

  it('an override set against the corrected value applies before the correction too', () => {
    const overrides = { 'staffShares.praktikant': { value: 30, preset: 0 } }
    expect(apply('SN', BEFORE, overrides).rules.staffShares.praktikant).toBe(30)
    expect(apply('SN', REVISED, overrides).rules.staffShares.praktikant).toBe(30)
    expect(apply('HH', BEFORE, { 'staffShares.studium_2': { value: 60, preset: 90 } }).rules.staffShares.studium_2).toBe(60)
  })

  it('keeps overrides over a law version that follows the correction with the corrected value (NW 2027, BB 2027)', () => {
    expect(apply('NW', '2027-08-01', { 'staffShares.azubi_1': { value: 50, preset: 0 } }).rules.staffShares.azubi_1).toBe(50)
    expect(apply('BB', '2027-01-01', { 'staffShares.studium_1': { value: 50, preset: 0 } }).rules.staffShares.studium_1).toBe(50)
  })

  it('a law version still lapses an override of a value it changes', () => {
    // MV Krippe 1 : 6 → 1 : 5 from 01.01.2027 (BB keeps 4.25 in 2027, so it changes nothing there any more)
    expect(apply('MV', '2027-01-01', { 'demand.u3.childrenPerFte': { value: 5.5, preset: 6 } }).ignored).toEqual(['demand.u3.childrenPerFte'])
    const u3 = 'demand.u3+h<=30.childrenPerFte'
    expect(apply('BB', '2027-01-01', { [u3]: { value: 4.5, preset: 4.25 } }).ignored).toEqual([])
  })

  it('without the state\'s comparison only equal numbers count (as before)', () => {
    const overrides = { 'staffShares.azubi_1': { value: 30, preset: 0 } }
    expect(applyOverrides(presetFor('BW', REVISED), overrides).ignored).toEqual(['staffShares.azubi_1'])
    // a version that is not one of the state's: equal numbers only
    const foreign = { ...presetFor('BW', REVISED) }
    expect(applyOverrides(foreign, overrides, sameLawValueOf('BW', foreign)).ignored).toEqual(['staffShares.azubi_1'])
  })

  describe('sameLawValue joins values only within the run around a correction', () => {
    const base = presetFor('BW', BEFORE)
    const version = (validFrom: string, azubi: number, correction?: boolean): StaffingRuleSet =>
      ({ ...base, validFrom, ...(correction ? { correction } : {}), staffShares: { ...base.staffShares, azubi_1: azubi } })
    const path = 'staffShares.azubi_1'

    it('over several corrections in a row', () => {
      const versions = [base, version('2027-01-01', 40, true), version('2027-02-01', 60, true)]
      for (const target of versions) {
        const same = sameLawValue(versions, target)
        expect(same(path, target.staffShares.azubi_1, 0)).toBe(true)
        expect(same(path, target.staffShares.azubi_1, 40)).toBe(true)
        expect(same(path, target.staffShares.azubi_1, 60)).toBe(true)
        expect(same(path, target.staffShares.azubi_1, 50)).toBe(false)
        expect(same('staffShares.azubi_2', 0, 40)).toBe(false)
      }
    })

    it('not over a law version that changes the value, in either direction', () => {
      // 0 –(correction)→ 40 –(law)→ 0: an override against 40 lapses on the law version; one against 0 is plain equal
      const back = [base, version('2027-01-01', 40, true), version('2027-06-01', 0)]
      expect(sameLawValue(back, back[2]!)(path, 0, 40)).toBe(false)
      expect(sameLawValue(back, back[1]!)(path, 40, 0)).toBe(true)
      // 0 –(law)→ 50 –(correction)→ 0: the value before the law change stays outside the run of the law version
      const law = [version('2026-01-01', 0), version('2026-06-01', 50), version('2027-01-01', 0, true)]
      expect(sameLawValue(law, law[1]!)(path, 50, 0)).toBe(true)
      expect(sameLawValue(law, law[0]!)(path, 0, 50)).toBe(false)
      // a law version alone joins nothing
      const plain = [base, version('2027-01-01', 40)]
      expect(sameLawValue(plain, plain[1]!)(path, 40, 0)).toBe(false)
    })
  })

  it.each(GERMAN_STATES)('%s: a law version lapses every override of a value it changes (no wrong keep)', (land) => {
    const versions = presetVersions(land)
    versions.forEach((version, i) => {
      if (i === 0 || version.correction) return
      const previous = new Map(overridableValues(versions[i - 1]!).map(v => [v.path, v.value]))
      for (const { path, value } of overridableValues(version)) {
        const old = previous.get(path)
        if (old === undefined || old === value) continue
        const { ignored } = applyOverrides(version, { [path]: { value: old + 1, preset: old } }, sameLawValueOf(land, version))
        expect([land, version.validFrom, path, ignored]).toEqual([land, version.validFrom, path, [path]])
      }
    })
  })

  it.each(GERMAN_STATES)('%s: only the versions of 01.11.2026 are corrections', (land) => {
    for (const version of presetVersions(land)) {
      expect([land, version.validFrom, version.correction === true])
        .toEqual([land, version.validFrom, version.validFrom === TRAINEES_REVISED])
    }
  })

  it.each(REVISED_STATES)('%s: every override set before the correction keeps applying after it', (land) => {
    for (const { path, value } of overridableValues(presetFor(land, BEFORE))) {
      expect([land, path, apply(land, REVISED, { [path]: { value: value + 1, preset: value } }).ignored]).toEqual([land, path, []])
    }
  })
})
