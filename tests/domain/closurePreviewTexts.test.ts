import { describe, expect, it } from 'vitest'
import { de } from '../../app/locales/de'

const t = de.closurePreview

describe('texts of „Schließzeiten als Urlaub“', () => {
  it('names what stays free, with the Resturlaub inside the sentence', () => {
    expect(t.free(30, 15, 0, false)).toBe('Bei 30 Urlaubstagen bleiben 15 Tage frei verfügbar.')
    expect(t.free(30, 15, 2, false)).toBe('Bei 30 Urlaubstagen bleiben 15 Tage frei verfügbar (plus 2 Tage Resturlaub).')
    expect(t.free(1, 1, 0, false)).toBe('Bei 1 Urlaubstag bleibt 1 Tag frei verfügbar.')
    expect(t.free(30, 20.5, 0, false)).toBe('Bei 30 Urlaubstagen bleiben 20,5 Tage frei verfügbar.')
  })

  it('says for an existing employee that only the closures are taken off', () => {
    expect(t.free(30, 15, 0, true)).toBe('Bei 30 Urlaubstagen bleiben nach Abzug der Schließzeiten 15 Tage.')
    expect(t.free(30, 15, 2, true)).toBe('Bei 30 Urlaubstagen bleiben nach Abzug der Schließzeiten 15 Tage (plus 2 Tage Resturlaub).')
  })

  it('names the days the closures need beyond the entitlement instead of a negative figure', () => {
    expect(t.free(30, -5, 0, false)).toBe('Die Schließzeiten brauchen 5 Tage mehr als der Anspruch.')
    expect(t.free(2, -1, 0, true)).toBe('Die Schließzeiten brauchen 1 Tag mehr als der Anspruch.')
    expect(t.free(2, -0.5, 1, false)).toBe('Die Schließzeiten brauchen 0,5 Tage mehr als der Anspruch (plus 1 Tag Resturlaub).')
  })
})
