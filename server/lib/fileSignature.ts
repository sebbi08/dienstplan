/** Largest document accepted for a child's record. */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024

export type DocumentMime = 'application/pdf' | 'image/jpeg' | 'image/png'

const SIGNATURES: { mime: DocumentMime; bytes: number[] }[] = [
  { mime: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46, 0x2D] }, // %PDF-
  { mime: 'image/jpeg', bytes: [0xFF, 0xD8, 0xFF] },
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] },
]

/**
 * The type of a document judged by its first bytes only (a file name or the type the browser reports proves nothing);
 * null for anything but PDF, JPEG and PNG.
 */
export function detectDocumentMime(bytes: Uint8Array): DocumentMime | null {
  const match = SIGNATURES.find(signature =>
    bytes.length >= signature.bytes.length && signature.bytes.every((byte, index) => bytes[index] === byte))
  return match?.mime ?? null
}

/** File extension (without dot) of a detected type. */
export const DOCUMENT_EXTENSIONS: Record<DocumentMime, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
}
