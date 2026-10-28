import { describe, expect, it } from 'vitest'
import { type CallOrderContact, callOrder } from '../../shared/domain/callOrder'

type Contact = CallOrderContact & { name: string }
const contact = (name: string, values: Partial<CallOrderContact> = {}): Contact => ({
  name, isGuardian: false, emergencyRank: null, contactBan: false, ...values,
})
const names = (contacts: Contact[]): string[] => contacts.map(entry => entry.name)

describe('callOrder', () => {
  // In the record's order (the arrows).
  const record = [
    contact('Nachbarin'),
    contact('Opa', { emergencyRank: 2 }),
    contact('Vater', { isGuardian: true }),
    contact('Tante'),
    contact('Mutter', { isGuardian: true, emergencyRank: 3 }),
    contact('Oma', { emergencyRank: 1 }),
    contact('Stiefvater', { isGuardian: true, emergencyRank: 1 }),
  ]

  it('puts the parents first by number, then the others with a number, then the others in the record order', () => {
    expect(names(callOrder(record))).toEqual(['Stiefvater', 'Mutter', 'Vater', 'Oma', 'Opa', 'Nachbarin', 'Tante'])
  })

  it('leaves out the others without a number for the "Wichtig" box, but keeps parents without one', () => {
    expect(names(callOrder(record, { withUnnumbered: false }))).toEqual(['Stiefvater', 'Mutter', 'Vater', 'Oma', 'Opa'])
  })

  it('keeps the record order for equal numbers and for parents without a number', () => {
    expect(names(callOrder([
      contact('Opa', { emergencyRank: 1 }),
      contact('Vater', { isGuardian: true }),
      contact('Oma', { emergencyRank: 1 }),
      contact('Mutter', { isGuardian: true }),
      contact('Pate', { isGuardian: true, emergencyRank: 2 }),
      contact('Patin', { isGuardian: true, emergencyRank: 2 }),
    ]))).toEqual(['Pate', 'Patin', 'Vater', 'Mutter', 'Opa', 'Oma'])
  })

  it('never lists a contact with a contact ban, not even a parent', () => {
    const contacts = [
      contact('Vater', { isGuardian: true, contactBan: true }),
      contact('Onkel', { contactBan: true }),
      contact('Mutter', { isGuardian: true }),
    ]
    expect(names(callOrder(contacts))).toEqual(['Mutter'])
    expect(names(callOrder(contacts, { withUnnumbered: false }))).toEqual(['Mutter'])
  })

  it('puts the contacts with a contact ban at the very end, in the record order, only with withBanned', () => {
    const contacts = [
      contact('Onkel', { contactBan: true }),
      contact('Tante'),
      contact('Vater', { isGuardian: true, contactBan: true }),
      contact('Oma', { emergencyRank: 1 }),
      contact('Mutter', { isGuardian: true }),
    ]
    expect(names(callOrder(contacts, { withBanned: true }))).toEqual(['Mutter', 'Oma', 'Tante', 'Onkel', 'Vater'])
    expect(names(callOrder(contacts, { withBanned: true, withUnnumbered: false })))
      .toEqual(['Mutter', 'Oma', 'Onkel', 'Vater'])
  })

  it('returns a new list and leaves the given one as it is', () => {
    const contacts = [contact('Oma', { emergencyRank: 1 }), contact('Mutter', { isGuardian: true })]
    expect(names(callOrder(contacts))).toEqual(['Mutter', 'Oma'])
    expect(names(contacts)).toEqual(['Oma', 'Mutter'])
    expect(callOrder([])).toEqual([])
  })
})
