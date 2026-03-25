/**
 * DbManager — database lifecycle management.
 *
 * Responsibilities:
 * - Create / drop application databases
 * - Track indexing state via _IndexMeta node
 * - Sanitize and unique-ify database names
 */

import { createHash } from 'crypto';
import { Driver, Session } from 'neo4j-driver';
import { IndexMetaStatus } from '../../core/types/graph-ir.js';

const INDEXER_VERSION = '0.1.0';

// ─── Database Naming ──────────────────────────────────────────────────────────

/**
 * Produce a valid Neo4j database name from an app name + root path.
 * Rules: lowercase, [a-z0-9_-] only, max 63 chars, starts with letter.
 * Appends an 8-char hash of rootPath for uniqueness.
 */
export function sanitizeDbName(appName: string, rootPath: string): string {
  const pathHash = createHash('sha256').update(rootPath).digest('hex').slice(0, 8);
  const base = appName
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_')
    .replace(/^[^a-z]+/, '') // must start with letter
    .slice(0, 40)
    || 'app';
  return `${base}-${pathHash}`;
}

// ─── Database Lifecycle ───────────────────────────────────────────────────────


export async function createDatabase(driver: Driver, name: string): Promise<void> {
  const session = driver.session({ database: 'system' });
  try {
    await session.run(`CREATE DATABASE \`${name}\` IF NOT EXISTS`);
  } finally {
    await session.close();
  }
}

export async function dropDatabase(driver: Driver, name: string): Promise<void> {
  const session = driver.session({ database: 'system' });
  try {
    await session.run(`DROP DATABASE \`${name}\` IF EXISTS`);
  } finally {
    await session.close();
  }
}

// ─── IndexMeta ────────────────────────────────────────────────────────────────

export async function getIndexMetaStatus(session: Session): Promise<IndexMetaStatus> {
  const result = await session.run(
    'MATCH (m:_IndexMeta) RETURN m.status AS status LIMIT 1',
  );
  if (result.records.length === 0) return 'absent';
  return result.records[0].get('status') as IndexMetaStatus;
}

export async function setIndexMetaStatus(
  session: Session,
  status: 'indexing' | 'complete',
): Promise<void> {
  const now = new Date().toISOString();
  if (status === 'indexing') {
    await session.run(
      `MERGE (m:_IndexMeta)
       SET m.status = 'indexing', m.startedAt = $now, m.indexerVersion = $version
       REMOVE m.completedAt`,
      { now, version: INDEXER_VERSION },
    );
  } else {
    await session.run(
      `MERGE (m:_IndexMeta)
       SET m.status = 'complete', m.completedAt = $now`,
      { now },
    );
  }
}

