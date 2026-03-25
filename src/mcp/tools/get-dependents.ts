/**
 * get_dependents — find all nodes that depend on a given symbol (inbound edges).
 */

import { z } from 'zod';
import { Driver } from 'neo4j-driver';
import { getSession } from '../../graph/db/connection.js';
import { traverseFromSymbol } from '../../impact/traversal-engine.js';
import { encodeCursor, decodeCursor } from '../cypher-helpers.js';

const InputSchema = z.object({
  appDb: z.string(),
  symbolId: z.string(),
  depth: z.number().min(1).max(20).optional().default(3),
  edgeKinds: z.array(z.string()).optional(),
  projectId: z.string().optional(),
  includeTests: z.boolean().optional().default(false),
  minimal: z.boolean().optional().default(true),
  pageSize: z.number().min(1).max(100).optional().default(20),
  cursor: z.string().optional(),
});

export async function getDependents(
  driver: Driver,
  input: Record<string, unknown>,
): Promise<unknown> {
  const params = InputSchema.parse(input);
  const session = getSession(driver, params.appDb);

  try {
    const results = await traverseFromSymbol(session, params.symbolId, {
      maxDepth: params.depth,
      edgeKinds: params.edgeKinds,
      projectId: params.projectId,
      includeTests: params.includeTests,
    });

    const skip = decodeCursor(params.cursor);
    const pageSize = params.pageSize;
    const total = results.length;
    const pageItems = results.slice(skip, skip + pageSize);
    const nextSkip = skip + pageSize;
    const cursor = nextSkip < total ? encodeCursor(nextSkip) : null;

    return {
      items: pageItems.map((r) => {
        const item: Record<string, unknown> = {
          id: r.nodeId,
          label: r.nodeLabel,
          name: r.nodeName,
          filePath: r.filePath,
          impactClass: r.impactClass,
          depth: r.depth,
        };
        if (!params.minimal) {
          item['edgeChain'] = r.edgeChain;
        }
        return item;
      }),
      cursor,
      total,
      appDb: params.appDb,
    };
  } finally {
    await session.close();
  }
}
