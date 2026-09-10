# Frontend-Walkthrough: `apps/web`

## Rolle des Frontends

`apps/web` ist zugleich UI, Offline-Anwendung, Kryptografie-Aufrufer und Sync-Client. Der Browser ist die Klartext- und Schlüsselgrenze: Notiz- und Kommentartext wird hier verschlüsselt, entschlüsselt und nur kurzzeitig im React-Zustand gehalten. IndexedDB speichert lokale verschlüsselte Umschläge, Queue, Konflikte, Public-Metadaten und passwortgeschützte Schlüssel.

## Einstieg und Routing

### `apps/web/src/main.tsx`

**Verantwortung:** Browser-Einstieg. Erzeugt den TanStack-`QueryClient`, prüft das Root-Element, rendert `App` unter `StrictMode`, `BrowserRouter`, `QueryClientProvider` und `AuthProvider` und ruft `registerServiceWorker` auf.

**Wichtige Logik:** Query-Retries sind knapp/ausgeschaltet genug, damit Offlinefehler nicht lange verdeckt werden. Die Provider-Reihenfolge macht Routing, Remote-Cache und Auth im Komponentenbaum verfügbar.

### `apps/web/src/App.tsx`

**Verantwortung:** Deklariert die React-Router-Struktur. Öffentliche Routen führen zu Landing/Login/Register, geschützte Routen zu Workspaces, Recovery/Hilfe und verschachtelten Workspace-/Note-/Conflict-Seiten.

**Zusammenspiel:** `ProtectedRoute`/`PublicOnlyRoute` trennen Sessionzustände; `AuthenticatedLayout` installiert Benutzer- und Dataprovider; `WorkspaceLayout` liefert Workspace-Kontext an Kindseiten.

### `apps/web/src/components/RouteGuards.tsx`

**Verantwortung:** `ProtectedRoute` zeigt Loading/Error, leitet nicht angemeldete Nutzer zum Login und rendert sonst den geschützten Outlet. `PublicOnlyRoute` leitet angemeldete Nutzer zur Workspace-Liste.

**Security:** Der Guard ist UX, keine Autorisierungsgrenze. Ein Angreifer kann Frontendcode umgehen; die API muss jede Berechtigung erneut prüfen.

### `apps/web/src/layouts/AuthenticatedLayout.tsx`

**Verantwortung:** Rahmen für angemeldete Seiten mit Navigation und Logout. Bindet `LocalDataProvider` und `WorkspaceKeyProvider` an die aktuelle User-ID.

**Wichtige Logik:** Dadurch besitzen zwei Accounts im selben Browser getrennte Repository-Scopes und In-Memory-Key-Maps.

### `apps/web/src/layouts/WorkspaceLayout.tsx` — **zentraler Orchestrator**

**Verantwortung:** Lädt Workspace und Mitglieder, cached Remote-Daten lokal, ermittelt Rolle und Schlüsselzugang und stellt `WorkspaceOutletContext` bereit.

**Wichtige Logik:** Verknüpft `useWorkspaceKey`, `WorkspaceSyncControls`, Identitätsprüfung, Key-Share-Setup und `LegacyPlaintextGate`. Owner können den vorhandenen Workspace-Key für Empfänger umwickeln. Empfänger laden den eigenen Share, entsperren die lokale RSA-Identität, wickeln den AES-Key aus und speichern ihn mit eigenem Workspace-Passwort.

**Flow:** Route-ID prüfen → Remote oder lokalen Workspace laden → Key-Status inspizieren → Legacy-Plaintext untersuchen → Schlüsselaktionen/Sync anbieten → erst bei sauberem Gate Outlet rendern.

**Security:** Kein Ersatz-Workspace-Key darf angeboten werden, wenn Legacy-Klartext den ursprünglichen Key verlangt. Public-Key-Versionen und Empfängerbindung müssen mit API und Kryptopaket übereinstimmen.

## Authentifizierung

### `apps/web/src/api/client.ts` — **sicherheitsrelevant**

**Verantwortung:** Zentraler Fetch-Client für Auth, Identität, Workspaces, Mitglieder/Key-Shares, Notizen, Kommentare und Sync.

**Wichtige Elemente:** `ApiError` bewahrt HTTP-Status und stabilen Fehlercode. `normalizeApiBaseUrl` akzeptiert nur eine absolute HTTP(S)-Origin ohne Pfad/Credentials. `buildApiUrl` erzwingt, dass Call-Sites den `/api`-Prefix nicht doppeln. `request` setzt JSON-Header, immer `credentials: "include"`, behandelt 204 und normalisiert Fehler.

**Zusammenspiel:** `api` ist Transport für AuthContext, Query-Seiten, Kommentare, Identitäts-/Recovery-Flows und SyncEngine.

**Security:** Niemals Session-Token in JavaScript ergänzen; das HTTP-only Cookie ist absichtlich die Sessiongrenze. Response-Daten sind untrusted; der Sync-Pfad validiert sie zusätzlich mit Zod.

### `apps/web/src/api/types.ts`

**Verantwortung:** TypeScript-Wireverträge für Benutzer, Workspaces, Mitglieder, Identitäten, Shares, Notes, Comments und Sync.

**Wichtig:** Diese Typen dokumentieren die Grenze, validieren zur Laufzeit aber nichts. Besonders `SyncPushResult` modelliert Accepted, Conflict, Duplicate und Rejected; `clientVersion` trägt die lokale AAD-Revision.

### `apps/web/src/auth/AuthContext.tsx` — **sicherheitsrelevant**

**Verantwortung:** Globaler Session-/Benutzerzustand und Login/Register/Logout.

**Wichtige Logik:** `/auth/me` aktualisiert den verifizierten Offline-Profilcache. Bei 401 wird der Cache entfernt; bei echtem Netzwerkfehler kann der zuletzt verifizierte Benutzer lokale Daten öffnen. Login versucht zusätzlich, die lokale Verschlüsselungsidentität mit dem Account-Passwort zu prüfen/erstellen. Logout leert Authzustand und alle fremden Query-Caches.

**Security:** Der Offline-Profilcache ist kein gültiger Online-Sessionnachweis und enthält kein Cookie. Die API entscheidet weiterhin über jeden Remotezugriff.

### `apps/web/src/auth/offlineUserCache.ts`

**Verantwortung:** Speichert/liest ausschließlich `id`, `email`, `createdAt` in `localStorage`, damit user-gescopte IndexedDB-Daten offline wiedergefunden werden.

**Wichtige Logik:** Storage-Fehler werden toleriert; ungültige JSON/Form wird gelöscht. Es werden weder Sessiontoken noch Schlüssel gespeichert.

## Benutzeridentität, Recovery und Workspace-Key

### `apps/web/src/key-management/userIdentity.ts` — **sicherheitskritisch**

**Verantwortung:** Vergleicht lokale private Identität mit serverseitigem Public Key und richtet den ersten Browser ein.

**Wichtige Funktionen:** `inspectUserCryptoIdentity` unterscheidet ready, mismatch, local-unregistered, missing-registered und missing-unregistered. `ensureLocalUserCryptoIdentity` entsperrt vorhandene lokale Identität oder erzeugt nur dann eine neue, wenn serverseitig noch keine registriert ist. Anschließend wird ausschließlich der Public Key idempotent registriert. `readLocalUserCryptoIdentity` ist der Lesepfad.

**Security:** Existiert remote bereits ein anderer Public Key, wird niemals still ein neues Schlüsselpaar erzeugt. Das verhindert, dass bestehende Key Shares unentschlüsselbar werden.

### `apps/web/src/key-management/recovery.ts` — **sicherheitskritisch**

**Verantwortung:** Browserintegration für Recovery-Kit-Export/-Import.

**Wichtige Funktionen:** `exportLocalUserRecoveryKit` liest die lokale Identität und delegiert die Re-Verschlüsselung. `parseRecoveryKitText` begrenzt Text auf 64 KiB und parst sicher. `verifyOrRegisterPublicIdentity` verlangt Übereinstimmung mit dem bereits registrierten Schlüssel oder registriert denselben bei leerem Serverstand. `importLocalUserRecoveryKit` prüft Owner-ID und überschreibt lokale Identität nur mit ausdrücklicher Bestätigung.

**Security:** Kit, Recovery-Passphrase und PKCS8-Klarbytes werden nicht hochgeladen. Das Kit enthält keine Workspace-Keys und keine Inhalte.

### `apps/web/src/key-management/WorkspaceKeyContext.tsx` — **sicherheitskritisch**

**Verantwortung:** Lebenszyklus entsperrter Workspace-Keys. Status je Workspace: checking, missing, locked, unlocked.

**Wichtige Operationen:** `create` erzeugt AES-Key und persistiert nur den passwortgeschützten Umschlag; `unlock` entschlüsselt diesen; `storeShared` schützt einen aus RSA-Share erhaltenen Key; `getKey` liefert nur einen entsperrten `CryptoKey`; `lock` entfernt ihn. `useWorkspaceKey` bindet diese Aktionen an eine Workspace-ID.

**Wichtige Logik:** Keys liegen in einem `useRef(Map)` und nicht in serialisierbarem React-State. `visibilitychange=hidden`, `pagehide`, Userwechsel oder Unmount leeren den Map. Eine Generation verhindert, dass eine während asynchroner KDF-Arbeit erfolgte Sperre anschließend durch ein spätes Promise wieder aufgehoben wird.

**Nicht leichtfertig ändern:** Die Hintergrundsperre und der Race-Schutz sind Teil des Sicherheitsmodells; JavaScript kann Speicher nicht zuverlässig nullen, aber Referenzen werden so früh wie möglich entfernt.

### `apps/web/src/local-storage/workspaceKeyRepository.ts`

**Verantwortung:** User-/Workspace-gescopte Speicherung von `ProtectedWorkspaceKey` in IndexedDB.

**Wichtige Logik:** `add` statt Upsert verhindert stilles Ersetzen eines vorhandenen Keys; `get` liest über `${userId}:${workspaceId}`. Gespeichert wird nur PBKDF2/AES-GCM-Umschlag, nie der rohe AES-Key.

### `apps/web/src/local-storage/userIdentityRepository.ts`

**Verantwortung:** Speichert eine lokale RSA-Identität mit Public Key plus verschlüsseltem privaten Schlüssel.

**Wichtige Logik:** `add` ist create-only. `restore` lehnt vorhandene Identität mit `LocalIdentityAlreadyExistsError` ab, außer `overwriteExisting` wurde explizit gesetzt; Zeitstempel/Scope werden kontrolliert gesetzt.

### `apps/web/src/components/EncryptionIdentitySetup.tsx`

**Verantwortung:** UX für fehlende, unregistrierte oder abweichende Verschlüsselungsidentität. Bietet ersten Setup-Vorgang oder verweist auf Recovery, je nach `inspectUserCryptoIdentity`.

**Security:** Das Account-Passwort dient lokal zum Schutz des privaten Identity-Keys. Bei bereits registrierter Remote-Identität wird Recovery statt Schlüsselersatz angeboten.

### `apps/web/src/pages/AccountRecoveryPage.tsx`

**Verantwortung:** Sicherheitsseite zum Prüfen des Gerätestatus, Erstellen/Download eines verschlüsselten Recovery-Kits und Import eines Kits.

**Wichtige Logik:** Verwaltet getrennte Account- und Recovery-Passphrasen, validiert Bestätigungen, erzeugt einen lokalen JSON-Download und verlangt vor Überschreiben vorhandener Identity eine ausdrückliche Bestätigung. Nach Import signalisiert sie `AuthContext.identityRestored` und prüft den Status neu.

**Security:** Passphrasen bleiben Komponentenstate und müssen bei Navigation/Statuswechsel verschwinden. Download-Dateien sind weiterhin hochsensibel, obwohl der private Schlüssel verschlüsselt ist.

## IndexedDB und lokale Domäne

### `apps/web/src/local-storage/database.ts` — **sicherheitskritisch**

**Verantwortung:** Dexie-Datenbank `cipherspace-local`, Tabellen und Schema-Upgrades 1–6.

**Tabellen:** `workspaces`, `notes`, `note_versions`, `pending_changes`, `local_sync_metadata`, `conflicts`, `workspace_keys`, `user_crypto_identities`.

**Wichtige Upgrades:** v2 ergänzt Konflikte und Retrydaten; v3 Workspace-Keys; v4 Auflösungsfelder; v5 verschlüsselte lokale Payloadfelder; v6 Benutzeridentitäten. Upgrades initialisieren Struktur, führen Klartext aber nicht automatisch kryptografisch um, weil dafür der Benutzer-Key fehlt. Diese Aufgabe übernimmt das Gate nach Unlock.

**Security:** Fast alle Schlüssel/Indizes enthalten `user_id`, um Konten im selben Browser zu trennen. Alte Klartextfelder bleiben nur zur kontrollierten Migration in den Typen.

### `apps/web/src/local-storage/types.ts`

**Verantwortung:** Persistente Modelle und Zustandsautomaten für lokale Notes, Versionen, Queue, Syncmetadaten, Konflikte, geschützte Workspace-Keys und Identitäten.

**Wichtige Typen:** `PendingChangeStatus` zeigt den Lebenszyklus pending → syncing → synced/failed/conflict/resolved. `ConflictResolutionInput` modelliert die drei Auflösungen. `LocalNote` trennt lokalen Ciphertext, Legacy-Klartext, Basisversion und lokale Revision.

**Defense-Notiz:** Diese Typen sind eine gute Übersicht des Local-first-Datenmodells. Die `local_note_payload`-Felder sind Legacy-Kompatibilität, nicht das gewünschte Normalformat.

### `apps/web/src/local-storage/notePayloadCrypto.ts` — **sicherheitskritisch**

**Verantwortung:** Brücke zwischen `{title, body}` und dem generischen Crypto-Paket.

**Wichtige Funktionen:** `encryptLocalNotePayload` serialisiert kanonisch und verschlüsselt mit Note-Kontext. `decryptLocalNotePayload` entschlüsselt und validiert exakt die Dokumentform. `decryptCachedNoteVersionPayload` prüft Algorithmus, Envelope-Version, Key-ID und rekonstruiert für v2 die positive sichere Revision aus `client_version`.

**Security:** Ein gültiger AES-GCM-Plaintext wird nicht ungeprüft als internes Objekt verwendet; JSON-Form und Metadaten werden erneut validiert.

### `apps/web/src/local-storage/repository.ts` — **zentral, sicherheitskritisch und komplex**

**Verantwortung:** Gesamte lokale Notizdomäne. `LocalNotesRepository` cached Remote-Daten, schreibt lokale Mutationen, coalesced Queue-Einträge, führt Legacy-Migration, verarbeitet Syncresultate, speichert Konflikte und löst sie.

**Normale Schreibpfade:** `createEncryptedNote` und `editEncryptedNote` verschlüsseln vor der Transaktion. `createNote` schreibt Note und Create-Operation atomar. `editNote` erhöht `local_revision` und ersetzt/coalesced eine ausstehende Update-Operation. `deleteNote` setzt Tombstone und legt/coalesced Delete an. Titel-/Body-Limits werden vor Writes geprüft.

**Caching:** `cacheWorkspaces`, `cacheServerNotes` und `cacheServerNoteDetail` halten Offline-Lesedaten. Servermetadaten dürfen einen vorhandenen lokalen verschlüsselten Entwurf nicht überschreiben.

**Legacy-Flow:** `inspectLegacyPlaintextWorkspace` zählt Klartext in Notes, Queue und Konflikten. `migratePlaintextWorkspace` erstellt zuerst einen vollständigen Plan, entschlüsselt/vergleicht eventuell bestehende Umschläge, prüft Revisionen erneut und schreibt alle Bereinigungen in genau einer Dexie-Transaktion. Abschlussinspektion erzwingt Null Klartext. `deleteLegacyPlaintextWorkspace` entfernt alternativ alle aktiven Datensätze betroffener Notes einschließlich Queue/Konflikten.

**Sync-Flow:** `listRetryableChanges`, `beginSyncAttempt`, `markSyncAttemptFailed`, `applyPushResults` und `applyPullResponse` bilden die Queue-Zustandsmaschine. Accepted markiert die Operation synced, cached Version und rebased jüngere abhängige Änderungen. Conflict bewahrt Snapshots und markiert die Operation conflict. Rejected bleibt sichtbar/failure. Pull schreibt Change-Snapshot und Cursor atomar.

**Konflikt-Flow:** `recordConflict` bewahrt Basis-, lokale verschlüsselte und Remote-Version. `resolveEncryptedConflict` verschlüsselt die gewählte Lösung mit neuer Revision. `resolveConflict` verlangt den neuesten Konflikt, markiert alte offene Operationen/Conflicts resolved und erzeugt genau ein neues Update auf `remote_version.id`.

**Nicht leichtfertig ändern:** Transaktionsgrenzen, Vorrang lokaler Entwürfe, Revision-vor-Verschlüsselung und Rebase-Regeln verhindern Klartextpersistenz und Lost Updates. Diese Datei sollte bei einer Defense zusammen mit ihren Tests gezeigt werden.

### `apps/web/src/local-storage/LocalDataContext.tsx`

**Verantwortung:** Erzeugt pro Benutzer eine `LocalNotesRepository`-Instanz und stellt sie per Context bereit. `useLocalData` erzwingt korrekten Provider. `useLocalQuery` bindet Dexie-Live-Queries an React und liefert Loading/Error/Data.

**Zusammenspiel:** Seiten beobachten lokale Daten reaktiv, ohne den Remote-Query-Cache als dauerhafte Quelle zu missbrauchen.

## Synchronisation

### `apps/web/src/sync/protocol.ts` — **sicherheitskritisch**

**Verantwortung:** Laufzeitvalidierung unbekannter Push-/Pull-Antworten mit strikten Zod-Schemas.

**Wichtige Logik:** Prüft UUIDs, Offset-Zeitstempel, kanonisches Base64 und Byte-Grenzen, gepaarte Title-Felder, alle Result-Varianten, Cursorlänge sowie Workspace-/Note-Konsistenz innerhalb gezogener Changes. `parseSyncPushResponse` und `parseSyncPullResponse` sind die einzigen Exporte.

**Defense-Notiz:** Der eigene Server ist aus Sicht eines Local-first-Clients trotzdem eine untrusted Grenze: Proxyfehler, Bugs oder manipulierte Antworten dürfen IndexedDB nicht korrumpieren.

### `apps/web/src/sync/crypto.ts`

**Verantwortung:** Kryptografie-Adapter für Queue und Konfliktsnapshots.

**Wichtige Funktionen:** `encryptPendingNoteChange` lässt schon verschlüsselte Umschläge unverändert und verschlüsselt nur Legacy-Create/Update mit korrektem Kontext; Delete ist nicht verschlüsselbar. `decryptCachedNoteVersion` delegiert die validierte Remote-Entschlüsselung.

### `apps/web/src/sync/engine.ts` — **zentraler Laufzeitfluss**

**Verantwortung:** `NoteSyncEngine` koordiniert einen vollständigen Workspace-Sync unabhängig von React.

**Flow `runSync`:** Key anfordern → Legacy-Migration erzwingen → Metadaten/Retry-Queue laden → etwaige Legacy-Queue-Payloads verschlüsseln → Änderungen nacheinander beginnen/pushen/committen → ab letztem Cursor alle Pull-Seiten validieren und atomar anwenden → Summary liefern. Fehler markieren begonnene Versuche als failed und speichern Workspace-Fehler, ohne Cursor vorzuschieben.

**Wichtige Logik:** `activeSyncs` dedupliziert parallele Sync-Aufrufe pro Workspace. Ein Push pro Operation hält Reihenfolge und ermöglicht nach Accepted das Rebase des nächsten abhängigen Updates.

### `apps/web/src/components/WorkspaceSyncControls.tsx`

**Verantwortung:** UI für Key erzeugen/entsperren/sperren, Empfänger-Share einrichten und manuellen Sync. Zeigt Pending-/Conflict-Zahlen und letzte Ergebnisse.

**Wichtige Logik:** verlangt übereinstimmende Workspace-Passwörter; für Shared Setup getrenntes Identity- und Workspace-Passwort; klassifiziert Netzwerkfehler anders als strukturierte API-Fehler; verbietet neuen Schlüssel während Legacy-Klartext vorliegt.

### `apps/web/src/components/LegacyPlaintextGate.tsx` — **sicherheitskritisch**

**Verantwortung:** Sperrt komplette Workspace-Inhalte, solange `LegacyPlaintextInspection.totalRecords > 0`.

**Wichtige Logik:** Migration verlangt entsperrten Original-Key; Löschen verlangt zweistufige explizite Bestätigung. Normales `children` wird nur bei sauberer Inspektion gerendert.

## Notiz- und Kommentar-UI

### `apps/web/src/pages/WorkspacesPage.tsx`

**Verantwortung:** Remote Workspace-Liste, lokaler Fallback und Workspace-Erstellung. Erfolgreiche Reads/Creates werden in IndexedDB gecached und Query-Keys invalidiert.

**Security:** Workspace-Name ist Servermetadatum und nicht Ende-zu-Ende verschlüsselt. Erstellung sollte erst bei bereiter lokaler Benutzeridentität sinnvoll fortfahren.

### `apps/web/src/pages/WorkspaceOverviewPage.tsx`

**Verantwortung:** Workspace-Dashboard mit Rolle, Mitgliedern, Key-Share-Status, Pending/Conflict-Zahlen und Navigation.

**Zusammenspiel:** nutzt Outlet-Kontext und lokale Live-Queries; Owner-Verwaltungsfunktionen greifen auf die in `WorkspaceLayout` gebauten Key-Share-Flows zurück.

### `apps/web/src/pages/NotesPage.tsx`

**Verantwortung:** Listet lokale aktive Notes, cached Servermetadaten und erstellt offline eine neue verschlüsselte Note.

**Wichtige Logik:** Schreibaktion nur für Owner/Editor und entsperrten Key. Erstellung ist local-first und navigiert anschließend zum lokalen Detail; Sync ist separat.

### `apps/web/src/pages/NoteDetailPage.tsx` — **sicherheitskritisch**

**Verantwortung:** Lädt lokale Note/Version und optional Remote-Detail, entschlüsselt die bevorzugte Quelle, zeigt Editor, speichert lokale verschlüsselte Änderungen und bindet Kommentare ein.

**Wichtige Logik:** Ein lokaler unsynchronisierter Umschlag hat Vorrang; andernfalls wird die neueste gecachte Serverversion entschlüsselt. Bei Lock werden Titel/Body geleert und Inputs deaktiviert. Decrypt-Fehler führen zu sicherem, nicht editierbarem Zustand. Speichern nutzt erwartete Revision indirekt über `editEncryptedNote`; Löschen ist rollenbegrenzt.

**Security:** Klartext existiert im Komponentenstate, solange er angezeigt wird. Er wird nicht in Query-/IndexedDB-Klartext zurückgeschrieben.

### `apps/web/src/pages/ConflictResolutionPage.tsx`

**Verantwortung:** Manuelle Konfliktoberfläche. Zeigt Metadaten und – nur entsperrt – lokale, Basis- und Remote-Inhalte.

**Wichtige Logik:** `keep_local`, `accept_remote` und `manual_merge` werden auf `resolveEncryptedConflict` abgebildet. Bei Lock verschwinden beide Snapshots und Merge-Felder unmittelbar. Die Seite verlangt den neuesten offenen Konflikt.

### `apps/web/src/comments/crypto.ts` — **sicherheitskritisch**

**Verantwortung:** Übersetzt Crypto-Umschlag ↔ Kommentar-API.

**Wichtige Funktionen:** `encryptCommentForApi` bindet Workspace, Note, clientgewählte Kommentar-ID, Author und Parent in v2-AAD und mappt Ciphertext/Nonce/Metadaten. `decryptApiComment` behandelt Soft-Deletes, validiert Algorithmus/Version/Key-ID und entschlüsselt mit exakt denselben Metadaten.

### `apps/web/src/comments/CommentSection.tsx`

**Verantwortung:** Lädt Kommentare/Mitglieder per Query, baut mit `buildThread` einen Parent/Child-Baum, entschlüsselt einzelne Bodies und erlaubt Reply/Delete gemäß Rolle.

**Wichtige Logik:** Neue Kommentar-ID entsteht vor Verschlüsselung. Erfolgreiche Create/Delete-Antworten werden optimistisch in Query-Daten gespiegelt und danach invalidiert. Bei Lock werden Draft, Reply-Ziel und Fehler geleert; Viewer erhalten ein read-only Formular. Noch nicht server-backed Notes haben keine Kommentare.

**Security:** Kommentare liegen nicht in IndexedDB/Sync-Queue und benötigen Onlinezugang. Gelöschte Kommentare rendern keinen Ciphertext.

## Übrige Seiten und Präsentation

### `apps/web/src/pages/AuthPage.tsx`

Gemeinsames Formular für Login/Register. Verwaltet Credentials, zeigt API-/Identitätsfehler und navigiert nach erfolgreicher Session. Passwörter bleiben Formularzustand und werden nicht lokal persistiert.

### `apps/web/src/pages/LandingPage.tsx`

Öffentliche Produktübersicht mit realistischen Aussagen zu Local-first und Verschlüsselung. Für die Thesis wichtig: keine Behauptung vollständiger Metadaten-Anonymität oder Schutzes gegen kompromittierten Client.

### `apps/web/src/pages/HelpPage.tsx`

Kompakter Ersteinrichtungs- und Bedienablauf in deutscher Sprache: Konto, Identität/Recovery, Workspace-Key, Offlinearbeit, Sync und Konflikte.

### `apps/web/src/components/AsyncState.tsx`

Wiederverwendbare Loading-, Error- und Empty-State-Komponenten. `ErrorState` normalisiert unbekannte Fehler und kann Retry anbieten.

### `apps/web/src/queryKeys.ts`

Zentrale, hierarchische TanStack-Query-Keys für Workspaces, Notes, Comments und Mitglieder. Konsistente Keys sind Voraussetzung für zielgerichtete Cache-Invalidierung.

### `apps/web/src/utils.ts`

Kleine reine Präsentationshelfer: deutsches Datum, gekürzte opake IDs und deutsche Rollenbezeichnungen. Keine Sicherheitsentscheidung darf auf gekürzten Werten beruhen.

### `apps/web/src/styles.css`

Globale Gestaltung für Layout, Formulare, Statuskarten, Notizeditor, Kommentare und responsive 360-px-/Safe-Area-Nutzung. Die Datei enthält keine Fachlogik, ist aber für die mobile PWA-Defense relevant: Touchziele, Lesbarkeit, Locked-/Error-States und Konfliktansicht bleiben benutzbar.

### `apps/web/src/vite-env.d.ts`

Bindet Vites Umgebungs-Typen in TypeScript ein. Enthält keine Runtime-Logik; insbesondere ist `VITE_API_BASE_URL` eine öffentlich in das Bundle kompilierte Variable und darf kein Secret sein.

## PWA-Dateien im Quellbaum

### `apps/web/src/pwa.ts`

Registriert den Service Worker ausschließlich im Production-Build nach `load`, mit Root-Scope und `updateViaCache: "none"`. Fehler beeinträchtigen die normale HTTPS-App nicht.

### `apps/web/index.html`

HTML-Shell mit Root-Element, deutschem Dokument, Viewport/Safe-Area, Theme-/PWA-/Apple-Metadaten, Manifest und Icons. Vite ersetzt den TSX-Einstieg beim Build durch gehashte Assets.

### `apps/web/public/service-worker.js` — **sicherheitskritisch**

Cached App-Shell, gehashte Assets, Manifest, Icons und plaintextfreie Offline-Seite. Install extrahiert Assetpfade aus der gebauten Shell; Activate entfernt alte CipherSpace-Caches. Fetch verarbeitet nur same-origin GET. `/api/*` und `/health` werden explizit nie intercepted. Navigation ist network-first mit Shell/Offline-Fallback; statische Assets sind cache-first.

### `apps/web/public/manifest.webmanifest`

Installationsmetadaten: Root-ID/Scope/Start-URL, Standalone-Modus, Farben, Kategorien und `any`-/`maskable`-Icons. Kein Zugriff auf Daten oder Schlüssel.

### `apps/web/public/offline.html` und `apps/web/public/offline.css`

Plaintextfreie statische Fallbackseite, falls die eigentliche App-Shell noch nicht verfügbar ist. Sie behauptet nicht, dass Remotefunktionen offline verfügbar sind, und enthält keine gecachten Benutzerdaten.

### `apps/web/public/_headers`

Hosting-Header für statische Deployments. CSP erlaubt nur Self-Ressourcen und den expliziten Render-API-Origin für `connect-src`; außerdem COOP/CORP, Permissions-Policy, Referrer-Policy, HSTS, Nosniff und Frame-Deny. Details stehen in [Deployment](deployment-and-config.md).

### `apps/web/scripts/check-pwa.mjs`

Statischer Post-Build-Check: Manifestfelder, PNG-Signatur/-Dimensionen, Icons, HTML-Metadaten, expliziter API-/Health-Bypass im Service Worker, Offline-Dateien und Assetverzeichnis.

### `apps/web/scripts/generate-pwa-icons.mjs`

Deterministischer PNG-Generator ohne Bildbibliothek. Implementiert CRC32/PNG-Chunks, zlib-Kompression und zeichnet die CipherSpace-Form für 180/192/512/maskable. Die erzeugten PNGs selbst sind generierte Binärassets und nicht einzeln dokumentiert.

## Defense-Schwerpunkte

Für eine mündliche Code-Defense eignen sich besonders `WorkspaceKeyContext.tsx`, `local-storage/repository.ts`, `sync/engine.ts`, `sync/protocol.ts`, `LegacyPlaintextGate.tsx`, `NoteDetailPage.tsx` und `comments/crypto.ts`: Zusammen zeigen sie, wie UI, Schlüssel, Offlinepersistenz, AAD und Konflikte verbunden sind, ohne die API zur Klartextinstanz zu machen.
