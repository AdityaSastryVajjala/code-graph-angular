# code-graph-angular Development Guidelines

Last updated: 2026-03-25

## Project Overview

Graph-based code intelligence platform for Angular workspaces. Parses Angular source files, builds a directed graph of entities and relationships, stores them in Neo4j, and exposes query capabilities via MCP tools.

## Active Technologies
- TypeScript 5.4, Node.js 20 LTS, target ES2022, CommonJS + `typescript` Compiler API (AST extraction), `@angular/compiler` (template parsing), `neo4j-driver` (graph writes), `@modelcontextprotocol/sdk` (MCP tool registration) (002-angular-semantics-foundation)
- Neo4j Enterprise (multi-db, one DB per Angular app) (002-angular-semantics-foundation)

- **Runtime**: Node.js 20 LTS, TypeScript 5.4 (target ES2022, commonjs)
- **Parsing**: `typescript` Compiler API, `@angular/compiler` (template parsing)
- **Graph DB**: Neo4j (via `neo4j-driver`), multi-database, one DB per Angular app
- **MCP**: `@modelcontextprotocol/sdk` — exposes query tools to LLM assistants
- **CLI**: `commander` — entry point at `src/cli/index.ts` → `dist/cli/index.js`
- **File watching**: `chokidar` (local dev), git diff (CI)
- **Validation**: `zod`
- **Testing**: Jest 29 + `ts-jest`

## Project Structure

```text
src/
  cli/                        # CLI entry point (commander)
  core/
    types/graph-ir.ts         # Intermediate representation types
    discovery/                # Angular project/workspace discovery
    collection/               # Source file collection
    extraction/               # TypeScript, template, and spec extractors
    normalization/            # Angular-specific normalizer
  graph/
    schema/                   # Node labels, relationship types, indexes
    db/                       # Neo4j connection + DB manager
    writer/                   # Cypher batch writer
    importer/                 # Bulk importer
  incremental/
    detectors/                # git-diff and chokidar change detectors
    debounce/                 # 30s rolling debounce
    change-processor.ts
  mcp/
    server.ts                 # MCP server setup
    cypher-helpers.ts
    tools/                    # find-component, get-component-dependencies,
                              # find-service-usage, trace-route,
                              # get-module-structure, get-entity-detail
  shared/
    logger.ts
docker/
  docker-compose.yml          # Neo4j Enterprise with persistent storage
  neo4j.env
specs/001-angular-codegraph-core/  # Feature spec, plan, data model, contracts
tests/
  fixtures/                   # simple-ngmodule-app, standalone-app
```

## Commands

```bash
npm test                      # Run all tests (Jest)
npm run test:unit             # tests/unit only
npm run test:integration      # tests/integration only
npm run test:e2e              # tests/e2e only
npm run test:coverage         # With coverage report
npm run lint                  # eslint src --ext .ts
npm run build                 # tsc compile to dist/
npm run build:watch           # tsc watch mode
npm run clean                 # rimraf dist
```

## Neo4j / Docker

Start Neo4j Enterprise locally (required before indexing):

```bash
docker compose -f docker/docker-compose.yml up -d
```

One Neo4j database per Angular application; database names are deterministic and sanitized from the app name.

## Code Style

- Strict TypeScript: `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`, `noFallthroughCasesInSwitch` are all enabled — fix all TS errors before committing.
- No authentication on the MCP server (trusted-network only).
- MCP tool responses: summary by default, detail available via `detail` parameter or dedicated tool. All list results are paginated with a cursor.
- Graph consistency model: eventual. Queries during an active write batch may return partially updated results.

## Key Design Decisions

- **Feature detection over version detection**: parser handles Angular 2 → latest; Angular 14+ (standalone, typed forms, `inject()`) is the strong-support baseline.
- **File ownership**: every graph node stores its source file path for file-level incremental updates.
- **Incremental updates**: 30-second rolling debounce in watch mode; reset on each new file event.
- **Dirty-state recovery**: on startup, detect partial/dirty DB and wipe before re-indexing.
- **Spec files**: `*.spec.ts` files are first-class graph nodes linked to the entities they test.

## Active Feature Branch

`001-angular-codegraph-core` — core indexer, MCP server, incremental updates, multi-app support.

<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->
