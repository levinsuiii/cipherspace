import { LegalPageLayout } from "../layouts/LegalPageLayout";

export function PrivacyPage() {
  return (
    <LegalPageLayout
      eyebrow="Datenschutz"
      intro="Diese Hinweise beschreiben die Verarbeitung personenbezogener Daten in der aktuellen öffentlichen Beta von CipherSpace."
      title="Datenschutzerklärung"
    >
      <section>
        <h2>1. Verantwortlicher</h2>
        <address>
          Levin Strecke<br />
          Nikolaus-Becker-Straße 1, 55131 Mainz<br />
          E-Mail: levin.strecke@yahoo.de
        </address>
      </section>

      <section>
        <h2>2. Überblick über die Datenverarbeitung</h2>
        <p>CipherSpace verarbeitet vier voneinander zu unterscheidende Bereiche:</p>
        <ul>
          <li><strong>Server-sichtbare Account- und Metadaten:</strong> insbesondere E-Mail-Adresse, Passwort-Hash, Account-, Workspace-, Mitgliedschafts- und Rollenangaben, IDs, Zeitstempel, verschlüsselte Datensätze und technische Protokolldaten.</li>
          <li><strong>Clientseitig verschlüsselte Workspace-Inhalte:</strong> Workspace-Inhalte sind darauf ausgelegt, vor der Übertragung an den Server im Browser verschlüsselt zu werden. Dazu gehören insbesondere Notiztitel, Notiztexte und Kommentare. Der Server speichert die verschlüsselten Daten samt technisch erforderlicher Verschlüsselungs- und Synchronisationsmetadaten.</li>
          <li><strong>Lokale Browserdaten:</strong> ein kleines Offline-Profil im lokalen Speicher sowie verschlüsselte Offline-Daten, Warteschlangen, Konfliktdaten und geschütztes Schlüsselmaterial in IndexedDB.</li>
          <li><strong>Verarbeitung durch Infrastruktur-Anbieter:</strong> die dokumentierte Beta-Architektur sieht Cloudflare Pages, Render, Neon/PostgreSQL und Resend vor.</li>
        </ul>
        <p>
          Metadaten wie Account-E-Mail, Workspace-Namen, Mitgliedschaften, Rollen, IDs,
          Zeitstempel, Datensatzgrößen und technische Anfrageinformationen sind nicht notwendig
          Ende-zu-Ende-verschlüsselt. CipherSpace verspricht weder vollständige Anonymität noch
          absolute Sicherheit.
        </p>
      </section>

      <section>
        <h2>3. Zwecke und Rechtsgrundlagen</h2>
        <p>
          Account-, Sitzungs-, Workspace-, Synchronisations- und verschlüsselte Inhaltsdaten
          werden verarbeitet, um den angeforderten Beta-Dienst bereitzustellen, Zugriffe zu
          steuern, Zusammenarbeit zu ermöglichen und Änderungen zu synchronisieren. Grundlage ist
          Art. 6 Abs. 1 lit. b DSGVO. E-Mail-Verifikation, Missbrauchsschutz sowie begrenzte
          Sicherheits- und Fehlerprotokollierung dienen außerdem der sicheren und zuverlässigen
          Bereitstellung; soweit diese Verarbeitung nicht bereits zur Vertragserfüllung notwendig
          ist, beruht sie auf dem berechtigten Interesse an Betriebssicherheit und
          Missbrauchsprävention nach Art. 6 Abs. 1 lit. f DSGVO. Die Registrierung enthält keine
          Datenschutz-Einwilligung und keine Marketing-Einwilligung.
        </p>
      </section>

      <section>
        <h2>4. Registrierung, Login und Sitzungen</h2>
        <p>
          Bei der Registrierung und Anmeldung verarbeitet CipherSpace die eingegebene
          E-Mail-Adresse und das Passwort. Das Passwort wird serverseitig als Passwort-Hash
          gespeichert; die Anwendung speichert es nicht im Klartext. Für eine angemeldete Sitzung
          setzt der Server das technisch notwendige Cookie <code>cipherspace_session</code>. Es ist
          für JavaScript nicht lesbar (HTTP-only), gilt für den Pfad <code>/</code>, besitzt ein
          Ablaufdatum und wird beim Abmelden entfernt. In der Datenbank liegt ein kryptografischer
          Hash des zufälligen Sitzungstokens zusammen mit Account-ID, Erstellungs- und Ablaufzeit.
        </p>
      </section>

      <section>
        <h2>5. E-Mail-Verifikation und Account-Reclaim</h2>
        <p>
          Zur Bestätigung einer E-Mail-Adresse werden E-Mail-Adresse, Account-Bezug, Art der
          Bestätigung, ein Hash des zeitlich begrenzten Bestätigungstokens und Ablauf- sowie
          Erstellungszeit verarbeitet. Bei der Wiederbeanspruchung einer bereits vorhandenen,
          nicht bestätigten Adresse kann zusätzlich ein neuer Passwort-Hash vorübergehend mit der
          Bestätigungsanforderung gespeichert werden. Resend erhält die Empfängeradresse und den
          Inhalt der Transaktions-E-Mail einschließlich Bestätigungslink und Ablaufzeit, um die
          Nachricht zu versenden.
        </p>
      </section>

      <section>
        <h2>6. Workspaces, Mitglieder und Inhaltsdaten</h2>
        <p>
          Der Server verarbeitet Workspace-IDs und -Namen, Rollen, Mitgliedschaften,
          Mitglieder-E-Mail-Adressen, Erstellungs- und Änderungszeiten sowie Zuordnungen zu
          Accounts. Für Notizen, Versionen, Kommentare und Synchronisation verarbeitet er unter
          anderem Datensatz- und Benutzer-IDs, Zeitstempel, Löschstatus, Reihenfolgen,
          Versionsbezüge, verschlüsselte Nutzdaten, Nonces, Schlüssel-IDs und Algorithmusangaben.
        </p>
        <p>
          Notiz- und Kommentarinhalte sind darauf ausgelegt, im Client mit einem Workspace-Schlüssel
          verschlüsselt zu werden, bevor sie übertragen werden. Der Server erhält nach dem
          vorgesehenen Ablauf nur das Chiffrat und die notwendigen Metadaten, besitzt aber keinen
          Workspace-Schlüssel. Inhalte können dennoch im entsperrten Browser, auf kompromittierten
          Geräten, durch schädliche Erweiterungen oder manipulierten Frontend-Code offengelegt
          werden. Bereits empfangene Inhalte lassen sich ehemaligen Mitgliedern technisch nicht
          rückwirkend entziehen.
        </p>
      </section>

      <section>
        <h2>7. Kryptografische Identitäts- und Schlüsselmetadaten</h2>
        <p>
          Für die Zusammenarbeit verarbeitet der Server öffentliche Verschlüsselungs- und
          Signaturschlüssel, Schlüsselversionen und -fingerabdrücke, Bundle-Hashes,
          Protokollversionen sowie Empfänger-, Absender- und Workspace-Zuordnungen verschlüsselter
          Workspace-Key-Freigaben. Öffentliche Schlüssel sind nicht geheim. Private
          Identitätsschlüssel und Workspace-Schlüssel sollen nicht ungeschützt an den Server
          übertragen werden; ihre lokal geschützten Umschläge verbleiben nach dem vorgesehenen
          Ablauf im Browser.
        </p>
      </section>

      <section>
        <h2>8. Lokaler Speicher und IndexedDB</h2>
        <p>
          <code>localStorage</code> speichert das zuletzt erfolgreich verifizierte Offline-Profil
          mit Account-ID, E-Mail-Adresse und Erstellungszeit, damit der richtige lokale
          Datenbestand bei einer Netzwerkstörung geöffnet werden kann. Ein eindeutiges
          Nicht-angemeldet-Signal oder erfolgreiches Abmelden löscht diesen Profilcache. Es wird
          kein Sitzungstoken darin gespeichert. <code>sessionStorage</code> wird von der Anwendung
          nicht verwendet.
        </p>
        <p>
          IndexedDB speichert benutzerbezogene Workspace- und Notizmetadaten, verschlüsselte lokale
          Notizen und Versionen, ausstehende Synchronisationsänderungen, Konflikte,
          Synchronisationsstatus, Identitätsprüfungen, angenommene Schlüsselfreigaben und lokal
          passwortgeschützte private Identitäts- und Workspace-Schlüssel. Entsperrte Schlüssel und
          lesbare Inhalte können während der Nutzung vorübergehend im Arbeitsspeicher des Browsers
          liegen. Ältere lokale Datenbankschemata können bis zur angebotenen Migration oder
          Bereinigung noch frühere Klartextfelder enthalten.
        </p>
        <p>
          Diese lokalen Speichertechniken und das Sitzungscookie sind für Authentifizierung,
          Sicherheit, Ende-zu-Ende-Verschlüsselung, Offline-Funktion und ausdrücklich angeforderte
          Funktionen erforderlich. Der Repository-Stand enthält keine nicht notwendigen
          Analyse-, Werbe- oder Tracking-Technologien; deshalb wird kein Einwilligungsbanner
          angezeigt.
        </p>
      </section>

      <section>
        <h2>9. Server- und Sicherheitsprotokolle</h2>
        <p>
          Der API-Server kann technische Anfrageinformationen wie Zeitpunkt, Methode, Route,
          Anfrage-ID und – bei Betrieb hinter einer vertrauenswürdigen Proxy-Infrastruktur – die
          für Betrieb und Rate-Limits verwendete IP-Adresse verarbeiten. Unerwartete Fehler werden
          mit Fehlerklasse und Anfrage-Metadaten protokolliert. Cookie-, Autorisierungs- und
          Set-Cookie-Header sowie Passwort und Bestätigungstoken sind in der konfigurierten
          Protokollierung geschwärzt; Anfragekörper werden nicht absichtlich protokolliert.
        </p>
      </section>

      <section>
        <h2>10. Empfänger und Auftragsverarbeiter</h2>
        <ul>
          <li><strong>Cloudflare:</strong> Auslieferung der statischen Webanwendung über Cloudflare Pages; dabei können technische Zugriffs- und Verbindungsdaten verarbeitet werden.</li>
          <li><strong>Render:</strong> Betrieb der API; dabei werden API-Anfragen, technische Protokolle sowie die an die API übertragenen Account-, Metadaten und verschlüsselten Datensätze verarbeitet.</li>
          <li><strong>Neon:</strong> Betrieb der PostgreSQL-Datenbank mit Account- und Metadaten sowie verschlüsselten Inhaltsdatensätzen.</li>
          <li><strong>Resend:</strong> Versand von E-Mail-Verifikationsnachrichten an die angegebene E-Mail-Adresse.</li>
        </ul>
        <p>
          Die konkreten Verträge zur Auftragsverarbeitung, tatsächlich gewählten Regionen und
          gegebenenfalls erforderlichen Garantien für Übermittlungen in Drittländer müssen vom
          Betreiber vor Veröffentlichung geprüft und dokumentiert werden. Aus dem Repository
          lassen sich weder die tatsächlich konfigurierte Region noch der konkrete
          Übermittlungsmechanismus verlässlich ableiten.
        </p>
      </section>

      <section>
        <h2>11. Speicherdauer und Löschung</h2>
        <p>
          Daten werden nur so lange gespeichert, wie sie für die genannten Zwecke erforderlich
          sind oder gesetzliche Pflichten dies verlangen. Sitzungen und Bestätigungsanforderungen
          besitzen technische Ablaufzeiten; der aktuelle Stand enthält jedoch keine automatische
          Bereinigung aller abgelaufenen Datensätze. Gelöschte Notizen bleiben als soft-gelöschte
          Datensätze einschließlich Versionen auf dem Server. Bei gelöschten Kommentaren werden
          Chiffrat und Verschlüsselungsmetadaten entfernt, während Thread-, Urheber- und
          Zeitmetadaten erhalten bleiben. Lokale verschlüsselte Daten werden beim Abmelden nicht
          automatisch gelöscht. Konkrete betriebliche Lösch- und Aufbewahrungsfristen sind vor
          Veröffentlichung festzulegen.
        </p>
        <p>
          Eine Selbstbedienungsfunktion zur vollständigen Account-Löschung besteht derzeit nicht.
          Auskunfts-, Datenschutz- und Löschanfragen können an levin.strecke@yahoo.de gerichtet
          werden. Gesetzliche Aufbewahrungspflichten und Rechte anderer Beteiligter können einer
          sofortigen oder vollständigen Löschung im Einzelfall entgegenstehen.
        </p>
      </section>

      <section>
        <h2>12. Rechte betroffener Personen</h2>
        <p>
          Betroffene Personen haben nach Maßgabe der DSGVO insbesondere Rechte auf Auskunft,
          Berichtigung, Löschung, Einschränkung der Verarbeitung und Datenübertragbarkeit. Sie
          können einer Verarbeitung auf Grundlage berechtigter Interessen aus Gründen ihrer
          besonderen Situation widersprechen. Anfragen sind an levin.strecke@yahoo.de zu richten.
          Außerdem besteht das Recht, sich bei einer Datenschutzaufsichtsbehörde zu beschweren,
          insbesondere am gewöhnlichen Aufenthaltsort, Arbeitsplatz oder Ort des mutmaßlichen
          Verstoßes.
        </p>
      </section>

      <section>
        <h2>13. Sicherheit und Änderungen</h2>
        <p>
          CipherSpace setzt unter anderem clientseitige Verschlüsselung, geschützte lokale
          Schlüsselumschläge, Passwort-Hashing, HTTP-only-Sitzungscookies, rollenbasierte Zugriffe,
          Transportverschlüsselung in der vorgesehenen Produktionskonfiguration und begrenzte
          Protokollierung ein. Kein technisches System bietet vollständige Sicherheit; insbesondere
          bleiben Endgeräte, Browser und die Auslieferung des Frontends Teil des Schutzmodells.
        </p>
        <p>
          Diese Datenschutzerklärung wird angepasst, wenn sich Funktionen, Datenflüsse,
          Rechtsgrundlagen oder eingesetzte Dienstleister ändern. Die jeweils aktuelle Fassung wird
          auf dieser Seite bereitgestellt.
        </p>
      </section>
    </LegalPageLayout>
  );
}
