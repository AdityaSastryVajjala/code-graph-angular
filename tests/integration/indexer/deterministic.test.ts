/**
 * Integration test — re-index idempotency.
 * Indexes simple-ngmodule-app twice and asserts identical results.
 *
 * Requires: NEO4J_INTEGRATION=true
 */

import { resolve } from 'path';
import { readFileSync } from 'fs';
import { discoverApp } from '../../../src/core/discovery/project-discovery.js';
import { collectFiles } from '../../../src/core/collection/source-collector.js';
import { extractTsFile } from '../../../src/core/extraction/ts-extractor.js';
import { extractSpecFile } from '../../../src/core/extraction/spec-extractor.js';
import { normalize } from '../../../src/core/normalization/angular-normalizer.js';
import { fullIndex } from '../../../src/graph/importer/bulk-importer.js';
import { createDriver, closeDriver, getSession } from '../../../src/graph/db/connection.js';
import { getIndexMetaStatus } from '../../../src/graph/db/db-manager.js';
import { GraphIR } from '../../../src/core/types/graph-ir.js';

const RUN_INTEGRATION = process.env['NEO4J_INTEGRATION'] === 'true';
const FIXTURE_ROOT = resolve(__dirname, '../../fixtures/simple-ngmodule-app');

const testFn = RUN_INTEGRATION ? describe : describe.skip;

testFn('Re-index idempotency — simple-ngmodule-app', () => {
  let driver: Awaited<ReturnType<typeof createDriver>>;

  async function doIndex(): Promise<{ dbName: string; nodeIds: string[]; relIds: string[] }> {
    const app = discoverApp(FIXTURE_ROOT);
    const fileSet = await collectFiles(FIXTURE_ROOT);
    const irs: GraphIR[] = [];
    for (const tsFile of fileSet.tsFiles) {
      irs.push(extractTsFile(tsFile, readFileSync(tsFile, 'utf-8'), FIXTURE_ROOT));
    }
    for (const specFile of fileSet.specFiles) {
      irs.push(extractSpecFile(specFile, readFileSync(specFile, 'utf-8'), FIXTURE_ROOT));
    }
    const stats = await fullIndex(driver, app, normalize(irs), FIXTURE_ROOT);

    const session = getSession(driver, stats.databaseName);
    try {
      const nodeResult = await session.run('MATCH (n) WHERE NOT n:_IndexMeta RETURN n.id AS id ORDER BY n.id');
      const relResult = await session.run('MATCH ()-[r]->() RETURN r.id AS id ORDER BY r.id');
      return {
        dbName: stats.databaseName,
        nodeIds: nodeResult.records.map((r) => r.get('id')),
        relIds: relResult.records.map((r) => r.get('id')),
      };
    } finally {
      await session.close();
    }
  }

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

  it('produces identical node IDs and counts on two consecutive runs', async () => {
    const run1 = await doIndex();
    const run2 = await doIndex();

    expect(run1.dbName).toBe(run2.dbName);
    expect(run1.nodeIds).toEqual(run2.nodeIds);
    expect(run1.relIds).toEqual(run2.relIds);
  }, 120_000);

  it('_IndexMeta status is complete after both runs', async () => {
    const { dbName } = await doIndex();
    const session = getSession(driver, dbName);
    try {
      expect(await getIndexMetaStatus(session)).toBe('complete');
    } finally {
      await session.close();
    }
  }, 60_000);
});
