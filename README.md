# Graph Hack

WeMakeDevs **Graph Hacks** submission — FalkorDB-backed GraphRAG agent (Node.js + tRPC).

Hackathon: [Graph Hacks: Context for AI Agents](https://www.wemakedevs.org/hackathons/falkordb)

## Stack

- **Web:** Next.js sign-in (black gradient) + Google OAuth (`apps/web`)
- **API:** Express + tRPC + `/auth/google/callback` (`apps/api`)
- **Services:** JWT cookies + SQLite users (`packages/services`) — same flow as Corsair Hackathon
- **Procedures:** `@stackfox/trpc` (`packages/trpc`)
- **Graph DB:** [FalkorDB](https://docs.falkordb.com/getting-started) (Docker)

## Prerequisites

- Node.js 20+
- Docker Desktop (for FalkorDB)

## Setup

```bash
cp .env.example .env
# add OPENAI_API_KEY when GraphRAG LLM is wired

npm install
npm run db:up
npm run dev
```

- Web / sign-in: http://localhost:3000/sign-in  
- API: http://localhost:8000  
- FalkorDB Browser: http://localhost:3001  
- tRPC: http://localhost:8000/trpc  

### Google OAuth

1. Create OAuth client (Web) in Google Cloud Console.  
2. Redirect URI: `http://localhost:3000/api-auth/google/callback`  
3. Copy client ID/secret into `.env` as `GOOGLE_OAUTH_*`  

## FalkorDB

```bash
docker compose up -d
```

Stops with `npm run db:down`.

## Project layout

```
apps/web/          Next.js UI + `/api-auth/google` (Corsair-style proxy)
apps/api/          Express server, mounts /trpc + Google callback
packages/services/ Auth, JWT, Google OAuth, SQLite users
packages/trpc/     tRPC routers, FalkorDB service, client types
docker-compose.yml FalkorDB + browser UI
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start API with hot reload |
| `npm run check-types` | Typecheck all packages |
| `npm run db:up` | Start FalkorDB container |

## License

MIT (hackathon submission)
