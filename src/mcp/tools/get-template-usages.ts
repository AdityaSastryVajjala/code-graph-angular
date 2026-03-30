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

export async function getTemplateUsages(
  driver: Driver,
  input: Record<string, unknown>,
): Promise<unknown> {
  const params = InputSchema.parse(input);
  const session = getSession(driver, params.appDb);

  try {
    const result = await session.run(
      `MATCH (t:Template)-[r:TEMPLATE_BINDS_PROPERTY|TEMPLATE_BINDS_EVENT|TEMPLATE_TWO_WAY_BINDS|TEMPLATE_USES_DIRECTIVE|TEMPLATE_USES_PIPE|USES_COMPONENT|USES_PIPE]->(s {id: $symbolId})
       RETURN
         t.id AS templateId,
         t.componentName AS componentName,
         COALESCE(t.templatePath, t.sourceFile, '') AS templateFile,
         COALESCE(r.bindingType, r.usageType, 'selector') AS bindingType,
         COALESCE(r.confidence, 'best-effort') AS confidence
       ORDER BY templateId`,
      { symbolId: params.symbolId },
    );

    const allItems = result.records.map((r) => ({
      templateId: r.get('templateId') as string,
      componentName: r.get('componentName') as string,
      templateFile: r.get('templateFile') as string,
      bindingType: r.get('bindingType') as string,
      confidence: r.get('confidence') as string,
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
