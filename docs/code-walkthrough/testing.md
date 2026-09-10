# Test-Walkthrough

## Strategie und Befehle

Die Tests verteilen sich auf drei Ebenen:

- API-Integrationstests injizieren In-Memory-Repositories/Datenbanken in `buildApp` und prüfen HTTP-Vertrag plus Fachregeln.
- Webtests nutzen Vitest, jsdom, Testing Library und `fake-indexeddb`; sie prüfen Komponenten, lokale Transaktionen und Sync-Zustandsübergänge.
- Crypto-Tests prüfen Web-Crypto-Round-trips und negative Sicherheitsfälle direkt gegen die Paket-API.

Vom Repository-Stamm:

```powershell
npm test
npm run typecheck
npm run build:production
npm run check:pwa
```

Für die Defense sind negative Tests mindestens so wichtig wie Happy Paths: falsche Keys, manipulierte Ciphertexte, Nichtmitglieder, Viewer-Writes, Idempotenz-Mismatch, veraltete Basisversionen und Migration-Rollback demonstrieren die Sicherheitsinvarianten.

## API-Tests

### `apps/api/test/auth.test.ts`

**Verantwortung:** Vollständiger Session-/HTTP-Flow. Prüft Registrierung mit Passwort-Hash und Sessionhash, Login und generische Invalid-Credentials-Antwort, Secure/SameSite-None-Cookie für getrennten Production-Origin, Duplicate-Schutz, `/me`, Logout/Invalidierung, exaktes credentialed CORS, Auth-Rate-Limit, Bodylimit und sichere 500-Antwort.

**Zusammenspiel:** deckt `app.ts`, Auth-Route/-Service/-Repository, Password/Session und Config gemeinsam ab. Besonders thesisrelevant ist der Nachweis, dass weder rohes Passwort noch rohes Sessiontoken gespeichert oder in Fehlern gespiegelt wird.

### `apps/api/test/config.test.ts`

**Verantwortung:** `loadConfig`-Grenzwerte und Deployment-Invarianten. Testet erforderliches Production-CORS, Ablehnung von Wildcards/Pfaden/Credentials, schwache Production-Secrets, PostgreSQL-URLs, numerische Bounds, separate Migration-URL, Cross-Site-Cookies und Ablehnung unsicherer SameSite-None-Nutzung.

### `apps/api/test/health.test.ts`

**Verantwortung:** `/health` liefert 200 bei erreichbarer DB und 503 bei DB-Fehler. Bestätigt, dass Readiness die echte Abhängigkeit und nicht nur den Node-Prozess prüft.

### `apps/api/test/identities.test.ts`

**Verantwortung:** Public-Identity-API. Prüft 404 bei neuer Identität, Registrierung/GET eines validen öffentlichen Schlüssels und strikte Ablehnung privater Schlüsselattribute.

**Security:** Belegt die Servergrenze „Public Key only“.

### `apps/api/test/workspaces.test.ts`

**Verantwortung:** Workspace- und Membership-Fachregeln. Prüft Creator-as-Owner, nutzergefilterte Listen, Member-Reads/Nichtmitglied-Verbergen, Hinzufügen per E-Mail/ID in allen Rollen, Owner-only Invitee-Key und nur wrapped gespeicherten Workspace-Key, Verbote für Nichtowner, Rollen-/Referenzvalidierung, Last-Owner-Schutz sowie erlaubte Rollenänderung/Entfernung bei weiterem Owner.

**Security:** Zentrale Autorisierungssuite für Workspace-Grenzen und Key Sharing.

### `apps/api/test/notes.test.ts`

**Verantwortung:** Direkte verschlüsselte Notiz-API. Testet v2 plus clientgewählte Note-ID/Revision, fehlende v2-Bindings, Viewer-Mutationsverbot, Nichtmitglied-Isolation, malformed/unsupported Envelopes, unveränderliche geordnete Versionen und Owner-Soft-Delete.

### `apps/api/test/comments.test.ts`

**Verantwortung:** Verschlüsselte Kommentar-API. Prüft clientgewählte v2-ID, Parent-Reply, Member-Listen, Viewer-read-only, Nichtmitglied-Isolation, Envelopevalidierung, Editor-own-delete und Owner-Moderation mit vollständiger Ciphertext-Redaction.

### `apps/api/test/sync.test.ts`

**Verantwortung:** Server-Sync. Prüft Accepted plus idempotentes Replay ohne Doppelversion, v2-Umschläge, Pull nach opakem Cursor, Konflikt bei alter Basis ohne Overwrite, Nichtmitglied-Verbot und Viewer-Pull bei abgelehnten Mutationen.

**Defense-Notiz:** Die Suite zeigt, dass Offline-Wiederholung und konkurrierende Bearbeitung unterschiedliche Fälle sind: Replay liefert Duplicate, alte Basis liefert Conflict.

## Web-/Local-first-Tests

### `apps/web/src/test/setup.ts`

**Verantwortung:** Lädt `@testing-library/jest-dom` für DOM-Matcher global in jsdom. Keine Anwendungslogik.

### `apps/web/src/api/client.test.ts`

**Verantwortung:** Prüft optionale API-Origin-Normalisierung, Ablehnung unsicherer URLs, einheitlichen `/api`-Prefix aller API-Familien, `credentials: include` und Erhalt strukturierter Backendfehler.

### `apps/web/src/auth/AuthContext.test.tsx`

**Verantwortung:** Prüft, dass Logout den live React-Authzustand und Appdaten-Queries leert und dass bei Offlinefehlern der zuletzt verifizierte Profilcache verwendet wird.

**Grenze:** Der Test behauptet nicht, dass der Cache eine Online-Session ersetzt.

### `apps/web/src/key-management/userIdentity.test.ts`

**Verantwortung:** Erster-Gerät-Flow. Belegt, dass nur Public Key registriert, der private Schlüssel geschützt lokal behalten, Setup von Recovery unterschieden und eine bestehende Remote-Identität ohne lokalen Private Key nicht ersetzt wird.

### `apps/web/src/key-management/recovery.test.ts`

**Verantwortung:** Browser-Recovery. Prüft Wiederherstellung nach Storage-Verlust, Nutzbarkeit der restaurierten Identität, Ablehnung eines Kits mit abweichender registrierter Public Identity und sicheres Fehlerverhalten für malformed JSON.

### `apps/web/src/key-management/WorkspaceKeyContext.test.tsx`

**Verantwortung:** Simuliert Background-Wechsel und belegt, dass in-memory Workspace-Keys entfernt werden.

### `apps/web/src/local-storage/workspaceKeyRepository.test.ts`

**Verantwortung:** Persistiert nur geschützten Workspace-Key, kann ihn nach DB-Reopen entsperren und ersetzt vorhandene Hülle nicht still.

### `apps/web/src/local-storage/userIdentityRepository.test.ts`

**Verantwortung:** Restore-Semantik: vorhandene Identität bleibt ohne explizite Bestätigung unangetastet und wird nur bei bestätigtem Overwrite ersetzt.

### `apps/web/src/local-storage/repository.test.ts` — **zentrale Local-first-Suite**

**Verantwortung:** Prüft atomare Note+Queue-Erstellung, Edit-Coalescing, Austausch des Ciphertexts bei Folgeänderung, Persistenz über Reopen, Soft-Delete und lokale Payloadvalidierung.

**Legacy-Sicherheit:** Testet Erkennung von Klartext in Notes/Queue/Conflicts, Migration und Verifikation aller Snapshots, vollständigen Rollback bei einem invaliden Plan, Nichtlöschen bei unverifizierbarem bestehendem Umschlag, explizite Löschalternative sowie Klartextfreiheit im normalen verschlüsselten Pfad.

### `apps/web/src/sync/crypto.test.ts`

**Verantwortung:** Entschlüsselt und validiert einen gecachten Remote-Notizsnapshot; deckt die Brücke von Wiremetadaten zu Crypto-AAD ab.

### `apps/web/src/sync/engine.test.ts` — **zentrale Sync-Suite**

**Verantwortung:** Prüft Encrypt→Push→Synced→Cursor, Konfliktspeicherung ohne lokalen Overwrite, geordneten Push abhängiger Create-/Update-Operationen mit Rebase, Retry bei Fehler ohne Cursorfortschritt und Sync einer manuell gelösten Version gegen die Remote-Basis.

### `apps/web/src/components/LegacyPlaintextGate.test.tsx`

**Verantwortung:** Belegt, dass normale Workspace-Inhalte bei Legacy-Klartext blockiert sind, Löschen zwei Bestätigungen verlangt und Children nur nach sauberer Inspektion erscheinen.

### `apps/web/src/components/WorkspaceSyncControls.test.tsx`

**Verantwortung:** Manueller Sync/Status, übereinstimmende Key-Passwortbestätigung, getrennte Identity-/Workspace-Passwörter beim Share, Verbot des Ersatzkeys im Legacy-Fall, Netzwerk-vs.-API-Fehlerlabel und persistente Konfliktanzeige.

### `apps/web/src/components/EncryptionIdentitySetup.test.tsx`

**Verantwortung:** Prüft, dass ein wirklich neues Gerät Identitätserstellung plus Recovery-Empfehlung erhält, während ein Account mit registriertem Public Key beim fehlenden lokalen Private Key zum Recovery-Import geführt wird.

### `apps/web/src/pages/NoteDetailPage.test.tsx`

**Verantwortung:** Prüft Entschlüsselung des lokalen verschlüsselten Drafts, Fallback auf gecachte Serverversion und anschließendes lokales Speichern, deaktivierte Felder bei Lock sowie safe failure und Schreibsperre bei Decryptfehler.

### `apps/web/src/pages/ConflictResolutionPage.test.tsx`

**Verantwortung:** Prüft Anzeige beider Versionen, Keep-local/Accept-remote, manuell editierten Merge und unmittelbares Leeren entschlüsselter Snapshots/Mergefelder beim Lock.

### `apps/web/src/comments/CommentSection.test.tsx`

**Verantwortung:** Belegt Decrypt beim Listen, Encrypt-before-transport beim Create, read-only Viewer und sofortiges Löschen des Klartextdrafts bei Workspace-Lock.

### `apps/web/src/pages/LandingPage.test.tsx`

**Verantwortung:** Sichert deutsche Produktkommunikation und verhindert übertriebene Sicherheitsbehauptungen.

### `apps/web/src/pages/HelpPage.test.tsx`

**Verantwortung:** Sichert den kompakten Ersteinrichtungsablauf und aktuelle sichtbare UI-Bezeichnungen gegen Dokumentationsdrift.

## Crypto-Tests

### `packages/crypto/test/workspace-key.test.ts`

**Verantwortung:** AES-256-GCM-Keyeigenschaften, identischer Raw-Key nach Export/Import und 96-Bit-Zufallsnonce.

### `packages/crypto/test/workspace-key-protection.test.ts`

**Verantwortung:** Protection/Unlock-Round-trip, frische Salt/Nonce für denselben Key, Failure bei falschem Passwort/Workspacekontext sowie Ablehnung kurzer Passwörter und malformed Envelopes.

### `packages/crypto/test/note-content.test.ts`

**Verantwortung:** Unicode-/Leertext-Round-trip, neue Nonce, safe failure bei falschem Key/manipuliertem Ciphertext, strikte Umschlagvalidierung und Größenfälle, obligatorischer v2-Kontext sowie Legacy-v1-Lesbarkeit.

### `packages/crypto/test/comment-content.test.ts`

**Verantwortung:** Unicode/Nonce, getrennte Note-vs.-Comment-AAD-Domäne, Metadatenbindung von v2 und Legacy-v1-Lesbarkeit.

### `packages/crypto/test/user-identity.test.ts`

**Verantwortung:** Erzeugung einer versionierten RSA-Identität mit geschütztem Private Key, recipient-spezifisches Wrapping, Wrong-Private-Key-Failure und Entschlüsselung bestehender Notizen/Kommentare nach erfolgreichem Share.

### `packages/crypto/test/recovery-kit.test.ts`

**Verantwortung:** Kit enthält nur verschlüsseltes privates Material plus Public-Metadaten, Import schützt für das aktuelle Gerätepasswort neu, restaurierte Identität entschlüsselt vorhandene Shares, falsche Recovery-Passphrase und malformed Kit geben kein Keymaterial frei.

## Konfigurationsdateien der Tests

- `apps/api/vitest.config.ts`: 15-Sekunden-Timeout.
- `apps/web/vitest.config.ts`: jsdom und Setup-Datei.
- `packages/crypto/vitest.config.ts`: Thread-Pool.

Diese Dateien werden im Deployment-Dokument ebenfalls eingeordnet, sind hier aber Teil der Testinventur.

## Bekannte Testgrenzen

Die Suites sind überwiegend komponenten-/serviceorientiert und simulieren Browser/DB-Grenzen. Sie ersetzen keinen echten Multi-Browser-E2E-Test, keine Last-/Race-Tests gegen reales PostgreSQL, keine Browser-CSP-Prüfung am Deployment, kein Kryptografieaudit und keine Prüfung kompromittierter Frontendauslieferung. Für die Thesis sollte klar zwischen „durch Tests belegte Invariante“ und „angenommene Plattform-/Deployment-Eigenschaft“ unterschieden werden.
