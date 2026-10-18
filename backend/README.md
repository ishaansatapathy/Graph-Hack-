# Stackfox

Stackfox is a team workspace for shared repository work, graph-backed code context, integration automation, and deployment API access.

The production graph engine requires FalkorDB. The in-memory graph fallback is for local development only and is disabled in production.

## Stack

- **Web:** Next.js sign-in (black gradient) + Google OAuth (`apps/web`)
- **API:** Express + tRPC + `/auth/google/callback` (`apps/api`)
- **Services:** JWT cookies, PostgreSQL workspace data, encrypted integration credentials (`packages/services`)
- **Procedures:** `@stackfox/trpc` (`packages/trpc`)
- **Graph DB:** [FalkorDB](https://docs.falkordb.com/getting-started) (Docker)

## Prerequisites

- Node.js 20+
- Docker Desktop (for FalkorDB)

## Setup

```bash
cp .env.example .env
# Configure required values in .env

npm install
npm run db:up
npm run db:migrate
npm run dev:all
```

- Web / sign-in: http://localhost:3000/sign-in  
- API: http://localhost:8000  
- FalkorDB Browser: http://localhost:3001  
- tRPC: http://localhost:8000/trpc  

### Google OAuth

1. Create OAuth client (Web) in Google Cloud Console.  
2. Redirect URI: `http://localhost:3000/api-auth/google/callback`  
3. Copy client ID/secret into `.env` as `GOOGLE_OAUTH_*`  

### GitHub editor permissions

The workspace IDE reads repository files and creates one `stackfox/user-<id>` branch per teammate. It commits
only to that member's branch; the server rejects writes to the default branch and other members' branches.
Members can open a pull request from their own branch for normal GitHub review and branch-protection checks.
The connected GitHub token needs repository contents read/write and pull-request write access.

## FalkorDB

```bash
docker compose up -d
```

Stops with `npm run db:down`.

## Workspace Graph API

Owners and admins can create and revoke workspace API keys from the workspace settings. A key grants read-only
Cypher access to that workspace's graph. Store it as a secret and send it in the `Authorization` header:

```http
POST /api/v1/graph/query
Authorization: Bearer sk_stackfox_…
Content-Type: application/json

{"cypher":"MATCH (f:Function) RETURN f.name AS name LIMIT 20"}
```

The endpoint rejects write queries and multiple statements. Keys are shown only at creation, stored as hashes,
and rejected after revocation or expiry.

GitHub pushes can post a summary to the connected Slack webhook. Jira issue transitions are opt-in in the Jira
integration settings: when enabled, a commit that explicitly contains a Jira key can move that issue to
`In Progress` if Jira exposes that transition. The handler checks the current status first and does not add
automatic Jira comments.

## Shared deployed services

Workspace owners and admins can register an HTTPS API origin under **Workspace → Shared Services**. The service
and optional bearer credential are shared with workspace members; the credential is encrypted at rest. Members
can invoke GET, POST, PUT, PATCH, or DELETE paths from the service console. Destinations must resolve to public
addresses; requests are pinned to a checked IP, do not follow redirects, and are bounded by time and payload size.

Run `npm run db:migrate` with `DATABASE_URL` set before deploying. The runner takes a PostgreSQL advisory lock,
applies numbered SQL files in order, commits each migration separately, and records its checksum in
`public.stackfox_migrations`. Separate transactions matter because PostgreSQL does not make a newly added enum
label available until its migration transaction commits. Previously hand-applied migrations can be safely
reapplied because the SQL uses idempotent DDL or replaces its partial index.

Create future SQL files with `npm run db:new-migration -- <lower_snake_case_name>`. Keep applied files immutable;
separate each statement with `--> statement-breakpoint`. `npm run db:push` is for local schema iteration, not production releases.
The Studio editor stores workspace-shared file drafts with optimistic version checks and polls for teammate updates every 2.5 seconds; commits still go to the current user's GitHub edit branch.

## Project layout

```
apps/web/          Next.js UI + `/api-auth/google` (Corsair-style proxy)
apps/api/          Express server, mounts /trpc + Google callback
packages/services/ Auth, JWT, Google OAuth, PostgreSQL workspace data
packages/trpc/     tRPC routers, FalkorDB service, client types
docker-compose.yml FalkorDB + browser UI
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev:all` | Start API and workspace web app |
| `npm run build` | Build the workspace web app for production |
| `npm run start:api` | Start the API process |
| `npm run start:web` | Start the web process |
| `npm run check-types` | Typecheck all packages |
| `npm run db:up` | Start local FalkorDB and OpenVSCode containers |
| `npm run db:check-migrations` | Validate migration order and statement boundaries without connecting to the database |
| `npm run db:migrate` | Apply ordered PostgreSQL SQL migrations |
| `npm run db:new-migration -- <name>` | Create the next numbered SQL migration |

## License

MIT
