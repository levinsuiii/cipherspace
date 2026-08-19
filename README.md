# CipherSpace

CipherSpace is a local-first encrypted collaboration workspace. The current implementation contains the backend foundation only: a TypeScript/Fastify API, PostgreSQL persistence schema, migrations, and Docker-based local development.

## Prerequisites

- Node.js 22 or newer
- npm 10 or newer
- Docker with Docker Compose

## Run the API and PostgreSQL with Docker

From a fresh clone:

```powershell
Copy-Item .env.example .env
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

Only the backend and database foundation are implemented. Authentication, API endpoints for workspaces or notes, encryption, sync endpoints, local client storage, comments, invitations, key sharing, and conflict resolution remain intentionally unimplemented. See `docs/PROJECT_STATE.md` for current status and planned work.

