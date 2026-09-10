# Backend-Walkthrough: `apps/api`

## Rolle des Backends

Die Fastify-API ist Authentifizierungs-, Autorisierungs- und Synchronisationsinstanz. Sie speichert verschlüsselte Inhalte opak; sie besitzt keinen Workspace-Key und kann Notizen oder Kommentare nicht entschlüsseln. Ihre Sicherheitsaufgabe ist trotzdem wesentlich: Eingaben begrenzen, Sessions prüfen, Rollen erzwingen, Versionen serialisieren, Wiederholungen idempotent behandeln und Metadatenkonsistenz in PostgreSQL sichern.

Die Schichten sind absichtlich getrennt: Route = HTTP/Validierung, Service = Fachregeln und Fehlersemantik, Repository = SQL/Transaktion.

## Einstieg, Konfiguration und Datenbank

### `apps/api/src/server.ts`

**Verantwortung:** Prozess-Einstiegspunkt. `start` lädt Konfiguration, baut die Fastify-App, bindet Host/Port und installiert geordnete `SIGINT`-/`SIGTERM`-Behandlung. Startfehler werden ohne sensible Details protokolliert; `app.close()` räumt Ressourcen auf.

**Zusammenspiel:** delegiert vollständig an `loadConfig` und `buildApp`. Das Deployment startet die kompilierte Fassung dieser Datei.

**Defense-Notiz:** Der Prozess besitzt kaum Fachlogik. Das erleichtert Tests von `buildApp` ohne echten Listener und erlaubt graceful shutdown des DB-Pools.

### `apps/api/src/config.ts` — **sicherheitskritisch**

**Verantwortung:** `loadConfig` validiert und normalisiert alle Umgebungsvariablen mit Zod. Dazu gehören PostgreSQL-URLs, Poolgröße, Bodylimit, CORS-Originliste, Session-Laufzeit/Secret/Cookie-SameSite, Rate-Limit, Proxy-Vertrauen, Host, Port und Log-Level.

**Wichtige Logik:** `parseCorsOrigins` akzeptiert nur exakte HTTP(S)-Origins ohne Pfad, Credentials oder Wildcards und verlangt in Produktion eine explizite Policy. `validateDatabaseUrl` beschränkt URLs auf PostgreSQL. `validateSessionSecret` fordert ausreichende Länge und verwirft bekannte Platzhalter in Produktion. `SameSite=None` ist nur mit sicherer Produktionskonfiguration zulässig; numerische Werte sind begrenzt.

**Zusammenspiel:** Das Ergebnis steuert `app.ts`, `database.ts`, Cookie-Eigenschaften und Migrationen.

**Nicht leichtfertig ändern:** Lockere CORS-, Proxy- oder Cookie-Prüfungen können Credential-Leaks, CSRF-nahe Cross-Site-Risiken oder IP-Spoofing beim Rate-Limit erzeugen. `VITE_API_BASE_URL` gehört nicht hierher; es ist eine öffentliche Buildvariable des Frontends.

### `apps/api/src/app.ts` — **sicherheitskritisch**

**Verantwortung:** Composition Root. `buildApp` erzeugt Fastify, Datenbank, Repositories und Services und registriert Cookies, CORS, Helmet, Auth-Rate-Limit und alle Routen. Die optional injizierbaren Repositories/Datenbank machen Integrationstests ohne reale Infrastruktur möglich.

**Wichtige Logik:** Request-Bodylimit; `trustProxy`; Log-Redaktion für Authorization/Cookie/Set-Cookie; credentialed CORS; minimale API-CSP; HSTS in Produktion; `no-store` für `/api/*`; einheitliche 404-/Fehlerantworten ohne Stack- oder Datenleck. Auth-Routen erhalten ein eigenes Rate-Limit. Ein selbst erzeugter DB-Pool wird im `onClose`-Hook geschlossen.

**Zusammenspiel:** verbindet jede Route mit dem passenden Service und jedes Service mit Repositorys.

**Defense-Notiz:** Die Datei zeigt Dependency Injection und „secure defaults“. Unerwartete Fehler werden serverseitig geloggt, nach außen aber auf `internal_error` reduziert.

### `apps/api/src/database/database.ts`

**Verantwortung:** Dünner PostgreSQL-Adapter. `createDatabase` erstellt einen `pg.Pool` und stellt `query`, `transaction` und `close` bereit.

**Wichtige Logik:** `transaction` reserviert einen Client, führt `BEGIN`/`COMMIT` aus, macht bei Fehlern `ROLLBACK` und gibt den Client immer frei.

**Zusammenspiel:** Alle PostgreSQL-Repositories sprechen nur gegen dieses Interface. Dadurch können Tests In-Memory-Repositories injizieren.

**Sicherheitsrelevanz:** Die Repositories verwenden parametrisierte Queries; diese Grenze darf nicht durch Stringverkettung untrusted Werte unterlaufen werden.

### `apps/api/src/database/migrate.ts` — **betriebs- und integritätskritisch**

**Verantwortung:** Liest sortierte `.sql`-Migrationen, berechnet SHA-256-Checksummen und führt noch nicht angewandte Dateien aus.

**Wichtige Funktionen:** `readMigrations`, `ensureMigrationTable`, `appliedMigrations`, exportiertes `runMigrations`, CLI-`main`.

**Wichtige Logik:** Ein PostgreSQL-Advisory-Lock verhindert parallele Migratoren. Jede Migration läuft in einer Transaktion. Eine bereits angewandte, nachträglich veränderte Datei wird über Checksum-Mismatch abgelehnt. `MIGRATIONS_DATABASE_URL` kann von der Runtime-URL getrennt sein.

**Nicht leichtfertig ändern:** Angewandte SQL-Dateien sind unveränderliche Historie; Korrekturen gehören in eine neue additive Migration.

## Authentifizierung und Session

### `apps/api/src/auth/password.ts` — **sicherheitskritisch**

**Verantwortung:** `hashPassword` und `verifyPassword` kapseln Argon2id. Parameter: 32-Byte-Hash, 19.456 KiB Memory, zwei Iterationen und Parallelität eins.

**Wichtige Logik:** Verifikationsfehler werden zu `false`, damit beschädigte Hashes keine internen Details nach außen tragen.

**Nicht leichtfertig ändern:** Algorithmus oder Parameter brauchen eine Migrationsstrategie für vorhandene Hashes und eine Performance-/DoS-Abwägung.

### `apps/api/src/auth/session.ts` — **sicherheitskritisch**

**Verantwortung:** `createSessionToken` erzeugt 32 kryptografisch zufällige Bytes als Base64url. `hashSessionToken` bildet mit dem Server-Secret einen HMAC-SHA-256-Hash.

**Datenfluss:** Nur das rohe Token geht als Cookie an den Client; nur der Hash liegt in `sessions`. Ein DB-Leak allein liefert damit keine sofort nutzbaren Session-Tokens.

### `apps/api/src/auth/repository.ts`

**Verantwortung:** `AuthRepository` definiert Benutzer-/Session-Persistenz; `PostgresAuthRepository` implementiert sie.

**Wichtige Methoden:** `createUser` behandelt Unique-Verletzung als erwarteten Duplicate-Fall; `findUserByEmail` vergleicht case-insensitiv; `createSession`, `findUserBySessionTokenHash` mit Ablaufprüfung und `deleteSession`.

**Zusammenspiel:** Wird ausschließlich vom `AuthService` genutzt. SQL gibt Passwort-Hashes nie an HTTP-Mapper weiter.

### `apps/api/src/auth/service.ts` — **sicherheitskritisch**

**Verantwortung:** Registrierung, Login, Session-Erstellung, Authentifizierung und Logout.

**Wichtige Logik:** `register` hasht vor dem Insert. `login` nutzt bei unbekannter E-Mail einen einmal erzeugten Dummy-Argon2-Hash, um Timing-Unterschiede gegenüber falschem Passwort zu reduzieren. `createSession` speichert nur den Token-HMAC und berechnet das Ablaufdatum. `publicUser` entfernt den Passwort-Hash.

**Fehler:** `DuplicateAccountError` und `InvalidCredentialsError` erlauben Routen sichere, generische Antworten.

### `apps/api/src/auth/middleware.ts` — **sicherheitskritisch**

**Verantwortung:** `createRequireAuthentication` liest das Session-Cookie, lässt es vom Service prüfen und setzt `request.authenticatedUser`.

**Zusammenspiel:** Alle geschützten Routen hängen diesen Handler als `preHandler` ein. Fehlendes, abgelaufenes oder ungültiges Token führt immer zu derselben 401-Antwort.

**Defense-Notiz:** Authentifizierung beantwortet „wer?“. Die späteren Services müssen separat „darf diese Person das?“ beantworten.

### `apps/api/src/routes/auth.ts` — **sicherheitskritisch**

**Verantwortung:** Endpunkte `/register`, `/login`, `/me`, `/logout` unter `/api/auth`.

**Wichtige Logik:** Striktes Credentials-Schema normalisiert E-Mail und erzwingt 12–128 Passwortzeichen. Login/Register haben 4-KiB-Bodylimit und Rate-Limit. `setSessionCookie` setzt HTTP-only, Path `/`, hohe Priorität, Ablauf, konfiguriertes SameSite und `Secure` in Produktion. Logout ist absichtlich idempotent und löscht DB-Session sowie Cookie.

**Sicherheitsrelevanz:** Das Cookie ist für JavaScript unsichtbar. Bei getrennten Origins ist `SameSite=None; Secure` zusammen mit exakter CORS-Origin nötig.

## Öffentliche Verschlüsselungsidentitäten

### `apps/api/src/identities/repository.ts`

**Verantwortung:** Speichert und liest versionierte öffentliche Benutzeridentitäten in `user_crypto_identities`.

**Wichtige Logik:** `findCurrent` wählt die höchste Version. `register` ist idempotent für exakt denselben Schlüssel, lehnt aber widersprüchliche Daten derselben beziehungsweise unerwarteter Version ab. Das feste Algorithmusliteral lautet `RSA-OAEP-3072-SHA256`.

**Sicherheitsrelevanz:** Die Tabelle darf niemals PKCS8/private Daten aufnehmen.

### `apps/api/src/identities/service.ts` — **sicherheitskritisch**

**Verantwortung:** Liefert den aktuellen Public Key und registriert Public-Key-Material.

**Wichtige Logik:** `validateRsaPublicKey` dekodiert SPKI, prüft kanonisches Base64 und importiert/validiert RSA-OAEP-3072 mit SHA-256. Der Service mappt Repository-Ergebnisse auf `IdentityNotFound`, `InvalidIdentityPublicKey` oder `IdentityVersionConflict`.

**Zusammenspiel:** Workspace-Key-Sharing verlässt sich auf diese registrierte Identität, bietet aber in v1 keine Key-Transparency oder Signaturen.

### `apps/api/src/routes/identities.ts` — **sicherheitskritisch**

**Verantwortung:** Authentifizierte GET-/PUT-Routen unter `/api/crypto/identity`.

**Wichtige Logik:** Das strikte Schema akzeptiert nur Algorithmus, Key-Version und höchstens 2.048 Zeichen kanonisches Base64. Zusätzliche Felder – insbesondere Private Keys – werden abgelehnt.

## Workspaces, Rollen und Key Shares

### `apps/api/src/workspaces/repository.ts` — **sicherheitskritisch**

**Verantwortung:** SQL für Workspaces, Mitglieder und verschlüsselte Key Shares; definiert `WorkspaceRole`, Result-Unionen und gespeicherte Modelle.

**Wichtige Methoden:** `createWorkspace` legt Workspace und Owner-Mitgliedschaft transaktional an; List-/Find-Methoden filtern nach Mitgliedschaft. `addMember` schreibt Mitglied und Key Share gemeinsam. `putKeyShare`, `getKeyShare` und `getKeyAccess` verwalten Schlüsselzugang. `updateMemberRole` und `removeMember` schützen den letzten Owner.

**Wichtige Logik:** Mutationen sperren den Workspace (`FOR UPDATE`/Hilfsfunktion `lockWorkspace`) und prüfen die Actor-Rolle innerhalb derselben Transaktion. So kann eine zwischen Service-Prüfung und SQL-Write geänderte Rolle keine TOCTOU-Lücke erzeugen. Owner-Zählung verhindert Downgrade oder Entfernung des letzten Owners. Key-Share-Status wird ohne Entschlüsselung ermittelt.

**Sicherheitsrelevanz:** `encrypted_workspace_key` ist RSA-OAEP-Ciphertext. Der Server darf keinen Rohschlüssel erhalten. Reine Vorabprüfung im Service reicht bei konkurrierenden Requests nicht; die Repository-Prüfung ist Teil der Invariante.

### `apps/api/src/workspaces/service.ts` — **sicherheitskritisch**

**Verantwortung:** Fachregeln und öffentliche DTOs für Workspace-Lifecycle, Mitgliedschaften und Schlüsselteilung.

**Wichtige Methoden:** `createWorkspace`, `listWorkspaces`, `getWorkspace`, `listMembers`, `addMember`, `getInviteePublicKey`, `putKeyShare`, `getOwnKeyShare`, `getKeyAccess`, `updateMemberRole`, `removeMember`.

**Wichtige Logik:** Owner-only für Verwaltung und Abruf des Invitee-Public-Key. Beim Share werden Sender- und Empfängeridentität geladen und die Empfänger-Key-Version gegen den vom Client verwendeten Schlüssel geprüft. `addMember` verlangt Share und Mitgliedschaft zusammen. Fehlerklassen trennen Not-found, Forbidden, Missing Identity, Key-Version-Race und Last-Owner.

**Defense-Notiz:** Die API bestätigt nur Algorithmus/Version/Empfänger und speichert Ciphertext. Dass der Share wirklich den richtigen Workspace-Key enthält, kann der Server ohne Schlüssel nicht prüfen.

### `apps/api/src/routes/workspaces.ts`

**Verantwortung:** HTTP-Verträge für Workspace CRUD-Lesepfade, Mitgliederverwaltung, Invitee-Key, Key-Access und Key-Shares.

**Wichtige Logik:** UUID-, Rollen-, E-Mail- und Name-Schemas sind strikt. Der RSA-Ciphertext muss kanonisches Base64 und exakt 512 Byte kodieren (RSA-3072-OAEP ergibt 384 Byte; die Base64-Zeichenlänge ist 512). Die Route übersetzt fachliche Fehler in stabile 403/404/409-Codes.

**Flow Hinzufügen:** Actor authentifizieren → Owner prüfen → Nutzer referenzieren → Public Keys/Versionen prüfen → Mitgliedschaft und Share atomar speichern → Mitglied mit `keyShareStatus` zurückgeben.

## Verschlüsselte Notizen und Versionen

### `apps/api/src/notes/repository.ts` — **sicherheitskritisch**

**Verantwortung:** Persistiert `encrypted_notes`, unveränderliche `note_versions` und passende `sync_changes`.

**Wichtige Methoden:** `createNote`, `listNotes`, `findNoteWithLatestVersion`, `appendVersion`, `listVersions`, `softDeleteNote`.

**Wichtige Logik:** Erstellen und Anhängen laufen transaktional, sperren relevante Notizen, nummerieren Versionen monoton, setzen Parent/current-Version konsistent und erzeugen Sync-Events. Lesepfade joinen Mitgliedschaft, sodass Nichtmitglieder keine Existenzdetails sehen. Normaler List/Get blendet Soft-Deletes aus. Nur Ciphertext, Nonce und Metadaten werden gemappt.

**Security:** SQL prüft Workspace-Zugehörigkeit und Membership zusätzlich zur Serviceschicht. Ciphertext wird nicht als vertrauenswürdiger Klartext interpretiert.

### `apps/api/src/notes/service.ts`

**Verantwortung:** DTO-Mapping und rollenbasierte Fachregeln für direkte Notiz-API.

**Wichtige Methoden:** `createNote`, `listNotes`, `getNote`, `appendVersion`, `listVersions`, `deleteNote`. Mapper konvertieren PostgreSQL-`bytea` zu Base64 und zurück.

**Autorisierung:** Mitglieder dürfen lesen; Owner/Editor schreiben; nur Owner löscht. Fehlende Mitgliedschaft wird als Workspace-not-found behandelt, um Daten nicht offenzulegen.

**AAD-Bezug:** `clientVersion` transportiert die lokale Revision, die der Browser zur Rekonstruktion der v2-AAD benötigt. Die API validiert Form und Metadaten, führt aber keine AES-GCM-Prüfung aus.

### `apps/api/src/routes/notes.ts` — **sicherheitskritisch**

**Verantwortung:** Direkte Notiz-Endpunkte: Create/List/Get, Version anhängen/auflisten und Soft-Delete.

**Wichtige Logik:** Strikte UUID- und Envelope-Schemas; kanonisches Base64; Nonce exakt 12 Byte; Ciphertext inklusive GCM-Tag bis 1 MiB; gepaarte optionale Title/Nonce-Felder; erlaubte Algorithmus-/Envelope-/Key-ID-Metadaten. v2 verlangt Client-ID/Revision-Kontext und clientgewählte Note-ID, weil diese IDs vor der Verschlüsselung in AAD gebunden werden.

**Defense-Notiz:** Diese Route ist die untrusted Netzwerkgrenze. TypeScript-Typen allein wären kein Schutz gegen übergroße oder inkonsistente Umschläge.

## Verschlüsselte Kommentare

### `apps/api/src/comments/repository.ts`

**Verantwortung:** SQL-Zugriff auf `encrypted_comments`.

**Wichtige Methoden:** `createComment`, `findActiveNote`, `findComment`, `listComments`, `softDeleteComment`.

**Wichtige Logik:** Workspace/Note-Zuordnung und Parent-Kommentar derselben Notiz werden durch Queries und Foreign Keys abgesichert. Listen ist membership-gefiltert und chronologisch. Soft-Delete setzt neben `deleted_at` sämtliche Inhalts-, Nonce- und Kryptometadaten auf `NULL`.

**Security:** Gelöschter Kommentartext bleibt nicht als weiterhin abrufbarer Ciphertext in der aktiven Zeile. Das ist Redaction, aber keine Garantie gegen Backups oder DB-WAL.

### `apps/api/src/comments/service.ts`

**Verantwortung:** Rollen- und Parent-Regeln, DTO-Mapping und Löschmoderation.

**Wichtige Methoden:** `createComment`, `listComments`, `deleteComment`.

**Autorisierung:** Viewer lesen, aber schreiben/löschen nicht. Editor darf den eigenen Kommentar löschen; Owner darf moderieren. Nichtmitglieder erhalten Workspace-not-found. Parent muss existieren und derselben aktiven Notiz angehören.

**Wichtige Logik:** `publicComment` liefert bei gelöschten Kommentaren konsequent `null` für Ciphertext, Nonce und Metadaten.

### `apps/api/src/routes/comments.ts` — **sicherheitskritisch**

**Verantwortung:** Create/List/Delete unter einer Workspace-/Note-URL.

**Wichtige Logik:** v2-Kommentare brauchen eine clientgewählte Kommentar-ID, weil Kommentar-ID, Author-ID, Note-ID, Workspace-ID und Parent-ID in AAD gebunden sind. Nonce ist 12 Byte, Ciphertext maximal 64 KiB, Base64 kanonisch und Metadaten sind strikt. Fachfehler werden auf stabile 403/404/409-Antworten abgebildet.

## Synchronisation und Konflikte

### `apps/api/src/sync/repository.ts` — **sicherheitskritisch und komplex**

**Verantwortung:** Atomare Verarbeitung einer Sync-Operation sowie geordnetes Lesen von Sync-Events.

**Wichtige Hilfen:** Mapper für Notes/Versions, `insertVersion`, `insertOperation`, `insertChange`, `readNote`, `readVersion`.

**Flow `processOperation`:**

1. Transaktion öffnen und Advisory Locks für Operation-ID und Note-ID erwerben.
2. Vorhandene Operation suchen. Identische Workspace-/Actor-/Client-/Request-Hash-Daten liefern gespeichertes Ergebnis als Duplicate; abweichende Wiederverwendung wird abgelehnt.
3. Bei Create: Owner/Editor prüfen; existierende Note wird Konflikt, sonst Note, erste Version, Operation und Sync-Event gemeinsam anlegen.
4. Bei Update/Delete: aktive Note samt aktueller Rolle `FOR UPDATE` laden; Schreib-/Löschrolle prüfen.
5. Wenn `current_version_id !== baseVersionId`, unveränderte Remote-Version als Konflikt speichern und zurückgeben.
6. Sonst Delete als Tombstone/Event oder Update als nächste unveränderliche Parent-Version/Event committen.

`pullChanges` liest `sync_changes` streng nach globaler Sequenz innerhalb des Workspace und joint den zugehörigen Note-/Version-Snapshot.

**Defense-Notiz:** Locks, Request-Hash und DB-Transaktion sind die Kernbegründung für deterministische Idempotenz und konfliktfreie Parallelität. Entfernt man einen Teil, können doppelte Versionen oder verlorene Updates entstehen.

### `apps/api/src/sync/service.ts`

**Verantwortung:** Übersetzt Wire-Payloads, erzeugt Request-Hashes, verarbeitet Batches sequenziell und kodiert/decodiert opake Pull-Cursor.

**Wichtige Funktionen:** `requestHash` hasht eine kanonisch konstruierte JSON-Struktur; `cursorFor` bindet Version, Workspace-ID und Sequenz; `sequenceFromCursor` validiert exakt Form und Workspace. `pushResult` normalisiert Accepted/Conflict/Duplicate.

**Wichtige Methoden:** `push` prüft zunächst Mitgliedschaft und verarbeitet jede Änderung einzeln; Repository-Ablehnungen werden zu `idempotency_key_reused`, `note_not_found` oder `write_forbidden`. `pull` liest Seiten zu 500 Events plus Lookahead und erzeugt `hasMore`/`nextCursor`.

**Sicherheitsrelevanz:** Cursor sind opak und validiert, aber nicht geheim oder signiert. Zugriffsschutz kommt von der Mitgliedschaftsprüfung. Viewer dürfen Pull, aber Repositorys lehnen Mutationen ab.

### `apps/api/src/routes/sync.ts`

**Verantwortung:** POST `/api/workspaces/:workspaceId/sync/push` und GET `.../pull`.

**Wichtige Logik:** Zod begrenzt Batchgröße, UUIDs, Zeitstempel, positive Revisionen, Operationskombinationen, Cursorlänge und Envelope-Größen. Create/Update benötigen Ciphertext; Delete darf keinen Ciphertext tragen. Die Route mappt ungültigen Cursor, fehlende Mitgliedschaft und Validierungsfehler auf kontrollierte Antworten.

## Health

### `apps/api/src/routes/health.ts`

**Verantwortung:** `/health` prüft mit `SELECT 1` die DB-Erreichbarkeit. Erfolg liefert 200, Fehler 503 und nur einen Fehlerklassennamen im Log.

**Zusammenspiel:** Docker/Render nutzen den Endpunkt für Readiness. Er enthält keine Benutzer- oder Secretsdaten.

## SQL-Migrationen

### `apps/api/migrations/0001_backend_foundation.sql`

Legt Benutzer, Workspaces, ursprüngliche Mitgliedschaften, verschlüsselte Notizen, unveränderliche Versionen und `sync_changes` an. Paar-Checks koppeln verschlüsselten Titel an Nonce. Zusammengesetzte Foreign Keys erzwingen, dass Parent- und Current-Version zur selben Note gehören. Indizes bedienen Membership-, Note- und Cursorpfade.

### `apps/api/migrations/0002_authentication.sql`

Macht Passwort-Hashes verpflichtend und erzeugt `sessions` mit eindeutigem 64-stelligem Hex-Tokenhash, Ablaufdatum und Indizes. Rohe Session-Tokens sind absichtlich nicht Teil des Schemas.

### `apps/api/migrations/0003_workspace_membership_roles.sql`

Benennt `owner_user_id` in `creator_user_id` um, migriert die alte Rolle `member` zu `editor` und führt `owner/editor/viewer` ein. Wichtig für die Trennung von historischer Erzeugerschaft und aktueller Owner-Rolle.

### `apps/api/migrations/0004_encrypted_note_api.sql`

Ergänzt begrenztes `client_version` für den Clientkontext und einen Partial Index für aktive Notizen. Bei v2 entspricht dieser Wert der authentifizierten lokalen Revision.

### `apps/api/migrations/0005_note_sync_protocol.sql`

Legt `sync_operations` als Idempotenzjournal an: Operation/Client/Actor/Note, Request-Hash, Basisversion und genau eines der Ergebnisse Accepted oder Conflict. Checks sichern erlaubte Typen, positive Revision und konsistente Ergebnis-IDs.

### `apps/api/migrations/0006_encrypted_comments.sql`

Legt verschlüsselte Kommentare mit Workspace-/Note-/Parent-Konsistenz an. Der Lifecycle-Check verlangt entweder einen vollständigen aktiven Umschlag oder einen vollständig redigierten Soft-Delete. Parent-Kommentare sind auf dieselbe Note beschränkt.

### `apps/api/migrations/0007_workspace_key_sharing.sql`

Legt ausschließlich öffentliche, versionierte RSA-Identitäten und empfängerbezogene Workspace-Key-Ciphertexte an. Foreign Keys binden Sender- und Empfängerversion; Algorithmuschecks begrenzen v1 auf RSA-OAEP-3072-SHA256. Private Keys und Workspace-Rohschlüssel haben hier keinen Platz.

## Zusammenfassung für die Code-Defense

Der überzeugendste Backend-Pfad ist `route → service → repository → constraints`: dieselbe Regel wird an der passenden Grenze erneut abgesichert. Routen schützen das Netzwerkformat, Services formulieren verständliche Fachregeln, Repositories beseitigen Race Conditions, und Foreign Keys/Checks schützen die dauerhafte Invariante.
