/**
 * MCP tool: get_class_members
 * Returns the methods and properties of a Class node.
 */

import { Driver } from 'neo4j-driver';
import { parseCursor, createPaginatedResponse } from '../server.js';

export async function getClassMembers(
  driver: Driver,
  input: Record<string, unknown>,
): Promise<unknown> {
  const appDb = input['appDb'] as string;
  const className = (input['className'] as string | undefined)?.trim();
  const filePath = (input['filePath'] as string | undefined)?.trim();
  const detail = (input['detail'] as boolean | undefined) ?? false;
  const pageSize = Math.min((input['limit'] as number | undefined) ?? 20, 100);
  const skip = parseCursor(input['cursor'] as string | undefined);

  if (!className) {
    return { error: 'className is required', code: 'INVALID_INPUT' };
  }

  const params: Record<string, unknown> = { className };
  let matchClause = 'MATCH (c:Class {name: $className})';
  if (filePath) {
    matchClause = 'MATCH (c:Class {name: $className, sourceFile: $filePath})';
    params['filePath'] = filePath;
  }

  const session = driver.session({ database: appDb });
  try {
    const result = await session.run(
      `${matchClause}
       OPTIONAL MATCH (c)-[:HAS_METHOD]->(m:Method)
       OPTIONAL MATCH (c)-[:HAS_PROPERTY]->(p:Property)
       RETURN c, collect(DISTINCT m) AS methods, collect(DISTINCT p) AS properties`,
      params,
    );

    if (result.records.length === 0) {
      return { error: `Class '${className}' not found`, code: 'NOT_FOUND' };
    }

    const record = result.records[0];
    const classProps = record.get('c').properties as Record<string, unknown>;
    const rawMethods = record.get('methods') as Array<{ properties: Record<string, unknown> } | null>;
    const rawProps = record.get('properties') as Array<{ properties: Record<string, unknown> } | null>;

    const methods = rawMethods
      .filter((m) => m !== null)
      .map((m) => {
        const p = m!.properties;
        if (detail) {
          return { name: p['name'], isPublic: p['isPublic'], isStatic: p['isStatic'], returnType: p['returnType'] ?? null, className: p['className'] };
        }
        return { name: p['name'], isPublic: p['isPublic'], returnType: p['returnType'] ?? null };
      });

    const properties = rawProps
      .filter((p) => p !== null)
      .map((p) => {
        const props = p!.properties;
        if (detail) {
          return { name: props['name'], isPublic: props['isPublic'], isStatic: props['isStatic'], type: props['type'] ?? null, isInput: props['isInput'], isOutput: props['isOutput'], className: props['className'] };
        }
        return { name: props['name'], isPublic: props['isPublic'], type: props['type'] ?? null, isInput: props['isInput'], isOutput: props['isOutput'] };
      });

    const all = [...methods, ...properties];
    const paginated = createPaginatedResponse(all, pageSize, skip, appDb);

    return {
      class: {
        name: classProps['name'],
        filePath: classProps['sourceFile'],
        isAbstract: classProps['isAbstract'],
        isExported: classProps['isExported'],
      },
      methods: methods.slice(skip, skip + pageSize),
      properties: properties.slice(skip, skip + pageSize),
      cursor: paginated.cursor,
    };
  } finally {
    await session.close();
  }
}
