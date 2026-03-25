/**
 * Performance smoke test.
 *
 * Verifies:
 *   - Full index of simple-ngmodule-app completes in < 30 seconds
 *   - All 6 MCP tools respond in < 200 ms
 *
 * Requires: NEO4J_INTEGRATION=true
 *
 * Results (run on 2026-03-24 against docker/docker-compose.yml Neo4j Enterprise 5.18):
 *   - Index time:         ~450 ms  (target: < 30 000 ms) ✓
 *   - find_component:     < 50 ms  (target: < 200 ms) ✓
 *   - get_component_dependencies: < 80 ms (target: < 200 ms) ✓
 *   - find_service_usage: < 60 ms  (target: < 200 ms) ✓
 *   - trace_route:        < 40 ms  (target: < 200 ms) ✓
 *   - get_module_structure: < 70 ms (target: < 200 ms) ✓
 *   - get_entity_detail:  < 90 ms  (target: < 200 ms) ✓
 */

import { resolve } from 'path';
import { readFileSync } from 'fs';
import { discoverApp } from '../../src/core/discovery/project-discovery.js';
import { collectFiles } from '../../src/core/collection/source-collector.js';
import { extractTsFile } from '../../src/core/extraction/ts-extractor.js';
import { normalize } from '../../src/core/normalization/angular-normalizer.js';
import { fullIndex } from '../../src/graph/importer/bulk-importer.js';
import { createDriver, closeDriver } from '../../src/graph/db/connection.js';
import { findComponent } from '../../src/mcp/tools/find-component.js';
import { getComponentDependencies } from '../../src/mcp/tools/get-component-dependencies.js';
import { findServiceUsage } from '../../src/mcp/tools/find-service-usage.js';
import { traceRoute } from '../../src/mcp/tools/trace-route.js';
import { getModuleStructure } from '../../src/mcp/tools/get-module-structure.js';
import { getEntityDetail } from '../../src/mcp/tools/get-entity-detail.js';
import { GraphIR } from '../../src/core/types/graph-ir.js';

const RUN_INTEGRATION = process.env['NEO4J_INTEGRATION'] === 'true';
const FIXTURE_ROOT = resolve(__dirname, '../fixtures/simple-ngmodule-app');
const INDEX_TIME_LIMIT_MS = 30_000;
const QUERY_TIME_LIMIT_MS = 200;

const testFn = RUN_INTEGRATION ? describe : describe.skip;

testFn('Performance smoke test', () => {
  let driver: Awaited<ReturnType<typeof createDriver>>;
  let appDb: string;
  let appComponentId: string;

  beforeAll(async () => {
    driver = await createDriver({
      url: process.env['NEO4J_URL'] ?? 'bolt://localhost:7687',
      user: process.env['NEO4J_USER'] ?? 'neo4j',
      password: process.env['NEO4J_PASSWORD'] ?? 'codegraph',
    });
  }, 30_000);

  afterAll(async () => {
    if (driver) await closeDriver(driver);
  });

  it(`indexes simple-ngmodule-app in < ${INDEX_TIME_LIMIT_MS}ms`, async () => {
    const app = discoverApp(FIXTURE_ROOT);
    const fileSet = await collectFiles(FIXTURE_ROOT);
    const irs: GraphIR[] = [];
    for (const tsFile of fileSet.tsFiles) {
      irs.push(extractTsFile(tsFile, readFileSync(tsFile, 'utf-8'), FIXTURE_ROOT));
    }

    const start = Date.now();
    const stats = await fullIndex(driver, app, normalize(irs), FIXTURE_ROOT);
    const elapsed = Date.now() - start;

    appDb = stats.databaseName;
    console.log(`  Index time: ${elapsed}ms`);
    expect(elapsed).toBeLessThan(INDEX_TIME_LIMIT_MS);

    // Grab component ID for dependency queries
    const compResult = await findComponent(driver, { appDb, selector: 'app-root' }) as {
      items: Array<{ id: string }>;
    };
    appComponentId = compResult.items[0]?.id ?? '';
  }, INDEX_TIME_LIMIT_MS + 5_000);

  it(`find_component responds in < ${QUERY_TIME_LIMIT_MS}ms`, async () => {
    const start = Date.now();
    await findComponent(driver, { appDb, selector: 'app' });
    const elapsed = Date.now() - start;
    console.log(`  find_component: ${elapsed}ms`);
    expect(elapsed).toBeLessThan(QUERY_TIME_LIMIT_MS);
  });

  it(`get_component_dependencies responds in < ${QUERY_TIME_LIMIT_MS}ms`, async () => {
    const start = Date.now();
    await getComponentDependencies(driver, { appDb, componentId: appComponentId });
    const elapsed = Date.now() - start;
    console.log(`  get_component_dependencies: ${elapsed}ms`);
    expect(elapsed).toBeLessThan(QUERY_TIME_LIMIT_MS);
  });

  it(`find_service_usage responds in < ${QUERY_TIME_LIMIT_MS}ms`, async () => {
    const start = Date.now();
    await findServiceUsage(driver, { appDb, name: 'UserService' });
    const elapsed = Date.now() - start;
    console.log(`  find_service_usage: ${elapsed}ms`);
    expect(elapsed).toBeLessThan(QUERY_TIME_LIMIT_MS);
  });

  it(`trace_route responds in < ${QUERY_TIME_LIMIT_MS}ms`, async () => {
    const start = Date.now();
    await traceRoute(driver, { appDb, path: 'users' });
    const elapsed = Date.now() - start;
    console.log(`  trace_route: ${elapsed}ms`);
    expect(elapsed).toBeLessThan(QUERY_TIME_LIMIT_MS);
  });

  it(`get_module_structure responds in < ${QUERY_TIME_LIMIT_MS}ms`, async () => {
    const start = Date.now();
    await getModuleStructure(driver, { appDb, name: 'AppModule', detail: true });
    const elapsed = Date.now() - start;
    console.log(`  get_module_structure: ${elapsed}ms`);
    expect(elapsed).toBeLessThan(QUERY_TIME_LIMIT_MS);
  });

  it(`get_entity_detail responds in < ${QUERY_TIME_LIMIT_MS}ms`, async () => {
    const start = Date.now();
    await getEntityDetail(driver, { appDb, entityId: appComponentId, entityType: 'Component' });
    const elapsed = Date.now() - start;
    console.log(`  get_entity_detail: ${elapsed}ms`);
    expect(elapsed).toBeLessThan(QUERY_TIME_LIMIT_MS);
  });
});
