<script setup lang="ts">
import type { Role } from '#shared/types/api'
import { de } from '~/locales/de'

/**
 * Overview of what each role may do (shown to the Träger on the users page). Keep in step with requireAdmin /
 * requireProvider / requireUser / requireTerminal in server/api and the per-person stamping options.
 * 'yes' = allowed, 'no' = not allowed, a number = allowed under footnote n.
 */
type Footnote = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11
type Right = 'yes' | 'no' | Footnote
const ROLES: Role[] = ['provider', 'admin', 'observer', 'terminal']

const GROUPS: { title: string; rows: { label: string; rights: [Right, Right, Right, Right] }[] }[] = [
  { title: 'Dienstplan', rows: [
    { label: 'Freigegebenen Dienstplan ansehen (mit den Gruppen und den Anwesenden je Gruppe)', rights: ['yes', 'yes', 'yes', 'yes'] },
    { label: 'Entwurf ansehen, bearbeiten, freigeben, Änderungen verwerfen', rights: ['yes', 'yes', 'no', 'no'] },
    { label: 'Überstunden, Soll/Ist und Warnungen im Dienstplan sehen', rights: ['yes', 'yes', 'no', 'no'] },
    { label: 'Dienstplanvorlagen speichern, einsetzen und verwalten (für die ganze Einrichtung oder eine Gruppe)', rights: ['yes', 'yes', 'no', 'no'] },
    { label: 'Einzelne Dienste einer anderen Gruppe zuordnen', rights: ['yes', 'yes', 'no', 'no'] },
    { label: 'Aushilfen aus anderen Einrichtungen einplanen', rights: ['yes', 'yes', 'no', 'no'] },
  ] },
  { title: 'Zeiterfassung', rows: [
    { label: 'Am Kita-Tablet mit PIN stempeln (immer erlaubt, sobald eine PIN gesetzt ist)', rights: [1, 1, 'yes', 'no'] },
    { label: 'Mit dem eigenen Handy stempeln', rights: [1, 1, 2, 'no'] },
    { label: 'Eigene Stempelzeiten, Stundenkonto und Urlaub ansehen', rights: [1, 1, 'yes', 'no'] },
    { label: 'Als gemeinsames Gerät: Stempeln für Mitarbeiter mit PIN', rights: ['no', 'no', 'no', 'yes'] },
    { label: 'Alle Stempelzeiten ansehen, nachtragen und korrigieren, Begründungen', rights: ['yes', 'yes', 'no', 'no'] },
  ] },
  { title: 'Mitarbeiter', rows: [
    { label: 'Anlegen, Wochenstunden, Urlaub, Stundenkonto-Buchungen, PIN, Stempeln und Pausen', rights: ['yes', 'yes', 'no', 'no'] },
    { label: 'Stammgruppe festlegen (oder Springer)', rights: ['yes', 'yes', 'no', 'no'] },
    { label: 'Vertragsangaben (TVöD) bearbeiten', rights: ['yes', 'no', 'no', 'no'] },
    { label: 'Vertragsangaben und Hinweise zum Stufenaufstieg ansehen', rights: ['yes', 3, 'no', 'no'] },
    { label: 'Vertragsangaben für die Leitung freigeben', rights: ['yes', 'no', 'no', 'no'] },
    { label: 'Pflichttermine (z. B. Betriebsarzt, Erste-Hilfe-Kurs) und Fortbildungen der Mitarbeiter eintragen', rights: ['yes', 'yes', 'no', 'no'] },
    { label: 'Hinweis auf fällige, überfällige und fehlende Pflichttermine sehen', rights: ['yes', 'yes', 'no', 'no'] },
    { label: 'Eigene Pflichttermine und Fortbildungen ansehen („Meine Termine“, ohne Hinweis)', rights: [1, 1, 'yes', 'no'] },
  ] },
  { title: 'Urlaubsanträge', rows: [
    { label: 'Urlaub beantragen und eigene Anträge sehen', rights: [4, 4, 4, 'no'] },
    { label: 'Urlaubsplanung: Anträge entscheiden, Kalender, Höchstzahl gleichzeitig im Urlaub', rights: [4, 5, 'no', 'no'] },
    { label: 'Modul ein- und ausschalten, Zuständige festlegen', rights: ['yes', 'no', 'no', 'no'] },
  ] },
  { title: 'Planung und Übersichten', rows: [
    { label: 'Schließzeiten, Feiertage, frühere Schließungen', rights: ['yes', 'yes', 'no', 'no'] },
    { label: 'Krankheitstage, Jahreskalender bearbeiten (Termine, Abwesenheiten), Druckansichten', rights: ['yes', 'yes', 'no', 'no'] },
    { label: '„Im Dienst erkrankt“ eintragen (die geplante Zeit bleibt gutgeschrieben) und die Liste „Vorzeitig gegangen wegen Krankheit“ sehen', rights: ['yes', 'yes', 'no', 'no'] },
    { label: 'Jahreskalender ansehen', rights: ['yes', 'yes', 6, 'no'] },
  ] },
  { title: 'Kinder', rows: [
    { label: 'Kinderliste und Akten ansehen', rights: ['yes', 'yes', 8, 10] },
    { label: 'Vormerkungen & Verträge ansehen', rights: ['yes', 'yes', 9, 11] },
    { label: 'Offene Bestätigungen ansehen', rights: ['yes', 'yes', 8, 10] },
    { label: 'Kinder anlegen und Akten ändern', rights: ['yes', 'yes', 7, 10] },
    { label: 'Vertrauliche Dokumente öffnen', rights: ['yes', 'yes', 7, 10] },
    { label: 'Kinder abmelden, Archiv, löschen', rights: ['yes', 'yes', 'no', 10] },
    { label: 'Vormerkung löschen', rights: ['yes', 'yes', 'no', 10] },
    { label: 'Belegung ansehen, Plätze ändern, Gruppenwechsel planen', rights: ['yes', 'yes', 'no', 10] },
    { label: 'Stichtag, automatische Abmeldung der Schulkinder, Gruppe „für Schulkinder“', rights: ['yes', 'no', 'no', 'no'] },
    { label: 'Löschfrist einstellen', rights: ['yes', 'no', 'no', 'no'] },
    { label: 'Tablet einstellen: Sperrzeit, Vormerkungen und künftige Vertragskinder am Tablet zeigen', rights: ['yes', 'yes', 'no', 'no'] },
    { label: 'Freischaltung „darf Kinderakten pflegen“ vergeben', rights: ['yes', 'yes', 'no', 'no'] },
    { label: 'Betreuungsformen und Dokumentarten pflegen', rights: ['yes', 'yes', 'no', 'no'] },
    { label: 'Kind in andere Einrichtung verschieben', rights: ['yes', 'no', 'no', 'no'] },
  ] },
  { title: 'Verwaltung', rows: [
    { label: 'Benutzer der Rollen Leitung, Mitarbeiter und Stempel-Tablet verwalten', rights: ['yes', 'yes', 'no', 'no'] },
    { label: 'Träger-Konten anlegen, ändern und weitere Träger ernennen', rights: ['yes', 'no', 'no', 'no'] },
    { label: 'Einstellungen: Zeiterfassung ab, Dienste, Codes, Pflichtdienste (für die ganze Einrichtung oder eine Gruppe)', rights: ['yes', 'yes', 'no', 'no'] },
    { label: 'Einstellungen: Arten der Pflichttermine und nach wie vielen Monaten sie wieder fällig sind', rights: ['yes', 'yes', 'no', 'no'] },
    { label: 'Einrichtungen anlegen, umbenennen, zwischen ihnen wechseln, Mitarbeiter verschieben', rights: ['yes', 'no', 'no', 'no'] },
    { label: 'Gruppen einer Einrichtung anlegen, umbenennen und löschen', rights: ['yes', 'no', 'no', 'no'] },
    { label: 'Datenbank herunterladen (Datensicherung)', rights: ['yes', 'no', 'no', 'no'] },
    { label: 'Eigenes Passwort ändern', rights: ['yes', 'yes', 'yes', 'no'] },
  ] },
]

const FOOTNOTES: Record<Footnote, string> = {
  1: 'nur wenn das Konto mit einem Mitarbeiter verknüpft ist (beim Handy zusätzlich: „Stempeln über“ erlaubt das Handy)',
  2: 'wenn die Leitung beim Mitarbeiter „Kita-Tablet und eigenes Handy“ eingestellt hat',
  3: 'nur lesen und nur, wenn der Träger die Vertragsangaben für die Leitung freigegeben hat',
  4: 'wenn der Träger das Modul Urlaubsanträge eingeschaltet hat (beim Beantragen: Konto mit einem Mitarbeiter verknüpft)',
  5: 'wenn das Modul eingeschaltet ist und der Träger diese Leitung als zuständig für die Urlaubsplanung festgelegt hat',
  6: 'nur lesen: Urlaub, Sonderurlaub, Fortbildung und Schule aller, Krankheitstage nur die eigenen, Termine nur die für Mitarbeiter freigegebenen',
  7: 'nicht mit dem eigenen Konto, nur am Tablet der Einrichtung (Name und PIN) und nur mit Freischaltung „darf Kinderakten pflegen“',
  8: 'nicht mit dem eigenen Konto, nur am Tablet der Einrichtung (Name und PIN)',
  9: 'nicht mit dem eigenen Konto, nur am Tablet der Einrichtung (Name und PIN) und nur, wenn es in den Einstellungen (Tablet) freigegeben ist',
  10: 'nach dem Aufschließen mit Name und PIN, mit den Rechten der aufschließenden Person',
  11: 'nach dem Aufschließen mit Name und PIN, mit den Rechten der aufschließenden Person; ohne Leitungsrechte nur, wenn es in den Einstellungen (Tablet) freigegeben ist',
}
</script>

<template>
  <section class="space-y-3 rounded-lg bg-white p-4 ring-1 ring-gray-200">
    <h2 class="font-semibold">{{ de.users.rightsTitle }}</h2>
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="text-left text-xs text-gray-600">
          <tr>
            <th class="px-2 py-1" />
            <th v-for="role in ROLES" :key="role" class="whitespace-nowrap px-2 py-1 text-center">{{ de.users.roles[role] }}</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="group in GROUPS" :key="group.title">
            <tr><td colspan="5" class="bg-gray-50 px-2 py-1 text-xs font-semibold text-gray-600">{{ group.title }}</td></tr>
            <tr v-for="row in group.rows" :key="row.label" class="border-t border-gray-100">
              <td class="px-2 py-1">{{ row.label }}</td>
              <td v-for="(right, index) in row.rights" :key="index" class="px-2 py-1 text-center">
                <span v-if="right === 'yes'" class="font-semibold text-green-700" :aria-label="de.users.rightYes">✓</span>
                <span v-else-if="right === 'no'" class="text-gray-300" :aria-label="de.users.rightNo">–</span>
                <span v-else class="font-semibold text-amber-700" :title="FOOTNOTES[right]">✓<sup>{{ right }}</sup></span>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
    <ol class="space-y-0.5 text-xs text-gray-500">
      <li v-for="(text, number) in FOOTNOTES" :key="number"><sup>{{ number }}</sup> {{ text }}</li>
    </ol>
  </section>
</template>
