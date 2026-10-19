import { describe, expect, it } from 'vitest'
import { automaticSchoolStart, openSchoolStart, resyncSchoolStart, schoolStartToSave } from '../../app/utils/schoolStartForm'

describe('school start in the master form', () => {
  it('keeps an unchanged prefill automatic', () => {
    const opened = openSchoolStart({ value: '', prefill: '' }, '2028-09-01')
    expect(opened).toEqual({ value: '2028-09-01', prefill: '2028-09-01' })
    expect(schoolStartToSave(opened)).toBeNull()
  })

  it('follows a changed birth date while the prefill is untouched, and stays automatic', () => {
    const opened = openSchoolStart({ value: '', prefill: '' }, '2028-09-01')
    const resynced = resyncSchoolStart(opened, '2027-09-01')
    expect(resynced).toEqual({ value: '2027-09-01', prefill: '2027-09-01' })
    expect(schoolStartToSave(resynced)).toBeNull()
    // Even without the resync the stale prefill is not stored.
    expect(schoolStartToSave(opened)).toBeNull()
  })

  it('saves an edited date and no longer follows the birth date', () => {
    const edited = { ...openSchoolStart({ value: '', prefill: '' }, '2028-09-01'), value: '2029-09-01' }
    expect(schoolStartToSave(edited)).toBe('2029-09-01')
    expect(resyncSchoolStart(edited, '2027-09-01')).toEqual(edited)
    expect(schoolStartToSave(resyncSchoolStart(edited, '2027-09-01'))).toBe('2029-09-01')
  })

  it('keeps a school start set by hand when opened, and saves it', () => {
    const opened = openSchoolStart({ value: '2029-09-01', prefill: '' }, '2028-09-01')
    expect(opened).toEqual({ value: '2029-09-01', prefill: '' })
    expect(schoolStartToSave(opened)).toBe('2029-09-01')
    expect(resyncSchoolStart(opened, '2027-09-01')).toEqual(opened)
  })

  it('clears to automatic with „Wieder automatisch“ and on an emptied input', () => {
    expect(automaticSchoolStart()).toEqual({ value: '', prefill: '' })
    expect(schoolStartToSave(automaticSchoolStart())).toBeNull()
    expect(schoolStartToSave({ value: '', prefill: '2028-09-01' })).toBeNull()
  })

  it('opens empty while there is no computed school start yet', () => {
    expect(openSchoolStart({ value: '', prefill: '' }, '')).toEqual({ value: '', prefill: '' })
  })
})
