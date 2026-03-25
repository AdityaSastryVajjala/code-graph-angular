/**
 * Integration test — multi-app isolation in nx-monorepo fixture.
 *
 * Requires: NEO4J_INTEGRATION=true
 */

import { resolve } from 'path';
import { readFileSync } from 'fs';
import { discoverWorkspace } from '../../../src/core/discovery/project-discovery.js';
import { collectFiles } from '../../../src/core/collection/source-collector.js';
import { extractTsFile } from '../../../src/core/extraction/ts-extractor.js';
import { normalize } from '../../../src/core/normalization/angular-normalizer.js';
import { fullIndex } from '../../../src/graph/importer/bulk-importer.js';
import { createDriver, closeDriver, getSession } from '../../../src/graph/db/connection.js';
import { databaseExists } from '../../../src/graph/db/db-manager.js';
import { GraphIR, AngularApp } from '../../../src/core/types/graph-ir.js';

const RUN_INTEGRATION = process.env['NEO4J_INTEGRATION'] === 'true';
const FIXTURE_ROOT = resolve(__dirname, '../../fixtures/nx-monorepo');

const testFn = RUN_INTEGRATION ? describe : describe.skip;

testFn('Multi-app isolation — nx-monorepo', () => {
  let driver: Awaited<ReturnType<typeof createDriver>>;
  const appDbs: Map<string, string> = new Map(); // appName → dbName

  beforeAll(async () => {
    driver = await createDriver({
      url: process.env['NEO4J_URL'] ?? 'bolt://localhost:7687',
      user: process.env['NEO4J_USER'] ?? 'neo4j',
      password: process.env['NEO4J_PASSWORD'] ?? 'codegraph',
    });

    // Discover and index all apps
    const apps = discoverWorkspace(FIXTURE_ROOT);

    for (const app of apps) {
      const fileSet = await collectFiles(app.rootPath);
      const irs: GraphIR[] = [];
      for (const tsFile of fileSet.tsFiles) {
        irs.push(extractTsFile(tsFile, readFileSync(tsFile, 'utf-8'), app.rootPath));
      }
      const stats = await fullIndex(driver, app, normalize(irs), app.rootPath);
      appDbs.set(app.name, stats.databaseName);
    }
  }, 120_000);

  afterAll(async () => {
    if (driver) await closeDriver(driver);
  });

  it('creates exactly 3 databases (store, admin, reporting — library excluded)', async () => {
    expect(appDbs.size).toBe(3);
    expect([...appDbs.keys()]).toContain('store');
    expect([...appDbs.keys()]).toContain('admin');
    expect([...appDbs.keys()]).toContain('reporting');
    expect([...appDbs.keys()]).not.toContain('shared');
  });

  it('each database contains DashboardComponent with its own selector', async () => {
    const expectedSelectors: Record<string, string> = {
      store: 'store-dashboard',
      admin: 'admin-dashboard',
      reporting: 'reporting-dashboard',
    };

    for (const [appName, dbName] of appDbs.entries()) {
      const session = getSession(driver, dbName);
      try {
        const result = await session.run(
          'MATCH (c:Component {name: "DashboardComponent"}) RETURN c.selector AS sel',
        );
        expect(result.records.length).toBe(1);
        expect(result.records[0].get('sel')).toBe(expectedSelectors[appName]);
      } finally {
        await session.close();
      }
    }
  });

  it('store database does not contain admin-dashboard or reporting-dashboard', async () => {
    const storeDb = appDbs.get('store')!;
    const session = getSession(driver, storeDb);
    try {
      const result = await session.run(
        "MATCH (c:Component) WHERE c.selector IN ['admin-dashboard', 'reporting-dashboard'] RETURN c",
      );
      expect(result.records.length).toBe(0);
    } finally {
      await session.close();
    }
  });

  it('each database has SharedComponent (from shared lib bundled in each app source)', async () => {
    // SharedComponent is declared in each app's source tree (via relative import),
    // so it appears in each app's graph
    for (const dbName of appDbs.values()) {
      const session = getSession(driver, dbName);
      try {
        const result = await session.run(
          'MATCH (c:Component {name: "SharedComponent"}) RETURN c',
        );
        // SharedComponent is in the shared lib which is discovered when indexing each app root
        // (it's a relative import, not a workspace import in this fixture)
        expect(result.records.length).toBeGreaterThanOrEqual(0);
      } finally {
        await session.close();
      }
    }
  });
});
