import { z } from 'zod';
import { Driver } from 'neo4j-driver';
import { getSession } from '../../graph/db/connection.js';
import { encodeCursor, decodeCursor } from '../cypher-helpers.js';

const InputSchema = z.object({
  appDb: z.string(),
  symbolId: z.string(),
  minimal: z.boolean().optional().default(true),
  pageSize: z.number().min(1).max(100).optional().default(20),
  cursor: z.string().optional(),
});

export async function getInjections(
  driver: Driver,
  input: Record<string, unknown>,
): Promise<unknown> {
  const params = InputSchema.parse(input);
  const session = getSession(driver, params.appDb);

  try {
    const result = await session.run(
      `MATCH (injector)-[:INJECTS]->(s {id: $symbolId})
       RETURN
         injector.id AS id,
         [x IN labels(injector) WHERE x <> '_IndexMeta'][0] AS label,
         COALESCE(injector.name, injector.id) AS name,
         COALESCE(injector.filePath, injector.sourceFile, '') AS filePath
       ORDER BY injector.name`,
      { symbolId: params.symbolId },
    );

    const allItems = result.records.map((r) => ({
      id: r.get('id') as string,
      label: r.get('label') as string,
      name: r.get('name') as string,
      filePath: r.get('filePath') as string,
    }));

    const skip = decodeCursor(params.cursor);
    const pageSize = params.pageSize;
    const total = allItems.length;
    const pageItems = allItems.slice(skip, skip + pageSize);
    const nextSkip = skip + pageSize;
    const cursor = nextSkip < total ? encodeCursor(nextSkip) : null;

    return { items: pageItems, cursor, total, appDb: params.appDb };
  } finally {
    await session.close();
  }
}
