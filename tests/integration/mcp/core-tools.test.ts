/**
 * Integration tests for core MCP tools.
 *
 * Requires: NEO4J_INTEGRATION=true + a pre-indexed simple-ngmodule-app database.
 * Run after: tests/integration/indexer/ngmodule-full-index.test.ts
 */

import { resolve } from 'path';
import { readFileSync } from 'fs';
import { discoverApp } from '../../../src/core/discovery/project-discovery.js';
import { collectFiles } from '../../../src/core/collection/source-collector.js';
import { extractTsFile } from '../../../src/core/extraction/ts-extractor.js';
import { extractSpecFile } from '../../../src/core/extraction/spec-extractor.js';
import { normalize } from '../../../src/core/normalization/angular-normalizer.js';
import { fullIndex } from '../../../src/graph/importer/bulk-importer.js';
import { createDriver, closeDriver } from '../../../src/graph/db/connection.js';
import { sanitizeDbName } from '../../../src/graph/db/db-manager.js';
import { findComponent } from '../../../src/mcp/tools/find-component.js';
import { getComponentDependencies } from '../../../src/mcp/tools/get-component-dependencies.js';
import { GraphIR } from '../../../src/core/types/graph-ir.js';

const RUN_INTEGRATION = process.env['NEO4J_INTEGRATION'] === 'true';
const FIXTURE_ROOT = resolve(__dirname, '../../fixtures/simple-ngmodule-app');

const testFn = RUN_INTEGRATION ? describe : describe.skip;

testFn('MCP core tools — simple-ngmodule-app', () => {
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
    for (const specFile of fileSet.specFiles) {
      irs.push(extractSpecFile(specFile, readFileSync(specFile, 'utf-8'), FIXTURE_ROOT));
    }

    const finalIr = normalize(irs);
    const stats = await fullIndex(driver, app, finalIr, FIXTURE_ROOT);
    appDb = stats.databaseName;
  }, 60_000);

  afterAll(async () => {
    if (driver) await closeDriver(driver);
  });

  describe('find_component', () => {
    it('finds component by selector', async () => {
      const result = await findComponent(driver, { appDb, selector: 'app-root' }) as {
        items: Array<{ selector: string; name: string }>;
        total: number;
      };
      expect(result.total).toBeGreaterThanOrEqual(1);
      expect(result.items[0].selector).toBe('app-root');
      expect(result.items[0].name).toBe('AppComponent');
    });

    it('finds component by name (case-insensitive)', async () => {
      const result = await findComponent(driver, { appDb, name: 'user' }) as {
        items: Array<{ name: string }>;
        total: number;
      };
      expect(result.total).toBeGreaterThanOrEqual(1);
      const names = result.items.map((c) => c.name);
      expect(names.some((n) => n.toLowerCase().includes('user'))).toBe(true);
    });

    it('returns error when neither name nor selector provided', async () => {
      const result = await findComponent(driver, { appDb }) as { code: string };
      expect(result.code).toBe('INVALID_INPUT');
    });

    it('supports pagination cursor', async () => {
      const page1 = await findComponent(driver, { appDb, name: '', selector: 'app', pageSize: 1 }) as {
        items: unknown[];
        cursor?: string;
        total: number;
      };
      if (page1.total > 1) {
        expect(page1.cursor).toBeDefined();
        const page2 = await findComponent(driver, { appDb, selector: 'app', pageSize: 1, cursor: page1.cursor }) as {
          items: unknown[];
        };
        expect(page2.items.length).toBe(1);
      }
    });
  });

  describe('get_component_dependencies', () => {
    it('returns injected services for UserComponent', async () => {
      // First find UserComponent ID
      const found = await findComponent(driver, { appDb, name: 'UserComponent' }) as {
        items: Array<{ id: string; name: string }>;
      };
      expect(found.items.length).toBeGreaterThanOrEqual(1);
      const userComp = found.items[0];

      const deps = await getComponentDependencies(driver, { appDb, componentId: userComp.id }) as {
        injectedServices: Array<{ name: string }>;
        appDb: string;
      };
      expect(deps.appDb).toBe(appDb);
      const svcNames = deps.injectedServices.map((s) => s.name);
      expect(svcNames).toContain('UserService');
    });

    it('returns NOT_FOUND for unknown ID', async () => {
      const result = await getComponentDependencies(driver, { appDb, componentId: 'nonexistent' }) as { code: string };
      expect(result.code).toBe('NOT_FOUND');
    });
  });
});
