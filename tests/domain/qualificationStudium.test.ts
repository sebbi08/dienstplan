import { describe, expect, it } from 'vitest'
import { de } from '../../app/locales/de'
import { staffingPathLabel } from '../../app/utils/staffing'
import { QUALIFICATION_TITLES } from '../../shared/domain/accidents'
import { isFachkraft, plannedFte, quotaLines, requiredFte, ruleSetProblems } from '../../shared/domain/staffing/calc'
import { applyOverrides, overridableValues, sameLawValue } from '../../shared/domain/staffing/overrides'
import { presetFor, presetVersions, sameLawValueOf } from '../../shared/domain/staffing/presets'
import { shares, TRAINEES_REVISED } from '../../shared/domain/staffing/presets/common'
import { QUALIFICATIONS, type Qualification } from '../../shared/domain/staffing/types'
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
  it('adds studium_1/2/3 right after azubi_3, with German labels', () => {
    expect([...QUALIFICATIONS]).toEqual([
      'fachkraft', 'ergaenzung', 'azubi_1', 'azubi_2', 'azubi_3', 'studium_1', 'studium_2', 'studium_3',
      'praktikant', 'haushalt', 'none',
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
    expect(QUALIFICATION_TITLES.studium_1).toBe('Studium praxisintegriert/dual (1. Studienjahr)')
    expect(QUALIFICATION_TITLES.studium_2).toBe('Studium praxisintegriert/dual (2. Studienjahr)')
    expect(QUALIFICATION_TITLES.studium_3).toBe('Studium praxisintegriert/dual (ab 3. Studienjahr)')
    expect(QUALIFICATION_TITLES.praktikant).toBe('Berufspraktikant/in (Anerkennungsjahr)')
    // no pedagogic job title for `none`: the field stays empty
    expect(QUALIFICATION_TITLES.none).toBeUndefined()
    for (const q of QUALIFICATIONS) if (q !== 'none') expect(QUALIFICATION_TITLES[q]).toBe(de.staffing.qualifications[q])
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
    expect(quota).toMatchObject({ kind: 'min_share', pct: 80, base: 'required' })
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
      .toEqual(['azubi_1', 'azubi_2', 'azubi_3', 'studium_1', 'studium_2', 'studium_3'])
  })

  it('MV: Assistenzkräfte and trainees together at most 25 % of the required staff', () => {
    const quota = presetFor('MV', REVISED).quotas.find(q => q.kind === 'max_share')!
    expect(quota).toMatchObject({ pct: 25, base: 'required' })
    expect([...quota.qualifications].sort()).toEqual(['azubi_1', 'azubi_2', 'azubi_3', 'ergaenzung'])
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

describe('Träger overrides and the correction of 01.11.2026', () => {
  it('an override of BW azubi_1 set before still applies after 01.11.2026', () => {
    const overrides = { 'staffShares.azubi_1': { value: 30, preset: 0 } }
    const before = applyOverrides(presetFor('BW', BEFORE), overrides, sameLawValueOf('BW'))
    expect(before).toMatchObject({ applied: ['staffShares.azubi_1'], ignored: [] })
    const after = applyOverrides(presetFor('BW', REVISED), overrides, sameLawValueOf('BW'))
    expect(after).toMatchObject({ applied: ['staffShares.azubi_1'], ignored: [] })
    expect(after.rules.staffShares.azubi_1).toBe(30)
  })

  it('an override set against the corrected value applies before the correction too', () => {
    const overrides = { 'staffShares.praktikant': { value: 30, preset: 0 } }
    expect(applyOverrides(presetFor('SN', BEFORE), overrides, sameLawValueOf('SN')).rules.staffShares.praktikant).toBe(30)
    expect(applyOverrides(presetFor('SN', REVISED), overrides, sameLawValueOf('SN')).rules.staffShares.praktikant).toBe(30)
    const studium = { 'staffShares.studium_2': { value: 60, preset: 90 } }
    expect(applyOverrides(presetFor('HH', BEFORE), studium, sameLawValueOf('HH')).rules.staffShares.studium_2).toBe(60)
  })

  it('keeps overrides over a law version that follows the correction with the corrected value (NW 2027, BB 2027)', () => {
    const nw = applyOverrides(presetFor('NW', '2027-08-01'), { 'staffShares.azubi_1': { value: 50, preset: 0 } }, sameLawValueOf('NW'))
    expect(nw.rules.staffShares.azubi_1).toBe(50)
    const bb = applyOverrides(presetFor('BB', '2027-01-01'), { 'staffShares.studium_1': { value: 50, preset: 0 } }, sameLawValueOf('BB'))
    expect(bb.rules.staffShares.studium_1).toBe(50)
    expect(presetFor('BB', '2027-01-01').correction).toBe(false)
    expect(presetFor('NW', '2027-08-01').correction).toBe(false)
  })

  it('a law version still lapses an override of a value it changes', () => {
    const u3 = 'demand.u3+h<=30.childrenPerFte'
    const january = applyOverrides(presetFor('BB', '2027-01-01'), { [u3]: { value: 4.5, preset: 4.25 } }, sameLawValueOf('BB'))
    expect(january.ignored).toEqual([u3])
  })

  it('without the state\'s comparison only equal numbers count (as before)', () => {
    const overrides = { 'staffShares.azubi_1': { value: 30, preset: 0 } }
    expect(applyOverrides(presetFor('BW', REVISED), overrides).ignored).toEqual(['staffShares.azubi_1'])
  })

  it('sameLawValue joins the old and the corrected value per path, over several corrections', () => {
    const base = presetFor('BW', BEFORE)
    const fix = (azubi: number, ergaenzung: number, validFrom: string) =>
      ({ ...base, validFrom, correction: true, staffShares: { ...base.staffShares, azubi_1: azubi, ergaenzung } })
    const same = sameLawValue([base, fix(40, 0, '2027-01-01'), fix(60, 0, '2027-02-01')])
    expect(same('staffShares.azubi_1', 0, 60)).toBe(true)
    expect(same('staffShares.azubi_1', 40, 0)).toBe(true)
    expect(same('staffShares.azubi_1', 0, 50)).toBe(false)
    expect(same('staffShares.azubi_2', 0, 40)).toBe(false)
    const law = sameLawValue([base, { ...fix(40, 0, '2027-01-01'), correction: false }])
    expect(law('staffShares.azubi_1', 0, 40)).toBe(false)
  })

  it.each(REVISED_STATES)('%s: every override set before the correction keeps applying after it', (land) => {
    const before = presetFor(land, BEFORE)
    const revised = presetFor(land, REVISED)
    for (const { path, value } of overridableValues(before)) {
      const { ignored } = applyOverrides(revised, { [path]: { value: value + 1, preset: value } }, sameLawValueOf(land))
      expect([land, path, ignored]).toEqual([land, path, []])
    }
  })
})
