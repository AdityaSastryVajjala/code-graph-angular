/**
 * MCP tool: trace_route
 * Trace a URL path to the component or module it loads.
 */

import { Driver } from 'neo4j-driver';
import {
  nodeToComponentSummary,
  nodeToNgModuleSummary,
  nodeToRouteSummary,
} from '../cypher-helpers.js';

export async function traceRoute(
  driver: Driver,
  input: Record<string, unknown>,
): Promise<unknown> {
  const appDb = input['appDb'] as string;
  const path = (input['path'] as string).replace(/^\//, ''); // normalize leading slash

  const session = driver.session({ database: appDb });
  try {
    // Try exact match first, then prefix match
    const routeResult = await session.run(
      `MATCH (r:Route)
       WHERE r.path = $path OR $path STARTS WITH r.path
       RETURN r ORDER BY size(r.path) DESC LIMIT 1`,
      { path },
    );

    if (routeResult.records.length === 0) {
      return { route: null, matchedPath: '', loadsComponent: null, loadsModule: null, ancestors: [], appDb };
    }

    const routeProps = routeResult.records[0].get('r').properties as Record<string, unknown>;
    const route = nodeToRouteSummary(routeProps);

    // Component loaded by this route
    const compResult = await session.run(
      'MATCH (r:Route {id: $id})-[:LOADS_COMPONENT]->(c:Component) RETURN c LIMIT 1',
      { id: routeProps['id'] },
    );
    const loadsComponent = compResult.records.length > 0
      ? nodeToComponentSummary(compResult.records[0].get('c').properties)
      : null;

    // Module loaded by this route
    const modResult = await session.run(
      'MATCH (r:Route {id: $id})-[:LOADS_MODULE]->(m:NgModule) RETURN m LIMIT 1',
      { id: routeProps['id'] },
    );
    const loadsModule = modResult.records.length > 0
      ? nodeToNgModuleSummary(modResult.records[0].get('m').properties)
      : null;

    // Ancestor routes (CHILD_OF chain)
    const ancestorResult = await session.run(
      `MATCH path = (r:Route {id: $id})-[:CHILD_OF*]->(ancestor:Route)
       RETURN ancestor ORDER BY length(path) ASC`,
      { id: routeProps['id'] },
    );
    const ancestors = ancestorResult.records.map((r) =>
      nodeToRouteSummary(r.get('ancestor').properties),
    );

    return {
      route: { ...route, loadsComponent, loadsModule, children: [], parent: ancestors[0] ?? null },
      matchedPath: routeProps['path'] as string,
      loadsComponent,
      loadsModule,
      ancestors,
      appDb,
    };
  } finally {
    await session.close();
  }
}
