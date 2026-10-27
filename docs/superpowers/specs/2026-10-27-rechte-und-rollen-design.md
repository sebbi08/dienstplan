# Rechte und Rollen: einstellbare Rechte und die Rolle Gruppenleitung

Stand: 27.10.2026 · Heute ist fest im Programm verdrahtet, wer was darf (Rollen Träger, Leitung, Mitarbeiter, Tablet;
dazu einzelne Freigaben je Person: „darf Kinderakten bearbeiten“, Urlaubsplanung, Bearbeiter von Bögen, Gruppenrechte am
Tablet). Künftig stellt der Träger die Rechte selbst ein, und es gibt die neue Rolle **Gruppenleitung**.

## 1. Ziel

| Entschieden | |
|---|---|
| Rollen | Träger (fest, darf alles), Leitung, **Gruppenleitung** (neu), Mitarbeiter, Tablet (bleibt fest wie heute) |
| Wer stellt ein | nur der Träger |
| Grundrechte | je Rolle, gelten für alle Einrichtungen gleich |
| Ausnahmen | je Person: einzelne Rechte zusätzlich geben oder wegnehmen |
| Umfang | bei gruppenbezogenen Rechten wählbar: „nur eigene Gruppe“ oder „ganze Einrichtung“ |
| Abhängigkeiten | werden angezeigt; ein Recht, das ein anderes braucht, zieht es mit; Wegnehmen fragt nach den abhängigen |
| Fest beim Träger | Rechte und Rollen einstellen, Träger-Zugänge, Einrichtungen anlegen/löschen, Löschen nach Fristen (Mehr → Löschfristen), Datensicherung und Wiederherstellen |
| Gruppenleitung | gehört zur Gruppe der verknüpften Person; Grundeinstellung wie Mitarbeiter plus „Kinder eintragen (nur eigene Gruppe)“ |
| Umsetzung | drei Teile, jeder einzeln hochgeladen |

## 2. Die Rechte-Liste

- Eine feste Liste von Rechten im Programm (Schlüssel + deutscher Name + Bereich), angelehnt an die Zeilen der heutigen
  Übersicht „Rechte der Rollen“. Bereiche z. B. Dienstplan, Urlaub, Zeiterfassung, Mitarbeiter, Kinder, Kasse, Kalender,
  Teamsitzungen, Bögen, Einstellungen, Benutzer. Beispiele: Dienstplan ansehen / bearbeiten / freigeben; Urlaub
  beantragen / planen / genehmigen; Kinder ansehen / eintragen (anlegen und Akte bearbeiten) / abmelden; Kasse ansehen /
  führen / Monate abschließen; Mitarbeitergespräche führen; Einstellungen der Einrichtung ändern; Zugänge verwalten.
- Je Recht ist festgelegt:
  - **braucht** (andere Rechte, ohne die es nicht geht, z. B. „Kinder eintragen“ braucht „Kinder ansehen“);
  - **schließt ein** (z. B. „Dienstplan freigeben“ schließt „Dienstplan bearbeiten“ ein);
  - ob es einen **Umfang** hat (eigene Gruppe / ganze Einrichtung);
  - ob es **fest beim Träger** ist (nicht vergebbar).
- Jede Prüfstelle fragt „hat die Person das Recht X (für diese Gruppe)?“ statt nach der Rolle.

## 3. Wirksame Rechte einer Person

1. Träger: alles.
2. Sonst: Grundrechte der Rolle → plus die je Person zusätzlich gegebenen → minus die je Person weggenommenen.
3. Danach werden „braucht“ und „schließt ein“ aufgelöst: was eingeschlossen ist, gilt mit; ein Recht, dessen
   Voraussetzung fehlt, gilt nicht.
4. Umfang „nur eigene Gruppe“: gilt für die Gruppe der verknüpften Person (ohne Gruppe/Springer: für keine Gruppe – Hinweis
   in der Oberfläche).
- Rechte gelten immer nur in der Einrichtung der Person (Leitung/Gruppenleitung/Mitarbeiter wie heute).
- Ausgeschiedene Personen bleiben gesperrt (wie heute).

## 4. Teil 1 – Umstellung ohne sichtbare Änderung

- Rechte-Liste, Speicher für Grundrechte je Rolle und Ausnahmen je Person, Prüfung über die Liste.
- Grundeinstellung = genau die heutigen Rechte von Leitung und Mitarbeiter. Die heutigen Freigaben je Person
  („darf Kinderakten bearbeiten“, Urlaubsplanung, Bearbeiter von Bögen, Gruppenrechte) werden in Ausnahmen je Person bzw.
  in ihre bisherige Form übernommen – nach Teil 1 darf jede Person genau das, was sie vorher durfte.
- Test: für jede Route und jede Rolle dasselbe Ergebnis wie vorher (die bestehende Rechte-Prüfung der Routen bleibt grün).

## 5. Teil 2 – Seite „Rechte und Rollen“ (Mehr → Benutzer, nur Träger)

- Tabelle: Zeilen = Rechte nach Bereich, Spalten = Leitung, Gruppenleitung, Mitarbeiter; Häkchen und ggf. Umfang.
- Neben jedem Recht: „braucht: …“ und, wenn eingeschlossen, grau „enthalten in: …“.
- Häkchen setzen: fehlende Voraussetzungen werden mit gesetzt („Kinder ansehen wurde mit freigegeben“).
  Häkchen wegnehmen: Rückfrage „Dann entfällt auch: …“.
- Feste Träger-Rechte stehen ausgegraut mit „nur Träger“.
- Auf der Seite einer Person (Zugang): Liste der wirksamen Rechte; je Recht „von der Rolle“ oder „Ausnahme“;
  zusätzlich geben / wegnehmen / Ausnahme entfernen.
- „Auf Grundeinstellung zurücksetzen“ je Rolle (mit Rückfrage).
- Die Übersicht „Rechte der Rollen“ zeigt die tatsächlichen Einstellungen.

## 6. Teil 3 – Rolle Gruppenleitung

- Beim Anlegen/Ändern eines Zugangs wählbar (wie Leitung und Mitarbeiter); verknüpft mit einer Person.
- Grundeinstellung: Rechte der Mitarbeiter plus „Kinder eintragen“ mit Umfang „nur eigene Gruppe“.
- Menü und Seiten richten sich nach den wirksamen Rechten (wer „Kinder eintragen“ hat, sieht „Kinder“).

## 7. Tests

- Teil 1: jede Route, jede Rolle wie vorher; übernommene Freigaben je Person.
- Wirksame Rechte: Rolle + Ausnahmen, „braucht“, „schließt ein“, Umfang eigene Gruppe, Springer ohne Gruppe.
- Feste Träger-Rechte lassen sich weder an eine Rolle noch an eine Person vergeben (Server lehnt ab).
- Gruppenleitung: Kind der eigenen Gruppe anlegen/bearbeiten ok, anderer Gruppe 403.

## 8. Nicht enthalten

- Rechte je Einrichtung unterschiedlich, eigene Rollen anlegen, Änderungsprotokoll der Rechte.
