# Angular CodeGraph

A graph-based code intelligence platform for Angular workspaces and Nx-style monorepos.
Parses Angular applications into a Neo4j property graph, then exposes the graph through
an MCP (Model Context Protocol) server for LLM-assisted code exploration.

## Prerequisites

- **Node.js** 20 LTS
- **Docker** + Docker Compose (for Neo4j)
- **Neo4j Enterprise 5.x** — spun up via the included Docker Compose file

## Quick Start

### 1. Start Neo4j

```bash
docker compose -f docker/docker-compose.yml up -d
```

The Neo4j browser is available at http://localhost:7474 (neo4j / codegraph).

### 2. Install & Build

```bash
npm install
npm run build
```

### 3. Index an Angular Application

```bash
# Single app
node dist/cli/index.js index --app-root /path/to/your/angular-app

# Nx workspace (indexes all apps, one DB per app)
node dist/cli/index.js index --workspace /path/to/nx-workspace

# With explicit Neo4j credentials
node dist/cli/index.js index \
  --app-root /path/to/app \
  --neo4j-url bolt://localhost:7687 \
  --neo4j-user neo4j \
  --neo4j-password codegraph
```

### 4. Watch Mode (Incremental Updates)

```bash
node dist/cli/index.js watch --app-root /path/to/your/angular-app
```

File changes are batched with a 30-second rolling debounce and incrementally applied.

### 5. Start the MCP Server

```bash
node dist/cli/index.js mcp-server
```

Runs on stdio. Connect via any MCP-compatible client (Claude, VS Code extension, etc.).

## MCP Tools

| Tool | Description |
|------|-------------|
| `find_component` | Find components by name or CSS selector |
| `get_component_dependencies` | Get the full dependency tree for a component |
| `find_service_usage` | Find all consumers of a service |
| `trace_route` | Trace a URL path to the component it loads |
| `get_module_structure` | Get NgModule declarations/imports/exports |
| `get_entity_detail` | Fetch full detail for any graph entity |

All tools operate against a named `appDb` (the Neo4j database for one application).
Responses are paginated (`pageSize`, `cursor`) with summary-first mode by default.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NEO4J_URL` | `bolt://localhost:7687` | Neo4j Bolt endpoint |
| `NEO4J_USER` | `neo4j` | Neo4j username |
| `NEO4J_PASSWORD` | `codegraph` | Neo4j password |
| `CODEGRAPH_DEBUG` | _(unset)_ | Set to `true` for debug logging |

## Running Tests

```bash
# Unit tests only (no Neo4j required)
npm test

# Integration + unit tests (requires running Neo4j)
NEO4J_INTEGRATION=true npm test
```

## Project Structure

```
src/
  cli/          — CLI commands (index, watch, mcp-server)
  core/         — Extraction pipeline (TypeScript & template parsers, normalizer)
  graph/        — Neo4j schema, writer, importer, DB management
  incremental/  — Change detection (git diff, chokidar) and debounce
  mcp/          — MCP server and 6 query tools
  shared/       — Structured logger
tests/
  fixtures/     — Minimal Angular apps for testing (no node_modules)
  unit/         — Pure unit tests (no database)
  integration/  — Tests requiring a live Neo4j instance
docker/         — Docker Compose for Neo4j Enterprise
specs/          — Feature specifications and architecture plan
```

## Further Reading

See [`specs/001-angular-codegraph-core/quickstart.md`](specs/001-angular-codegraph-core/quickstart.md)
for end-to-end walkthrough scenarios.
