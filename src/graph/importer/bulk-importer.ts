/**
 * BulkImporter — orchestrates a full graph index of an Angular application.
 *
 * Sequence:
 * 1. Dirty-state check → auto-wipe if indexing was interrupted
 * 2. Drop + recreate application database
 * 3. Apply schema (constraints + indexes)
 * 4. Write _IndexMeta {status: 'indexing'}
 * 5. Write all nodes in label batches
 * 6. Write all relationships in type batches
 * 7. Update _IndexMeta {status: 'complete'}
 */

import { Driver } from 'neo4j-driver';
import { AngularApp, GraphIR, IndexStats } from '../../core/types/graph-ir.js';
import {
  dropDatabase,
  createDatabase,
  setIndexMetaStatus,
  sanitizeDbName,
} from '../db/db-manager.js';
import { getSession } from '../db/connection.js';
import { applySchema } from '../schema/indexes.js';
import { writeNodes, writeRelationships } from '../writer/cypher-batch-writer.js';
import { logger } from '../../shared/logger.js';

export async function fullIndex(
  driver: Driver,
  app: AngularApp,
  ir: GraphIR,
  appRoot: string,
): Promise<IndexStats> {
  const startTime = Date.now();
  const dbName = sanitizeDbName(app.name, appRoot);

  logger.info('indexing_start', {
    appName: app.name,
    databaseName: dbName,
    nodeCount: ir.nodes.length,
    edgeCount: ir.relationships.length,
  });

  // Drop if exists, then recreate for a clean slate.
  await dropDatabase(driver, dbName);
  await createDatabase(driver, dbName);

  // 3. Apply schema (constraints + indexes)
  const schemaSession = getSession(driver, dbName);
  try {
    await applySchema(schemaSession);
  } finally {
    await schemaSession.close();
  }

  // 4. Mark indexing in-progress
  const writeSession = getSession(driver, dbName);
  try {
    await setIndexMetaStatus(writeSession, 'indexing');

    // 5. Write all nodes
    const nodeStats = await writeNodes(writeSession, ir.nodes);

    // 6. Write all relationships
    const relStats = await writeRelationships(writeSession, ir.relationships);

    // 7. Mark complete
    await setIndexMetaStatus(writeSession, 'complete');

    const duration = Date.now() - startTime;
    const stats: IndexStats = {
      nodeCount: nodeStats.written,
      edgeCount: relStats.written,
      fileCount: ir.nodes.filter((n) => n.label === 'File').length,
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
    await writeSession.close();
  }
}
