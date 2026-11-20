import { addItem, addSection, type FormContent, type FormKind, type FormSubject, type ItemDraft } from '../forms'

// The legend lives in ../forms, so the client gets it without the starter texts; kept here for existing imports.
export { RATING_LEGEND } from '../forms'

/**
 * The starter templates every facility gets once (see spec §7): texts taken word for word from the facility's paper
 * forms („&amp;“ as „&“). Header fields (name, date …) and signature lines are not part of a template.
 */
export type StarterKey =
  | 'staff_self_assessment' | 'staff_assessment' | 'child_development' | 'team_meeting' | 'accident_child' | 'accident_u1000'


export interface StarterTemplate {
  key: StarterKey
  kind: FormKind
  name: string
  selfAssessment: boolean
  /** For an accident starter: whom its forms are about. */
  subject?: FormSubject
  /** The printout's layout of its forms ('u1000': the official Unfallanzeige); kept by copies of the template. */
  printLayout?: 'u1000'
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

/** Each section of the team meeting starter is one free text with its own short question. */
const minutes = (title: string, ask: string) => section(title, [question(ask)])

const TEAM_MEETING: StarterTemplate = {
  key: 'team_meeting',
  kind: 'team',
  name: 'Teamsitzung',
  selfAssessment: false,
  sections: [
    minutes('Tagesordnung', 'Welche Punkte stehen an?'),
    minutes('Themen und Ergebnisse', 'Was wurde besprochen und entschieden?'),
    minutes('Vereinbarungen und Aufgaben (wer, was, bis wann)', 'Wer erledigt was bis wann?'),
    minutes('Termine', 'Welche Termine stehen an?'),
    minutes('Sonstiges', 'Weitere Notizen'),
  ],
}

/** A text item filled from the app's data when the form is made (see PREFILL_KINDS in ../forms). */
const prefilled = (text: string, prefill: 'facility' | 'personName' | 'address' | 'healthInsurer' | 'workingTime' | 'jobTitle' | 'group' | 'facilityPhone'): ItemDraft =>
  ({ kind: 'text', question: text, prefill })
const dateItem = (text: string, prefill?: 'birthDate' | 'employedSince'): ItemDraft =>
  (prefill ? { kind: 'date', question: text, prefill } : { kind: 'date', question: text })
const NO_YES = ['Nein', 'Ja']

const ACCIDENT_CHILD: StarterTemplate = {
  key: 'accident_child',
  kind: 'accident',
  subject: 'child',
  name: 'Unfallbericht Kind',
  selfAssessment: false,
  sections: [
    section('Unfall', [
      question('Unfallort'),
      question('Hergang – Was ist passiert?'),
      question('Verletzung (Art und Körperteil)'),
    ]),
    section('Erste Hilfe', [
      question('Erste Hilfe – durch wen?'),
      question('Erste Hilfe – welche Maßnahmen?'),
      question('Zeugen'),
    ]),
    section('Eltern', [
      question('Eltern informiert – wann und durch wen?'),
      question('Bemerkungen'),
    ]),
  ],
}

/**
 * The official „Unfallanzeige“ (DGUV form U 1000, page 1): one item per numbered field 1–29 with its official number and
 * label (field 15 „Unfallzeitpunkt“ is the form's fixed header, Datum and Uhrzeit), the short explanations of pages 2–3
 * as section hints in own words. An item without a number of its own belongs to the numbered field before it (the
 * printout lays the fields out like the official page, see app/utils/u1000.ts).
 */
const ACCIDENT_U1000: StarterTemplate = {
  key: 'accident_u1000',
  kind: 'accident',
  subject: 'employee',
  printLayout: 'u1000',
  name: 'Unfallanzeige (U 1000)',
  selfAssessment: false,
  sections: [
    {
      title: 'Unternehmen',
      hint: 'Die Unfallanzeige erstattet der Träger als Unternehmer oder eine bevollmächtigte Person. Zu 2: die '
        + 'Mitgliedsnummer beim Unfallversicherungsträger (steht z. B. im Beitragsbescheid).',
      items: [
        prefilled('1 Name und Anschrift des Unternehmens', 'facility'),
        question('2 Unternehmensnummer des Unfallversicherungsträgers'),
        question('3 Empfänger/-in'),
      ],
    },
    {
      title: 'Versicherte Person',
      hint: 'Zu 9: Leiharbeitnehmer/-innen sind Beschäftigte einer Zeitarbeitsfirma, die hier eingesetzt sind. Zu 11: nur '
        + 'wenn der Unternehmer eine natürliche Person ist (z. B. Einzelunternehmen); „verwandt“ gilt auch bis zum dritten '
        + 'Grad verwandt, bis zum zweiten Grad verschwägert oder als Pflegekind. Zu 13: bei gesetzlicher Versicherung '
        + 'Name, PLZ und Ort der Kasse, sonst die Art der Versicherung (z. B. privat, Familienversicherung).',
      items: [
        prefilled('4 Name, Vorname der versicherten Person', 'personName'),
        dateItem('5 Geburtsdatum', 'birthDate'),
        prefilled('6 Straße, Hausnummer, Postleitzahl, Ort', 'address'),
        choices('7 Geschlecht', ['Männlich', 'Weiblich', 'Divers', 'Keine Angabe']),
        question('8 Staatsangehörigkeit'),
        choices('9 Leiharbeitnehmer/-in', NO_YES),
        choices('10 Auszubildende/-r', NO_YES),
        choices('11 Die versicherte Person ist', [
          'Unternehmer/-in', 'Gesellschafter/-in Geschäftsführer/-in', 'mit der Unternehmerin/dem Unternehmer verheiratet',
          'mit der Unternehmerin/dem Unternehmer in eingetragener Lebenspartnerschaft lebend',
          'mit der Unternehmerin/dem Unternehmer verwandt',
        ]),
        question('12 Anspruch auf Entgeltfortzahlung besteht für … Wochen'),
        prefilled('13 Krankenkasse (Name, PLZ, Ort)', 'healthInsurer'),
      ],
    },
    {
      title: 'Unfall',
      hint: 'Zu 18: Wo, wie und warum ist es passiert? In welchem Bereich (z. B. Gruppenraum, Garten, Küche), bei welcher '
        + 'Tätigkeit, was hat den Unfall ausgelöst, welche Geräte, Fahrzeuge oder Stoffe waren beteiligt? Skizzen oder '
        + 'Fotos können als Anhang beigefügt werden.',
      items: [
        choices('14 Tödlicher Unfall?', NO_YES),
        note('15 Unfallzeitpunkt: Datum und Uhrzeit stehen oben im Kopf des Bogens.'),
        question('16 Unfallort (genaue Orts- und Straßenangabe mit PLZ)'),
        { kind: 'choices', question: '17 Unfall im Homeoffice?', options: NO_YES.map(label => ({ label })), prefill: 'homeOffice' },
        question('18 Ausführliche Schilderung des Unfallhergangs (Verlauf, Bezeichnung des Betriebsteils, ggf. Beteiligung von Maschinen, Anlagen, Gefahrstoffen)'),
        choices('Die Angaben beruhen auf der Schilderung', ['der versicherten Person', 'anderer Personen']),
      ],
    },
    {
      title: 'Verletzung und Erstbehandlung',
      hint: 'Zu 19: z. B. rechter Unterarm, linker Zeigefinger. Zu 20: z. B. Prellung, Knochenbruch, Verstauchung, '
        + 'Verbrennung, Platzwunde, Schnittverletzung.',
      items: [
        question('19 Verletzte Körperteile'),
        question('20 Art der Verletzung'),
        question('21 Wer hat von dem Unfall zuerst Kenntnis genommen? (Name, Anschrift)'),
        choices('War diese Person Augenzeugin/Augenzeuge des Unfalls?', NO_YES),
        question('22 Erstbehandlung: Name und Anschrift der Ärztin/des Arztes oder des Krankenhauses'),
      ],
    },
    {
      title: 'Tätigkeit',
      hint: 'Zu 24: die genaue Tätigkeit, z. B. Erzieherin, Kinderpfleger, Hauswirtschaftskraft – nicht „Angestellte“. '
        + 'Zu 26: z. B. Gruppe, Küche, Büro.',
      items: [
        prefilled('23 Beginn und Ende der Arbeitszeit der versicherten Person', 'workingTime'),
        prefilled('24 Zum Unfallzeitpunkt beschäftigt/tätig als', 'jobTitle'),
        dateItem('25 Seit wann bei dieser Tätigkeit?', 'employedSince'),
        prefilled('26 In welchem Teil des Unternehmens ist die versicherte Person ständig tätig?', 'group'),
      ],
    },
    section('Arbeit eingestellt und wieder aufgenommen', [
      choices('27 Hat die versicherte Person die Arbeit eingestellt?', ['Nein', 'Sofort', 'Später']),
      question('Später, am … um … Uhr'),
      choices('28 Hat die versicherte Person die Arbeit wieder aufgenommen?', NO_YES),
      dateItem('Ja, am'),
    ]),
    {
      title: 'Rückfragen',
      hint: 'Der Ausdruck wird unterschrieben: Datum, Unternehmer/-in (Bevollmächtigte/-r), Betriebsrat (Personalrat).',
      items: [prefilled('29 Datum / Telefon-Nr. für Rückfragen', 'facilityPhone')],
    },
  ],
}

/** The staff talk starters, in the order they are listed: self-assessment first. */
export const STAFF_STARTERS: readonly StarterTemplate[] = [SELF_ASSESSMENT, ASSESSMENT]

/** The child form starters. */
export const CHILD_STARTERS: readonly StarterTemplate[] = [CHILD_DEVELOPMENT]

/** The team meeting starters. */
export const TEAM_STARTERS: readonly StarterTemplate[] = [TEAM_MEETING]

/** The accident report starters: the child's report and the official Unfallanzeige for employees. */
export const ACCIDENT_STARTERS: readonly StarterTemplate[] = [ACCIDENT_CHILD, ACCIDENT_U1000]

/** Every starter a facility is given (once per key, see the form_starter_seeds table), in the order they are created. */
export const STARTERS: readonly StarterTemplate[] = [...STAFF_STARTERS, ...CHILD_STARTERS, ...TEAM_STARTERS, ...ACCIDENT_STARTERS]

/**
 * The starters a facility created later (createFacility) starts with: only the accident reports. The others
 * (Selbstbeurteilung, Beurteilungsbogen, Entwicklungsgespräch, Teamsitzung) are recorded as given without being created,
 * so they never arrive later either; the facility makes its own forms („Vorlage anlegen“). Existing facilities keep theirs.
 */
export const NEW_FACILITY_STARTER_KEYS: readonly StarterKey[] = ACCIDENT_STARTERS.map(starter => starter.key)

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
