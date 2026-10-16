# Graph Hack

WeMakeDevs **Graph Hacks** submission — FalkorDB-backed GraphRAG agent (Node.js + tRPC).

Hackathon: [Graph Hacks: Context for AI Agents](https://www.wemakedevs.org/hackathons/falkordb)

## Stack

- **API:** Express + tRPC (`apps/api`)
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

- API: http://localhost:8000  
- FalkorDB Browser: http://localhost:3000  
- tRPC: http://localhost:8000/trpc  

## FalkorDB

```bash
docker compose up -d
```

Stops with `npm run db:down`.

## Project layout

```
apps/api/          Express server, mounts /trpc
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
