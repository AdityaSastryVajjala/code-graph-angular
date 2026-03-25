/**
 * ChangeProcessor — orchestrates an incremental graph update for a set of changed files.
 *
 * For each changed file:
 *   - deleted: DETACH DELETE all nodes with filePath = this path
 *   - added/modified: re-extract through the full extraction pipeline, write new nodes + rels
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Driver } from 'neo4j-driver';
import { AngularApp, ChangedFileSet, IncrementalStats } from '../core/types/graph-ir.js';
import { extractTsFile } from '../core/extraction/ts-extractor.js';
import { extractTemplate } from '../core/extraction/template-extractor.js';
import { extractSpecFile } from '../core/extraction/spec-extractor.js';
import { normalize, buildSelectorMap } from '../core/normalization/angular-normalizer.js';
import { writeNodes, writeRelationships } from '../graph/writer/cypher-batch-writer.js';
import { getSession } from '../graph/db/connection.js';
import { sanitizeDbName } from '../graph/db/db-manager.js';
import { logger } from '../shared/logger.js';

export async function processChanges(
  driver: Driver,
  app: AngularApp,
  changedFiles: ChangedFileSet,
  appRoot: string,
): Promise<IncrementalStats> {
  const startTime = Date.now();
  const dbName = sanitizeDbName(app.name, appRoot);
  const session = getSession(driver, dbName);

  let deltaNodes = 0;
  let deltaEdges = 0;

  try {
    // 1. Delete nodes for all changed files (deleted OR modified — will re-add modified)
    for (const file of changedFiles.files) {
      await session.run(
        'MATCH (n) WHERE n.filePath = $path DETACH DELETE n',
        { path: file.path },
      );
    }

    // 2. Re-extract added + modified files
    const irs = [];
    for (const file of changedFiles.files) {
      if (file.kind === 'deleted') continue;
      const absPath = resolve(appRoot, file.path);
      try {
        const source = readFileSync(absPath, 'utf-8');
        if (file.path.endsWith('.spec.ts')) {
          irs.push(extractSpecFile(absPath, source, appRoot));
        } else if (file.path.endsWith('.ts')) {
          irs.push(extractTsFile(absPath, source, appRoot));
        } else if (file.path.endsWith('.html')) {
          // For templates, we need the selector map — build from current DB state
          const selectorMap = await buildSelectorMapFromDb(driver, dbName);
          // Find owning component for this template
          const ownerResult = await session.run(
            'MATCH (c:Component) WHERE c.templatePath = $path RETURN c LIMIT 1',
            { path: file.path },
          );
          if (ownerResult.records.length > 0) {
            const ownerProps = ownerResult.records[0].get('c').properties as Record<string, unknown>;
            irs.push(
              await extractTemplate(
                source,
                file.path,
                ownerProps['id'] as string,
                ownerProps['filePath'] as string,
                selectorMap,
              ),
            );
          }
        }
      } catch (err) {
        logger.warn('incremental_extract_error', {
          filePath: file.path,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (irs.length > 0) {
      const merged = normalize(irs);
      const nodeStats = await writeNodes(session, merged.nodes);
      const relStats = await writeRelationships(session, merged.relationships);
      deltaNodes = nodeStats.written;
      deltaEdges = relStats.written;
    }

    const duration = Date.now() - startTime;
    const stats: IncrementalStats = {
      deltaNodes,
      deltaEdges,
      changedFileCount: changedFiles.files.length,
      duration,
    };

    logger.info('incremental_update', {
      appName: app.name,
      databaseName: dbName,
      deltaNodes,
      deltaEdges,
      changedFiles: changedFiles.files.length,
      durationMs: duration,
    });

    return stats;
  } finally {
    await session.close();
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function buildSelectorMapFromDb(
  driver: Driver,
  dbName: string,
): Promise<ReturnType<typeof buildSelectorMap>> {
  const session = getSession(driver, dbName);
  try {
    const result = await session.run(
      'MATCH (n) WHERE n:Component OR n:Directive OR n:Pipe RETURN n, labels(n) AS lbls',
    );
    const map = new Map<string, { nodeId: string; kind: 'component' | 'directive' }>();
    for (const record of result.records) {
      const props = record.get('n').properties as Record<string, unknown>;
      const lbls = record.get('lbls') as string[];
      if (lbls.includes('Component') && props['selector']) {
        map.set(props['selector'] as string, { nodeId: props['id'] as string, kind: 'component' });
      } else if (lbls.includes('Directive') && props['selector']) {
        map.set(props['selector'] as string, { nodeId: props['id'] as string, kind: 'directive' });
      } else if (lbls.includes('Pipe') && props['pipeName']) {
        map.set(props['pipeName'] as string, { nodeId: props['id'] as string, kind: 'directive' });
      }
    }
    return map;
  } finally {
    await session.close();
  }
}

