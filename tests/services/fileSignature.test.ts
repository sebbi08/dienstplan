import { describe, expect, it } from 'vitest'
import { detectDocumentMime } from '../../server/lib/fileSignature'

const bytes = (...values: number[]) => new Uint8Array([...values, 0, 0, 0, 0])
const text = (value: string) => new TextEncoder().encode(value)

describe('detectDocumentMime', () => {
  it('detects PDF, JPEG and PNG by their signature', () => {
    expect(detectDocumentMime(text('%PDF-1.7\n...'))).toBe('application/pdf')
    expect(detectDocumentMime(bytes(0xFF, 0xD8, 0xFF, 0xE0))).toBe('image/jpeg')
    expect(detectDocumentMime(bytes(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A))).toBe('image/png')
  })

  it('rejects everything else', () => {
    expect(detectDocumentMime(text('%PDX-1.7'))).toBeNull()
    expect(detectDocumentMime(new Uint8Array())).toBeNull()
    expect(detectDocumentMime(text('%PDF'))).toBeNull()
    // a docx (ZIP) renamed to .pdf
    expect(detectDocumentMime(bytes(0x50, 0x4B, 0x03, 0x04))).toBeNull()
    // PNG signature cut short
    expect(detectDocumentMime(new Uint8Array([0x89, 0x50, 0x4E, 0x47]))).toBeNull()
  })
})
