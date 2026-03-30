/**
 * BulkImporter — orchestrates a full graph index of an Angular application
 * using neo4j-admin offline CSV import for maximum throughput.
 *
 * Sequence:
 * 1. Drop existing database while Neo4j is still running (clean catalog entry)
 * 2. Serialize GraphIR → CSV files (one per node label, one per rel type)
 * 3. Run `neo4j-admin database import full`:
 *    - stops the Docker container
 *    - removes stale transaction logs (prevents replay-revert on restart)
 *    - runs neo4j-admin in a one-shot container
 *    - restarts the Docker container
 * 4. Wait for Bolt to accept connections again after the restart
 * 5. Register the database with `CREATE DATABASE` + `START DATABASE`
 * 6. Wait for the database to come online
 * 7. Apply schema (constraints + indexes)
 * 8. Write _IndexMeta {status: 'complete'}
 * 9. Clean up temp CSV files
 */

import { randomBytes } from 'crypto';
import { rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Driver } from 'neo4j-driver';
import { AngularApp, GraphIR, IndexStats } from '../../core/types/graph-ir.js';
import {
  dropDatabase,
  createDatabase,
  setIndexMetaStatus,
  sanitizeDbName,
  waitForDatabaseOnline,
} from '../db/db-manager.js';
import { getSession } from '../db/connection.js';
import { applySchema } from '../schema/indexes.js';
import { writeGraphIrToCsv } from '../writer/csv-writer.js';
import { runNeo4jAdminImport, AdminImportOptions } from './admin-import-runner.js';
import { logger } from '../../shared/logger.js';

export interface BulkImportOptions extends AdminImportOptions {
  /**
   * Directory to write temporary CSV files.
   * Defaults to a unique subdirectory under `os.tmpdir()`.
   * When provided, the directory is NOT deleted after the import
   * (useful for debugging or pre-staging CSVs).
   */
  csvOutputDir?: string;
}

/**
 * Poll until the Bolt connection is available again after the Docker container
 * restarts.  `docker start` returns before the Bolt port is ready, so we must
 * wait explicitly before issuing any Cypher commands.
 */
async function waitForNeo4jReady(driver: Driver, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  let lastLogAt = 0;
  while (Date.now() < deadline) {
    try {
      await driver.verifyConnectivity();
      return;
    } catch (err) {
      lastError = err;
      const now = Date.now();
      if (now - lastLogAt >= 5_000) {
        logger.info('waiting_for_neo4j_ready', { remaining: Math.round((deadline - now) / 1000) });
        lastLogAt = now;
      }
      await new Promise<void>(resolve => setTimeout(resolve, 1_000));
    }
  }
  throw new Error(`Neo4j did not become available within ${timeoutMs}ms: ${lastError}`);
}

export async function fullIndex(
  driver: Driver,
  app: AngularApp,
  ir: GraphIR,
  appRoot: string,
  options: BulkImportOptions = {},
): Promise<IndexStats> {
  const startTime = Date.now();
  const dbName = sanitizeDbName(app.name, appRoot);
  const { csvOutputDir, ...adminOptions } = options;

  logger.info('indexing_start', {
    appName: app.name,
    databaseName: dbName,
    nodeCount: ir.nodes.length,
    edgeCount: ir.relationships.length,
  });

  // 1. Drop the existing database while Bolt is still available.
  //    This cleans up the catalog entry before we stop the container.
  await dropDatabase(driver, dbName);

  // Determine temp directory (auto-generated if not supplied by caller)
  const autoGenDir = !csvOutputDir;
  const sessionDir = csvOutputDir ?? join(tmpdir(), `cgraph-${randomBytes(4).toString('hex')}`);

  try {
    // 2. Serialize GraphIR to CSV
    const manifest = writeGraphIrToCsv(ir.nodes, ir.relationships, sessionDir);

    // 3. neo4j-admin offline import.
    //    Stops the Docker container, clears stale tx logs, runs the import in
    //    a one-shot container, then restarts the Docker container.
    runNeo4jAdminImport(dbName, manifest, adminOptions);

    // 4. Wait for Bolt to accept connections again after the container restart.
    await waitForNeo4jReady(driver);

    // 5. Register + start the newly created store.
    //    CREATE DATABASE registers the neo4j-admin store; START DATABASE is
    //    required because Neo4j detects the pre-existing store files and leaves
    //    the database in `offline` state rather than auto-starting it.
    await createDatabase(driver, dbName);

    // 6. Wait for Neo4j to bring it online
    await waitForDatabaseOnline(driver, dbName);

    // 7. Apply schema (constraints + indexes)
    const schemaSession = getSession(driver, dbName);
    try {
      await applySchema(schemaSession);
    } finally {
      await schemaSession.close();
    }

    // 8. Mark indexing complete
    const metaSession = getSession(driver, dbName);
    try {
      await setIndexMetaStatus(metaSession, 'complete');
    } finally {
      await metaSession.close();
    }

    const duration = Date.now() - startTime;
    const stats: IndexStats = {
      nodeCount: ir.nodes.length,
      edgeCount: ir.relationships.length,
      fileCount: ir.nodes.filter(n => n.label === 'File').length,
      duration,
      databaseName: dbName,
    };

    logger.info('indexing_complete', {
      appName: app.name,
      databaseName: dbName,
      nodeCount: stats.nodeCount,
      edgeCount: stats.edgeCount,
      fileCount: stats.fileCount,
      durationMs: duration,
    });

    return stats;
  } finally {
    // 9. Clean up auto-generated temp CSVs (skip if caller owns the dir)
    if (autoGenDir) {
      rmSync(sessionDir, { recursive: true, force: true });
    }
  }
}
