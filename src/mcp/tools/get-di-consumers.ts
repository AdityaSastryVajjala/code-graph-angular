/**
 * MCP tool: get_di_consumers
 * Returns all classes that inject a given service or InjectionToken.
 */

import { Driver } from 'neo4j-driver';
import { parseCursor } from '../server.js';

export async function getDiConsumers(
  driver: Driver,
  input: Record<string, unknown>,
): Promise<unknown> {
  const appDb = input['appDb'] as string;
  const serviceName = (input['serviceName'] as string | undefined)?.trim();
  const pageSize = Math.min((input['limit'] as number | undefined) ?? 20, 100);
  const skip = parseCursor(input['cursor'] as string | undefined);

  if (!serviceName) {
    return { error: 'serviceName is required', code: 'INVALID_INPUT' };
  }

  const session = driver.session({ database: appDb });
  try {
    const result = await session.run(
      `MATCH (consumer)-[r:INJECTS]->(target)
       WHERE target.name = $serviceName
       RETURN consumer, labels(consumer) AS lbls, r.via AS via
       ORDER BY consumer.name
       SKIP $skip LIMIT $limit`,
      { serviceName, skip, limit: pageSize },
    );

    const consumers = result.records.map((r) => {
      const props = r.get('consumer').properties as Record<string, unknown>;
      const lbls = r.get('lbls') as string[];
      const kind = lbls.includes('Component')
        ? 'Component'
        : lbls.includes('Service')
        ? 'Service'
        : lbls.includes('Class')
        ? 'Class'
        : 'Unknown';
      return {
        name: props['name'],
        kind,
        filePath: props['filePath'] ?? props['sourceFile'] ?? null,
        via: r.get('via'),
      };
    });

    const countResult = await session.run(
      `MATCH (consumer)-[:INJECTS]->(target {name: $serviceName})
       RETURN count(consumer) AS total`,
      { serviceName },
    );
    const total = (countResult.records[0]?.get('total') as { toNumber?: () => number } | number | undefined);
    const totalCount = typeof total === 'object' && total?.toNumber ? total.toNumber() : Number(total ?? 0);
    const hasMore = skip + pageSize < totalCount;

    return {
      service: serviceName,
      consumers,
      cursor: hasMore ? String(skip + pageSize) : null,
    };
  } finally {
    await session.close();
  }
}
