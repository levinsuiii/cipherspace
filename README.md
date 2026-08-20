# CipherSpace

CipherSpace is a local-first encrypted collaboration workspace. The current implementation contains a React/TypeScript frontend with durable IndexedDB note storage, a TypeScript/Fastify API, PostgreSQL persistence and migrations, email/password authentication with database-backed sessions, workspace membership management, encrypted immutable note versions, encrypted note-scoped comments and replies, an isolated client crypto package, and the first push/pull note sync protocol.

## Prerequisites

- Node.js 22 or newer
- npm 10 or newer
- Docker with Docker Compose

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

Open `http://localhost:5173`. Vite proxies `/api` and `/health` to `http://localhost:3000`; this is required for the HTTP-only cookie session to remain same-origin without enabling backend CORS.

Frontend workspace commands:

```powershell
npm run dev:web
npm run test:web
npm run typecheck --workspace @cipherspace/web
npm run build --workspace @cipherspace/web
npm run preview --workspace @cipherspace/web
```

The frontend provides login and registration, a protected application shell, workspace listing and creation, workspace details and membership listing, a local-first note editor, encrypted note discussions, and manual conflict resolution. Workspaces, encrypted local note envelopes, cached encrypted versions, pending changes, sync cursors, retry state, and encrypted conflict snapshots are stored in IndexedDB through Dexie. Creating, editing, and deleting a note writes locally without calling a mutation API, survives reloads, and displays unsynced or conflict indicators. Comments use React Query and the authenticated API directly; they are not currently durable offline data or part of note push/pull sync.

The workspace UI provides a minimal local-only key creation/unlock flow and an explicit **Sync** action. A random AES-256-GCM workspace key is protected under a separate local unlock password and only the protected key envelope is persisted in IndexedDB. After reload, enter the same local unlock password to recover the same workspace key; the unwrapped key remains in memory only. Note creates, edits, and conflict resolutions are encrypted through `@cipherspace/crypto` before the local note and pending operation are committed, so sync reuses the durable ciphertext and never needs a plaintext queue payload.

This v1 key is tied to the current user, workspace, and browser profile. There is no recovery or member/device key sharing yet. Titles and bodies are encrypted at rest in IndexedDB; locking clears readable note UI state and removes the unwrapped key from memory. Note IDs, workspace IDs, timestamps, revisions, queue state, ciphertext size, and other operational metadata remain visible in the browser profile.

Opening a local or server-backed note decrypts its envelope only after the workspace is unlocked. Plaintext is held in React memory while displayed. Selecting **Save local change** creates a new encrypted local envelope and encrypted pending operation; it does not persist the title or body as plaintext. A locked workspace replaces titles with **Encrypted note**, clears editor values, and disables editing. A wrong workspace key produces a generic decryption error without exposing partial content. IndexedDB schema version 5 lazily encrypts older plaintext note, queue, and conflict payloads after the correct workspace key is unlocked.

## Manual frontend check

1. Start the local stack and open the frontend.
2. Register with an email and a password containing 12–128 characters. Registration should open the empty workspace page.
3. Create a workspace and confirm its overview shows the current account as an owner.
4. Open **Notes** and confirm the empty state appears.
5. In the workspace sync panel, choose a separate local unlock password of 12–128 characters and select **Create and unlock key**. Keep that password available; v1 has no recovery.
6. Create a local note with a title and body. Confirm the editor and workspace header show unsynced changes and sync status `idle`.
7. Select **Sync**. Confirm the status changes through `syncing` to `synced` and the unsynced count drops (normally to zero). The backend stores only ciphertext and metadata.
8. Edit the note again and confirm the unsynced indicator returns. Select **Sync** again to push the next encrypted version.
9. Select **Lock** (or reload). Confirm note titles become **Encrypted note** and an open editor no longer shows title/body content. Unlock with the same local password and confirm the readable notes return.
10. Open a note that exists on the server but has no local draft. Confirm it shows an unlock prompt while locked, then displays the decrypted title and body after unlock.
11. Stop the API or disable the browser network, then select **Sync** and confirm the UI reports `Server unavailable`. Restart the API and retry; the pending change must remain durable and then sync successfully.
12. As a workspace owner, delete a note locally and confirm it disappears from the note list while the workspace reports a pending change. Sync the tombstone manually.
13. Sign out and confirm protected routes redirect to sign-in. Sign back in to reopen the same user-scoped local cache and unlock the workspace again.

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

Passwords must be between 12 and 128 characters. They are hashed with Argon2id before storage. Registering or logging in sets an opaque session token in the `cipherspace_session` cookie. The cookie is HTTP-only, uses `SameSite=Lax`, and is marked `Secure` when `NODE_ENV=production`. PostgreSQL stores only an HMAC-SHA-256 digest of the token.

`SESSION_SECRET` is required, must contain at least 32 characters, and should be a securely generated value. Changing it invalidates existing sessions. `SESSION_TTL_HOURS` defaults to 168 (seven days) and accepts values from 1 through 720.

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

Workspace names, member email addresses, and roles are server-visible metadata. Adding by email or user ID immediately adds an existing CipherSpace account; pending invitations and email delivery are not implemented.

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

# Add an existing account as an editor (userId may be used instead of email)
curl.exe -i -b owner-cookies.txt -H "Content-Type: application/json" `
  --data '{"email":"member@example.com","role":"editor"}' `
  "http://localhost:3000/api/workspaces/$workspaceId/members"

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
- `POST /api/workspaces/:id/members`
- `GET /api/workspaces/:id/members`
- `PATCH /api/workspaces/:id/members/:userId`
- `DELETE /api/workspaces/:id/members/:userId`

Non-members receive `404` for workspace-scoped reads so the API does not disclose whether a workspace ID exists. Editors and viewers receive `403` when attempting member management. The final owner cannot be removed or changed to another role.

## Encrypted note API

The note API stores opaque, base64-encoded ciphertext and nonce values. CipherSpace does not encrypt, decrypt, or interpret note content on the server. The isolated `@cipherspace/crypto` package provides AES-256-GCM workspace-key generation, authenticated note encryption/decryption, and local password protection for the workspace key. The React workspace UI creates/unlocks that local key and passes it to manual sync. Member/device key sharing, recovery, rotation, and revocation are not implemented.

An optional title is stored as a ciphertext/nonce pair. Initial note content is stored as version 1. Every later version is immutable, receives a monotonically increasing server version number, and points to the version that was current when it was appended. `clientVersion` is optional revision metadata for future client and sync work; it is not currently an idempotency key or conflict check.

The examples below assume an authenticated cookie jar and a workspace ID from the workspace API:

```powershell
$workspaceId = "00000000-0000-4000-8000-000000000000"

# Create a note with an initial encrypted version
curl.exe -i -b owner-cookies.txt -H "Content-Type: application/json" `
  --data '{"encryptedTitle":"AQIDBA==","encryptedTitleNonce":"AAECAwQFBgcICQoL","encryptedContent":"2RhjKslREPA=","contentNonce":"BwgJCgsMDQ4PEBES","encryptionMetadata":{"envelopeVersion":1,"algorithm":"AES-GCM","keyId":"workspace-key-1"},"clientVersion":"device-revision-1"}' `
  "http://localhost:3000/api/workspaces/$workspaceId/notes"

# List active notes (metadata and encrypted titles, without content versions)
curl.exe -i -b owner-cookies.txt `
  "http://localhost:3000/api/workspaces/$workspaceId/notes"

# Copy the note id returned by the create request
$noteId = "00000000-0000-4000-8000-000000000000"

# Append a new encrypted version
curl.exe -i -b owner-cookies.txt -H "Content-Type: application/json" `
  --data '{"encryptedContent":"E94RYgOM","contentNonce":"CAkKCwwNDg8QERIT","encryptionMetadata":{"envelopeVersion":1,"algorithm":"AES-GCM","keyId":"workspace-key-1"},"clientVersion":"device-revision-2"}' `
  "http://localhost:3000/api/workspaces/$workspaceId/notes/$noteId/versions"

# Read version history in ascending version order
curl.exe -i -b owner-cookies.txt `
  "http://localhost:3000/api/workspaces/$workspaceId/notes/$noteId/versions"
```

Replace the sample base64 values with ciphertext and fresh nonces generated by a client-side authenticated-encryption implementation. The note content limit is 1 MiB decoded; encrypted titles are limited to 16 KiB, nonces to 256 bytes, and `clientVersion` to 255 characters.

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

The frontend foundation, encrypted-at-rest local note storage and pending queue, backend foundation, authentication, workspaces, membership roles, encrypted-note/version APIs, encrypted note comments and replies, client encryption primitives, local-only workspace-key unlock, manual push/pull, idempotency, cursor persistence, retry state, conflict detection, and manual note-edit conflict resolution are implemented. Member/device key sharing, recovery, rotation, automatic/background sync, automatic merging, offline comment sync, pending invitations, and email delivery remain intentionally unimplemented. See `docs/PROJECT_STATE.md` for current status and planned work.

