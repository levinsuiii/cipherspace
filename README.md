# CipherSpace

CipherSpace is a local-first encrypted collaboration workspace. The current implementation contains a React/TypeScript frontend with durable IndexedDB note storage, a TypeScript/Fastify API, PostgreSQL persistence and migrations, email/password authentication with database-backed sessions, workspace membership management, RSA-OAEP recipient-specific workspace-key sharing, encrypted immutable note versions, encrypted note-scoped comments and replies, an isolated client crypto package, and the first push/pull note sync protocol.

## Prerequisites

- Node.js 22 or newer
- npm 10 or newer
- Docker with Docker Compose

## Recommended Codex workflow

- Use one task per feature, fix, or documentation change so the working context stays focused.
- Start a fresh chat for each new task instead of carrying unrelated history forward.
- Write focused prompts that name the desired outcome, relevant area or files, constraints, non-goals, and verification commands.
- Ask Codex to read `AGENTS.md`, the relevant files in `docs/`, and the root and relevant workspace `package.json` manifests before inspecting source code.
- Keep follow-up requests within the current task; open a fresh chat when the goal changes.

## Run the full stack with Docker

From a fresh clone:

```powershell
Copy-Item .env.example .env
# Replace SESSION_SECRET in .env with this generated value:
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
docker compose up --build
```

Open the frontend at `http://localhost:8080`. The API is also available directly at `http://localhost:3000`. Verify the proxied API with:

```powershell
Invoke-RestMethod http://localhost:8080/health
```

The direct health check at `http://localhost:3000/health` should also return `200`.

The API container waits for PostgreSQL, runs pending migrations, and then starts the server. The Nginx web container serves the frontend and proxies `/api` requests to the API so cookie sessions remain same-origin. `WEB_PORT` can override the default frontend port of `8080`.

Stop the services with `docker compose down`. To also remove local database data, run `docker compose down --volumes`.

## Run the API locally

Start only PostgreSQL in Docker and run the Node.js API on the host:

```powershell
Copy-Item .env.example .env
npm install
docker compose up -d postgres
npm run db:migrate
npm run dev
```

The development server watches for TypeScript changes. Use `npm run build` followed by `npm start` to run the compiled server.

## Run the frontend locally

Install dependencies once at the repository root, then run PostgreSQL, the API, and the frontend in separate terminals:

```powershell
# Terminal 1
docker compose up -d postgres

# Terminal 2
npm run db:migrate
npm run dev:api

# Terminal 3
npm run dev:web
```

Open `http://localhost:5173`. Vite proxies `/api` and `/health` to `http://localhost:3000` so normal browser traffic remains same-origin. The API also has an explicit development-origin CORS allowlist for direct local API calls; it never reflects arbitrary origins.

Frontend workspace commands:

```powershell
npm run dev:web
npm run test:web
npm run typecheck --workspace @cipherspace/web
npm run build --workspace @cipherspace/web
npm run preview --workspace @cipherspace/web
```

## Mobile and Progressive Web App

The frontend is responsive down to a 360px-wide viewport. Workspace and note lists use full-width
touch rows, important controls have at least 44px touch targets, note and conflict editors keep a
usable mobile-height writing area, and note metadata, comments, replies, and conflict snapshots wrap
or scroll without pushing actions off screen. On small screens, the new-note panel appears before a
long note list so note creation remains reachable.

CipherSpace includes a web app manifest named **CipherSpace Encrypted Workspace**, 192px and 512px
PNG icons, a maskable icon, an Apple touch icon, theme/background colors, standalone display mode,
and safe-area viewport support. The production build registers `/service-worker.js`; Vite development
mode deliberately does not register it, which avoids a stale worker intercepting source-module
requests while developing.

The service worker caches only the static app shell, generated `/assets/` bundles, icons, manifest,
and a content-free offline page. It ignores non-GET requests, cross-origin requests, `/api/*`, and
`/health`. It therefore does not cache note/comment responses, session responses, sync payloads, or
decrypted plaintext. Encrypted local notes continue to use the existing IndexedDB repository rather
than the Cache API. After one successful online production load, an offline navigation can reopen the
cached app shell and the last verified local user scope; online authentication and comments still
require the API.

Whenever the document becomes hidden or receives `pagehide`—including when a mobile user switches
apps or sends the installed PWA to the background—CipherSpace immediately removes all unwrapped
workspace keys from memory. The existing locked rendering then clears note titles/editor values,
comment drafts/content, and conflict/merge plaintext. Returning to the app requires the local unlock
password again. This is a background lock, not an inactivity timer: an unlocked app that remains
visible does not automatically lock.

Build and statically validate the installability assets with:

```powershell
npm run build:web
npm run check:pwa
```

Then run `npm run preview --workspace @cipherspace/web` and inspect `http://localhost:4173` in a
360px-wide responsive viewport. The Vite preview proxy still expects the API at
`http://localhost:3000`. The Docker production build can instead be checked at
`http://localhost:8080`. Browsers treat local `localhost` as a secure context for development, but a
phone opening a LAN IP is not the same localhost; use the deployed HTTPS URL for real-device
installation. In browser developer tools, verify the manifest has no errors, the 192px/512px and
maskable icons load, the service worker controls the page after a reload, and no `/api/` response is
present in Cache Storage.

### Install on Android

1. Open the deployed CipherSpace HTTPS URL in Chrome on Android and complete one normal page load.
2. Open Chrome's menu and choose **Install app** or **Add to Home screen**. Browser wording varies.
3. Confirm the name **CipherSpace** and select **Install**.
4. Launch CipherSpace from the new home-screen icon, sign in, and unlock the workspace locally.
5. Switch to another app and return. Confirm the workspace is locked and requires the local unlock
   password again.

If Chrome does not offer installation, confirm the page is HTTPS, reload once, check that the
manifest and service worker are error-free, and verify that the selected browser permits the
cross-site session cookie required by the documented free-provider deployment.

### Install on iPhone or iPad

1. Open the deployed CipherSpace HTTPS URL in Safari.
2. Tap **Share**, then **Add to Home Screen**. If it is not visible, scroll or choose **Edit Actions**.
3. Keep or edit the displayed name, then tap **Add**.
4. Launch CipherSpace from the home-screen icon, sign in, and unlock the workspace locally.
5. Background the installed app and return. Confirm the workspace is locked and unlock it again.

iOS installation uses Safari's share sheet and may not show a proactive install prompt. Private
browsing, browser storage clearing, or deleting site data can remove the protected workspace-key
envelope and encrypted local cache. A previously exported identity recovery kit can restore access
to server-held workspace key shares, but it does not restore unsynced local data.

### Manual mobile/PWA test flow

1. Start the app locally, or use the deployed HTTPS URL after deployment.
2. Open it at about 360px width or on a phone and verify there is no horizontal page overflow.
3. Register or sign in.
4. Open a workspace.
5. Create or unlock its local workspace key.
6. Create a note, open it, and edit its title/body using the mobile keyboard.
7. Add a comment and a reply; confirm nested discussion remains readable and actions remain reachable.
8. Select **Sync** and confirm the pending count returns to zero.
9. Select **Lock**.
10. Verify note titles become **Encrypted note** and note/comment plaintext and drafts disappear.
11. Reload the page and confirm it remains locked.
12. Unlock again and confirm the encrypted note/comment is readable.
13. Use the conflict simulation later in this README and open conflict resolution at mobile width.
14. Test **Keep local**, **Accept remote**, and a manual merge; confirm snapshots, metadata, editors,
    and resolution buttons remain usable without horizontal page overflow.
15. After deployment, add CipherSpace to an Android/iOS home screen and repeat the core flow,
    including backgrounding the app and unlocking again.

## Free public-beta deployment

The documented no-cost path uses a Neon Free Postgres database, a Render Free API web service, and a Cloudflare Pages static frontend. Provider HTTPS and generated provider subdomains are sufficient; a custom domain is not required. See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for the exact setup, environment variables, migration behavior, health checks, browser verification, and current free-tier limitations.

Production differs from local Docker in three intentional ways:

- `DATABASE_URL` points to the hosted runtime database, while optional `MIGRATIONS_DATABASE_URL` can use the provider's direct connection for schema migrations.
- The static build receives the public, non-secret `VITE_API_BASE_URL`, such as `https://cipherspace-api.onrender.com`. An empty value preserves the local same-origin `/api` behavior.
- The API sets `CORS_ORIGINS` to the exact deployed frontend origin. Separate provider domains also require `SESSION_COOKIE_SAME_SITE=none`, `NODE_ENV=production`, and `TRUST_PROXY=true`; local Docker keeps strict same-site cookies and does not trust forwarded headers.

Deployment-oriented commands are:

```powershell
npm run build:production
npm run db:migrate:deploy
npm run start:deploy
```

`start:deploy` applies pending migrations from compiled JavaScript before starting the API. The API Docker image uses the same command, and `render.yaml` describes the free Render service plus `/health` readiness check. Do not put `SESSION_SECRET`, database credentials, or other secrets into frontend variables or committed files.

The frontend provides login and registration, a protected application shell, workspace listing and creation, workspace details and membership listing, a local-first note editor, encrypted note discussions, and manual conflict resolution. Workspaces, encrypted local note envelopes, cached encrypted versions, pending changes, sync cursors, retry state, and encrypted conflict snapshots are stored in IndexedDB through Dexie. Creating, editing, and deleting a note writes locally without calling a mutation API, survives reloads, and displays unsynced or conflict indicators. Comments use React Query and the authenticated API directly; they are not currently durable offline data or part of note push/pull sync.

The workspace UI provides local key creation/unlock, recipient setup, and an explicit **Sync** action. A random AES-256-GCM workspace key is protected under each user's separate local workspace password, and only protected key envelopes are persisted in IndexedDB. After reload, each user enters their own password to recover the same logical workspace key; the unwrapped key remains in memory only. Note creates, edits, and conflict resolutions are encrypted through `@cipherspace/crypto` before the local note and pending operation are committed, so sync reuses durable ciphertext and never needs a plaintext queue payload.

Each user also has a WebCrypto RSA-OAEP identity using a 3072-bit RSA key and SHA-256. The backend stores the versioned SPKI public key. The PKCS8 private key is encrypted locally with AES-256-GCM under PBKDF2-HMAC-SHA-256 using the account password and is never uploaded. When an owner adds an existing user, the unlocked client wraps the existing 32-byte workspace key with that recipient's public key and uploads only the 384-byte RSA-OAEP ciphertext. The recipient decrypts the share locally, then protects the recovered workspace key with a new local workspace password that may differ from the owner's.

PostgreSQL stores accounts/password hashes, sessions/token digests, public identity keys, workspace/membership roles, recipient-specific encrypted workspace-key shares, encrypted note/comment envelopes, and operational metadata. It does not store plaintext note/comment content, plaintext workspace keys, plaintext or locally protected identity private keys, account passwords, or local workspace passwords. IndexedDB stores encrypted note/sync/conflict data, protected workspace-key envelopes, and the locally protected identity-private-key envelope. Unwrapped keys and decrypted content remain client-memory-only while unlocked.

CipherSpace supports manual identity transfer through an encrypted recovery kit. It does not provide
account-password recovery, server-side recovery, automatic device pairing, key rotation,
cryptographic revocation, sender signatures, device verification, or key transparency. Titles and
bodies are encrypted at rest in IndexedDB; locking clears readable note UI state and removes the
unwrapped workspace key from memory. Note IDs, workspace IDs, membership, identity/share metadata,
timestamps, revisions, queue state, ciphertext size, and other operational metadata remain visible.

## First-device encryption setup

After registration, CipherSpace checks both the backend public-key record and this browser's
protected private identity. A brand-new account has neither, so the workspace page offers **Set up
this device for encryption**. Enter the account password to generate the RSA identity in the browser.
Only the public key is registered with the API; the private key is password-protected in IndexedDB.
Workspace creation is enabled only after those identities match.

After setup, use the displayed **Export recovery kit** recommendation and store the encrypted kit
separately from its passphrase. If the backend already has a public key but the browser has no
matching private identity, CipherSpace treats it as an existing account on a new device (or cleared
browser) and offers recovery import instead of generating an unrelated replacement identity.

## Encrypted recovery kit

Open **Security** in the authenticated header to see whether this browser has the local crypto
identity. When it does, enter the current account password and a unique recovery passphrase of
16–128 characters, then create the kit. Download the JSON file or copy its text and store it
separately from the recovery passphrase.

Recovery kit version 1 contains:

- the account/user identifier;
- the public RSA identity key, algorithm, key version, and identity creation time;
- the recovery kit creation time and format version;
- the PKCS8 private identity key encrypted locally with AES-256-GCM under a
  PBKDF2-HMAC-SHA-256 key derived with a random 128-bit salt and 600,000 iterations, plus the random
  nonce and KDF metadata.

It does **not** contain plaintext private keys, plaintext or encrypted workspace keys, notes,
comments, account or workspace passwords, recovery passphrases, auth/session tokens, sync queues, or
other browser data. Public metadata and ciphertext remain visible to anyone holding the file. The
encrypted private key is subject to offline passphrase guessing, so use a strong unique passphrase
and protect both the file and passphrase.

To restore on a second browser or device:

1. Export and save the recovery kit before losing the original browser data.
2. In a separate browser profile/device, sign in to the same CipherSpace account.
3. Open **Security**. The status should say **Recovery kit required on this device**, and the
   workspace page should warn that the registered public identity has no matching local private key.
4. Select the JSON file or paste its text, then enter the recovery passphrase and current account
   password. The recovery passphrase decrypts the kit; the account password re-encrypts the restored
   identity for this browser.
5. Import the kit. CipherSpace verifies the recovered key pair and confirms that its public key
   exactly matches the account's registered identity before changing IndexedDB. An existing local
   identity requires an explicit replacement confirmation.
6. Open a shared workspace. Retrieve the existing encrypted workspace-key share, enter the current
   account password to unlock the restored identity, and choose a new device-local workspace unlock
   password. Existing notes and comments should decrypt normally.

Wrong passphrases, malformed/tampered kits, kits for another account, and public-key mismatches fail
without returning private material. The kit is never uploaded; only the existing public identity is
verified or idempotently registered. If both the local identity and recovery kit (or its passphrase)
are lost, the server cannot recreate the key or decrypt existing workspace shares. Generating an
unrelated identity would not restore access; a future versioned identity replacement plus member
re-sharing flow would be required and is not implemented in v1. The recovery kit also cannot restore
unsynced local-only notes or a forgotten account password. CipherSpace has not been independently
security audited.

Opening a local or server-backed note decrypts its envelope only after the workspace is unlocked. Plaintext is held in React memory while displayed. Selecting **Save local change** creates a new encrypted local envelope and encrypted pending operation; it does not persist the title or body as plaintext. A locked workspace replaces titles with **Encrypted note**, clears editor values, and disables editing. A wrong workspace or identity private key produces a generic decryption error without exposing partial content. IndexedDB schema version 5 lazily encrypts older plaintext note, queue, and conflict payloads after the correct workspace key is unlocked; schema version 6 adds protected user identities without replacing existing workspace keys.

## Security

CipherSpace applies the following practical hardening controls:

- Account passwords are stored only as Argon2id hashes using 19 MiB of memory, two iterations, one lane, and a 32-byte hash. Login failures are generic, including the unknown-account path.
- Sessions use 256-bit random opaque tokens. PostgreSQL stores only keyed HMAC-SHA-256 token digests. Cookies are host-only, HTTP-only, high priority, and `Secure` in production. `SESSION_COOKIE_SAME_SITE` defaults to `strict`; a separately hosted production frontend can explicitly use `none` with exact credentialed CORS. Authenticated API responses use `Cache-Control: no-store`.
- Registration and login share an IP-based rate-limit bucket. Defaults are 10 attempts per 60 seconds and can be changed with `AUTH_RATE_LIMIT_MAX` and `AUTH_RATE_LIMIT_WINDOW_MS`. The v1 limiter is in memory per API process; multi-instance deployments need a shared rate-limit store.
- Credentialed CORS is limited to exact origins from `CORS_ORIGINS`. Wildcards, URL paths, and embedded credentials are rejected. Production must set the variable explicitly; set it to an empty value when all browser traffic is same-origin.
- The API applies CSP, clickjacking, MIME-sniffing, referrer, cross-origin, and related security headers through Helmet. HSTS is enabled by the API only in production. The Docker Nginx frontend applies a restrictive CSP, `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, a restrictive permissions policy, and same-origin opener/resource policies. A production TLS edge must also apply HSTS to frontend responses.
- Request bodies default to 1,500,000 bytes globally, while auth bodies are capped at 4 KiB. Malformed, oversized, unsupported, and unexpected requests receive safe error bodies without validation internals or stack traces.
- Fastify logs request metadata but not bodies. Cookie, authorization, and `Set-Cookie` headers are explicitly redacted. Unexpected-error logging records only an error class, request ID, method, and route—not error messages or payloads.
- Workspace, membership, note, version, comment, sync-push, and sync-pull operations enforce current membership. Viewers are read-only; owners and editors may create/update notes and comments; only owners delete notes or manage members; comment deletion follows the documented author/moderator rule.
- Public identity registration accepts only validated RSA-3072 SPKI keys. Invitee-key lookup is owner-only, membership plus its first encrypted key share is atomic, and a member can retrieve only their own active share.
- Note and comment API inputs must use the implemented version 1 AES-GCM envelope shape, including a 12-byte nonce, at least a 16-byte authenticated ciphertext/tag, canonical base64, and bounded fields. The server still cannot prove that submitted opaque bytes encrypt meaningful content.
- Locking removes the workspace key and clears note titles, editor values, comment drafts/content, and conflict/merge plaintext from rendered React state. Plaintext can still exist transiently in browser/runtime memory while unlocked and cannot be reliably zeroized as JavaScript strings.
- Moving the page or installed PWA to the background triggers the same lock immediately. There is no visible-app inactivity timeout, and browsers may delay or terminate background lifecycle events; users should still select **Lock** before handing an unlocked device to someone else.
- The service worker caches only static application files and a plaintext-free offline page. API/auth/sync/comment responses bypass it, and IndexedDB remains the encrypted local-note store. A compromised service worker or malicious delivered frontend would still run inside the trusted application origin and is outside v1's protection boundary.
- New local note, queue, conflict, and resolution records store encrypted envelopes and `null` legacy plaintext fields. Opening a workspace scans legacy schema v1-v4 note, pending-change, and conflict fields before rendering normal workspace routes. A mandatory gate requires the original workspace key to migrate and verify every record atomically; unsafe records remain untouched and blocked until migration succeeds or the user separately confirms permanent deletion of the affected local records. CipherSpace never creates a replacement key for this flow. Comments are online-only and are not stored in IndexedDB.
- Docker Compose binds PostgreSQL, API, and web ports to loopback by default. The API container runs as the unprivileged `node` user with a read-only root filesystem, dropped capabilities, `no-new-privileges`, and a temporary `/tmp` filesystem. Development database credentials and the marked development session secret are not suitable for production.

`SESSION_SECRET` must be at least 32 UTF-8 bytes. Production rejects documented placeholder/development markers and requires a cryptographically random value. `DATABASE_URL` and optional `MIGRATIONS_DATABASE_URL` must be PostgreSQL URLs. Pool size, proxy trust, cookie policy, body limits, auth rate limits, ports, log level, session lifetime, CORS origins, and bind addresses are all represented in `.env.example` and validated or consumed explicitly.

Important limitations remain: this is not formally reviewed or enterprise-grade E2EE; metadata remains visible; workspace keys are extractable and browser-profile protected; recovery is a manual encrypted-file backup rather than server escrow or device pairing; and there is no key rotation, cryptographic revocation, key transparency, MFA, email verification, password reset, CSRF token, automatic session cleanup, or shared multi-instance limiter. Removing a member cannot erase data or keys already obtained. A malicious server can substitute public keys or deliver modified client code, and an extension, same-origin script, compromised recovery file/passphrase, or compromised unlocked device can access key material and plaintext. See `docs/THREAT_MODEL.md` for the complete boundary.

## Manual two-user encrypted-sharing test

Use two separate browser profiles so IndexedDB, cookies, identity private keys, and local workspace passwords are isolated. User B must register once before invitation so their public identity exists; B can then sign out until the owner shares access.

1. Start PostgreSQL, run `npm run db:migrate`, then start the API and web frontend.
2. In browser profile B, register `user-b@example.test` with a 12+ character account password. Registration creates B's RSA identity, stores only its public key on the backend, and protects the private key in profile B. Sign out.
3. In browser profile A, register `user-a@example.test` with a different account password.
4. Create a workspace, open it, and choose a local workspace unlock password that differs from both account passwords.
5. Create a note with a unique title/body, save it locally, select **Sync**, then add an encrypted comment and optional reply.
6. Keep A's workspace unlocked, open **Overview**, enter B's registered email, select `editor` or `viewer`, and choose **Add member**. Confirm B shows `key share available`. A never enters or reveals A's local workspace password during this step.
7. In profile B, sign in again. The workspace should appear in B's list because membership is active.
8. Open the workspace. Because B has no local workspace-key envelope yet, the page must show **Set up encrypted workspace access**, not **Create and unlock key**.
9. Enter B's account password to unlock B's client-only identity private key. Enter and confirm a new local workspace password different from A's, then complete setup.
10. Confirm the workspace unlocks and A's existing note title/body and encrypted comment/reply decrypt correctly.
11. Lock and unlock in profile B using only B's local workspace password. A's password must never be needed.
12. If B is an editor, edit the note or create another note, sync, and add a comment. If B is a viewer, confirm editing, note/comment creation, deletion, member management, and mutating sync are unavailable or denied.
13. In profile A, select **Sync** and confirm B's permitted note change appears; refresh the comment discussion and confirm B's comment appears.
14. In profile A, make an offline edit while B edits and syncs the same note, then sync A. Confirm the existing explicit conflict flow still preserves both encrypted snapshots and resolves normally.
15. As a non-member third account or unauthenticated request, call the workspace, note, comment, sync, and `GET /api/workspaces/<id>/key-share` endpoints. Confirm workspace-scoped reads return `404 workspace_not_found`.
16. Inspect PostgreSQL: `user_crypto_identities` must contain public keys only; `workspace_key_shares.encrypted_workspace_key` must be a 512-character canonical-base64 RSA ciphertext, not the 44-character base64 form of a raw 32-byte AES key. `note_versions` and `encrypted_comments` must contain ciphertext rather than the unique plaintext markers.
17. Remove B as a member and confirm future API/sync/key-share retrieval is denied. Treat B's previously decrypted data as still accessible on B's device; v1 removal is not cryptographic revocation.

## Manual security hardening check

Prepare three accounts: an owner, a viewer member added by the owner, and an outsider who is not a member. Create and sync one note, add one comment, and put a unique marker such as `CIPHERSPACE-PLAINTEXT-CHECK-7f3c` in both the note and comment. Keep separate cookie jars or browser profiles for the three accounts. Record the workspace, note, and comment UUIDs.

1. **Workspace non-member:** as the outsider, request `GET /api/workspaces/<workspaceId>` and `GET /api/workspaces/<workspaceId>/members`. Both must return `404 workspace_not_found`; neither response may contain the workspace name or member email addresses.
2. **Note non-member:** as the outsider, request the note list, note detail, and version history under that workspace. Also try note create, version append, and delete with a structurally valid envelope. Every request must return `404 workspace_not_found`.
3. **Comment non-member:** as the outsider, try comment list, create, and delete. Every request must return `404 workspace_not_found`.
4. **Sync non-member:** as the outsider, try both sync pull and a validly shaped sync push. Both must return `404 workspace_not_found`; the pushed operation must not appear when the owner pulls.
5. **Viewer writes:** sign in as the viewer. Workspace/note/comment reads and sync pull may succeed. Note create/version append/delete, comment create/delete, member management, and sync create/update/delete must be denied. Direct routes return `403`; sync push returns a per-operation `write_forbidden` rejection. The UI must show no create/edit/comment controls.
6. **Lock behavior:** while the note, discussion, and conflict page are readable, type unsaved note/comment/merge drafts and select **Lock**. Titles must become **Encrypted note**; note fields, comment bodies/draft, and conflict snapshots/merge fields must be empty or replaced by locked placeholders. Navigating back must not restore unsaved plaintext.
7. **IndexedDB leakage:** open browser developer tools, select **Application → IndexedDB → cipherspace-local**, and inspect/filter every store for `CIPHERSPACE-PLAINTEXT-CHECK-7f3c`. The marker must not occur in `notes`, `pending_changes`, `conflicts`, `note_versions`, `workspace_keys`, or sync metadata. Legacy `local_note_payload` and `resolved_note_payload` fields must be `null` after unlocking/migration. Comments are online-only and must not appear in IndexedDB at all.
8. **Log leakage:** run `docker compose logs api` after registration, login, note/comment mutation, sync, unlock, and lock. Search for the unique marker, account password, local unlock password, raw cookie value, `Authorization` value, and any exported/raw key. None may appear. Normal logs may contain request IDs, methods, routes, status codes, timings, and non-secret error class names.
9. **Authentication failures:** request a protected endpoint without a cookie and with `Cookie: cipherspace_session=invalid`; both must return the same safe `401 unauthorized` body. Send malformed JSON and an auth body larger than 4 KiB; expect safe `400` and `413 request_too_large` responses without echoed input. Exceed the configured auth attempt count from one client IP; expect `429 rate_limit_exceeded` plus `Retry-After`.
10. **Docker/local regression:** run `docker compose config`, then `docker compose up --build`. Confirm PostgreSQL becomes healthy, migrations complete, `http://localhost:8080/health` returns `200`, registration/login/sync still work, and `docker compose ps` shows all services running. Confirm the API and database are reachable only on the configured loopback bind addresses unless you intentionally changed them.

For CORS/header checks, send a preflight with `Origin: http://localhost:5173` and confirm that exact origin plus `Access-Control-Allow-Credentials: true` is returned. Repeat with `Origin: https://attacker.example` and confirm there is no `Access-Control-Allow-Origin`. Inspect frontend and API responses for the headers described above. In production, serve only over HTTPS, set `NODE_ENV=production`, set a new random `SESSION_SECRET`, use non-development database credentials, and set `CORS_ORIGINS` to the deployed frontend origin or an empty value for same-origin-only operation. The documented separate-domain deployment also sets `SESSION_COOKIE_SAME_SITE=none` and enables `TRUST_PROXY` only behind the hosting provider's trusted edge.

## Manual legacy IndexedDB migration check

Use a disposable local account/workspace and keep its current local unlock password. This test
intentionally edits browser storage; export or sync anything important first.

1. Create a local note with a unique title/body, leave it unsynced so a matching pending change
   exists, then lock the workspace.
2. In browser developer tools, open **Application → IndexedDB → cipherspace-local**. Copy the note's
   current `id`, `user_id`, and `workspace_id`. In a disposable profile, edit that note so
   `local_note_payload` contains `{ "title": "Legacy title", "body": "Legacy body" }` and
   `local_encrypted_payload` is `null`. Edit its matching `pending_changes` row the same way by
   setting `local_note_payload` and clearing `encrypted_payload`. To cover conflicts, first create a
   conflict with the manual conflict flow below, then put a legacy payload in its
   `local_note_payload` or `resolved_note_payload` and clear the corresponding encrypted field.
3. Reload and open the workspace. Confirm **Legacy plaintext blocks this workspace** appears before
   notes, comments, conflicts, or sync controls are usable, and that the counts identify the stores
   you changed.
4. Unlock with the original workspace password. Confirm the gate disappears only after migration
   completes. Reopen IndexedDB and verify every affected `local_note_payload` and
   `resolved_note_payload` is `null`/absent while the corresponding encrypted envelope is present.
   Lock, reload, and sign out/in; the legacy marker must never reappear as readable stored content.
5. To test failure safely, repeat with a disposable row whose plaintext field is a malformed value,
   or whose existing encrypted envelope was produced for another key. Confirm migration reports an
   error, normal workspace use stays blocked, and the row is unchanged.
6. Confirm **Review permanent delete option** does nothing by itself. Only the second
   **Permanently delete affected local records** action may remove data. It deletes the local note,
   pending-change, and conflict records for every affected note, including unsynced/local-only data;
   it does not silently delete, quarantine, overwrite, or generate a key. Cancel unless this data is
   intentionally disposable.

## Manual frontend check

For a true first-device check, stop the stack with `docker compose down --volumes`, clear all site
data for the frontend origin (cookies, IndexedDB, local storage, Cache Storage, and service workers),
then restart with `docker compose up --build`. This intentionally deletes local development data.

1. Start the local stack and open the frontend.
2. Register with an email and a password containing 12–128 characters. Registration should open the empty workspace page and offer **Set up this device for encryption**.
3. Enter the account password and select **Create encryption identity**. Confirm the page recommends **Export recovery kit** and enables workspace creation.
4. Create a workspace and confirm its overview shows the current account as an owner.
5. Open **Notes** and confirm the empty state appears.
6. In the workspace sync panel, choose a separate local unlock password of 12–128 characters and select **Create and unlock key**. Keep that password available; v1 has no recovery.
7. Create a local note with a title and body. Confirm the editor and workspace header show unsynced changes and sync status `idle`.
8. Select **Sync**. Confirm the status changes through `syncing` to `synced` and the unsynced count drops (normally to zero). The backend stores only ciphertext and metadata.
9. Edit the note again and confirm the unsynced indicator returns. Select **Sync** again to push the next encrypted version.
10. Select **Lock** (or reload). Confirm note titles become **Encrypted note** and an open editor no longer shows title/body content. Unlock with the same local password and confirm the readable notes return.
11. Open a note that exists on the server but has no local draft. Confirm it shows an unlock prompt while locked, then displays the decrypted title and body after unlock.
12. Stop the API or disable the browser network, then select **Sync** and confirm the UI reports `Server unavailable`. Restart the API and retry; the pending change must remain durable and then sync successfully.
13. As a workspace owner, delete a note locally and confirm it disappears from the note list while the workspace reports a pending change. Sync the tombstone manually.
14. Sign out and confirm protected routes redirect to sign-in. Sign back in to reopen the same user-scoped local cache and unlock the workspace again.

## Manual comments check

1. Start the full stack, sign in as a workspace owner or editor, open a synced note, and unlock the workspace key. A local-only note asks you to sync it before starting a discussion.
2. In **Discussion**, add a comment. Confirm it appears without a page reload and remains after reloading the page and unlocking the same key.
3. Reply to the comment and confirm the reply is indented beneath its parent.
4. Sign in as a viewer member. Confirm the discussion is readable after key provisioning/unlock, but the comment form is not shown.
5. Confirm an editor can delete their own comment but not another member's comment. Confirm an owner can delete any comment in the workspace.
6. After deletion, confirm the row remains as **Comment deleted** and its replies remain visible. The API response must contain `null` for ciphertext, nonce, and encryption metadata.
7. Stop the API and confirm the discussion reports that comments require an online connection. Note drafts remain local-first, but comments are online-only in this slice.

Comment bodies are encrypted in the browser with the unlocked AES-256-GCM workspace key and comment-specific authenticated metadata before upload. The backend stores only ciphertext, nonce, encryption metadata, authorship, parent linkage, and timestamps. Comment drafts exist only in React state until submitted; there is no offline queue, comment conflict handling, notification, or real-time delivery.

## Manual conflict-resolution check

This flow uses the authenticated browser console to append a second immutable server version that reuses the note's existing encrypted envelope. It simulates another writer without exposing plaintext to the backend and works despite multi-device workspace-key sharing not being implemented yet.

1. Start the app with Docker Compose, log in, open a workspace, create or unlock its local key, create a note, and sync it.
2. Keep the note page open. Its URL contains the workspace and note IDs.
3. Open the browser developer console and run the following same-origin snippet. It reads the current encrypted version and appends the same ciphertext as a new server version:

```javascript
const [, workspaceId, noteId] = location.pathname.match(
  /\/workspaces\/([^/]+)\/notes\/([^/]+)/
) ?? [];
const detail = await fetch(`/api/workspaces/${workspaceId}/notes/${noteId}`).then((response) =>
  response.json()
);
await fetch(`/api/workspaces/${workspaceId}/notes/${noteId}/versions`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    encryptedContent: detail.latestVersion.encryptedContent,
    contentNonce: detail.latestVersion.contentNonce,
    encryptionMetadata: detail.latestVersion.encryptionMetadata,
    clientVersion: "manual-remote-simulation"
  })
}).then(async (response) => ({ status: response.status, body: await response.json() }));
```

4. Without refreshing or pulling first, edit the old local note and save it locally.
5. Select **Sync**. Confirm the server rejects the stale `baseVersionId`, sync status becomes `conflict`, the conflict count appears, and the local edit remains visible.
6. Open the note or its conflict badge. Confirm the resolution view shows the local snapshot, decrypted remote/server snapshot, remote metadata, and cached base-version metadata.
7. Select **Keep local**. Confirm the conflict count clears, exactly one resolved change remains unsynced, and **Sync** successfully creates the next immutable server version.
8. Repeat steps 3–6 and select **Accept remote**. Confirm the explicitly selected remote content becomes the new local resolved draft, then sync it.
9. Repeat steps 3–6, edit the title/body in **Manual merge**, and select **Save manual merge**. Confirm the merged draft becomes the single unsynced resolved change, then sync it.

Conflict snapshots remain in IndexedDB as encrypted resolved history. The original conflicted queue entries are retired rather than silently retried, and every selected resolution is encrypted locally before it becomes the one pending update based on the remote version.

## Authentication

Passwords must be between 12 and 128 characters. They are hashed with Argon2id before storage. Registering or logging in sets an opaque session token in the `cipherspace_session` cookie. The cookie is host-only, HTTP-only, high priority, and marked `Secure` when `NODE_ENV=production`. Its `SameSite` policy defaults to `Strict` and is configurable for the documented cross-site production topology. PostgreSQL stores only an HMAC-SHA-256 digest of the token.

`SESSION_SECRET` is required and must contain at least 32 UTF-8 bytes. Production rejects the documented development/placeholder marker, so deploy with a securely generated value. Changing it invalidates existing sessions. `SESSION_TTL_HOURS` defaults to 168 (seven days) and accepts values from 1 through 720. `SESSION_COOKIE_SAME_SITE` defaults to `strict`; use `none` only for the documented HTTPS cross-origin deployment. Auth rate limiting defaults to 10 registration/login attempts per IP per 60 seconds.

The following PowerShell-compatible curl examples use a cookie jar. Use a development server (`npm run dev`) for plain-HTTP local requests:

```powershell
# Register and start a session
curl.exe -i -c cookies.txt -H "Content-Type: application/json" `
  --data '{"email":"person@example.com","password":"correct horse battery staple"}' `
  http://localhost:3000/api/auth/register

# Log in and replace the cookie jar session
curl.exe -i -c cookies.txt -H "Content-Type: application/json" `
  --data '{"email":"person@example.com","password":"correct horse battery staple"}' `
  http://localhost:3000/api/auth/login

# Read the current authenticated user
curl.exe -i -b cookies.txt http://localhost:3000/api/auth/me

# End the current session
curl.exe -i -b cookies.txt -c cookies.txt -X POST http://localhost:3000/api/auth/logout
```

Registration returns `201`, login and the current-user endpoint return `200`, and logout returns `204`. User responses contain only `id`, normalized `email`, and `createdAt`; password hashes and session tokens are never included in JSON responses.

## Workspace API

All workspace endpoints require the `cipherspace_session` cookie. A workspace creator becomes its first `owner`. Members have one of three roles:

- `owner`: read the workspace, manage members, create and update notes, soft-delete notes, create comments, and soft-delete any comment.
- `editor`: read the workspace, create or update notes, create comments, and soft-delete their own comments, but cannot manage members or delete notes.
- `viewer`: read the workspace, encrypted note data, and comments, but cannot create, update, or delete notes or comments.

Workspace names, member email addresses, roles, public identity keys, and key-share metadata are server-visible. Adding by email immediately adds an existing account only after the unlocked owner client has encrypted the existing workspace key for that user's registered public key. Pending invitations and email delivery are not implemented.

The following PowerShell-compatible examples assume an authenticated owner cookie in `owner-cookies.txt` and an authenticated member cookie in `member-cookies.txt`:

```powershell
# Create a workspace
curl.exe -i -b owner-cookies.txt -H "Content-Type: application/json" `
  --data '{"name":"Product planning"}' `
  http://localhost:3000/api/workspaces

# Copy the id from the response for the remaining examples
$workspaceId = "00000000-0000-4000-8000-000000000000"

# List only workspaces belonging to the authenticated user
curl.exe -i -b owner-cookies.txt http://localhost:3000/api/workspaces

# Look up an existing account's public key as an owner.
# Use the browser UI for the subsequent WebCrypto wrap and atomic membership/key-share POST.
curl.exe -i -b owner-cookies.txt `
  "http://localhost:3000/api/workspaces/$workspaceId/invitee-key?email=member%40example.com"

# Read workspace details using the new member's session
curl.exe -i -b member-cookies.txt "http://localhost:3000/api/workspaces/$workspaceId"

# List members (available to every workspace member)
curl.exe -i -b member-cookies.txt "http://localhost:3000/api/workspaces/$workspaceId/members"

# Change a member's role as an owner
$memberUserId = "00000000-0000-4000-8000-000000000000"
curl.exe -i -b owner-cookies.txt -X PATCH -H "Content-Type: application/json" `
  --data '{"role":"viewer"}' `
  "http://localhost:3000/api/workspaces/$workspaceId/members/$memberUserId"

# Remove a member as an owner
curl.exe -i -b owner-cookies.txt -X DELETE `
  "http://localhost:3000/api/workspaces/$workspaceId/members/$memberUserId"
```

Supported workspace endpoints are:

- `POST /api/workspaces`
- `GET /api/workspaces`
- `GET /api/workspaces/:id`
- `GET /api/crypto/identity`
- `PUT /api/crypto/identity`
- `GET /api/workspaces/:id/invitee-key`
- `GET /api/workspaces/:id/key-access`
- `GET /api/workspaces/:id/key-share`
- `PUT /api/workspaces/:id/key-shares/:userId`
- `POST /api/workspaces/:id/members`
- `GET /api/workspaces/:id/members`
- `PATCH /api/workspaces/:id/members/:userId`
- `DELETE /api/workspaces/:id/members/:userId`

Non-members receive `404` for workspace-scoped reads, including key-share retrieval, so the API does not disclose whether a workspace ID exists. Editors and viewers receive `403` when attempting member management or invitee-key lookup. The final owner cannot be removed or changed to another role. Removing a member marks the backend share revoked but does not erase keys or content already obtained.

## Encrypted note API

The note API stores opaque, base64-encoded ciphertext and nonce values. CipherSpace does not encrypt, decrypt, or interpret note content on the server. The isolated `@cipherspace/crypto` package provides AES-256-GCM workspace-key generation, authenticated note/comment encryption, local password protection, RSA-OAEP user identities, recipient-specific workspace-key wrapping, and versioned encrypted identity recovery kits. The React workspace UI creates, shares, receives, or unlocks workspace keys and passes them to manual sync. Automated device pairing, identity replacement, rotation, and cryptographic revocation are not implemented.

An optional title is stored as a ciphertext/nonce pair. Initial note content is stored as version 1. Every later version is immutable, receives a monotonically increasing server version number, and points to the version that was current when it was appended. `clientVersion` is optional revision metadata for future client and sync work; it is not currently an idempotency key or conflict check.

The examples below assume an authenticated cookie jar and a workspace ID from the workspace API:

```powershell
$workspaceId = "00000000-0000-4000-8000-000000000000"

# Create a note with an initial encrypted version
curl.exe -i -b owner-cookies.txt -H "Content-Type: application/json" `
  --data '{"encryptedTitle":"AAAAAAAAAAAAAAAAAAAAAA==","encryptedTitleNonce":"AAAAAAAAAAAAAAAA","encryptedContent":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","contentNonce":"AAAAAAAAAAAAAAAA","encryptionMetadata":{"envelopeVersion":1,"algorithm":"AES-GCM","keyId":"workspace-key-v1"},"clientVersion":"device-revision-1"}' `
  "http://localhost:3000/api/workspaces/$workspaceId/notes"

# List active notes (metadata and encrypted titles, without content versions)
curl.exe -i -b owner-cookies.txt `
  "http://localhost:3000/api/workspaces/$workspaceId/notes"

# Copy the note id returned by the create request
$noteId = "00000000-0000-4000-8000-000000000000"

# Append a new encrypted version
curl.exe -i -b owner-cookies.txt -H "Content-Type: application/json" `
  --data '{"encryptedContent":"AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=","contentNonce":"AQEBAQEBAQEBAQEB","encryptionMetadata":{"envelopeVersion":1,"algorithm":"AES-GCM","keyId":"workspace-key-v1"},"clientVersion":"device-revision-2"}' `
  "http://localhost:3000/api/workspaces/$workspaceId/notes/$noteId/versions"

# Read version history in ascending version order
curl.exe -i -b owner-cookies.txt `
  "http://localhost:3000/api/workspaces/$workspaceId/notes/$noteId/versions"
```

Replace the sample base64 values with ciphertext and fresh nonces generated by the client crypto package; the all-zero/one values above are shape-only examples and are not secure ciphertext. The note content limit is 1 MiB decoded; encrypted titles are limited to 16 KiB, AES-GCM nonces must decode to exactly 12 bytes, ciphertext must include at least a 16-byte authentication tag, and `clientVersion` is limited to 255 characters.

Supported note endpoints are:

- `POST /api/workspaces/:workspaceId/notes`
- `GET /api/workspaces/:workspaceId/notes`
- `GET /api/workspaces/:workspaceId/notes/:noteId`
- `POST /api/workspaces/:workspaceId/notes/:noteId/versions`
- `GET /api/workspaces/:workspaceId/notes/:noteId/versions`
- `DELETE /api/workspaces/:workspaceId/notes/:noteId`

All endpoints require authentication. Workspace members may read active notes and version history. Owners and editors may create notes and append versions. Only owners may soft-delete notes. Non-members receive `404`; viewers receive `403` for mutations. Soft-deleted notes and their versions remain stored but are excluded from normal note reads, lists, and version-history responses.

## Encrypted comment API

Comments are scoped to active notes. Comment bodies use the existing workspace key with a comment-specific AES-256-GCM envelope; the API validates and stores only opaque base64 ciphertext, nonce, and encryption metadata. Optional `parentCommentId` links a reply to another comment on the same note.

Supported comment endpoints are:

- `POST /api/workspaces/:workspaceId/notes/:noteId/comments`
- `GET /api/workspaces/:workspaceId/notes/:noteId/comments`
- `DELETE /api/workspaces/:workspaceId/notes/:noteId/comments/:commentId`

Owners and editors can create comments. Every current workspace member can list them. Editors can soft-delete only their own comments; owners can soft-delete any comment as lightweight moderation. Viewers cannot create or delete comments, and non-members receive `404 workspace_not_found` for reads and writes.

A soft-delete retains comment identity, authorship, parent linkage, and timestamps so replies stay understandable, but PostgreSQL clears the encrypted body, nonce, and encryption metadata. List responses represent those fields as `null`, so deleted comment content is never returned by the API. Comments are limited to 64 KiB of decoded ciphertext and are currently online-only: they have no IndexedDB cache, retry queue, sync cursor, conflict model, notifications, or real-time transport.

## Encrypted note sync API

The first sync protocol adds:

- `POST /api/workspaces/:workspaceId/sync/push`
- `GET /api/workspaces/:workspaceId/sync/pull?cursor=<opaque>`

Push accepts encrypted `create_note`, `update_note`, and `delete_note` operations. The durable client `operationId` is the idempotency key. Updates and deletes must name the server version they were based on; a stale base returns a conflict and does not create a version. Replaying the same operation returns `duplicate` with the original result.

Pull returns at most 500 ordered `upsert_note_version` or `delete_note` events and an opaque workspace-scoped `nextCursor`. The client applies a page and advances its IndexedDB cursor atomically. Remote data never overwrites an unsynced draft; a divergent version creates a local conflict record instead. The conflict view decrypts the cached remote envelope only after the workspace is unlocked. **Keep local**, **Accept remote**, and **Manual merge** each retire the conflicted queue entries and create one new pending update based on the remote version. The existing encrypted sync path then creates the immutable resolved server version.

The backend routes can be checked manually with an authenticated cookie jar and a real envelope generated by `@cipherspace/crypto`. The focused automated checks are the quickest complete protocol exercise:

```powershell
npm run test --workspace @cipherspace/api -- sync.test.ts
npm run test --workspace @cipherspace/web -- src/sync/engine.test.ts
```

See `docs/SYNC_PROTOCOL.md` for the exact request/response shapes, cursor rules, retry states, and conflict representation.

## Database migrations

Migrations are ordered SQL files in `apps/api/migrations`. Apply pending migrations with:

```powershell
npm run db:migrate
```

Applied filenames and checksums are recorded in PostgreSQL. An already-applied migration must not be edited; add a new migration instead.

## Verification commands

```powershell
npm test
npm run typecheck
npm run build
docker compose config
```

The root `test`, `typecheck`, and `build` commands verify all npm workspaces. Backend-only and frontend-only tests can be run with `npm run test:api` and `npm run test:web`. Crypto-only verification uses `npm run test --workspace @cipherspace/crypto`.

## Current scope

The responsive frontend, installable PWA shell, encrypted-at-rest local note storage and pending queue, backend foundation, authentication, workspaces, membership roles, RSA-OAEP multi-user workspace-key sharing, encrypted-note/version APIs, encrypted note comments and replies, client encryption primitives, local workspace unlock, encrypted identity recovery-kit export/import, manual push/pull, idempotency, cursor persistence, retry state, conflict detection, and manual note-edit conflict resolution are implemented. Automated device pairing, identity replacement, rotation, cryptographic revocation, automatic/background sync, automatic merging, offline comment sync, pending invitations, and email delivery remain intentionally unimplemented. See `docs/PROJECT_STATE.md` for current status and planned work.

