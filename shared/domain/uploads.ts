/**
 * The size limit of uploaded files (docs/BETRIEB.md „Hochladen“): one value for every document upload – PDF, JPG and PNG
 * in the child and personnel records, Vorlagen, „Wissen“, health office documents, accident attachments, cash receipts,
 * filled PDFs – checked in the browser on selection and on the server before the body is read. The street list import
 * (Schulbezirke) has its own, lower limit (SCHOOL_DISTRICT_LIMITS.maxBytes).
 */
export const MAX_UPLOAD_MB = 30
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024

/** A size in MB as shown in messages: „31,2“. */
export const megabytes = (bytes: number) => (Math.ceil(bytes / 1024 / 1024 * 10) / 10).toLocaleString('de-DE', { maximumFractionDigits: 1 })
