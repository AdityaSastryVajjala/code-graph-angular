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
import { logger } from '../../shared/logger.js';

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
    // After a neo4j-admin import, Neo4j registers the database in `offline`
    // state because it detects pre-existing store files.  START DATABASE is
    // idempotent (no-op if already online) so it is safe to call always.
    await session.run(`START DATABASE \`${name}\``);
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

/**
 * Poll the system database until `name` reports `currentStatus = 'online'`.
 * Uses `SHOW DATABASE \`name\`` (singular) which targets one specific DB and
 * avoids the WHERE-after-YIELD ordering issues of `SHOW DATABASES`.
 * Throws if the database does not come online within `timeoutMs` milliseconds.
 */
export async function waitForDatabaseOnline(
  driver: Driver,
  name: string,
  timeoutMs = 60_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const session = driver.session({ database: 'system' });
  let lastStatus: string | undefined;
  let lastLogAt = 0;
  try {
    while (Date.now() < deadline) {
      // `name` is already sanitized ([a-z0-9_-]) — interpolation is safe.
      const result = await session.run(`SHOW DATABASE \`${name}\``);
      const status = result.records[0]?.get('currentStatus') as string | undefined;
      if (status === 'online') return;

      // Log status changes and periodic heartbeats (every 5s) for visibility
      const now = Date.now();
      if (status !== lastStatus || now - lastLogAt >= 5_000) {
        logger.info('waiting_for_database', { name, currentStatus: status ?? 'not found' });
        lastStatus = status;
        lastLogAt = now;
      }

      await new Promise<void>(resolve => setTimeout(resolve, 500));
    }
    throw new Error(
      `Database '${name}' did not come online within ${timeoutMs}ms (last status: ${lastStatus ?? 'not found'})`,
    );
  } finally {
    await session.close();
  }
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

