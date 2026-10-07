import { pdfQuery } from '../schemas'

export default defineServiceHandler(async (event) => {
  // Any signed-in person (not the tablet); the print page itself then checks what this person may see.
  await requireUser(event)
  const { path, name } = await getValidatedQuery(event, pdfQuery.parse)
  if (!PDF_PATH.test(path)) throw createError({ statusCode: 400, statusMessage: 'invalid_pdf_path', data: { code: 'invalid_pdf_path' } })
  const pdf = await renderPdf(path, getRequestHeader(event, 'cookie'))
  setResponseHeaders(event, {
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${name.endsWith('.pdf') ? name : `${name}.pdf`}"`,
    'Cache-Control': 'no-store',
  })
  return pdf
})
