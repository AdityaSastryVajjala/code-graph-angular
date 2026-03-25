/**
 * get_impact_from_file — returns all nodes impacted by a change to a file.
 */

import { z } from 'zod';
import { Driver } from 'neo4j-driver';
import { getSession } from '../../graph/db/connection.js';
import { traverseFromFile } from '../../impact/traversal-engine.js';
import { buildImpactSummary, encodeCursor, decodeCursor, formatImpactItem } from '../cypher-helpers.js';

const InputSchema = z.object({
  appDb: z.string(),
  filePath: z.string(),
  depth: z.number().min(1).max(20).optional().default(5),
  includeTests: z.boolean().optional().default(false),
  projectId: z.string().optional(),
  summary: z.boolean().optional().default(true),
  pageSize: z.number().min(1).max(200).optional().default(50),
  cursor: z.string().optional(),
});

export async function getImpactFromFile(
  driver: Driver,
  input: Record<string, unknown>,
): Promise<unknown> {
  const params = InputSchema.parse(input);
  const session = getSession(driver, params.appDb);

  try {
    const results = await traverseFromFile(session, params.filePath, {
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
      sourceFile: params.filePath,
      items: pageItems.map((r) => formatImpactItem(r, params.summary)),
      summary,
      cursor,
      appDb: params.appDb,
    };
  } finally {
    await session.close();
  }
}
