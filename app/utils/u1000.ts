import type { FormAnswers, FormContent } from '#shared/domain/forms'
import type { AccidentFormDto, FormTemplateDto } from '#shared/types/api'
import { formatTime } from '#shared/domain/time'
import { de } from '~/locales/de'
import { formatDate } from '~/utils/format'

/**
 * The printout of an Unfallanzeige in the layout of the official DGUV form U 1000 (page 1): numbered boxes 1–28 in its
 * arrangement, ticked or empty squares for the choices, field 15 from the form's header (Datum, Uhrzeit), and the
 * signature row „Datum · Unternehmer/-in (Bevollmächtigte/-r) · Betriebsrat (Personalrat) · Telefon-Nr. für Rückfragen“
 * (field 29). The items are matched to the boxes by their official numbers (shared/domain/accidents.ts u1000Fields), so a
 * changed copy of the starter still prints; items without a box come under „Weitere Angaben“.
 */

/** The boxes in the order and width (of 12 columns) of the official page. */
export const U1000_LAYOUT: readonly { field: number; span: number; tall?: boolean }[] = [
  { field: 1, span: 7, tall: true }, { field: 2, span: 5 }, { field: 3, span: 12 },
  { field: 4, span: 8 }, { field: 5, span: 4 },
  { field: 6, span: 12 },
  { field: 7, span: 5 }, { field: 8, span: 4 }, { field: 9, span: 3 },
  { field: 10, span: 3 }, { field: 11, span: 9 },
  { field: 12, span: 4 }, { field: 13, span: 8 },
  { field: 14, span: 3 }, { field: 15, span: 9 },
  { field: 16, span: 9 }, { field: 17, span: 3 },
  { field: 18, span: 12, tall: true },
  { field: 19, span: 6 }, { field: 20, span: 6 },
  { field: 21, span: 12 },
  { field: 22, span: 7 }, { field: 23, span: 5 },
  { field: 24, span: 7 }, { field: 25, span: 5 },
  { field: 26, span: 12 },
  { field: 27, span: 12 }, { field: 28, span: 12 },
]

export interface U1000Sheet {
  title: string
  fileName: string
  content: FormContent
  answers: FormAnswers
  /** Field 15 from the header („17.11.2026, 10:30 Uhr“); '' when blank. */
  accidentTime: string
  /** Small print under the form: the header ticks, the attachments, the legal hint. */
  notes: string[]
  blank: boolean
  updatedAt: string
  updatedBy: string
}

/** A filled Unfallanzeige. */
export function u1000Sheet(data: AccidentFormDto): U1000Sheet {
  const a = de.accidents
  const yesNo = (value: boolean) => (value ? a.yes : a.no)
  const time = data.start === null ? '' : `, ${formatTime(data.start).padStart(5, '0')} ${a.u1000Hour}`
  return {
    title: data.title, fileName: `Unfallanzeige-${data.id}-${data.date}`, content: data.content, answers: data.answers,
    accidentTime: data.date ? `${formatDate(data.date)}${time}` : '',
    notes: [
      [`${a.doctor}: ${yesNo(data.doctor)}`, `${a.unfit}: ${yesNo(data.unfit)}`,
        data.reportedOn ? a.reported(formatDate(data.reportedOn)) : a.notReported].join(' · '),
      ...(data.attachments.length ? [a.attachmentsList(data.attachments.map(file => file.fileName).join(', '))] : []),
      a.legalHint,
    ],
    blank: false, updatedAt: data.updatedAt, updatedBy: data.updatedBy,
  }
}

/** The template printed blank, to fill in by hand. */
export function blankU1000Sheet(template: Pick<FormTemplateDto, 'name' | 'content'>): U1000Sheet {
  return {
    title: template.name, fileName: `Vorlage-${template.name}`, content: template.content, answers: {}, accidentTime: '',
    notes: [de.accidents.legalHint], blank: true, updatedAt: '', updatedBy: '',
  }
}
