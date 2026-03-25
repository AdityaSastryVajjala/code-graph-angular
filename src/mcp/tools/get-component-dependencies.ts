/**
 * MCP tool: get_component_dependencies
 * Get the full dependency tree for a specific component.
 */

import { Driver } from 'neo4j-driver';
import {
  nodeToComponentSummary,
  nodeToServiceSummary,
  nodeToDirectiveSummary,
  nodeToPipeSummary,
} from '../cypher-helpers.js';

export async function getComponentDependencies(
  driver: Driver,
  input: Record<string, unknown>,
): Promise<unknown> {
  const appDb = input['appDb'] as string;
  const componentId = input['componentId'] as string;
  const detail = (input['detail'] as boolean | undefined) ?? false;

  if (!componentId) {
    return { error: 'componentId is required', code: 'INVALID_INPUT' };
  }

  const session = driver.session({ database: appDb });
  try {
    // Fetch the component itself
    const compResult = await session.run(
      'MATCH (c:Component {id: $id}) RETURN c',
      { id: componentId },
    );
    if (compResult.records.length === 0) {
      return { error: 'Component not found', code: 'NOT_FOUND' };
    }
    const compProps = compResult.records[0].get('c').properties as Record<string, unknown>;
    const component = detail
      ? {
          ...nodeToComponentSummary(compProps),
          templateType: compProps['templateType'],
          templatePath: compProps['templatePath'] ?? null,
          changeDetection: compProps['changeDetection'] ?? null,
        }
      : nodeToComponentSummary(compProps);

    // Injected services
    const svcResult = await session.run(
      'MATCH (c:Component {id: $id})-[:INJECTS]->(s:Service) RETURN s',
      { id: componentId },
    );
    const injectedServices = svcResult.records.map((r) =>
      nodeToServiceSummary(r.get('s').properties),
    );

    // Used components
    const usedCompResult = await session.run(
      'MATCH (c:Component {id: $id})-[:USES_COMPONENT]->(cc:Component) RETURN cc',
      { id: componentId },
    );
    const usedComponents = usedCompResult.records.map((r) =>
      nodeToComponentSummary(r.get('cc').properties),
    );

    // Used directives
    const dirResult = await session.run(
      'MATCH (c:Component {id: $id})-[:USES_DIRECTIVE]->(d:Directive) RETURN d',
      { id: componentId },
    );
    const usedDirectives = dirResult.records.map((r) =>
      nodeToDirectiveSummary(r.get('d').properties),
    );

    // Used pipes
    const pipeResult = await session.run(
      'MATCH (c:Component {id: $id})-[:USES_PIPE]->(p:Pipe) RETURN p',
      { id: componentId },
    );
    const usedPipes = pipeResult.records.map((r) =>
      nodeToPipeSummary(r.get('p').properties),
    );

    return {
      component,
      injectedServices,
      usedComponents,
      usedDirectives,
      usedPipes,
      appDb,
    };
  } finally {
    await session.close();
  }
}
