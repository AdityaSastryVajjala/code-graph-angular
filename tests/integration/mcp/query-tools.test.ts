/**
 * Integration tests for query MCP tools (service usage, routes, modules).
 *
 * Requires: NEO4J_INTEGRATION=true + a pre-indexed simple-ngmodule-app database.
 */

import { resolve } from 'path';
import { readFileSync } from 'fs';
import { discoverApp } from '../../../src/core/discovery/project-discovery.js';
import { collectFiles } from '../../../src/core/collection/source-collector.js';
import { extractTsFile } from '../../../src/core/extraction/ts-extractor.js';
import { normalize } from '../../../src/core/normalization/angular-normalizer.js';
import { fullIndex } from '../../../src/graph/importer/bulk-importer.js';
import { createDriver, closeDriver } from '../../../src/graph/db/connection.js';
import { findServiceUsage } from '../../../src/mcp/tools/find-service-usage.js';
import { getModuleStructure } from '../../../src/mcp/tools/get-module-structure.js';
import { GraphIR } from '../../../src/core/types/graph-ir.js';

const RUN_INTEGRATION = process.env['NEO4J_INTEGRATION'] === 'true';
const FIXTURE_ROOT = resolve(__dirname, '../../fixtures/simple-ngmodule-app');

const testFn = RUN_INTEGRATION ? describe : describe.skip;

testFn('MCP query tools — simple-ngmodule-app', () => {
  let driver: Awaited<ReturnType<typeof createDriver>>;
  let appDb: string;

  beforeAll(async () => {
    driver = await createDriver({
      url: process.env['NEO4J_URL'] ?? 'bolt://localhost:7687',
      user: process.env['NEO4J_USER'] ?? 'neo4j',
      password: process.env['NEO4J_PASSWORD'] ?? 'codegraph',
    });

    const app = discoverApp(FIXTURE_ROOT);
    const fileSet = await collectFiles(FIXTURE_ROOT);
    const irs: GraphIR[] = [];

    for (const tsFile of fileSet.tsFiles) {
      irs.push(extractTsFile(tsFile, readFileSync(tsFile, 'utf-8'), FIXTURE_ROOT));
    }

    const stats = await fullIndex(driver, app, normalize(irs), FIXTURE_ROOT);
    appDb = stats.databaseName;
  }, 60_000);

  afterAll(async () => {
    if (driver) await closeDriver(driver);
  });

  describe('find_service_usage', () => {
    it('returns components injecting UserService', async () => {
      const result = await findServiceUsage(driver, { appDb, name: 'UserService' }) as {
        items: Array<{ service: { name: string }; usedByComponents: Array<{ name: string }> }>;
        total: number;
      };
      expect(result.total).toBeGreaterThanOrEqual(1);
      const userSvcEntry = result.items.find((i) => i.service.name === 'UserService');
      expect(userSvcEntry).toBeDefined();
      const consumerNames = userSvcEntry!.usedByComponents.map((c) => c.name);
      expect(consumerNames).toContain('UserComponent');
    });
  });

  describe('get_module_structure', () => {
    it('returns AppModule with all declarations', async () => {
      const result = await getModuleStructure(driver, { appDb, name: 'AppModule', detail: true }) as {
        items: Array<{
          name: string;
          declares: Array<{ name: string }>;
          bootstrap: Array<{ name: string }>;
        }>;
        total: number;
      };
      expect(result.total).toBeGreaterThanOrEqual(1);
      const appModule = result.items.find((m) => m.name === 'AppModule');
      expect(appModule).toBeDefined();
      const declaredNames = appModule!.declares.map((d) => d.name);
      expect(declaredNames).toContain('AppComponent');
      expect(declaredNames).toContain('UserComponent');
      expect(declaredNames).toContain('HighlightDirective');
      expect(declaredNames).toContain('TruncatePipe');
    });
  });
});
