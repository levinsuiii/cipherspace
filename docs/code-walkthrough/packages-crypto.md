# Kryptografie-Walkthrough: `packages/crypto`

## Zweck und Vertrauensgrenze

`@cipherspace/crypto` ist eine browserkompatible, transport- und speicherunabhängige Web-Crypto-Bibliothek ohne Runtime-Abhängigkeiten. Sie implementiert Inhaltsverschlüsselung, lokale Schlüsselhüllen, Benutzeridentitäten, Workspace-Key-Sharing und Recovery-Kits. Das Backend importiert dieses Paket nicht; nur vertrauenswürdiger Clientcode soll Klartext und rohe Schlüssel an diese API übergeben.

Aktueller Algorithmusstand: AES-256-GCM für Inhalte und lokale Hüllen, 96-Bit-Nonce, 128-Bit-GCM-Tag, PBKDF2-HMAC-SHA-256 mit 600.000 Iterationen für Passwortableitung und RSA-OAEP-3072/SHA-256 für Empfänger-Key-Shares.

## Dateien

### `packages/crypto/src/constants.ts` — **sicherheitskritisch**

**Verantwortung:** Zentrale Algorithmus-, Versions- und Größenkonstanten: AES-GCM, Legacy-Envelope v1, aktuelle v2, Workspace-Key v1, Identity-/Recovery-Version, Key-/Nonce-/Taglängen sowie 1-MiB-Note- und 64-KiB-Comment-Ciphertextlimit.

**Zusammenspiel:** Nahezu jede andere Kryptodatei und die API-Grenzen spiegeln diese Werte.

**Nicht leichtfertig ändern:** Versions-/Algorithmusänderungen sind Protokollmigrationen, keine reine Umbenennung. Frontend, API-Validierung, gespeicherte Daten und Tests müssen gemeinsam migriert werden.

### `packages/crypto/src/types.ts`

**Verantwortung:** Öffentliche serialisierbare Formate und Kontexte: Note-/Comment-Umschläge, v2-AAD-Kontexte, Fehlercodes, Workspace-Key-Hülle, Public/Local Identity, Recovery-Kit und Key Share.

**Wichtige Aussage:** `LocalUserCryptoIdentity` enthält einen verschlüsselten privaten Schlüssel; `PublicUserCryptoIdentity` nicht. `ProtectedWorkspaceKey` ist persistierbar, der rohe `CryptoKey` nicht. Das Recovery-Kit bindet Identitäts- und KDF-Metadaten.

### `packages/crypto/src/errors.ts`

**Verantwortung:** `CipherSpaceCryptoError` ergänzt normale Errors um einen stabilen `CryptoErrorCode` und optional eine interne Cause.

**Security:** Aufrufer können sichere, generische Fehler behandeln, ohne Web-Crypto-Ausnahmen oder falscher-Key-vs.-manipulierter-Ciphertext zu unterscheiden.

### `packages/crypto/src/encoding.ts`

**Verantwortung:** Base64-Konvertierung für Browser-`Uint8Array`.

**Wichtige Logik:** `decodeBase64` verlangt String, nichtleere Länge als Vielfaches von vier, gültiges Padding/Alphabet und Round-trip-Kanonizität. Fehler werden `invalid_payload`.

**Security:** Kanonische Darstellung verhindert mehrere Textrepräsentationen derselben Bytes und vereinfacht Hash-, Validierungs- und Protokollvergleiche.

### `packages/crypto/src/content-aad.ts` — **sicherheitskritisch**

**Verantwortung:** Deterministische Additional Authenticated Data (AAD) für Notizen und Kommentare.

**Wichtige Funktionen:** `noteAdditionalData` und `commentAdditionalData`. v1 liest feste Legacy-Strings. v2 erzeugt UTF-8-kodierte JSON-Arrays mit fester Feldreihenfolge und validiert kanonische kleingeschriebene UUIDs sowie positive sichere lokale Revisionen.

**Bindings:**

- Note: `['cipherspace.note', 2, 'AES-GCM', 1, workspaceId, noteId, localRevision]`.
- Kommentar: `['cipherspace.comment', 2, 'AES-GCM', 1, workspaceId, noteId, commentId, authorId, parentCommentId]`.

**Security:** AAD wird authentifiziert, aber nicht verschlüsselt. Ein Verschieben des Ciphertexts zu anderem Workspace/Objekt/Revision/Autor/Parent lässt die Entschlüsselung scheitern. Feldreihenfolge oder Serialisierung zu ändern macht vorhandene v2-Daten unlesbar.

### `packages/crypto/src/workspace-key.ts` — **sicherheitskritisch**

**Verantwortung:** Erzeugt, prüft, exportiert und importiert den symmetrischen Workspace-Key.

**Wichtige Funktionen:** `assertWorkspaceKey` prüft Typ, AES-GCM, 256 Bit, Extractability und benötigte Usage. `generateWorkspaceKey` nutzt Web Crypto für einen extrahierbaren AES-256-GCM-Key. `exportWorkspaceKey` gibt exakt 32 Bytes als kanonisches Base64 aus; `importWorkspaceKey` akzeptiert nur dieses Format.

**Security:** Extractability ist für RSA-`wrapKey`/lokale Protection nötig, erhöht aber den Schutzbedarf. Exportierte Rohbytes dürfen nie unwrapped persistiert, geloggt oder transportiert werden.

### `packages/crypto/src/note-content.ts` — **sicherheitskritisch**

**Verantwortung:** AES-GCM-Ver-/Entschlüsselung von UTF-8-Notizinhalt.

**Wichtige Funktionen:** `generateNonce` erzeugt 12 Zufallsbytes. `encryptNoteContent` validiert Key/Klartext/Größe, erzeugt v2-AAD und gibt einen JSON-sicheren Umschlag. `decryptNoteContent` validiert exakt Felder, Version, Keyversion, kanonisches Base64, Nonce und Größe vor Web Crypto; v2 verlangt Kontext, v1 bleibt lesbar.

**Flow:** Text kodieren → Größenlimit inklusive 16-Byte-Tag → frische Nonce → AES-GCM mit AAD → Base64-Envelope. Beim Lesen umgekehrt mit fatalem UTF-8-Decoder.

**Security:** Wrong Key, manipulierte Daten oder falsche AAD enden im selben `decryption_failed`. Temporäre Bytearrays werden bestmöglich mit Nullen überschrieben; JavaScript-Strings können nicht zuverlässig gelöscht werden.

### `packages/crypto/src/comment-content.ts` — **sicherheitskritisch**

**Verantwortung:** Entsprechender AES-GCM-Pfad für Kommentartext mit eigenem Domänentag und 64-KiB-Limit.

**Wichtige Funktionen:** `encryptCommentContent`, `decryptCommentContent`; strikte Payloadvalidierung entspricht dem Note-Format.

**Security:** Eigene AAD-Domäne verhindert Cross-Type-Substitution zwischen Note und Kommentar. v2 bindet insbesondere Autor und Parent; ein Server kann einen Kommentar nicht unbemerkt einem anderen Thread zuordnen.

### `packages/crypto/src/workspace-key-protection.ts` — **sicherheitskritisch**

**Verantwortung:** Passwortgeschützte lokale Speicherung eines Workspace-Keys.

**Wichtige Funktionen:** `protectWorkspaceKey` exportiert die 32 Rohbytes nur kurzzeitig, leitet mit PBKDF2/SHA-256/600.000 und 16-Byte-Zufallssalz einen AES-256-Key ab und verschlüsselt mit frischer 12-Byte-Nonce. `unlockWorkspaceKey` validiert Envelope, entschlüsselt und importiert wieder einen Workspace-Key.

**AAD:** bindet Format, Algorithmusparameter, `userId` und `workspaceId`. Eine Hülle kann daher nicht in einen anderen Account/Workspace kopiert werden.

**Security:** Workspace-Passwort wird nie gespeichert oder gesendet. Es ist ein Wrapping-Passwort, nicht der Notizschlüssel selbst. Parameteränderungen benötigen Envelope-Versionierung und Migration.

### `packages/crypto/src/user-identity.ts` — **sicherheitskritisch und komplex**

**Verantwortung:** RSA-Identität, lokale private-key Protection, Pair-Verifikation und Workspace-Key-Wrapping.

**Wichtige Funktionen:**

- `createUserCryptoIdentity`: erzeugt RSA-OAEP-3072/SHA-256, exportiert SPKI Public Key und schützt PKCS8 lokal mit Account-Passwort.
- `protectUserPrivateKeyBytes` / `decryptProtectedUserPrivateKeyBytes`: PBKDF2/AES-GCM-Hülle mit User-ID-AAD.
- `verifyUserIdentityPrivateKeyBytes`: importiert Private/Public Key und prüft das Paar über eine lokale kryptografische Probe.
- `unlockUserCryptoIdentity`: liefert nicht-extrahierbaren RSA-Private-`CryptoKey` für unwrap/decrypt.
- `wrapWorkspaceKeyForRecipient`: RSA-OAEP-wrap des existierenden AES-Keys.
- `unwrapWorkspaceKeyShare`: prüft 384-Byte-RSA-Ciphertext und unwrappt auf einen AES-Key.

**OAEP-Label:** bindet Share-Version, Workspace-ID, Empfänger-ID und Empfänger-Key-Version. So kann ein Share nicht still einem anderen Empfänger/Workspace zugeordnet werden.

**Security:** Nur SPKI/Public Key geht zur API. PKCS8-Klarbytes werden bestmöglich genullt. Das v1-System hat keine Sender-Signatur/Key-Transparency; ein kompromittierter Public-Key-Verteiler bleibt außerhalb des Schutzumfangs.

### `packages/crypto/src/recovery-kit.ts` — **sicherheitskritisch**

**Verantwortung:** Exportiert eine lokale Identität in ein portables, separat passwortgeschütztes JSON-Kit und importiert sie sicher wieder.

**Wichtige Funktionen:** `exportUserRecoveryKit` entsperrt die lokale Identität im Speicher, verschlüsselt PKCS8 neu unter einer mindestens 16 Zeichen langen Recovery-Passphrase und frischen Salt/Nonce. `importUserRecoveryKit` validiert exakte Objektfelder/Datums-/Größen-/Algorithmuswerte, bindet User-ID, entschlüsselt, verifiziert das Key-Paar und schützt es erneut mit dem aktuellen Account-Passwort.

**AAD:** bindet Kit-/Identity-Version, Zeitpunkte, User-ID, Public Key, PKCS8-Format sowie KDF-/AES-Parameter. Manipulation öffentlicher Metadaten lässt GCM-Prüfung scheitern.

**Security:** Ein falsches Passwort oder fehlerhaftes Kit liefert kein Keymaterial. Kit-Verlust plus Passphrase-Verlust kann Identität offenlegen; Verlust aller Identity-Kopien macht bestehende Shares unbrauchbar.

### `packages/crypto/src/index.ts`

**Verantwortung:** Öffentliche Paketoberfläche. Re-exportiert nur die vorgesehenen Konstanten, Funktionen, Fehler und Typen; interne Validatoren/Helfer bleiben gekapselt.

**Defense-Notiz:** Dieser Barrel ist der Contract für `apps/web`. Änderungen hier können Consumer brechen, selbst wenn Implementierungsdateien gleich bleiben.

## Paket- und Builddateien

### `packages/crypto/package.json`

Definiert ESM-Paket, `dist/index.js`/`.d.ts`-Exports, Node-22-Anforderung und Build/Test/Typecheck-Scripts. Es gibt keine Runtime-Dependencies, wodurch die kryptografische Trusted Computing Base klein bleibt.

### `packages/crypto/tsconfig.json`

Erweitert die strikte Root-Konfiguration, bindet DOM/Web-Crypto-Typen ein und erzeugt JS, Declarations und Sourcemaps aus `src` nach `dist`.

### `packages/crypto/vitest.config.ts`

Führt Tests im Thread-Pool aus. Die Tests nutzen die Web-Crypto-Unterstützung der Node-22-Laufzeit.

### `packages/crypto/README.md`

Bestehende Paket-Kurzdokumentation mit API-Beispiel, Envelope-/AAD-Format, Befehlen und Grenzen. Sie ist gute Consumer-Dokumentation; dieses Walkthrough-Dokument ergänzt Entwurfsbegründung und dateibezogene Defense-Hinweise.

## Sicherheitsmodell und Grenzen

Das Paket schützt gegen passive DB-/Backend-Einsicht, falsche Schlüssel, Ciphertextmanipulation und Metadatenverschiebung bei v2. Es schützt nicht zuverlässig gegen kompromittierten Browser, bösartige ausgelieferte Frontendversion, Extensions, XSS nach erfolgreicher Ausführung, Key-Substitution ohne Transparency, Screenshots oder Klartext in JS-Strings/DOM. „Ende-zu-Ende verschlüsselt“ muss deshalb immer zusammen mit diesen Client- und Metadatenannahmen erklärt werden.
