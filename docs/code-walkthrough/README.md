# CipherSpace: strukturierter Code-Walkthrough

## Ziel und Abgrenzung

Diese Dokumentation erklärt die relevante Implementierung von CipherSpace für eine Bachelorarbeit oder Code-Defense. Sie beschreibt Verantwortlichkeiten, wichtige Funktionen, Abhängigkeiten, Laufzeitpfade und Sicherheitsgrenzen. Sie ist bewusst keine zeilenweise Nacherzählung offensichtlicher Framework- oder UI-Boilerplate.

Dokumentiert sind die Quell- und Testdateien unter `apps/api`, `apps/web` und `packages/crypto`, die SQL-Migrationen sowie relevante Build-, Deployment- und Sicherheitskonfiguration. `packages/shared` und ein eigenständiges `database/migrations` existieren in diesem Stand nicht. Generierte Dateien, Abhängigkeiten, Lockfiles, Build-Ausgaben, Coverage, Binärassets und lokale Geheimnisse sind ausgeschlossen.

**Bewusst ausgeschlossene konkrete Dateien/Verzeichnisse:** `node_modules/`, alle `dist/`-, `build/`- und `coverage/`-Inhalte, `.git/`, `package-lock.json`, die lokale `.env`, die generierten PNGs `apps/web/public/icons/cipherspace-180.png`, `cipherspace-192.png`, `cipherspace-512.png`, `cipherspace-maskable-512.png` sowie das rein visuelle Asset `apps/web/public/icons/cipherspace.svg`. Ihre Erzeugung beziehungsweise Einbindung wird dokumentiert, nicht ihr Pixel-/Vektorinhalt. Ebenfalls nicht aufgenommen sind unversionierte Audit-Artefakte außerhalb des verlangten Projektumfangs.

## Projektkarte

```text
Browser / PWA (apps/web)
  ├─ React-Routen und UI
  ├─ Auth-Zustand; Session-Cookie bleibt HTTP-only
  ├─ Workspace-Key nur entsperrt im Arbeitsspeicher
  ├─ IndexedDB/Dexie als lokale Quelle für Notizen und Sync-Queue
  ├─ @cipherspace/crypto für Ver- und Entschlüsselung
  └─ typisierter Fetch-Client
             │ HTTPS / JSON, credentials: include
             ▼
Fastify API (apps/api)
  ├─ Session-Authentifizierung
  ├─ Workspace- und Rollenautorisierung
  ├─ Validierung verschlüsselter Umschläge als opake Daten
  ├─ idempotenter Push, Konflikterkennung und Cursor-Pull
  └─ PostgreSQL-Repositories
             │
             ▼
PostgreSQL
  ├─ Benutzer, Sessions, Mitglieder und Public Keys
  ├─ verschlüsselte Workspace-Key-Shares
  ├─ verschlüsselte Notizen, Versionen und Kommentare
  └─ Sync-Operationen und geordnete Sync-Events
```

Die wichtigste Architekturgrenze lautet: Notiz- und Kommentar-Klartext wird im Browser ver- und entschlüsselt. Die API sieht Ciphertext und Betriebsmetadaten, aber keinen Inhaltsklartext. Workspace-Namen, E-Mail-Adressen, Mitgliedschaften, IDs, Zeitpunkte, Rollen und Größen bleiben serverseitig sichtbar.

## Dokumente und empfohlene Lesereihenfolge

1. [Backend und API](apps-api.md) – HTTP-Grenze, Authentifizierung, Autorisierung, Services, Repositories und Migrationen.
2. [Frontend und PWA](apps-web.md) – React-Struktur, Schlüsselzustand, IndexedDB, Sync, Konflikte und Recovery.
3. [Kryptografiepaket](packages-crypto.md) – Algorithmen, Umschlagformate, AAD-Bindung und Schlüsselteilung.
4. [Shared Package](packages-shared.md) – erklärt, warum es derzeit kein `packages/shared` gibt und wo Verträge liegen.
5. [Deployment und Konfiguration](deployment-and-config.md) – Docker, Render, Vite, Nginx, CSP und Service Worker.
6. [Tests](testing.md) – Teststrategie und Verantwortung jeder Testsuite.

## Zentrale Laufzeitflüsse

### Anmeldung und Session

1. `AuthPage` ruft den Client in `apps/web/src/api/client.ts` auf.
2. Die API-Route validiert E-Mail und Passwort; `AuthService` prüft Argon2id beziehungsweise erstellt einen Benutzer.
3. Ein zufälliges Session-Token geht ausschließlich als HTTP-only Cookie an den Browser. In PostgreSQL liegt nur ein HMAC-SHA-256-Hash des Tokens.
4. Geschützte Routen führen `createRequireAuthentication` aus und schreiben den verifizierten Benutzer in `request.authenticatedUser`.
5. Rollenprüfungen erfolgen danach in Workspace-, Note-, Comment- oder Sync-Service und zusätzlich transaktional in kritischen Repository-Pfaden.

### Workspace-Erstellung, Mitgliedschaft und Key Sharing

1. Ein angemeldeter Benutzer erzeugt zunächst lokal eine RSA-OAEP-Identität; nur der öffentliche Schlüssel wird registriert.
2. Beim Workspace-Ersteller erzeugt der Browser einen AES-256-GCM-Workspace-Key und speichert nur dessen passwortgeschützten Umschlag in IndexedDB.
3. Vor dem Hinzufügen eines Mitglieds lädt der Owner dessen Public Key, umwickelt den bestehenden Workspace-Key lokal mit RSA-OAEP und sendet Mitgliedschaft plus Ciphertext gemeinsam.
4. Die API prüft Owner-Rolle, Identitätsversionen und Mitgliedschaft atomar. Private Keys und unverschlüsselte Workspace-Keys verlassen den Browser nie.
5. Das neue Mitglied entschlüsselt den Share mit seinem lokalen privaten Schlüssel und schützt den erhaltenen Workspace-Key mit einem eigenen Workspace-Passwort.

### Lokale Änderung und Synchronisation

1. `NoteDetailPage` erhält den entsperrten Workspace-Key aus `WorkspaceKeyContext`.
2. `LocalNotesRepository` verschlüsselt die Notiz mit AAD aus Workspace-ID, Note-ID und lokaler Revision.
3. Notiz und `pending_change` werden in einer Dexie-Transaktion dauerhaft geschrieben, bevor Netzwerkzugriff erfolgt.
4. `NoteSyncEngine` schiebt retry-fähige Operationen einzeln in lokaler Reihenfolge. Die API speichert Operation-ID und Request-Hash für Idempotenz.
5. Stimmt `baseVersionId` mit der aktuellen Serverversion überein, wird eine unveränderliche Version angelegt. Sonst liefert die API einen Konflikt, ohne den lokalen Entwurf zu überschreiben.
6. Danach zieht der Client Seiten ab einem opaken Cursor und schreibt Versionen, Metadaten und Cursor atomar.

### Konfliktauflösung

`LocalNotesRepository.recordConflict` bewahrt verschlüsselte lokale, Basis- und Remote-Snapshots. `ConflictResolutionPage` entschlüsselt sie nur bei entsperrtem Workspace. „Lokal behalten“, „Remote übernehmen“ und „manuell zusammenführen“ erzeugen jeweils einen neuen verschlüsselten lokalen Stand, beenden alte divergente Queue-Einträge und legen genau eine neue Update-Operation auf Basis der Remote-Version an.

### Legacy-Plaintext-Migration

Alte IndexedDB-Schemata können Klartextfelder enthalten. `LegacyPlaintextGate` blockiert daher normale Workspace-Routen. Erst nach Entsperren des ursprünglichen Workspace-Keys plant `migratePlaintextWorkspace` alle Umwandlungen, prüft vorhandene Ciphertext-Umschläge und schreibt alles in einer Transaktion. Formfehler, falsche Schlüssel, nicht übereinstimmende Umschläge oder konkurrierende Änderungen rollen den gesamten Vorgang zurück. Alternativ kann der Benutzer nach doppelter Bestätigung alle betroffenen aktiven lokalen Datensätze löschen.

## Sicherheitskritische Invarianten

- Ein unverschlüsselter Workspace-Key darf weder an die API gesendet noch dauerhaft gespeichert werden.
- Der private RSA-Schlüssel darf nur passwortgeschützt in IndexedDB oder in einem separat passwortgeschützten Recovery-Kit vorkommen.
- Für neue Notizen und Kommentare muss Umschlagversion 2 mit identischem AAD-Kontext beim Entschlüsseln verwendet werden. Version 1 ist ausschließlich ein Legacy-Lesepfad.
- Nonces dürfen unter demselben AES-GCM-Key nie wiederverwendet werden; die Bibliothek erzeugt sie zufällig pro Verschlüsselung.
- Autorisierung darf nicht der UI überlassen werden. Jede Workspace-Operation muss serverseitig Mitgliedschaft und Rolle prüfen.
- Lokale unsynchronisierte Inhalte haben Vorrang vor Server-Caches; Pull darf lokale Entwürfe nicht überschreiben.
- Sync-Operation-IDs sind nur zusammen mit identischem Request-Hash wiederholbar.
- Service Worker und HTTP-Caches dürfen niemals API-, Health-, Session-, Sync-, Notiz- oder Kommentarantworten cachen.
- Beim Wechsel in den Hintergrund werden entsperrte Schlüssel aus dem verwalteten In-Memory-Map entfernt und Klartextfelder der UI geleert.

## Vollständige gefilterte Dateiinventur

### Backend

- Einstieg und Infrastruktur: `apps/api/src/app.ts`, `config.ts`, `server.ts`, `database/database.ts`, `database/migrate.ts`.
- Authentifizierung: `apps/api/src/auth/middleware.ts`, `password.ts`, `repository.ts`, `service.ts`, `session.ts`.
- HTTP-Routen: `apps/api/src/routes/auth.ts`, `comments.ts`, `health.ts`, `identities.ts`, `notes.ts`, `sync.ts`, `workspaces.ts`.
- Domänenmodule: je `repository.ts` und `service.ts` unter `comments`, `identities`, `notes`, `sync` und `workspaces`.
- Datenbank: `apps/api/migrations/0001_...sql` bis `0007_...sql`.
- Tests und Builddateien sind in [Tests](testing.md) beziehungsweise [Deployment](deployment-and-config.md) inventarisiert.

### Frontend

- Einstieg/Routing: `main.tsx`, `App.tsx`, `pwa.ts`, `queryKeys.ts`, `utils.ts`, `vite-env.d.ts`.
- API/Auth: `api/client.ts`, `api/types.ts`, `auth/AuthContext.tsx`, `auth/offlineUserCache.ts`.
- Schlüssel/Recovery: alle Dateien unter `key-management` sowie `local-storage/workspaceKeyRepository.ts` und `userIdentityRepository.ts`.
- Lokale Daten/Sync: übrige Dateien unter `local-storage` und `sync`.
- UI: Dateien unter `components`, `layouts`, `pages` und `comments` sowie `styles.css`.
- PWA/Hosting: `index.html`, `public/manifest.webmanifest`, `public/service-worker.js`, `public/offline.*`, `public/_headers`, `nginx.conf` und die zwei Dateien unter `scripts`.
- Tests und Builddateien sind separat inventarisiert.

### Kryptografie

- Bibliotheksquellen: alle zwölf Dateien unter `packages/crypto/src`.
- Paket-README, Manifest, TypeScript-/Vitest-Konfiguration und sechs Testsuiten.

### Architekturkontext

- `README.md`, `docs/ARCHITECTURE.md`, `docs/SYNC_PROTOCOL.md`, `docs/THREAT_MODEL.md` und `docs/DEPLOYMENT.md` liefern Kontext. Sie sind keine Laufzeitabhängigkeiten und ersetzen nicht die Implementierung als maßgebliche Quelle.

## Geeignete Schwerpunkte für Bachelorarbeit und Code-Defense

Besonders ergiebig sind die Trennung von Klartext- und Ciphertext-Zonen, die AAD-Metadatenbindung, die Kombination aus local-first Persistenz und optimistischer Versionskontrolle, die transaktionale Idempotenz im Backend, der Legacy-Migrations-Gate sowie die Recovery- und Key-Sharing-Grenzen. Diese Themen zeigen nicht nur Framework-Nutzung, sondern begründbare Architekturentscheidungen, explizite Invarianten und testbare Fehlerfälle.
