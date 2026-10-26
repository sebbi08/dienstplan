import { addItem, addSection, type FormContent, type FormKind, type ItemDraft } from '../forms'

/**
 * The starter templates every facility gets once (see spec §7): texts taken word for word from the facility's paper
 * forms („&amp;“ as „&“). Header fields (name, date …) and signature lines are not part of a template.
 */
export type StarterKey = 'staff_self_assessment' | 'staff_assessment'

export interface StarterTemplate {
  key: StarterKey
  kind: FormKind
  name: string
  selfAssessment: boolean
  sections: { title: string; hint: string; items: ItemDraft[] }[]
}

/**
 * The legend the forms show above every section with ratings (spec §2), from the Beurteilungsbogen; not part of any
 * template. `value` is the stored rating, `symbol` what the form shows.
 */
export const RATING_LEGEND = {
  intro: 'Bewertung: Pro Kriterium bitte genau eine Spalte (+, ~ oder −) markieren.',
  entries: [
    { value: '+', symbol: '+', label: 'Stärke / entspricht den Erwartungen' },
    { value: '~', symbol: '~', label: 'teilweise erfüllt / Entwicklung möglich' },
    { value: '-', symbol: '−', label: 'Entwicklungsbedarf' },
  ],
} as const

const note = (text: string): ItemDraft => ({ kind: 'note', text })
const question = (text: string): ItemDraft => ({ kind: 'text', question: text })
const rating = (criterion: string): ItemDraft => ({ kind: 'rating', criterion })
const section = (title: string, items: ItemDraft[]) => ({ title, hint: '', items })

const SELF_ASSESSMENT: StarterTemplate = {
  key: 'staff_self_assessment',
  kind: 'staff',
  name: 'Selbstbeurteilung',
  selfAssessment: true,
  sections: [
    section('Phase 1: Einstieg & Ankommen', [
      note('Begrüßung und positiver Einstieg (z. B. Rückblick auf die vergangenen Monate, Würdigung des Engagements).'),
      note('Ziel des Gesprächs: Gegenseitige Rückmeldung, Standortbestimmung, Perspektiven klären.'),
    ]),
    section('Phase 2: Rückblick & Arbeitsalltag (Reflexion)', [
      question('Wie erleben Sie Ihre aktuelle Arbeit im Team und in Ihrer Gruppe?'),
      question('Welche Projekte, Angebote oder Aufgabenbereiche (z. B. Elternarbeit, Dokumentation) liefen in letzter Zeit besonders gut?'),
      question('Gibt es Bereiche, in denen Sie sich aktuell überlastet oder eingeschränkt fühlen?'),
    ]),
    section('Phase 3: Zusammenarbeit im Team & mit der Leitung', [
      question('Wie bewerten Sie die Kommunikation und Unterstützung innerhalb des Teams?'),
      question('Wie erleben Sie die Zusammenarbeit mit der Einrichtungsleitung und dem Träger?'),
      question('Gibt es konstruktive Verbesserungsvorschläge für die Einrichtung?'),
    ]),
    section('Phase 4: Rahmenbedingungen & Arbeitsbelastung', [
      question('Passen personelle Ressourcen, Raumangebot und Materialausstattung zum Alltag?'),
      question('Wie gelingt die Balance zwischen Betreuungszeit, Vorbereitungszeit und Dokumentation?'),
    ]),
    section('Phase 5: Kompetenzen & Fortbildung', [
      question('Welche Stärken und besonderen Talente (z. B. musikalischer Bereich, Kreativangebote, Naturpädagogik) konnten Sie zuletzt gewinnbringend einbringen?'),
      question('In welchen Bereichen möchten Sie sich fachlich oder persönlich weiterentwickeln?'),
      question('Welche Fort- und Weiterbildungen werden im kommenden Jahr benötigt/gewünscht?'),
    ]),
    section('Phase 6: Ziele & Vereinbarungen für das nächste Jahr', [
      note('Konkrete Ziele: (Maximal 2–3 messbare oder gut greifbare Ziele vereinbaren, z. B. Umsetzung eines bestimmten Projekts, Vertiefung eines pädagogischen Ansatzes, Teilnahme an einer spezifischen Fortbildung).'),
      question('Ziel 1'),
      question('Ziel 2'),
      question('Ziel 3'),
      question('Was braucht die Fachkraft von der Leitung, um diese Ziele zu erreichen?'),
    ]),
    section('Phase 7: Abschluss', [
      note('Zusammenfassung der wichtigsten Ergebnisse.'),
      note('Positiver Ausblick und Dankeschön für die geleistete Arbeit.'),
      question('Anmerkungen'),
    ]),
  ],
}

const ASSESSMENT: StarterTemplate = {
  key: 'staff_assessment',
  kind: 'staff',
  name: 'Beurteilungsbogen pädagogische Fachkräfte',
  selfAssessment: false,
  sections: [
    section('1. Teamarbeit', [
      rating('Arbeitet konstruktiv und wertschätzend mit Kolleginnen und Kollegen zusammen.'),
      rating('Bringt sich in Teamsitzungen ein und beteiligt sich an gemeinsamen Absprachen.'),
      rating('Geht offen und respektvoll mit unterschiedlichen Meinungen um.'),
      rating('Gibt relevante Informationen zuverlässig an das Team weiter.'),
      rating('Unterstützt Kolleginnen und Kollegen und trägt zu einem positiven Teamklima bei.'),
    ]),
    section('2. Pädagogische Arbeit', [
      rating('Gestaltet den pädagogischen Alltag kindorientiert und bedürfnisgerecht.'),
      rating('Beobachtet Kinder aufmerksam und nimmt ihre Interessen und Entwicklungsstände wahr.'),
      rating('Fördert Selbstständigkeit, Partizipation und soziale Kompetenzen der Kinder.'),
      rating('Plant und gestaltet anregende Bildungs- und Spielangebote.'),
      rating('Handelt in herausfordernden Situationen ruhig, wertschätzend und angemessen.'),
    ]),
    section('3. Elternarbeit und Erziehungspartnerschaft', [
      rating('Begegnet Eltern freundlich, respektvoll und offen.'),
      rating('Kommuniziert wichtige Informationen klar und angemessen.'),
      rating('Führt Gespräche mit Eltern professionell und lösungsorientiert.'),
      rating('Bezieht die Perspektiven und Anliegen der Eltern angemessen ein.'),
      rating('Wahrt Vertraulichkeit und Datenschutz im Kontakt mit Familien.'),
    ]),
    section('4. Dokumentation', [
      rating('Führt erforderliche Beobachtungs- und Entwicklungsdokumentationen sorgfältig.'),
      rating('Dokumentiert nachvollziehbar, sachlich und zeitnah.'),
      rating('Geht verantwortungsvoll mit Unterlagen und personenbezogenen Daten um.'),
      rating('Nutzt Dokumentationen für die pädagogische Planung und Reflexion.'),
    ]),
    section('5. Sprachkompetenz und Sprachbildung', [
      rating('Kommuniziert klar, verständlich und situationsangemessen.'),
      rating('Schafft im Alltag vielfältige Sprechanlässe für Kinder.'),
      rating('Begleitet Handlungen sprachlich und erweitert kindliche Äußerungen wertschätzend.'),
      rating('Geht sensibel mit Mehrsprachigkeit und unterschiedlichen Sprachständen um.'),
    ]),
    section('6. Arbeitsorganisation und Selbstständigkeit', [
      rating('Plant Aufgaben vorausschauend und setzt Prioritäten sinnvoll.'),
      rating('Arbeitet selbstständig und erkennt anstehende Aufgaben.'),
      rating('Bereitet Materialien und Angebote rechtzeitig vor.'),
      rating('Geht sorgsam mit Zeit, Materialien und Ressourcen um.'),
    ]),
    section('7. Kinderschutz, Sicherheit und Aufsichtspflicht', [
      rating('Beachtet Aufsichts- und Sicherheitsregeln zuverlässig.'),
      rating('Erkennt mögliche Gefährdungen und handelt angemessen.'),
      rating('Kennt die geltenden Kinderschutzverfahren und beachtet Meldewege.'),
      rating('Geht verantwortungsvoll mit Nähe und Distanz um.'),
    ]),
    section('8. Zuverlässigkeit und Verantwortungsbewusstsein', [
      rating('Hält Absprachen und vereinbarte Aufgaben ein.'),
      rating('Informiert rechtzeitig über Verzögerungen, Abwesenheiten oder Schwierigkeiten.'),
      rating('Übernimmt Verantwortung für das eigene Handeln.'),
      rating('Geht sorgfältig mit vertraulichen Informationen um.'),
    ]),
    section('9. Inklusion und individuelle Förderung', [
      rating('Begegnet allen Kindern offen und vorurteilsbewusst.'),
      rating('Berücksichtigt individuelle Bedürfnisse, Ressourcen und Lebenslagen.'),
      rating('Ermöglicht allen Kindern Teilhabe am Alltag und an Angeboten.'),
      rating('Passt Unterstützung und Lernanregungen angemessen an.'),
    ]),
    section('10. Reflexion, Fachlichkeit und Weiterentwicklung', [
      rating('Reflektiert das eigene pädagogische Handeln kritisch und konstruktiv.'),
      rating('Nimmt Rückmeldungen an und setzt vereinbarte Entwicklungsschritte um.'),
      rating('Bringt fachliche Überlegungen in Gespräche und Planungen ein.'),
      rating('Nutzt Fortbildungen und fachliche Impulse zur Weiterentwicklung.'),
    ]),
    section('11. Engagement, Initiative und Flexibilität', [
      rating('Bringt eigene Ideen und Impulse in die Arbeit ein.'),
      rating('Zeigt Initiative und übernimmt Aufgaben über das unmittelbar Notwendige hinaus.'),
      rating('Reagiert flexibel auf Veränderungen und unterschiedliche Anforderungen.'),
      rating('Unterstützt gemeinsame Vorhaben und trägt zu deren Umsetzung bei.'),
    ]),
    section('Zusammenfassung und Vereinbarungen', [
      question('Stärken / besonders gelungene Aspekte'),
      question('Entwicklungsfelder'),
      question('Vereinbarte Ziele und Maßnahmen (mit Zeitraum)'),
      question('Unterstützungsbedarf / vereinbarte Unterstützung'),
    ]),
  ],
}

/** The staff talk starters, in the order they are listed: self-assessment first. */
export const STAFF_STARTERS: readonly StarterTemplate[] = [SELF_ASSESSMENT, ASSESSMENT]

/** The starter's content with fresh ids for every section, item and option. */
export function starterContent(starter: StarterTemplate, newId: () => string): FormContent {
  let content: FormContent = { sections: [] }
  for (const entry of starter.sections) {
    content = addSection(content, { title: entry.title, hint: entry.hint }, newId)
    const sectionId = content.sections[content.sections.length - 1]!.id
    for (const item of entry.items) content = addItem(content, sectionId, item, newId)
  }
  return content
}
