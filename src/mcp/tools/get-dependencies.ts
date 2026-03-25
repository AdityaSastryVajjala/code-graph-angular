/**
 * get_dependencies — find all nodes that a given symbol depends on (outbound edges).
 */

import { z } from 'zod';
import { Driver } from 'neo4j-driver';
import { getSession } from '../../graph/db/connection.js';
import { ELIGIBLE_EDGE_TYPES } from '../../impact/traversal-options.js';
import { encodeCursor, decodeCursor } from '../cypher-helpers.js';

const InputSchema = z.object({
  appDb: z.string(),
  symbolId: z.string(),
  depth: z.number().min(1).max(20).optional().default(3),
  edgeKinds: z.array(z.string()).optional(),
  projectId: z.string().optional(),
  minimal: z.boolean().optional().default(true),
  pageSize: z.number().min(1).max(100).optional().default(20),
  cursor: z.string().optional(),
});

export async function getDependencies(
  driver: Driver,
  input: Record<string, unknown>,
): Promise<unknown> {
  const params = InputSchema.parse(input);
  const session = getSession(driver, params.appDb);

  try {
    const edgeTypes = params.edgeKinds ?? ELIGIBLE_EDGE_TYPES;
    const maxDepth = Math.min(params.depth, 20);

    // BFS traversal in outbound direction
    const visited = new Set<string>([params.symbolId]);
    type QueueEntry = { id: string; depth: number; chain: string[] };
    let queue: QueueEntry[] = [{ id: params.symbolId, depth: 0, chain: [] }];
    const results: Array<{
      nodeId: string;
      nodeLabel: string;
      nodeName: string;
      filePath: string;
      depth: number;
      edgeChain: string[];
    }> = [];

    while (queue.length > 0) {
      const currentBatch = queue;
      queue = [];
      const currentIds = currentBatch.map((e) => e.id);

      const result = await session.run(
        `UNWIND $nodeIds AS nodeId
         MATCH (node) WHERE node.id = nodeId
         MATCH (node)-[r]->(dep)
         WHERE type(r) IN $edgeTypes
         RETURN
           nodeId AS fromId,
           type(r) AS edgeType,
           dep.id AS depId,
           [x IN labels(dep) WHERE x <> '_IndexMeta'][0] AS depLabel,
           COALESCE(dep.name, dep.path, dep.filePath, dep.id) AS depName,
           COALESCE(dep.filePath, dep.sourceFile, '') AS depFilePath
        `,
        { nodeIds: currentIds, edgeTypes },
      );

      for (const record of result.records) {
        const depId = record.get('depId') as string;
        if (visited.has(depId)) continue;
        visited.add(depId);

        const fromId = record.get('fromId') as string;
        const edgeType = record.get('edgeType') as string;
        const parentEntry = currentBatch.find((e) => e.id === fromId);
        const parentChain = parentEntry ? parentEntry.chain : [];
        const newChain = [...parentChain, edgeType];
        const newDepth = parentEntry ? parentEntry.depth + 1 : 1;

        if (newDepth > maxDepth) continue;

        results.push({
          nodeId: depId,
          nodeLabel: record.get('depLabel') as string ?? 'Unknown',
          nodeName: record.get('depName') as string ?? depId,
          filePath: record.get('depFilePath') as string ?? '',
          depth: newDepth,
          edgeChain: newChain,
        });

        if (newDepth < maxDepth) {
          queue.push({ id: depId, depth: newDepth, chain: newChain });
        }
      }
    }

    // Apply projectId filter if specified
    let filteredResults = results;
    if (params.projectId) {
      const ids = results.map((r) => r.nodeId);
      if (ids.length > 0) {
        const projResult = await session.run(
          `UNWIND $ids AS nodeId
           MATCH (n {id: nodeId})-[:BELONGS_TO_PROJECT]->(p:Project {id: $projectId})
           RETURN collect(n.id) AS validIds`,
          { ids, projectId: params.projectId },
        );
        const validIds = new Set<string>(
          projResult.records.length > 0
            ? (projResult.records[0].get('validIds') as string[])
            : [],
        );
        filteredResults = results.filter((r) => validIds.has(r.nodeId));
      }
    }

    const skip = decodeCursor(params.cursor);
    const pageSize = params.pageSize;
    const total = filteredResults.length;
    const pageItems = filteredResults.slice(skip, skip + pageSize);
    const nextSkip = skip + pageSize;
    const cursor = nextSkip < total ? encodeCursor(nextSkip) : null;

    return {
      items: pageItems.map((r) => {
        const item: Record<string, unknown> = {
          id: r.nodeId,
          label: r.nodeLabel,
          name: r.nodeName,
          filePath: r.filePath,
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
