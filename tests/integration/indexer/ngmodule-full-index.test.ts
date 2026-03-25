/**
 * Integration test — full index of simple-ngmodule-app against a live Neo4j instance.
 *
 * Requires:  NEO4J_URL, NEO4J_USER, NEO4J_PASSWORD env vars
 *            (or docker/neo4j.env defaults: bolt://localhost:7687 neo4j/codegraph)
 *
 * Skip condition: NEO4J_INTEGRATION=true must be set to run this test.
 */

import { resolve } from 'path';
import { readFileSync } from 'fs';
import { discoverApp } from '../../../src/core/discovery/project-discovery.js';
import { collectFiles } from '../../../src/core/collection/source-collector.js';
import { extractTsFile } from '../../../src/core/extraction/ts-extractor.js';
import { extractSpecFile } from '../../../src/core/extraction/spec-extractor.js';
import { normalize, buildSelectorMap } from '../../../src/core/normalization/angular-normalizer.js';
import { fullIndex } from '../../../src/graph/importer/bulk-importer.js';
import { createDriver, closeDriver, getSession } from '../../../src/graph/db/connection.js';
import { getIndexMetaStatus } from '../../../src/graph/db/db-manager.js';
import { GraphIR, NodeLabel } from '../../../src/core/types/graph-ir.js';

const RUN_INTEGRATION = process.env['NEO4J_INTEGRATION'] === 'true';
const FIXTURE_ROOT = resolve(__dirname, '../../fixtures/simple-ngmodule-app');

const testFn = RUN_INTEGRATION ? describe : describe.skip;

testFn('Full index — simple-ngmodule-app', () => {
  let driver: Awaited<ReturnType<typeof createDriver>>;
  let dbName: string;

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
      const source = readFileSync(tsFile, 'utf-8');
      irs.push(extractTsFile(tsFile, source, FIXTURE_ROOT));
    }

    for (const specFile of fileSet.specFiles) {
      const source = readFileSync(specFile, 'utf-8');
      irs.push(extractSpecFile(specFile, source, FIXTURE_ROOT));
    }

    const finalIr = normalize(irs);
    const stats = await fullIndex(driver, app, finalIr, FIXTURE_ROOT);
    dbName = stats.databaseName;
  }, 60_000);

  afterAll(async () => {
    if (driver) await closeDriver(driver);
  });

  it('_IndexMeta status is complete', async () => {
    const session = getSession(driver, dbName);
    try {
      const status = await getIndexMetaStatus(session);
      expect(status).toBe('complete');
    } finally {
      await session.close();
    }
  });

  it('has at least 1 Component node', async () => {
    const session = getSession(driver, dbName);
    try {
      const result = await session.run(
        `MATCH (n:${NodeLabel.Component}) RETURN count(n) AS count`,
      );
      const count = result.records[0].get('count').toInt();
      expect(count).toBeGreaterThanOrEqual(1);
    } finally {
      await session.close();
    }
  });

  it('has AppComponent with selector app-root', async () => {
    const session = getSession(driver, dbName);
    try {
      const result = await session.run(
        `MATCH (n:${NodeLabel.Component} {selector: 'app-root'}) RETURN n`,
      );
      expect(result.records.length).toBe(1);
    } finally {
      await session.close();
    }
  });

  it('has UserService with providedIn root', async () => {
    const session = getSession(driver, dbName);
    try {
      const result = await session.run(
        `MATCH (n:${NodeLabel.Service} {name: 'UserService'}) RETURN n.providedIn AS pi`,
      );
      expect(result.records[0]?.get('pi')).toBe('root');
    } finally {
      await session.close();
    }
  });

  it('has NgModule node for AppModule', async () => {
    const session = getSession(driver, dbName);
    try {
      const result = await session.run(
        `MATCH (n:${NodeLabel.NgModule} {name: 'AppModule'}) RETURN n`,
      );
      expect(result.records.length).toBe(1);
    } finally {
      await session.close();
    }
  });

  it('has SpecFile node for app.component.spec.ts', async () => {
    const session = getSession(driver, dbName);
    try {
      const result = await session.run(
        `MATCH (n:${NodeLabel.SpecFile}) WHERE n.filePath CONTAINS 'app.component.spec' RETURN n`,
      );
      expect(result.records.length).toBeGreaterThanOrEqual(1);
    } finally {
      await session.close();
    }
  });

  it('has StyleFile node for app.component.scss', async () => {
    const session = getSession(driver, dbName);
    try {
      const result = await session.run(
        `MATCH (n:${NodeLabel.StyleFile}) WHERE n.filePath CONTAINS 'app.component' RETURN n`,
      );
      expect(result.records.length).toBeGreaterThanOrEqual(1);
    } finally {
      await session.close();
    }
  });
});
