# Platzplanung: Vormerkungen, Belegung, Gruppenwechsel, Schulkinder – Design

Stand: 13.10.2026 · Ergänzt die Kinderakte
([2026-10-08-kinderakte-design.md](2026-10-08-kinderakte-design.md)) und baut auf den Gruppen auf
([2026-10-08-groups-design.md](2026-10-08-groups-design.md)).

Nicht Teil dieses Dokuments, aber als nächstes eigenes Vorhaben vereinbart: **Bundesland pro Einrichtung und
Feiertage je Bundesland** (betrifft Dienstplan, Tagessoll, Warnungen, Urlaub, Kalender). Es belegt später auch
den Schulkind-Stichtag aus dem Bundesland vor.

## 1. Ziel

Leitung und Träger planen die Plätze: Sie sehen pro Kita-Jahr Monat für Monat, wie viele Kinder in jeder
Gruppe sind und wann die definierte Kinderanzahl einer Gruppe erreicht ist; sie führen Vormerkungen und
künftige Vertragskinder; sie planen Gruppenwechsel (z. B. Krippe → Kindergarten) mit Datum und legen fest,
welche Angaben neu bestätigt werden müssen. Die App weiß über einen Stichtag, wann ein Kind Schulkind wird,
und meldet Schulkinder zum 1. September automatisch ab – außer sie wechseln in eine Gruppe für Schulkinder.

**Erfolgskriterien**

- Jede Zahl der Belegungstabelle lässt sich per Klick auf die Namen zurückführen.
- Die Belegung künftiger Kita-Jahre stimmt, ohne dass für jedes Kind ein Austritt eingetragen werden muss.
- Ein geplanter Gruppenwechsel verschiebt das Kind in der Belegung ab dem richtigen Monat und stellt die Gruppe
  am Wechseltag automatisch um.
- Vormerkungen erscheinen nie in den Belegungszahlen.
- Nach einem Wechsel ist für jedes Kind sichtbar, welche Bereiche noch nicht neu bestätigt sind.
- Kein Kind wird überraschend abgemeldet: Vor dem Einschalten der automatischen Abmeldung zeigt die App, wen es
  trifft.

**Entscheidungen der Leitung (Brainstorming 13.10.2026):**

| Thema | Entscheidung |
|---|---|
| Zeitraster | Kita-Jahr 1.9.–31.8., Monat für Monat. |
| Zählweise | Ein Kind zählt in einem Monat in einer Gruppe, wenn es an mindestens einem Tag des Monats dort ist – auch im Monat seines letzten Tages. |
| Zellinhalt | „17 (+2)“: Hauptzahl = schon vor dem Monat in der Gruppe; Klammer = in genau diesem Monat neu in der Gruppe (Eingewöhnung oder Wechsel aus anderer Gruppe). |
| Rot | Sobald Hauptzahl + Klammer die Plätze der Gruppe erreichen. |
| Vormerkungen | Eigener Stand beim Kind; zählen nicht in der Belegung; eigene Übersicht zusammen mit künftigen Vertragskindern. |
| Vertragskinder | Zählen ab dem Monat ihres Vertragsbeginns. |
| Gruppenwechsel | Mit Datum (jeder Tag) im Voraus planbar; Leitung/Träger wählen pro Bereich „übernehmen“ oder „neu bestätigen“. |
| Nicht übernommene Bereiche | Angaben bleiben sichtbar, werden als „nicht bestätigt“ markiert, bis sie durchgesehen sind. |
| Schulkind | Stichtag + Alter; Schulstart am 1. September. Schulkinder werden automatisch zum 31.8. abgemeldet. |
| Hort / Schulkindbetreuung | Statt Abmeldung Wechsel in eine Gruppe „für Schulkinder“; dafür ist ein weiterer Betreuungsvertrag nötig. |
| Reihenfolge | Erst diese Platzplanung, danach Bundesland/Feiertage als eigenes Vorhaben. |

## 2. Begriffe

- **Stand** eines Kindes: **Vormerkung** oder **Vertrag**. „Aufgenommen“ ist kein eigener Stand: ein Kind mit
  Vertrag ist aufgenommen, sobald sein Eintritt erreicht ist (Status „aktiv“ der Kinderakte).
- **Vertragsbeginn:** `Eintritt`, sonst `geplanter Eintritt`.
- **Errechneter Schulstart:** siehe Abschnitt 7. **Schulstart** eines Kindes: der von Hand eingetragene
  `voraussichtliche Schulstart`, sonst der errechnete.
- **Letzter Tag:** `Austritt`; sonst der Tag vor dem Schulstart – außer das Kind bleibt wegen einer Gruppe für
  Schulkinder (am Schulstart oder durch einen späteren Wechsel, siehe 7.4), dann offen.
- **Plätze:** definierte Kinderanzahl einer Gruppe.
- **Kita-Jahr J/J+1:** 1. September J bis 31. August J+1, Anzeige „2026/27“.
- **Gruppenhistorie:** für jedes Kind die Folge „ab Datum X in Gruppe G“ (einschließlich geplanter Wechsel);
  die Gruppe an einem Tag ist der letzte Eintrag mit Datum ≤ Tag.

## 3. Stand „Vormerkung / Vertrag“

- Neues Feld **Stand** in den Stammdaten (Vormerkung / Vertrag); bestehende Kinder: Vertrag. Neues Feld
  **Vorgemerkt am** (Datum, nur bei Vormerkung; Vorbelegung heute).
- Eine Vormerkung hat keinen `Eintritt`; der gewünschte Eintritt steht in `geplanter Eintritt`. Wird ein
  `Eintritt` eingetragen, während der Stand „Vormerkung“ ist, lehnt die App ab (`waitlist_has_entry`).
- Eine Vormerkung ist immer „geplant“ (nie aktiv, nie archiviert) und zählt nirgends als anwesend.
- Pflichtfelder einer Vormerkung: Nachname, Vorname, Geburtsdatum. Alles andere optional.
- **Vormerkung löschen** (Leitung, Träger): löscht die Akte sofort (mit Bestätigung).
- Vormerkungen werden nicht automatisch gelöscht; die Betriebsanleitung weist darauf hin, sie regelmäßig
  durchzusehen.

## 4. Übersicht „Vormerkungen & Verträge“

Ersetzt den Reiter „Geplant“ unter „Kinder“ (alle Mitarbeiter der Kita lesen; Pfleger der Akte legen an).

1. **Vormerkungen** – sortiert nach „Vorgemerkt am“ (ohne Datum zuletzt), dann Name. Spalten: Name,
   Geburtsdatum, Alter zum gewünschten Eintritt, gewünschter Eintritt, gewünschte Gruppe, Betreuungsform,
   Telefon der ersten Bezugsperson (mobil, sonst privat, sonst Arbeit), Bemerkung, vorgemerkt am.
2. **Künftige Kinder mit Vertrag** – Stand „Vertrag“ und noch nicht aktiv; sortiert nach Vertragsbeginn (ohne
   Datum zuletzt), dann Name. Gleiche Spalten mit Vertragsbeginn und zugesagter Gruppe, ohne „vorgemerkt am“.

Filter: Gruppe; Kita-Jahr des (gewünschten) Eintritts. Druckansicht beider Listen. Knöpfe „Vormerkung
anlegen“ und „Kind anlegen“ (Stand vorbelegt).

## 5. Plätze und Belegung

### 5.1 Plätze

Jede Gruppe hat **Plätze** (ganze Zahl 1–200 oder leer). Leitung und Träger ändern sie direkt in der
Belegungstabelle.

### 5.2 Reiter „Belegung“ (Leitung, Träger)

Auswahl des Kita-Jahres (vor/zurück, Vorbelegung: laufendes Kita-Jahr). Tabelle: Zeile je Gruppe (Reihenfolge
der Gruppen), danach „ohne Gruppe“ (nur wenn belegt), danach **Summe**; Spalten: Gruppe, Plätze, September …
August.

### 5.3 Zählregel

Gezählt werden nur Kinder mit Stand „Vertrag“ und einem Vertragsbeginn. Der **Aufenthalt** eines Kindes reicht
vom Vertragsbeginn bis zum letzten Tag (offen = unbegrenzt). Innerhalb des Aufenthalts ergibt die
Gruppenhistorie zusammenhängende **Gruppenzeiten** (von–bis in einer Gruppe).

Für Gruppe G und Monat M:

- Ein Kind zählt, wenn eine seiner Gruppenzeiten in G mindestens einen Tag von M enthält.
- Es steht in der **Klammer**, wenn diese Gruppenzeit in M beginnt, sonst in der **Hauptzahl**.
- Anzeige: `Hauptzahl` oder `Hauptzahl (+Klammer)`; bei 0 Kindern „–“.

Beispiele: Eintritt 15.10. → Oktober in der Klammer, ab November Hauptzahl. Austritt 15.3. → zählt im März
noch, ab April nicht mehr. Wechsel am 15.3. von Krippe nach Kindergarten → Krippe: März Hauptzahl, April nicht
mehr; Kindergarten: März Klammer, April Hauptzahl. Schulstart 1.9.2027 → zählt bis August 2027.

**Summe:** jedes Kind einmal, wenn sein Aufenthalt den Monat berührt; Klammer = Vertragsbeginn im Monat
(Gruppenwechsel zählen hier nicht als neu).

### 5.4 Rot

- Gruppenzelle rot, wenn Plätze eingetragen sind und Hauptzahl + Klammer ≥ Plätze. Liegt die Zahl über den
  Plätzen, steht zusätzlich „+n über Plätze“.
- Summenzelle rot, wenn alle Gruppen Plätze haben und die Summe ≥ Summe aller Plätze ist.
- Zeile „ohne Gruppe“ wird nie rot.

### 5.5 Namen und Hinweise

- Klick auf eine Zelle zeigt unter der Tabelle die Kinder dieser Zelle: „schon da“ und „neu in diesem Monat“,
  je mit Beginn und Ende der Gruppenzeit; Namen verlinken zur Akte.
- Hinweis unter der Tabelle (nur wenn > 0), aufklappbar mit Namen: „n Kinder mit Vertrag ohne Eintrittsdatum
  werden nicht gezählt.“
- Druckansicht pro Kita-Jahr (Tabelle und Hinweis).

## 6. Gruppenwechsel

### 6.1 Planen

- In der Akte (Stammdaten): **„Gruppenwechsel planen“** (Leitung, Träger): neue Gruppe (andere als die dann
  gültige; „ohne Gruppe“ nicht wählbar), Datum (jeder Tag), und je Bereich ein Häkchen **„übernehmen“**:
  Bezugspersonen, Gesundheit, Einwilligungen, Dokumente, Betreuungsform, Bezugserzieher (Vorbelegung: alle
  übernehmen).
- Regeln: Datum nach dem letzten bereits vollzogenen Wechsel des Kindes (`group_change_order`); höchstens ein
  noch nicht vollzogener Wechsel je Kind (`group_change_pending`); nicht für Vormerkungen und nicht für
  archivierte Kinder.
- Ein Wechsel mit Datum ≤ heute wird sofort vollzogen. Ein künftiger Wechsel steht in der Akte („wechselt am
  … in …“) und kann bis zum Wechseltag geändert oder gelöscht werden.
- **Vollzug** (täglicher Lauf; mehrfaches Ausführen ändert nichts): Gruppe des Kindes umstellen, Wechsel als
  vollzogen kennzeichnen, für jeden nicht übernommenen Bereich die Markierung „nicht bestätigt seit
  <Wechseltag>“ setzen.

### 6.2 Gruppe direkt ändern

Das Ändern der Gruppe in den Stammdaten bleibt möglich:

- Hat das Kind noch nicht begonnen (Vormerkung oder Vertragsbeginn in der Zukunft/leer) und gibt es keinen
  vollzogenen Wechsel, wird nur die Startgruppe geändert.
- Sonst wird ein Wechsel „heute, alles übernehmen“ festgehalten und sofort vollzogen. In eine Gruppe für
  Schulkinder kann man so nicht wechseln (dafür „Gruppenwechsel planen“, siehe 7.4).

### 6.3 Nicht bestätigte Bereiche

- Markierbar: Bezugspersonen, Gesundheit, Einwilligungen, Dokumente, Betreuungsform, Bezugserzieher sowie
  Betreuungsvertrag (nur durch 7.4).
- Anzeige: Der Bereich (bzw. das Feld in den Stammdaten) trägt einen auffälligen Hinweis „Seit dem
  Gruppenwechsel am … nicht bestätigt“.
- Die Markierung verschwindet, wenn ein Pfleger der Akte den Bereich speichert (Bezugspersonen: jede Änderung;
  Betreuungsform/Bezugserzieher: Speichern der Stammdaten) oder **„Angaben bestätigen“** klickt.
- **Dokumente:** Solange die Markierung besteht, gilt in der Dokumentenübersicht eine *nötige* Dokumentart für
  dieses Kind als „neu einzureichen“ (rot), wenn ihr neuestes Dokument vor dem Wechseltag hochgeladen wurde.
  Die Markierung verschwindet durch „Dokumente bestätigen“ oder automatisch, sobald jede nötige Art ein
  Dokument hat, das am oder nach dem Wechseltag hochgeladen wurde.
- **Betreuungsvertrag:** Eine Dokumentart je Kita ist als „Betreuungsvertrag“ gekennzeichnet (vorbelegt: die
  Art dieses Namens; Leitung/Träger können die Kennzeichnung in den Dokumentarten umsetzen). Solange die
  Markierung „Betreuungsvertrag“ besteht, gilt diese Art als „neu einzureichen“, bis ein Dokument dieser Art am
  oder nach dem Wechseltag hochgeladen wurde (dann verschwindet die Markierung automatisch) oder bestätigt wird.
- **Reiter „Offen“** unter „Kinder“ (alle Mitarbeiter): aktive Kinder mit mindestens einer Markierung, mit den
  offenen Bereichen; Klick führt zur Akte.

### 6.4 Zusammenspiel

- **Kita-Wechsel** (Träger): beendet die Gruppenhistorie mit „ohne Gruppe ab heute“ und löscht einen noch nicht
  vollzogenen Wechsel.
- **Gruppe löschen:** zusätzlich gesperrt, solange ein noch nicht vollzogener Wechsel in diese Gruppe führt
  (`group_has_pending_changes`). Historieneinträge archivierter Kinder verlieren beim Löschen die Gruppe.
- **Abmelden:** ein noch nicht vollzogener Wechsel nach dem Austrittsdatum wird beim Abmelden gelöscht.

## 7. Schulkinder

### 7.1 Stichtag (Träger, pro Einrichtung)

Einstellung je Einrichtung: **Stichtag** (Tag und Monat) und **Alter** (Jahre, 4–8). Vorbelegung: 30. Juni
und 6 Jahre. Regel: Ein Kind wird zum **1. September** des Jahres J Schulkind, wenn es bis einschließlich
Stichtag im Jahr J das Alter erreicht hat. Der **errechnete Schulstart** ist der 1. September des ersten
solchen Jahres.

Beispiele (30.6., 6 Jahre): geboren 30.06.2021 → 1.9.2027; geboren 01.07.2021 → 1.9.2028. Ein am 29. Februar
geborenes Kind erreicht das Alter in Nicht-Schaltjahren am 28. Februar.

Hinweis in der Einstellung: „Die Stichtage unterscheiden sich je Bundesland und können sich ändern. Bitte den
Wert prüfen.“

### 7.2 In der Akte

Das Feld „voraussichtlicher Schulstart“ zeigt den errechneten Wert („errechnet: 01.09.2027“). Ein von Hand
eingetragenes Datum (Zurückstellung, vorzeitige Einschulung) hat Vorrang und ist als „abweichend“
gekennzeichnet; Leeren des Feldes kehrt zum errechneten Wert zurück.

### 7.3 Automatische Abmeldung

- Schalter je Einrichtung (Träger): **„Schulkinder automatisch abmelden“**, Vorbelegung aus.
- Beim Einschalten zeigt die App in der Bestätigung, welche Kinder **sofort** abgemeldet werden (Schulstart
  schon erreicht) – mit Namen und Austrittsdatum. Mit der Bestätigung wird eingeschaltet, und genau die
  angezeigten Kinder werden im selben Schritt abgemeldet. Hat sich die Liste seit der Anzeige geändert, lehnt
  die App ab (`auto_leave_preview_changed`) und zeigt sie neu. Ausschalten braucht keine Bestätigung.
- Täglicher Lauf bei eingeschaltetem Schalter: Jedes aktive Kind mit Stand „Vertrag“, ohne Austritt, dessen
  Schulstart erreicht ist (≤ heute) und das nicht wegen einer Gruppe für Schulkinder bleibt (7.4), bekommt
  den Austritt „Tag vor dem Schulstart“ (31.8.) und ist damit archiviert; die Löschfrist der Kinderakte läuft.
  Das Server-Protokoll vermerkt nur die Anzahl. Vorschau, Einschalten und Lauf verwenden dieselbe Auswahl. Jede
  Einrichtung wird für sich verarbeitet; ein Fehler in einer Einrichtung hält die anderen nicht auf.
- **Nicht automatisch abgemeldet** wird ein Kind,
  - das erst am oder nach seinem Schulstart eingetreten ist (der Austritt läge vor dem Eintritt; die Belegung
    nennt es im Hinweis „Schulstart oder Austritt liegt vor dem Eintritt“),
  - dessen Akte mit diesem Austritt sofort gelöscht würde (Löschfrist schon abgelaufen),
  - für das ein Gruppenwechsel mit weiterem Betreuungsvertrag geplant ist, der nach dem Austritt läge.

  Diese Kinder bleiben aktiv und stehen in der Liste „Schulkinder zum 1.9.“, bis Leitung oder Träger von Hand
  entscheiden.
- **Der Schalter schaltet sich aus**, wenn sich ändert, wen er trifft: wenn der Stichtag der Einrichtung
  geändert wird, wenn einer Gruppe der Einrichtung das Kennzeichen „für Schulkinder“ genommen wird, und in
  allen Einrichtungen, wenn die Löschfrist der Kinderakte geändert wird. Der Träger schaltet ihn danach mit der
  neuen Liste wieder ein.
- Unabhängig vom Schalter: Reiter „Belegung“ zeigt ab 1. März die Liste **„Schulkinder zum 1.9.“** des
  kommenden Septembers (Name, Gruppe, Schulstart, ggf. geplanter Wechsel in eine Schulkind-Gruppe), damit
  Zurückstellungen rechtzeitig eingetragen werden. Bei ausgeschaltetem Schalter gibt es dort den Knopf „zum
  31.8. abmelden“ je Kind.
- **Abmeldung zurücknehmen** bei einem Kind, dessen Schulstart schon erreicht ist, verlangt einen neuen,
  künftigen „voraussichtlichen Schulstart“ (`school_start_required`), damit der Lauf es nicht erneut abmeldet –
  außer das Kind bleibt wegen einer Gruppe für Schulkinder (7.4).

### 7.4 Hort / Schulkindbetreuung

- Der Träger kennzeichnet eine Gruppe als **„für Schulkinder“** (in der Gruppenverwaltung).
- Ein **Gruppenwechsel in eine solche Gruppe** kann nur geplant werden, wenn „weiterer Betreuungsvertrag
  abgeschlossen“ bestätigt ist (`new_contract_required`); der Wechseltag ist der Beginn dieses Vertrags.
  Beim Vollzug wird die Markierung „Betreuungsvertrag nicht bestätigt“ gesetzt (6.3) – maßgeblich ist, ob die
  Gruppe am Wechseltag „für Schulkinder“ ist, nicht ob sie es beim Planen war.
- **Ein Kind bleibt**, wenn es am Schulstart in einer Gruppe für Schulkinder ist oder seine Gruppenhistorie
  (einschließlich geplanter Wechsel) danach in eine solche Gruppe führt – etwa wenn der Hortvertrag erst am
  13.9. beginnt. Ein Kind, das bleibt, wird nicht automatisch abgemeldet, hat kein errechnetes Ende (offener
  Aufenthalt in der Belegung; es steht nicht im Hinweis „Schulstart oder Austritt liegt vor dem Eintritt“) und
  wird von Hand abgemeldet. Belegung,
  Vorschau, täglicher Lauf, Liste „Schulkinder zum 1.9.“ und „Abmeldung zurücknehmen“ urteilen nach derselben
  Regel.
- Der automatische Lauf löscht nie einen geplanten Wechsel mit weiterem Betreuungsvertrag (7.3).
- **Kita-Wechsel in eine Einrichtung mit eingeschaltetem Schalter:** Ein Kind mit Stand „Vertrag“ und ohne
  Austritt, dessen Schulstart (eingetragen, sonst nach dem Stichtag der Ziel-Einrichtung errechnet) schon
  erreicht ist, kann nicht dorthin verschoben werden (`school_start_reached`): Es käme ohne Gruppe an und würde
  sofort abgemeldet. Erst den voraussichtlichen Schulstart anpassen oder dort den Schalter ausschalten.
- In der Belegung zählen Schulkind-Gruppen wie jede andere Gruppe.

## 8. Rechte

| | Träger | Leitung | Mitarbeiter mit Freischaltung | übrige Mitarbeiter |
|---|---|---|---|---|
| Übersicht „Vormerkungen & Verträge“, Reiter „Offen“ ansehen | ja | ja | ja | ja |
| Vormerkung/Kind anlegen, Stand ändern, Schulstart überschreiben, Bereiche bestätigen | ja | ja | ja | nein |
| Vormerkung löschen | ja | ja | nein | nein |
| Belegung und Liste „Schulkinder zum 1.9.“ ansehen, Plätze ändern | ja | ja | nein | nein |
| Gruppenwechsel planen, ändern, löschen | ja | ja | nein | nein |
| Stichtag, automatische Abmeldung, Gruppe „für Schulkinder“ | ja | nein | nein | nein |

Das Stempel-Tablet hat keinen Zugriff. Alle Prüfungen serverseitig; fremde Kitas → 404 wie in der Kinderakte.

## 9. Technik

### 9.1 Datenmodell

- `children.admission_status` (`waitlist` | `contract`, Standard `contract`), `children.waitlisted_on`
  (ISO-Datum, nullable).
- `groups.capacity` (integer, nullable), `groups.for_school_children` (boolean, Standard false).
- `facilities.school_cutoff_month` (Standard 6), `school_cutoff_day` (Standard 30), `school_age_years`
  (Standard 6), `auto_leave_school_children` (boolean, Standard false).
- `document_types.care_contract` (boolean; höchstens eine je Kita; Migration: die Art „Betreuungsvertrag“).
- Neu `child_group_changes`: id, child_id (FK cascade), group_id (FK groups, ON DELETE SET NULL, nullable),
  from_date (ISO, nullable = von Anfang an), keep_contacts, keep_health, keep_consents, keep_documents,
  keep_care_type, keep_key_educator (boolean, Standard true), new_contract (boolean, Standard false),
  applied_at (ISO-Zeit, nullable), created_by (FK users SET NULL), created_at. Je Kind genau ein Eintrag mit
  `from_date` null (Startgruppe).
- `children`: `contacts_review_since`, `health_review_since`, `consents_review_since`,
  `documents_review_since`, `care_type_review_since`, `key_educator_review_since`, `contract_review_since`
  (ISO-Datum, nullable).
- `children.group_id` bleibt die heute gültige Gruppe (vom Vollzug gepflegt); `children.school_start_date`
  bleibt der von Hand eingetragene Wert (leer = errechnet).
- Migration: alle Kinder `contract`; je Kind ein Starteintrag der Historie mit der heutigen Gruppe, vollzogen.

### 9.2 Server

- Domain (rein, ohne Datenbank): `shared/domain/occupancy.ts` – Aufenthalt, Gruppenzeiten, Monatszählung,
  Summe; `shared/domain/kitaYear.ts` – `kitaYearOf(date)`, `kitaYearMonths(startYear)`;
  `shared/domain/schoolStart.ts` – `computedSchoolStart(birthDate, cutoff)`.
- Services: `server/services/occupancy.ts` (Tabelle, Zellnamen, Hinweis, Liste „Schulkinder zum 1.9.“),
  `childGroupChanges.ts` (planen, ändern, löschen, vollziehen, direktes Ändern), `schoolChildren.ts`
  (Einstellungen, Vorschau, automatische Abmeldung), Erweiterung `children.ts` (Stand, geplante Listen,
  Bestätigen, Schulstart), `groups.ts` (Plätze, Kennzeichen, Löschsperre), `childDocuments.ts` (Übersicht mit
  „neu einzureichen“).
- Täglicher Lauf im Datenbank-Plugin ruft zusätzlich `applyDueGroupChanges(db, today)` und danach
  `leaveSchoolChildren(db, today)`.
- Routen: Belegung, Plätze und Gruppenwechsel über `requireAdmin`; Stichtag, Schalter und Gruppen-Kennzeichen
  über `requireProvider`; Bestätigen über `requireChildEditor`; Listen „Vormerkungen & Verträge“ und „Offen“
  über `requireChildReader`.

### 9.3 Oberfläche

Reiter unter „Kinder“: Liste · Vormerkungen & Verträge · Geburtstage · Dokumente · Offen · Belegung (nur
Leitung/Träger) · Archiv (nur Leitung/Träger). Einstellungen (Träger): Abschnitt „Schulkinder“ je Einrichtung.
Druckansichten `/print/children/planned` und `/print/children/occupancy/[jahr]`.

## 10. Umsetzung in Stufen

1. Stand „Vormerkung / Vertrag“ und Übersicht „Vormerkungen & Verträge“
2. Stichtag und errechneter Schulstart; Plätze und Belegung (rechnet mit der heutigen Gruppe für alle Monate)
3. Gruppenwechsel mit Historie, Vollzug, Markierungen, Reiter „Offen“; Belegung rechnet mit der Historie
4. Schulkinder: Liste „Schulkinder zum 1.9.“, automatische Abmeldung, Gruppen „für Schulkinder“ mit weiterem
   Betreuungsvertrag

Jede Stufe ist für sich lauffähig und getestet.

## 11. Tests

- **Zählregel (Domain):** Eintritt/Austritt/Wechsel mitten im Monat; Monatserster und Monatsletzter als
  Grenzen; Schulstart als Ende; offener Aufenthalt; Vormerkung und Vertrag ohne Datum nicht gezählt; Klammer
  nur im Startmonat der Gruppenzeit; Rückwechsel in eine frühere Gruppe; Summe ohne Doppelzählung im
  Wechselmonat; Kita-Jahr-Grenzen (August/September, Schaltjahr-Februar).
- **Schulstart (Domain):** Geburt am Stichtag, einen Tag danach, 29. Februar; abweichender Stichtag und Alter;
  von Hand eingetragener Wert hat Vorrang.
- **Rot:** genau erreicht, überschritten („+n über Plätze“), ohne Plätze, Summenzeile.
- **Gruppenwechsel:** Vollzug genau am Wechseltag und nur einmal; sofortiger Vollzug bei Datum ≤ heute;
  Reihenfolge- und „nur ein offener Wechsel“-Regel; direkter Gruppenwechsel vor und nach Beginn; Kita-Wechsel,
  Abmelden und Gruppe löschen mit offenem Wechsel.
- **Markierungen:** nur für nicht übernommene Bereiche; Verschwinden durch Speichern und durch Bestätigen;
  Dokumentregel und Betreuungsvertrag mit Upload vor/nach dem Wechseltag; Reiter „Offen“.
- **Schulkinder:** Abmeldung genau am 1.9. und nicht vorher; nicht bei ausgeschaltetem Schalter; nicht bei
  abweichendem späterem Schulstart; nicht bei (geplantem) Wechsel in eine Schulkind-Gruppe; Vorschau beim
  Einschalten nennt genau die Betroffenen; Zurücknehmen verlangt neuen Schulstart; Wechsel in Schulkind-Gruppe
  ohne bestätigten Vertrag abgelehnt.
- **Stand:** Vormerkung nie aktiv; `waitlist_has_entry`; Listen und Sortierung; Löschen nur Leitung/Träger.
- **Rechte und Trennung der Kitas** für alle neuen Routen; Tablet ohne Zugriff.
- **Migration:** bestehende Kinder bekommen Stand „Vertrag“ und einen Starteintrag der Historie; die Art
  „Betreuungsvertrag“ ist gekennzeichnet; Einrichtungen haben Stichtag 30.6./6 und Schalter aus.

## 12. Nicht enthalten

- Bundesland pro Einrichtung und Feiertage je Bundesland (eigenes Vorhaben, als Nächstes).
- Warteliste mit automatischem Nachrücken, Platzvergabe nach Alter oder Punkten.
- Betreuungsschlüssel (Personal pro Kind) und Verknüpfung mit dem Dienstplan.
- Automatisches Löschen alter Vormerkungen; automatisches Ende für Kinder in Schulkind-Gruppen.
- Mehrere parallele Verträge je Kind als eigene Datensätze (der weitere Vertrag wird über Wechseltag,
  Bestätigung und das Dokument abgebildet).
- Anwesenheit/Stempeln der Kinder (Gruppenbuch Stufe 2) und Tagesprotokoll (Stufe 3).
