import { describe, expect, it } from 'vitest'
import { mayEditChildren } from '../../shared/domain/roles'

describe('mayEditChildren', () => {
  it('always allows the managers', () => {
    expect(mayEditChildren({ role: 'provider', canEditChildren: false })).toBe(true)
    expect(mayEditChildren({ role: 'admin', canEditChildren: false })).toBe(true)
  })
  it('allows a Mitarbeiter only with the flag', () => {
    expect(mayEditChildren({ role: 'observer', canEditChildren: false })).toBe(false)
    expect(mayEditChildren({ role: 'observer', canEditChildren: true })).toBe(true)
  })
  it('never allows the tablet', () => {
    expect(mayEditChildren({ role: 'terminal', canEditChildren: true })).toBe(false)
  })
})
