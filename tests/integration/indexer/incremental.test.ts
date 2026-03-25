/**
 * Integration test — incremental update after modifying a fixture file.
 *
 * Requires: NEO4J_INTEGRATION=true
 */

import { resolve } from 'path';
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, rmSync } from 'fs';
import { discoverApp } from '../../../src/core/discovery/project-discovery.js';
import { collectFiles } from '../../../src/core/collection/source-collector.js';
import { extractTsFile } from '../../../src/core/extraction/ts-extractor.js';
import { normalize } from '../../../src/core/normalization/angular-normalizer.js';
import { fullIndex } from '../../../src/graph/importer/bulk-importer.js';
import { processChanges } from '../../../src/incremental/change-processor.js';
import { createDriver, closeDriver, getSession } from '../../../src/graph/db/connection.js';
import { sanitizeDbName, getIndexMetaStatus } from '../../../src/graph/db/db-manager.js';
import { GraphIR } from '../../../src/core/types/graph-ir.js';

const RUN_INTEGRATION = process.env['NEO4J_INTEGRATION'] === 'true';
const FIXTURE_ROOT = resolve(__dirname, '../../fixtures/simple-ngmodule-app');

const testFn = RUN_INTEGRATION ? describe : describe.skip;

testFn('Incremental update — simple-ngmodule-app', () => {
  let driver: Awaited<ReturnType<typeof createDriver>>;
  let dbName: string;
  let tmpRoot: string;

  beforeAll(async () => {
    // Work on a copy to avoid modifying the fixture
    tmpRoot = resolve(__dirname, '../../fixtures/simple-ngmodule-app-tmp');
    // Copy fixture files needed
    mkdirSync(resolve(tmpRoot, 'src/app'), { recursive: true });
    const srcApp = resolve(FIXTURE_ROOT, 'src/app');
    for (const file of ['app.component.ts', 'app.module.ts', 'user.service.ts',
      'user.component.ts', 'highlight.directive.ts', 'truncate.pipe.ts', 'app.routes.ts',
      'app-header.component.ts', 'app.component.html']) {
      copyFileSync(resolve(srcApp, file), resolve(tmpRoot, 'src/app', file));
    }
    writeFileSync(
      resolve(tmpRoot, 'angular.json'),
      readFileSync(resolve(FIXTURE_ROOT, 'angular.json'), 'utf-8'),
    );

    driver = await createDriver({
      url: process.env['NEO4J_URL'] ?? 'bolt://localhost:7687',
      user: process.env['NEO4J_USER'] ?? 'neo4j',
      password: process.env['NEO4J_PASSWORD'] ?? 'codegraph',
    });

    const app = discoverApp(tmpRoot);
    const fileSet = await collectFiles(tmpRoot);
    const irs: GraphIR[] = [];
    for (const tsFile of fileSet.tsFiles) {
      irs.push(extractTsFile(tsFile, readFileSync(tsFile, 'utf-8'), tmpRoot));
    }
    const stats = await fullIndex(driver, app, normalize(irs), tmpRoot);
    dbName = stats.databaseName;
  }, 60_000);

  afterAll(async () => {
    if (driver) await closeDriver(driver);
    try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('updates component selector after modification', async () => {
    const appCompPath = resolve(tmpRoot, 'src/app/app.component.ts');
    const original = readFileSync(appCompPath, 'utf-8');

    // Modify the selector
    const modified = original.replace("selector: 'app-root'", "selector: 'app-root-modified'");
    writeFileSync(appCompPath, modified);

    const app = discoverApp(tmpRoot);
    await processChanges(
      driver,
      app,
      { files: [{ path: 'src/app/app.component.ts', kind: 'modified' }], detectedAt: new Date() },
      tmpRoot,
    );

    const session = getSession(driver, dbName);
    try {
      const result = await session.run(
        "MATCH (c:Component {selector: 'app-root-modified'}) RETURN c",
      );
      expect(result.records.length).toBe(1);

      // Old selector should be gone
      const oldResult = await session.run(
        "MATCH (c:Component {selector: 'app-root'}) RETURN c",
      );
      expect(oldResult.records.length).toBe(0);
    } finally {
      await session.close();
    }
  });

  it('_IndexMeta remains complete after incremental update', async () => {
    const session = getSession(driver, dbName);
    try {
      const status = await getIndexMetaStatus(session);
      expect(status).toBe('complete');
    } finally {
      await session.close();
    }
  });
});
