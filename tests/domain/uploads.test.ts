import { describe, expect, it } from 'vitest'
import { de } from '../../app/locales/de'
import { pickedFile, uploadSizeError } from '../../app/utils/uploads'
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB, megabytes } from '../../shared/domain/uploads'

const MB = 1024 * 1024

describe('the upload limit in the browser', () => {
  it('says at once that a file is too large, with its size', () => {
    expect(MAX_UPLOAD_MB).toBe(30)
    expect(uploadSizeError(MAX_UPLOAD_BYTES)).toBeNull()
    expect(uploadSizeError(MAX_UPLOAD_BYTES + 1)).toBe('Die Datei ist zu groß (30,1 MB). Erlaubt sind höchstens 30 MB.')
    expect(uploadSizeError(31.2 * MB)).toBe('Die Datei ist zu groß (31,2 MB). Erlaubt sind höchstens 30 MB.')
    // A lower limit of its own (the street list).
    expect(uploadSizeError(12 * MB, 10 * MB)).toBe('Die Datei ist zu groß (12 MB). Erlaubt sind höchstens 10 MB.')
    expect(megabytes(2.04 * MB)).toBe('2,1')
  })

  it('clears a too large choice and keeps a fitting one', () => {
    const shown: string[] = []
    const toast = { add: (entry: { title: string }) => shown.push(entry.title) }
    const input = (size: number) => ({ files: [{ size, name: 'a.pdf' }], value: 'C:\\fakepath\\a.pdf' })
    const big = input(MAX_UPLOAD_BYTES + 1)
    expect(pickedFile({ target: big } as unknown as Event, toast)).toBeNull()
    expect(big.value).toBe('')
    expect(shown).toHaveLength(1)
    const fine = input(MAX_UPLOAD_BYTES)
    expect(pickedFile({ target: fine } as unknown as Event, toast)).toBe(fine.files[0])
    expect(fine.value).not.toBe('')
    expect(pickedFile({ target: { files: [] } } as unknown as Event, toast)).toBeNull()
  })

  it('names 30 MB in every text about uploads', () => {
    const texts = JSON.stringify(de)
    // Only the street list (Schulbezirke) keeps 10 MB.
    expect(texts.match(/10 MB/g)).toEqual(['10 MB'])
    expect(de.errors.school_district_file_too_large).toContain('10 MB')
    expect(de.errors.document_too_large).toContain('30 MB')
  })
})
