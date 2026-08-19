# CipherSpace

CipherSpace is a local-first encrypted collaboration workspace. The current implementation contains a React/TypeScript frontend foundation, a TypeScript/Fastify API, PostgreSQL persistence and migrations, email/password authentication with database-backed sessions, workspace membership management, and server-side storage for encrypted notes and immutable note versions.

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

The frontend provides login and registration, a protected application shell, workspace listing and creation, workspace details and membership listing, note listing, an opaque note-detail shell, and development-only note creation fields matching the existing encrypted-note API.

The note form does **not** encrypt content. Its prefilled values are harmless base64 placeholders used only to exercise the API contract. Do not enter plaintext secrets or sensitive note content until client-side encryption is implemented.

## Manual frontend check

1. Start the local stack and open the frontend.
2. Register with an email and a password containing 12–128 characters. Registration should open the empty workspace page.
3. Create a workspace and confirm its overview shows the current account as an owner.
4. Open **Notes** and confirm the empty state appears.
5. Submit the prefilled development note form. The new note-detail shell should show version 1 and the same opaque payload metadata.
6. Return to the note list and workspace list, then sign out. Protected routes should redirect to sign-in.
7. Sign back in and confirm the workspace and note remain available.

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

- `owner`: read the workspace, manage members, create and update notes, and soft-delete notes.
- `editor`: read the workspace and create or update notes, but cannot manage members or delete notes.
- `viewer`: read the workspace and encrypted note data, but cannot create, update, or delete notes.

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

The note API stores opaque, base64-encoded ciphertext and nonce values. CipherSpace does not encrypt, decrypt, or interpret note content on the server. Clients are responsible for producing authenticated encrypted envelopes; the client crypto package and key-sharing flow are not implemented yet.

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

The root `test`, `typecheck`, and `build` commands verify both npm workspaces. Backend-only and frontend-only tests can be run with `npm run test:api` and `npm run test:web`.

## Current scope

The first online-only frontend foundation, backend foundation, user authentication, workspaces, membership roles, and encrypted-note/version APIs are implemented. Actual client-side encryption, sync, local client storage, offline mode, comments, pending invitations, email delivery, key sharing, and conflict resolution remain intentionally unimplemented. See `docs/PROJECT_STATE.md` for current status and planned work.

