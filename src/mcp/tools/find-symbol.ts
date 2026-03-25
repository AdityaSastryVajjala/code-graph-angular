import { z } from 'zod';
import { Driver } from 'neo4j-driver';
import { getSession } from '../../graph/db/connection.js';
import { encodeCursor, decodeCursor } from '../cypher-helpers.js';

const InputSchema = z.object({
  appDb: z.string(),
  name: z.string(),
  kind: z.enum([
    'Component', 'Service', 'Directive', 'Pipe', 'Class',
    'Interface', 'Method', 'Property', 'InjectionToken', 'NgModule',
  ]).optional(),
  filePath: z.string().optional(),
  minimal: z.boolean().optional().default(true),
  pageSize: z.number().min(1).max(100).optional().default(20),
  cursor: z.string().optional(),
});

export async function findSymbol(
  driver: Driver,
  input: Record<string, unknown>,
): Promise<unknown> {
  const params = InputSchema.parse(input);
  const session = getSession(driver, params.appDb);

  try {
    let cypher: string;
    const queryParams: Record<string, unknown> = { name: params.name.toLowerCase() };

    if (params.kind) {
      cypher = `MATCH (n:${params.kind}) WHERE toLower(n.name) CONTAINS $name`;
    } else {
      cypher = `MATCH (n) WHERE (n:Component OR n:Service OR n:Directive OR n:Pipe OR n:Class OR n:Interface OR n:Method OR n:Property OR n:InjectionToken OR n:NgModule) AND toLower(n.name) CONTAINS $name`;
    }

    if (params.filePath) {
      cypher += ' AND (n.filePath = $filePath OR n.sourceFile = $filePath)';
      queryParams['filePath'] = params.filePath;
    }

    cypher += ` RETURN n.id AS id, [x IN labels(n) WHERE x <> '_IndexMeta'][0] AS label, n.name AS name, COALESCE(n.filePath, n.sourceFile, '') AS filePath ORDER BY n.name`;

    const result = await session.run(cypher, queryParams);

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
