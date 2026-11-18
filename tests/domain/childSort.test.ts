import { describe, expect, it } from 'vitest'
import { CHILD_SORTS, childComparator, isChildSort, type ChildSort } from '#shared/domain/childSort'

const kid = (firstName: string, lastName: string, birthDate: string) => ({ firstName, lastName, birthDate })
const order = (sort: ChildSort, rows: ReturnType<typeof kid>[]) =>
  [...rows].sort(childComparator(sort)).map(row => `${row.firstName} ${row.lastName}`)

const rows = [
  kid('Bea', 'Özil', '2021-05-01'), kid('Anna', 'Oberle', '2020-01-01'), kid('Ümit', 'Zorn', '2022-03-03'),
  kid('Anna', 'Müller', '2019-07-07'), kid('Ände', 'Baum', '2019-07-07'),
]

describe('childComparator', () => {
  it('has the six values', () => {
    expect(CHILD_SORTS).toHaveLength(6)
    expect(isChildSort('age_desc')).toBe(true)
    expect(isChildSort('nope')).toBe(false)
  })

  it('first_asc: first name, then last name; umlauts sort with their base letter', () => {
    expect(order('first_asc', rows)).toEqual(['Ände Baum', 'Anna Müller', 'Anna Oberle', 'Bea Özil', 'Ümit Zorn'])
  })

  it('first_desc reverses both parts', () => {
    expect(order('first_desc', rows)).toEqual(['Ümit Zorn', 'Bea Özil', 'Anna Oberle', 'Anna Müller', 'Ände Baum'])
  })

  it('last_asc: Özil comes after Oberle', () => {
    expect(order('last_asc', rows)).toEqual(['Ände Baum', 'Anna Müller', 'Anna Oberle', 'Bea Özil', 'Ümit Zorn'])
  })

  it('last_desc', () => {
    expect(order('last_desc', rows)).toEqual(['Ümit Zorn', 'Bea Özil', 'Anna Oberle', 'Anna Müller', 'Ände Baum'])
  })

  it('name ties fall back to the other name part, then the birth date', () => {
    const twins = [kid('Max', 'Meier', '2022-02-02'), kid('Max', 'Meier', '2021-01-01'), kid('Alex', 'Meier', '2023-01-01')]
    expect([...twins].sort(childComparator('last_asc')).map(row => row.birthDate)).toEqual(['2023-01-01', '2021-01-01', '2022-02-02'])
    expect([...twins].sort(childComparator('first_desc')).map(row => row.birthDate)).toEqual(['2021-01-01', '2022-02-02', '2023-01-01'])
  })

  it('age_desc: oldest first, ties by first name then last name', () => {
    expect(order('age_desc', rows)).toEqual(['Ände Baum', 'Anna Müller', 'Anna Oberle', 'Bea Özil', 'Ümit Zorn'])
  })

  it('age_asc: youngest first, ties by first name then last name', () => {
    expect(order('age_asc', rows)).toEqual(['Ümit Zorn', 'Bea Özil', 'Anna Oberle', 'Ände Baum', 'Anna Müller'])
  })
})
