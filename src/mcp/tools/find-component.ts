/**
 * MCP tool: find_component
 * Find Angular components by name or selector.
 */

import { Driver } from 'neo4j-driver';
import { parseCursor, createPaginatedResponse } from '../server.js';
import { nodeToComponentSummary } from '../cypher-helpers.js';

export async function findComponent(
  driver: Driver,
  input: Record<string, unknown>,
): Promise<unknown> {
  const appDb = input['appDb'] as string;
  const name = (input['name'] as string | undefined)?.trim();
  const selector = (input['selector'] as string | undefined)?.trim();
  const isStandalone = input['isStandalone'] as boolean | undefined;
  const detail = (input['detail'] as boolean | undefined) ?? false;
  const pageSize = Math.min((input['pageSize'] as number | undefined) ?? 20, 100);
  const skip = parseCursor(input['cursor'] as string | undefined);

  if (!name && !selector) {
    return { error: 'At least one of name or selector must be provided', code: 'INVALID_INPUT' };
  }

  const conditions: string[] = [];
  const params: Record<string, unknown> = {};

  if (name) {
    conditions.push('toLower(c.name) CONTAINS toLower($name)');
    params['name'] = name;
  }
  if (selector) {
    conditions.push('c.selector CONTAINS $selector');
    params['selector'] = selector;
  }
  if (isStandalone !== undefined) {
    conditions.push('c.isStandalone = $isStandalone');
    params['isStandalone'] = isStandalone;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' OR ')}` : '';
  const cypher = `MATCH (c:Component) ${whereClause} RETURN c ORDER BY c.name`;

  const session = driver.session({ database: appDb });
  try {
    const result = await session.run(cypher, params);
    const allComponents = result.records.map((r) => {
      const props = r.get('c').properties as Record<string, unknown>;
      if (!detail) return nodeToComponentSummary(props);
      return {
        ...nodeToComponentSummary(props),
        templateType: props['templateType'],
        templatePath: props['templatePath'] ?? null,
        changeDetection: props['changeDetection'] ?? null,
        styleFiles: [],
        hostBindings: (props['hostBindings'] as string[]) ?? [],
        injectedServices: [],
        usedComponents: [],
        usedDirectives: [],
        usedPipes: [],
        declaredInModule: null,
        specFiles: [],
      };
    });

    return createPaginatedResponse(allComponents, pageSize, skip, appDb);
  } finally {
    await session.close();
  }
}
