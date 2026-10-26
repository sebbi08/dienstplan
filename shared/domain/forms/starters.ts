import { addItem, addSection, type FormContent, type FormKind, type ItemDraft } from '../forms'

// The legend lives in ../forms, so the client gets it without the starter texts; kept here for existing imports.
export { RATING_LEGEND } from '../forms'

/**
 * The starter templates every facility gets once (see spec §7): texts taken word for word from the facility's paper
 * forms („&amp;“ as „&“). Header fields (name, date …) and signature lines are not part of a template.
 */
export type StarterKey = 'staff_self_assessment' | 'staff_assessment' | 'child_development'

export interface StarterTemplate {
  key: StarterKey
  kind: FormKind
  name: string
  selfAssessment: boolean
  sections: { title: string; hint: string; items: ItemDraft[] }[]
}


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

const choices = (question: string, labels: string[]): ItemDraft => ({
  kind: 'choices', question, options: labels.map(label => ({ label })),
})
/** Milestones of one age column of the paper form's table (the column header is the age label). */
const milestones = (ageLabel: string, texts: string[]): ItemDraft[] => texts.map(text => ({ kind: 'milestone', text, ageLabel }))

const AGE_3 = '3;0 Jahre'
const AGE_4 = '4;0 Jahre'
const AGE_5 = '5;0 Jahre'
const AGE_6 = '6;0 Jahre'

/**
 * „Entwicklungsgespräche“ of the facility (spec §7): the box „Angaben zum Kind“ (Datum, Uhrzeit, Teilnehmer) is the
 * form's header, not part of the template; every row of the checkbox table is a section with its ticks and its free
 * text; the three tables by age are milestones labelled with their column header.
 */
const CHILD_DEVELOPMENT: StarterTemplate = {
  key: 'child_development',
  kind: 'child',
  name: 'Entwicklungsgespräch',
  selfAssessment: false,
  sections: [
    section('Stärken & Persönlichkeit', [
      choices('', [
        'selbstbewusst', 'neugierig', 'kreativ', 'ruhig', 'hilfsbereit', 'sensibel', 'kontaktfreudig', 'ausdauernd',
        'humorvoll', 'vorsichtig', 'bewegungsfreudig',
      ]),
      question('Besondere Stärken'),
    ]),
    section('Soziales Verhalten', [
      choices('', [
        'sucht Kontakt', 'spielt allein', 'hat Freunde', 'konfliktfähig', 'empathisch', 'braucht Unterstützung',
        'hält sich an Regeln', 'benutzt Höflichkeitsformen (Bitte/Danke)', 'achtet auf fremdes Eigentum',
        'kann eigene Bedürfnisse und Wünsche zurückstellen', 'hilfsbereit', 'kompromissbereit',
      ]),
      question('Beobachtungen'),
    ]),
    section('Spiel & Lernen & Freispiel', [
      choices('Interessen', ['Bauen', 'Malen', 'Rollenspiel', 'Bücher', 'Bewegung', 'Natur', 'Musik']),
      choices('', [
        'konzentriert', 'neugierig', 'leicht ablenkbar', 'motiviert', 'ausdauernd', 'wendet neu Erlerntes an',
        'probiert vieles aus', 'konstruiert etwas nach eigenem Interesse', 'benutzt Materialien sachgemäß',
        'Beobachterrolle', 'übernimmt Sprecherrolle', 'kennt die Spielregeln', 'hält sich an Spielregeln', 'kann verlieren',
      ]),
      question('Beobachtungen'),
    ]),
    section('Emotionale Entwicklung', [
      choices('', [
        'zeigt Gefühle', 'sucht Nähe', 'kann sich beruhigen', 'braucht Begleitung', 'trennt sich gut von der Bezugsperson',
        'kann Gefühle und Emotionen sprachlich darstellen', 'angemessene Frustrationstoleranz', 'besitzt Einfühlungsvermögen',
      ]),
      question('Beobachtungen'),
    ]),
    section('Selbstständigkeit', [
      choices('', [
        'Kleidung Anziehen', 'Schuhe anziehen', 'Essen', 'Ordnung', 'Toilettengang', 'Aufräumen', 'Aufgaben',
        'wäscht sich die Hände', 'räumt den Tisch ab', 'hilft beim Tischdecken', 'meldet sich in den Gruppen an und ab',
      ]),
      question('Beobachtungen'),
    ]),
    section('Entwicklungsschwerpunkte', [
      choices('', ['Sprache', 'Motorik', 'Sozialverhalten', 'Konzentration', 'Selbstvertrauen']),
      question('Förderziel'),
    ]),
    section('Vorschule', [choices('', ['konzentriert', 'leicht ablenkbar', 'wissbegierig'])]),
    section('Projekte', [choices('', ['konzentriert', 'leicht ablenkbar', 'wissbegierig'])]),
    section('Essen', [
      choices('', [
        'kennt die Regeln', 'hält sich an die Regeln', 'isst mit Besteck', 'nimmt sich selbstständig Essen nach',
        'schenkt sich selbstständig Trinken ein',
      ]),
    ]),
    section('Motorik', [
      ...milestones(AGE_3, [
        'Beidbeiniges Abhüpfen von einer untersten Treppenstufe mit sicherer Gleichgewichtskontrolle',
        'Rennen mit deutlichem Armschwung, Umsteuern von Hindernissen; plötzliches, promptes Anhalten gelingt ohne Gefährdung des Gleichgewichts',
        'Dünne Buchseiten werden sorgfältig einzeln umgeblättert',
        'Benutzt sicheren 3-Finger-Spitzgriff (Daumen-, Zeige- und Mittelfinger) zur präzisen Manipulation kleiner Gegenstände',
      ]),
      ...milestones(AGE_4, [
        'Treppen im Wechselschritt hochsteigen',
        'Stift wird korrekt mit den Spitzen der ersten 3 Fringer gehalten',
        '„Kopffüßler“ oder Männchen, auch Objekte wie Haus, Baum, Blume, Auto können gemalt werden, wenn auch oft noch etwas unbeholfen und unvollständig',
        'Kann Perlen auffädeln',
        'Kann seine Kraft im Spiel mit anderen einschätzen',
      ]),
      ...milestones(AGE_5, [
        'Treppen werden beim Hoch- und Herabsteigen mit Beinwechsel sicher und freihändig bewältigt',
        'Größere Bälle (Durchmesser 20 cm), zugeworfen aus etwa 2 Meter Entfernung, können mit Hilfe der Hände, Arme und des Körpers sicher aufgefangen werden',
        'Weitgehend genaues Entlangschneiden mit einer Schere an einer Linie',
        'Einzelne Buchstaben, Zahlen oder der Name können mit großen Buchstaben geschrieben werden (auch seitenverkehrt)',
      ]),
      ...milestones(AGE_6, [
        'Sicheres Stehen auf dem linken und dem rechten Bein für etwa 10 Sekunden',
        'Flüssiges und sicheres Hüpfen auf dem rechten und dem linken Bein (8-10 mal)',
        'Fängt Ball sicher mit beiden Händen und wirft gezielt (etwa Fußballgröße)',
        'Gegenstände, wie ein Haus, Baum, Männchen, Autos können erkennbar gemalt werden',
        'Kind kommt beim Basteln mit Falten, Ausschneiden, Kleben (auch mit Klebeband) zurecht',
        'Stift ruht auf dem Mittelfinger, Führung durch Daumen und Zeigefinger (Dreipunktgriff)',
      ]),
    ]),
    section('Sprechen, Sehen, Hören', [
      ...milestones(AGE_3, [
        '3 – 5 Wort-Sätze (Kombination von Nomina, Hilfsverben, Präpositionen, Adjektiven)',
        'Reagiert auf Ansprache von hinten',
        'Erkennt Geräusche aus der Umwelt',
        'Singt einfache Melodien',
        'Unauffällige, flüssige Sprache',
      ]),
      ...milestones(AGE_4, [
        'Kleine Ereignisse/Geschichten werden in weitgehend korrekter zeitlicher und logischer Reihenfolge berichtet, meist noch mit „… und dann … und dann“-Verbindungen',
        'Nimmt mündliche Anweisungen an und setzt sie um',
        'Unterscheidet ähnlich klingende Wörter',
        'Unauffällige, flüssige Aussprache',
      ]),
      ...milestones(AGE_5, [
        'In kleinen Sätzen mit korrekter Grammatik werden Ereignisse/Geschichten in richtiger zeitlicher und logischer Reihenfolge wiedergegeben',
        'Unauffällige, flüssige Aussprache',
      ]),
      ...milestones(AGE_6, [
        'Spricht korrekte Sätze mit grammatikalischen Strukturen, auch kleine Nebensätze werden sicher beherrscht',
        'Erlebtes/Geschehnisse werden flüssig in richtiger zeitlicher und logischer Reihenfolge berichtet und oft spontan aus eigener Sicht kommentiert',
        'Unauffällige, flüssige Aussprache aller Vokale und Konsonanten, auch r, s, sch',
      ]),
    ]),
    section('Kognitive Entwicklung', [
      ...milestones(AGE_3, [
        'Malen und Kritzeln; auch wenn noch wenig gestaltend gemalt wird, kommentiert das Kind, wenn es gefragt wird, wen und/oder was es malt/ gemalt hat',
        'Konzentriertes, anhaltendes Spielen für mindestens 30 Minuten mit Puppen, Autos, Bausteinen …',
        'Kann Gelerntes auf neue Situationen übertragen',
      ]),
      ...milestones(AGE_4, [
        'Viele W-Fragen',
        'Gleiche Gegenstände verschiedener Größe können unterschieden und benannt werden (z.B. große und kleine Bauklötze)',
      ]),
      ...milestones(AGE_5, [
        'Grundfarben werden erkannt und benannt (blau, grün, rot, gelb, schwarz, weiß)',
        'Kennt Oberbegriffe: Tiere, Pflanzen, Nahrungsmittel, Kleidungsstücke, Fahrzeuge, Jahreszeiten',
      ]),
      ...milestones(AGE_6, [
        'Kreis, Dreieck, Quadrat werden erkannt und benannt',
        'Spielt mit Lego oder anderen Bauelementen konstruktiv, aber auch nach Vorlagen',
        'Malt „Männchen“: Kopf und Rumpf getrennt, Kopf mit Augen, Nase, Mund; Rumpf mit Armen, Hände, Finger; Beine mit Zehen; wenn auch noch wenig differenziert oder nur angedeutet',
      ]),
    ]),
  ],
}

/** The staff talk starters, in the order they are listed: self-assessment first. */
export const STAFF_STARTERS: readonly StarterTemplate[] = [SELF_ASSESSMENT, ASSESSMENT]

/** The child form starters. */
export const CHILD_STARTERS: readonly StarterTemplate[] = [CHILD_DEVELOPMENT]

/** Every starter a facility is given (once per key, see the form_starter_seeds table), in the order they are created. */
export const STARTERS: readonly StarterTemplate[] = [...STAFF_STARTERS, ...CHILD_STARTERS]

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
