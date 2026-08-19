# CipherSpace

CipherSpace is a local-first encrypted collaboration workspace. The current implementation contains a TypeScript/Fastify API, PostgreSQL persistence and migrations, email/password authentication with database-backed sessions, and workspace membership management.

## Prerequisites

- Node.js 22 or newer
- npm 10 or newer
- Docker with Docker Compose

## Run the API and PostgreSQL with Docker

From a fresh clone:

```powershell
Copy-Item .env.example .env
# Replace SESSION_SECRET in .env with this generated value:
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
docker compose up --build
```

The API is available at `http://localhost:3000`. Verify it with:

```powershell
Invoke-RestMethod http://localhost:3000/health
```

The API container waits for PostgreSQL, runs pending migrations, and then starts the server. Stop the services with `docker compose down`. To also remove local database data, run `docker compose down --volumes`.

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

- `owner`: read the workspace and manage members.
- `editor`: read the workspace but cannot manage members. Note editing is not implemented yet.
- `viewer`: read the workspace but cannot manage members.

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

## Current scope

Only the backend foundation, user authentication, workspaces, and membership roles are implemented. APIs for notes, encryption, sync, local client storage, comments, pending invitations, email delivery, key sharing, and conflict resolution remain intentionally unimplemented. See `docs/PROJECT_STATE.md` for current status and planned work.

