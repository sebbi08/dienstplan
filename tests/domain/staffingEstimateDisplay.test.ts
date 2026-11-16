import { describe, expect, it } from 'vitest'
import { assumptionText, estimateLines, presenceSentence } from '../../app/utils/staffingEstimate'
import type { StaffingEstimatePresenceDto } from '../../shared/types/api'
import { de } from '../../app/locales/de'

const rule = (over: Partial<StaffingEstimatePresenceDto>): StaffingEstimatePresenceDto => ({
  window: 'always', minStaff: null, minFachkraft: null, minChildren: null, perChildren: null, ...over,
})

describe('presenceSentence', () => {
  it('BW VÖ: one sentence for both rules', () => {
    expect(presenceSentence([rule({ minFachkraft: 1 }), rule({ window: 'haupt', minFachkraft: 2 })]))
      .toBe('Mindestens 1 Fachkraft während der ganzen Öffnungszeit, 2 Fachkräfte in der Hauptbetreuungszeit.')
  })

  it('names staff, Fachkräfte, blocks of children and the minimum of children present', () => {
    expect(presenceSentence([rule({ minStaff: 2, minFachkraft: 1 })]))
      .toBe('Mindestens 2 Kräfte, davon 1 Fachkraft während der ganzen Öffnungszeit.')
    expect(presenceSentence([rule({ window: 'haupt', minStaff: 3, minFachkraft: 1, minChildren: 11 })]))
      .toBe('Mindestens 3 Kräfte, davon 1 Fachkraft in der Hauptbetreuungszeit ab 11 anwesenden Kindern.')
    expect(presenceSentence([rule({ perChildren: { children: 10, staff: 2, fachkraft: 1 } })]))
      .toBe('Mindestens 2 Kräfte, davon 1 Fachkraft je angefangene 10 Kinder während der ganzen Öffnungszeit.')
  })

  it('is null without rules', () => {
    expect(presenceSentence([])).toBeNull()
  })
})

describe('assumptionText', () => {
  it('states the hours and the children under 3', () => {
    expect(assumptionText({ children: 25, u3: 0, school: 0, weeklyHoursPerChild: 30, hoursSource: 'opening' }))
      .toBe('angenommen: alle Plätze ganztags belegt, 30 Std./Woche je Kind')
    expect(assumptionText({ children: 25, u3: 1, school: 0, weeklyHoursPerChild: 32.5, hoursSource: 'opening' }))
      .toBe('angenommen: alle Plätze ganztags belegt, 32,5 Std./Woche je Kind; 1 Kind unter 3 (in der Gruppe sind zurzeit Kinder unter 3)')
    expect(assumptionText({ children: 10, u3: 10, school: 0, weeklyHoursPerChild: null, hoursSource: 'none' }))
      .toBe('angenommen: alle Plätze belegt; alle Kinder unter 3')
    expect(assumptionText({ children: 10, u3: 0, school: 0, weeklyHoursPerChild: 35, hoursSource: 'reference' }))
      .toContain('Öffnungszeit laut Gruppenart')
    expect(assumptionText({ children: 14, u3: 3, school: 0, weeklyHoursPerChild: 50, hoursSource: 'opening' }))
      .toBe('angenommen: alle Plätze ganztags belegt, 50 Std./Woche je Kind; 3 Kinder unter 3 (so viele wie zurzeit in der Gruppe)')
  })
})

describe('the headline at full occupancy', () => {
  it('says „1 Platz“ but „2 Plätze“', () => {
    expect(de.staffing.estimate.full(1, null)).toBe('Bei voller Belegung (1 Platz):')
    expect(de.staffing.estimate.full(2, 'Regelgruppe')).toBe('Bei voller Belegung (2 Plätze, Regelgruppe):')
  })
})

describe('estimateLines', () => {
  it('splits the counting surcharges from the shown-only lines (Leitung) and leaves out the base demand', () => {
    const lines = [
      { key: 'demand', label: 'Grundbedarf', fte: 2, counts: true },
      { key: 'verfuegung', label: 'Verfügungszeit', fte: 0.2, counts: true },
      { key: 'leitung', label: 'Leitungszeit', fte: 0.1, counts: false },
      { key: 'zero', label: 'Nichts', fte: 0, counts: false },
    ]
    expect(estimateLines(lines)).toEqual({ included: [lines[1]], shown: [lines[2]] })
  })
})
