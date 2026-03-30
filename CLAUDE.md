# code-graph-angular Development Guidelines

Last updated: 2026-03-26

## Project Overview

Graph-based code intelligence platform for Angular workspaces. Parses Angular source files, builds a directed graph of entities and relationships, stores them in Neo4j, and exposes query capabilities via MCP tools.

## Active Technologies
- TypeScript 5.4, Node.js 20 LTS, target ES2022, CommonJS + `typescript` Compiler API (AST extraction), `@angular/compiler` (template parsing), `neo4j-driver` (graph writes), `@modelcontextprotocol/sdk` (MCP tool registration) (002-angular-semantics-foundation)
- Neo4j Enterprise (multi-db, one DB per Angular app) (002-angular-semantics-foundation)
- TypeScript 5.4, Node.js 20 LTS (ES2022 target, CommonJS) + `typescript` Compiler API (AST extraction), `@angular/compiler` (template AST parsing), `neo4j-driver` ^5 (graph writes + queries), `@modelcontextprotocol/sdk` ^1 (MCP tool registration), `zod` (schema validation) (003-impact-workspace-intelligence)
- Neo4j Enterprise, multi-database (one DB per Angular application) (003-impact-workspace-intelligence)
- TypeScript 5.4, Node.js 20 LTS (target ES2022, CommonJS) + `neo4j-driver` ^5, `@modelcontextprotocol/sdk` ^1, `zod`, `typescript` Compiler API, `commander` (004-migration-intelligence)
- Neo4j Enterprise (existing multi-database; one DB per Angular app) (004-migration-intelligence)
- [e.g., Python 3.11, Swift 5.9, Rust 1.75 or NEEDS CLARIFICATION] + [e.g., FastAPI, UIKit, LLVM or NEEDS CLARIFICATION] (004-migration-intelligence)
- [if applicable, e.g., PostgreSQL, CoreData, files or N/A] (004-migration-intelligence)
- TypeScript 5.4, Node.js 20 LTS (target ES2022, CommonJS) + `neo4j-driver` ^5, `@modelcontextprotocol/sdk` ^1, `zod`, `semver` (add as direct dependency for version range parsing) (005-pkg-compat-analyzer)

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
    extraction/               # ts-extractor (Angular entities + semantic symbols)
                              # template-extractor (HTML template bindings)
                              # spec-extractor (*.spec.ts linkage)
                              # di-extractor (InjectionToken + @Inject patterns)
                              # route-extractor (ROUTES_TO + LAZY_LOADS)
                              # workspace-extractor (Project nodes from angular.json/nx.json)
    normalization/            # Angular-specific normalizer
  graph/
    schema/                   # Node labels, relationship types, indexes
    db/                       # Neo4j connection + DB manager
    writer/                   # cypher-batch-writer (online Cypher MERGE writes)
                              # csv-writer (offline CSV serialization for neo4j-admin import)
    importer/                 # bulk-importer (orchestrates full index via neo4j-admin)
                              # admin-import-runner (executes neo4j-admin database import)
  incremental/
    detectors/                # git-diff and chokidar change detectors
    debounce/                 # 30s rolling debounce
    change-processor.ts
  mcp/
    server.ts                 # MCP server setup
    cypher-helpers.ts
    tools/                    # Phase 1/2: find-component, get-component-dependencies,
                              #   find-service-usage, trace-route, get-module-structure,
                              #   get-entity-detail, get-class-members
                              # Phase 3: get-impact-from-file, get-impact-from-symbol,
                              #   get-dependents, get-dependencies, get-project-dependencies,
                              #   get-template-usages, get-template-bindings, get-metrics,
                              #   find-symbol, get-injections, get-di-consumers, get-test-coverage
  impact/                     # Phase 3: traversal engine, impact classifier, traversal options
    traversal-engine.ts
    impact-classifier.ts
    traversal-options.ts
  metrics/                    # Phase 3: symbol, file, and project metrics
    metrics-service.ts
  shared/
    logger.ts
docker/
  docker-compose.yml          # Neo4j Enterprise with persistent storage
  neo4j.env
specs/001-angular-codegraph-core/  # Feature spec, plan, data model, contracts
specs/003-impact-workspace-intelligence/  # Phase 3 spec, plan, tasks, contracts
tests/
  fixtures/                   # simple-ngmodule-app, standalone-app, nx-workspace
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

`003-impact-workspace-intelligence` — Phase 3 additions: impact analysis (file + symbol traversal), workspace/project boundary awareness, typed template binding relationships, graph metrics, and 9 new focused MCP tools.

Phase 3 new modules:
- `src/impact/` — traversal engine, BFS-based impact traversal with cycle detection, impact classifier
- `src/metrics/` — symbol, file, and project-level coupling metrics via Neo4j COUNT queries
- `src/core/extraction/workspace-extractor.ts` — Project node extraction from angular.json / nx.json

Phase 3 new MCP tools (registered in `src/mcp/server.ts`):
`get_impact_from_file`, `get_impact_from_symbol`, `get_dependents`, `get_dependencies`,
`get_project_dependencies`, `get_template_usages`, `get_template_bindings`, `get_metrics`,
`find_symbol`, `get_injections`, `get_di_consumers`, `get_test_coverage`

Phase 2 additional MCP tools: `get_class_members`

## Method Call Tracking

`CALLS_METHOD` relationships are emitted from `extractMethodCallRelationships()` in
`src/core/extraction/ts-extractor.ts`, called for every `Method` node during semantic extraction.

**Relationship**: `(:Method)-[:CALLS_METHOD {line, callee, via?}]->(:Method)`

| Call pattern | `toId` resolution | Extra properties |
|---|---|---|
| `this.methodName()` | Direct (same-class, computed at extraction time) | `line`, `callee` |
| `this.dep.methodName()` | `pendingTargetName` → normalizer resolves by method `name` | `line`, `callee`, `via` (dep field name) |

- `line` is 1-based source line of the call expression.
- An index on `CALLS_METHOD.line` is registered in `src/graph/schema/indexes.ts`.
- Unresolvable cross-object targets (e.g. calls on non-`this` expressions) are silently dropped by the normalizer's pending-resolution pass.

<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->
