/**
 * MCP tool: find_service_usage
 * Find all components and services that inject a given service.
 */

import { Driver } from 'neo4j-driver';
import { parseCursor, createPaginatedResponse } from '../server.js';
import {
  nodeToServiceSummary,
  nodeToComponentSummary,
} from '../cypher-helpers.js';

export async function findServiceUsage(
  driver: Driver,
  input: Record<string, unknown>,
): Promise<unknown> {
  const appDb = input['appDb'] as string;
  const name = (input['name'] as string).trim();
  const pageSize = Math.min((input['pageSize'] as number | undefined) ?? 20, 100);
  const skip = parseCursor(input['cursor'] as string | undefined);

  const session = driver.session({ database: appDb });
  try {
    // Find matching services
    const svcResult = await session.run(
      'MATCH (s:Service) WHERE toLower(s.name) CONTAINS toLower($name) RETURN s ORDER BY s.name',
      { name },
    );

    const allItems = await Promise.all(
      svcResult.records.map(async (r) => {
        const svcProps = r.get('s').properties as Record<string, unknown>;
        const service = nodeToServiceSummary(svcProps);

        // Who injects this service?
        const consumersResult = await session.run(
          'MATCH (consumer)-[:INJECTS]->(s:Service {id: $id}) RETURN consumer, labels(consumer) AS lbls',
          { id: svcProps['id'] },
        );
        const usedByComponents = consumersResult.records
          .filter((cr) => (cr.get('lbls') as string[]).includes('Component'))
          .map((cr) => nodeToComponentSummary(cr.get('consumer').properties));
        const usedByServices = consumersResult.records
          .filter((cr) => (cr.get('lbls') as string[]).includes('Service'))
          .map((cr) => nodeToServiceSummary(cr.get('consumer').properties));

        return { service, usedByComponents, usedByServices };
      }),
    );

    return createPaginatedResponse(allItems, pageSize, skip, appDb);
  } finally {
    await session.close();
  }
}
