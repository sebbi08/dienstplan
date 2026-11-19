import { describe, expect, it } from 'vitest'
import { de } from '../../app/locales/de'
import { staffingPathLabel } from '../../app/utils/staffing'
import { QUALIFICATION_TITLES } from '../../shared/domain/accidents'
import { isFachkraft, plannedFte, quotaLines, requiredFte, ruleSetProblems } from '../../shared/domain/staffing/calc'
import { applyOverrides } from '../../shared/domain/staffing/overrides'
import { presetFor, presetVersions } from '../../shared/domain/staffing/presets'
import { shares, TRAINEES_REVISED } from '../../shared/domain/staffing/presets/common'
import { QUALIFICATIONS, type Qualification } from '../../shared/domain/staffing/types'
import { GERMAN_STATES, type GermanState } from '../../shared/domain/states'

const REVISED = '2026-11-19'
const BEFORE = '2026-11-18'
const weeks = 30 / 7

type Keys = 'studium_1' | 'studium_2' | 'studium_3' | 'azubi_1' | 'azubi_2' | 'azubi_3' | 'praktikant' | 'ergaenzung'

/** Requirement 3 of the brief: the shares from 19.11.2026 (percent). */
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

/** The states whose preset got a new version on 19.11.2026. */
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

describe('presets – trainee and student shares from 19.11.2026', () => {
  it('dates the revision 19.11.2026', () => {
    expect(TRAINEES_REVISED).toBe(REVISED)
  })

  it.each(GERMAN_STATES)('%s: shares of trainees, students, Berufspraktikanten and Ergänzungskräfte', (land) => {
    expect(sharesOf(land, REVISED)).toEqual(EXPECTED[land])
    // and in every later version
    for (const version of presetVersions(land).filter(v => v.validFrom > REVISED)) {
      expect([version.validFrom, sharesOf(land, version.validFrom)]).toEqual([version.validFrom, EXPECTED[land]])
    }
  })

  it.each(REVISED_STATES)('%s: a new version from 19.11.2026; the earlier ones keep their values', (land) => {
    const revised = presetFor(land, REVISED)
    expect(revised.validFrom).toBe(REVISED)
    expect(ruleSetProblems(revised)).toEqual([])
    const before = presetFor(land, BEFORE)
    expect(before.validFrom < REVISED).toBe(true)
    for (const q of ['studium_1', 'studium_2', 'studium_3'] as const) expect(before.staffShares[q]).toBe(0)
    // everything but shares, quotas, Fachkraft set, note and source stays as it was
    const strip = ({ validFrom: _v, note: _n, source: _s, staffShares: _sh, quotas: _q, fachkraftQualifications: _f, ...rest }: typeof revised) => rest
    expect(strip(revised)).toEqual(strip(before))
    expect(revised.note).toContain('19.11.2026')
  })

  it('keeps the values before 19.11.2026 (no rewritten history)', () => {
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

describe('Träger overrides and the 19.11.2026 version', () => {
  it('an override of a value the new version changed lapses from 19.11.2026 and keeps counting before', () => {
    const overrides = { 'staffShares.praktikant': { value: 30, preset: 50 } }
    const before = applyOverrides(presetFor('SN', BEFORE), overrides)
    expect(before.applied).toEqual(['staffShares.praktikant'])
    expect(before.rules.staffShares.praktikant).toBe(30)
    const after = applyOverrides(presetFor('SN', REVISED), overrides)
    expect(after.ignored).toEqual(['staffShares.praktikant'])
    expect(after.rules.staffShares.praktikant).toBe(0)
  })

  it('an override of a value the new version kept still applies', () => {
    const overrides = { 'staffShares.ergaenzung': { value: 50, preset: 0 }, 'demand.regel.ftePerGroup': { value: 2.1, preset: 1.8 } }
    const { rules, applied, ignored } = applyOverrides(presetFor('BW', REVISED), overrides)
    expect(ignored).toEqual([])
    expect(applied.sort()).toEqual(['demand.regel.ftePerGroup', 'staffShares.ergaenzung'])
    expect(rules.staffShares.ergaenzung).toBe(50)
  })

  it('an override of a student share set today does not apply to the earlier version', () => {
    const overrides = { 'staffShares.studium_2': { value: 60, preset: 90 } }
    expect(applyOverrides(presetFor('HH', REVISED), overrides).rules.staffShares.studium_2).toBe(60)
    expect(applyOverrides(presetFor('HH', BEFORE), overrides).ignored).toEqual(['staffShares.studium_2'])
  })

  it.each(REVISED_STATES)('%s: overrides set before the revision apply where the value stayed the same', (land) => {
    const before = presetFor(land, BEFORE)
    const revised = presetFor(land, REVISED)
    for (const q of QUALIFICATIONS as readonly Qualification[]) {
      const preset = before.staffShares[q]
      const { ignored } = applyOverrides(revised, { [`staffShares.${q}`]: { value: preset === 7 ? 8 : 7, preset } })
      expect([land, q, ignored.length]).toEqual([land, q, revised.staffShares[q] === preset ? 0 : 1])
    }
  })
})
