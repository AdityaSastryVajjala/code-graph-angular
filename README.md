# Angular CodeGraph

A graph-based code intelligence platform for Angular workspaces and Nx-style monorepos.
Parses Angular applications into a Neo4j property graph, then exposes the graph through
an MCP (Model Context Protocol) server for LLM-assisted code exploration and migration planning.

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

### 5. Run Migration Analysis (Phase 4)

```bash
node dist/cli/index.js migrate analyze --app <appName>
```

Runs a full, read-only migration intelligence scan across the workspace. Previous findings
are replaced on each run. Example output:

```
[migrate] Analysis complete.
          Run ID: 2026-03-25T10:00:00Z
          Duration: 8s
          Findings: 47 total (3 blockers, 18 risks, 26 opportunities)
          Standalone candidates: 34/52
```

### 6. Start the MCP Server

```bash
node dist/cli/index.js mcp-server
```

Runs on stdio. Connect via any MCP-compatible client (Claude, VS Code extension, etc.).

## MCP Tools

### Code Intelligence (Phases 1–3)

| Tool | Description |
|------|-------------|
| `find_component` | Find components by name or CSS selector |
| `get_component_dependencies` | Get the full dependency tree for a component |
| `find_service_usage` | Find all consumers of a service |
| `trace_route` | Trace a URL path to the component it loads |
| `get_module_structure` | Get NgModule declarations/imports/exports |
| `get_entity_detail` | Fetch full detail for any graph entity |
| `get_class_members` | List members (methods, properties) of a class |
| `get_impact_from_file` | Get all artifacts impacted by changes to a file |
| `get_impact_from_symbol` | Get all artifacts impacted by a symbol change |
| `get_dependents` | List all dependents of an artifact |
| `get_dependencies` | List all dependencies of an artifact |
| `get_project_dependencies` | Cross-project dependency graph |
| `get_template_usages` | Find all template usages of a directive or pipe |
| `get_template_bindings` | Get typed bindings for a component's template |
| `get_metrics` | Symbol, file, and project coupling metrics |
| `find_symbol` | Search for any symbol across the workspace |
| `get_injections` | List injected dependencies for a class |
| `get_di_consumers` | Find all consumers of an injection token or service |
| `get_test_coverage` | Show spec file linkage for an artifact |

### Migration Intelligence (Phase 4)

| Tool | Description |
|------|-------------|
| `get_migration_summary` | High-level migration readiness summary for the app or a project |
| `get_standalone_candidates` | List components, directives, and pipes that are standalone migration candidates |
| `get_migration_findings` | Query findings by type (`blocker`, `risk`, `opportunity`), category, and severity |
| `get_migration_order` | Dependency-safe migration order with parallelizable groups identified |
| `get_deprecated_patterns` | List all deprecated Angular and RxJS pattern findings |

All tools require an `appDb` parameter (the Neo4j database name for the target application).
Responses are paginated (`pageSize`, `cursor`) with summary-first mode by default.

## Migration Intelligence Overview

Phase 4 adds read-only migration analysis across five dimensions:

- **Standalone candidate detection** — evaluates each component, directive, and pipe for standalone migration readiness, listing all blockers for non-candidates.
- **NgModule complexity analysis** — scores each NgModule on declarations, imports, exports, and coupling; emits a standalone migration feasibility rating.
- **Deprecated pattern detection** — detects deprecated Angular APIs (class-based guards, legacy router config, entry components) and RxJS patterns (non-pipeable operators, legacy imports, subscription anti-patterns).
- **Template modernization hints** — flags structural directive updates, standalone import implications, and directive/pipe modernization opportunities.
- **Dependency-aware migration ordering** — topologically orders all artifacts for safe migration sequencing; identifies parallelizable groups and flags cyclic module groups as Hard Blockers.

All findings are stored as enriched properties on graph nodes and are queryable via the five dedicated MCP tools above or through `get_entity_detail`. Circular dependency groups are excluded from ordering and emitted as Hard Blocker findings.

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
  cli/          — CLI commands (index, watch, mcp-server, migrate)
  core/         — Extraction pipeline (TypeScript & template parsers, normalizer)
  graph/        — Neo4j schema, writer, importer, DB management
  impact/       — BFS traversal engine, impact classifier (Phase 3)
  incremental/  — Change detection (git diff, chokidar) and debounce
  metrics/      — Symbol, file, and project coupling metrics (Phase 3)
  migration/    — Migration analyzers, finding builder, migration runner (Phase 4)
  mcp/          — MCP server and query tools (Phases 1–4)
  shared/       — Structured logger
tests/
  fixtures/     — Minimal Angular apps for testing (no node_modules)
  unit/         — Pure unit tests (no database)
  integration/  — Tests requiring a live Neo4j instance
docker/         — Docker Compose for Neo4j Enterprise
specs/          — Feature specifications and architecture plans
```

## Further Reading

- [`specs/001-angular-codegraph-core/quickstart.md`](specs/001-angular-codegraph-core/quickstart.md) — end-to-end walkthrough (Phases 1–2)
- [`specs/004-migration-intelligence/quickstart.md`](specs/004-migration-intelligence/quickstart.md) — migration analysis walkthrough (Phase 4)
- [`specs/004-migration-intelligence/contracts/mcp-tools.md`](specs/004-migration-intelligence/contracts/mcp-tools.md) — full MCP tool input/output schemas
