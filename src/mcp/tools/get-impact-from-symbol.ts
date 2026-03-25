/**
 * get_impact_from_symbol — returns all nodes impacted by a change to a symbol.
 */

import { z } from 'zod';
import { Driver } from 'neo4j-driver';
import { getSession } from '../../graph/db/connection.js';
import { traverseFromSymbol } from '../../impact/traversal-engine.js';
import { buildImpactSummary, encodeCursor, decodeCursor, formatImpactItem } from '../cypher-helpers.js';

const InputSchema = z.object({
  appDb: z.string(),
  symbolId: z.string(),
  depth: z.number().min(1).max(20).optional().default(5),
  includeTests: z.boolean().optional().default(false),
  projectId: z.string().optional(),
  summary: z.boolean().optional().default(true),
  pageSize: z.number().min(1).max(200).optional().default(50),
  cursor: z.string().optional(),
});

export async function getImpactFromSymbol(
  driver: Driver,
  input: Record<string, unknown>,
): Promise<unknown> {
  const params = InputSchema.parse(input);
  const session = getSession(driver, params.appDb);

  try {
    // Get source symbol info
    const symbolResult = await session.run(
      `MATCH (n {id: $id})
       RETURN
         n.id AS id,
         [x IN labels(n) WHERE x <> '_IndexMeta'][0] AS label,
         COALESCE(n.name, n.id) AS name,
         COALESCE(n.filePath, n.sourceFile, '') AS filePath`,
      { id: params.symbolId },
    );

    const sourceSymbol = symbolResult.records.length > 0
      ? {
          id: symbolResult.records[0].get('id') as string,
          label: symbolResult.records[0].get('label') as string,
          name: symbolResult.records[0].get('name') as string,
          filePath: symbolResult.records[0].get('filePath') as string,
        }
      : { id: params.symbolId, label: 'Unknown', name: params.symbolId, filePath: '' };

    const results = await traverseFromSymbol(session, params.symbolId, {
      maxDepth: params.depth,
      includeTests: params.includeTests,
      projectId: params.projectId,
      summaryMode: params.summary,
    });

    const summary = buildImpactSummary(results);
    const skip = decodeCursor(params.cursor);
    const pageSize = params.pageSize;
    const pageItems = results.slice(skip, skip + pageSize);
    const nextSkip = skip + pageSize;
    const cursor = nextSkip < results.length ? encodeCursor(nextSkip) : null;

    return {
      sourceSymbol,
      items: pageItems.map((r) => formatImpactItem(r, params.summary)),
      summary,
      cursor,
      appDb: params.appDb,
    };
  } finally {
    await session.close();
  }
}
