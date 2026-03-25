/**
 * MCP tool: get_module_structure
 * Get the full declaration/import/export structure of an NgModule.
 */

import { Driver } from 'neo4j-driver';
import { parseCursor, createPaginatedResponse } from '../server.js';
import {
  nodeToNgModuleSummary,
  nodeToComponentSummary,
  nodeToDirectiveSummary,
  nodeToPipeSummary,
  nodeToServiceSummary,
} from '../cypher-helpers.js';

export async function getModuleStructure(
  driver: Driver,
  input: Record<string, unknown>,
): Promise<unknown> {
  const appDb = input['appDb'] as string;
  const name = (input['name'] as string).trim();
  const detail = (input['detail'] as boolean | undefined) ?? false;
  const pageSize = Math.min((input['pageSize'] as number | undefined) ?? 20, 100);
  const skip = parseCursor(input['cursor'] as string | undefined);

  const session = driver.session({ database: appDb });
  try {
    const modResult = await session.run(
      'MATCH (m:NgModule) WHERE toLower(m.name) CONTAINS toLower($name) RETURN m ORDER BY m.name',
      { name },
    );

    const allItems = await Promise.all(
      modResult.records.map(async (r) => {
        const modProps = r.get('m').properties as Record<string, unknown>;
        const summary = nodeToNgModuleSummary(modProps);

        if (!detail) return summary;

        // Fetch module relationships
        const declResult = await session.run(
          'MATCH (m:NgModule {id: $id})-[:DECLARES]->(n) RETURN n, labels(n) AS lbls',
          { id: modProps['id'] },
        );
        const declares = declResult.records.map((dr) => {
          const props = dr.get('n').properties as Record<string, unknown>;
          const lbls = dr.get('lbls') as string[];
          if (lbls.includes('Component')) return nodeToComponentSummary(props);
          if (lbls.includes('Directive')) return nodeToDirectiveSummary(props);
          return nodeToPipeSummary(props);
        });

        const impResult = await session.run(
          'MATCH (m:NgModule {id: $id})-[:IMPORTS]->(n) RETURN n, labels(n) AS lbls',
          { id: modProps['id'] },
        );
        const imports = impResult.records.map((ir) => {
          const props = ir.get('n').properties as Record<string, unknown>;
          const lbls = ir.get('lbls') as string[];
          if (lbls.includes('Component')) return nodeToComponentSummary(props);
          return nodeToNgModuleSummary(props);
        });

        const expResult = await session.run(
          'MATCH (m:NgModule {id: $id})-[:EXPORTS]->(n) RETURN n, labels(n) AS lbls',
          { id: modProps['id'] },
        );
        const exports = expResult.records.map((er) => {
          const props = er.get('n').properties as Record<string, unknown>;
          const lbls = er.get('lbls') as string[];
          if (lbls.includes('Component')) return nodeToComponentSummary(props);
          if (lbls.includes('Directive')) return nodeToDirectiveSummary(props);
          if (lbls.includes('NgModule')) return nodeToNgModuleSummary(props);
          return nodeToPipeSummary(props);
        });

        const bootResult = await session.run(
          'MATCH (m:NgModule {id: $id})-[:BOOTSTRAPS]->(c:Component) RETURN c',
          { id: modProps['id'] },
        );
        const bootstrap = bootResult.records.map((br) =>
          nodeToComponentSummary(br.get('c').properties),
        );

        const prvResult = await session.run(
          'MATCH (m:NgModule {id: $id})-[:PROVIDES]->(s:Service) RETURN s',
          { id: modProps['id'] },
        );
        const providers = prvResult.records.map((pr) =>
          nodeToServiceSummary(pr.get('s').properties),
        );

        return { ...summary, declares, imports, exports, bootstrap, providers };
      }),
    );

    return createPaginatedResponse(allItems, pageSize, skip, appDb);
  } finally {
    await session.close();
  }
}
