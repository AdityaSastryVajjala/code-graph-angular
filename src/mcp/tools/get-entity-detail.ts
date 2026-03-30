/**
 * MCP tool: get_entity_detail
 * Fetch full detail for any graph entity by ID and type.
 */

import { Driver } from 'neo4j-driver';
import {
  nodeToComponentSummary,
  nodeToServiceSummary,
  nodeToDirectiveSummary,
  nodeToPipeSummary,
  nodeToNgModuleSummary,
  nodeToRouteSummary,
} from '../cypher-helpers.js';

type EntityType = 'Component' | 'Service' | 'NgModule' | 'Directive' | 'Pipe' | 'Route' | 'Class';

export async function getEntityDetail(
  driver: Driver,
  input: Record<string, unknown>,
): Promise<unknown> {
  const appDb = input['appDb'] as string;
  const entityId = input['entityId'] as string;
  const entityType = input['entityType'] as EntityType;

  const session = driver.session({ database: appDb });
  try {
    const result = await session.run(
      `MATCH (n:${entityType} {id: $id}) RETURN n LIMIT 1`,
      { id: entityId },
    );

    if (result.records.length === 0) {
      return { error: `${entityType} not found`, code: 'NOT_FOUND' };
    }

    const props = result.records[0].get('n').properties as Record<string, unknown>;

    switch (entityType) {
      case 'Component': {
        // Phase 2: methods, properties, template binding count, test coverage
        const classResult = await session.run(
          'MATCH (cls:Class) WHERE cls.sourceFile = (MATCH (c:Component {id: $id}) RETURN c.filePath LIMIT 1) AND cls.name = (MATCH (c:Component {id: $id}) RETURN c.name LIMIT 1) RETURN cls LIMIT 1',
          { id: entityId },
        );
        const methodsResult = await session.run(
          'MATCH (c:Component {id: $id})<-[:BELONGS_TO_FILE]-(f:File)<-[:DECLARES_SYMBOL]-(cls:Class)-[:HAS_METHOD]->(m:Method) RETURN m ORDER BY m.name',
          { id: entityId },
        );
        const propsResult = await session.run(
          'MATCH (c:Component {id: $id})<-[:BELONGS_TO_FILE]-(f:File)<-[:DECLARES_SYMBOL]-(cls:Class)-[:HAS_PROPERTY]->(p:Property) RETURN p ORDER BY p.name',
          { id: entityId },
        );
        const bindingCountResult = await session.run(
          'MATCH (c:Component {id: $id})-[:USES_TEMPLATE]->(t:Template)-[:BINDS_TO]->() RETURN count(*) AS bindingCount',
          { id: entityId },
        );
        void classResult; // reserved for future use

        // Enrich with related nodes
        const svcResult = await session.run(
          'MATCH (c:Component {id: $id})-[:INJECTS]->(s:Service) RETURN s',
          { id: entityId },
        );
        const usedCompResult = await session.run(
          'MATCH (c:Component {id: $id})-[:USES_COMPONENT]->(cc:Component) RETURN cc',
          { id: entityId },
        );
        const dirResult = await session.run(
          'MATCH (c:Component {id: $id})-[:USES_DIRECTIVE]->(d:Directive) RETURN d',
          { id: entityId },
        );
        const pipeResult = await session.run(
          'MATCH (c:Component {id: $id})-[:USES_PIPE]->(p:Pipe) RETURN p',
          { id: entityId },
        );
        const styleResult = await session.run(
          'MATCH (c:Component {id: $id})-[:HAS_STYLE]->(sf:StyleFile) RETURN sf ORDER BY sf.filePath',
          { id: entityId },
        );
        const specResult = await session.run(
          'MATCH (spec:SpecFile)-[:TESTS]->(c:Component {id: $id}) RETURN spec',
          { id: entityId },
        );
        const modResult = await session.run(
          'MATCH (m:NgModule)-[:DECLARES]->(c:Component {id: $id}) RETURN m LIMIT 1',
          { id: entityId },
        );

        const bindingCountRaw = bindingCountResult.records[0]?.get('bindingCount');
        const bindingCount = typeof bindingCountRaw === 'object' && bindingCountRaw?.toNumber
          ? bindingCountRaw.toNumber()
          : Number(bindingCountRaw ?? 0);

        return {
          ...nodeToComponentSummary(props),
          templateType: props['templateType'],
          templatePath: props['templatePath'] ?? null,
          changeDetection: props['changeDetection'] ?? null,
          styleFiles: styleResult.records.map((r) => r.get('sf').properties['filePath']),
          hostBindings: (props['hostBindings'] as string[]) ?? [],
          injectedServices: svcResult.records.map((r) => nodeToServiceSummary(r.get('s').properties)),
          usedComponents: usedCompResult.records.map((r) => nodeToComponentSummary(r.get('cc').properties)),
          usedDirectives: dirResult.records.map((r) => nodeToDirectiveSummary(r.get('d').properties)),
          usedPipes: pipeResult.records.map((r) => nodeToPipeSummary(r.get('p').properties)),
          declaredInModule: modResult.records.length > 0
            ? nodeToNgModuleSummary(modResult.records[0].get('m').properties)
            : null,
          specFiles: specResult.records.map((r) => r.get('spec').properties['filePath']),
          // Phase 2 additions
          methods: methodsResult.records.map((r) => {
            const p = r.get('m').properties as Record<string, unknown>;
            return { name: p['name'], isPublic: p['isPublic'], returnType: p['returnType'] ?? null };
          }),
          properties: propsResult.records.map((r) => {
            const p = r.get('p').properties as Record<string, unknown>;
            return { name: p['name'], isPublic: p['isPublic'], type: p['type'] ?? null, isInput: p['isInput'], isOutput: p['isOutput'] };
          }),
          templateBindingCount: bindingCount,
        };
      }

      case 'Service': {
        const consumersResult = await session.run(
          'MATCH (consumer)-[:INJECTS]->(s:Service {id: $id}) RETURN consumer, labels(consumer) AS lbls',
          { id: entityId },
        );
        return {
          ...nodeToServiceSummary(props),
          usedByComponents: consumersResult.records
            .filter((r) => (r.get('lbls') as string[]).includes('Component'))
            .map((r) => nodeToComponentSummary(r.get('consumer').properties)),
          usedByServices: consumersResult.records
            .filter((r) => (r.get('lbls') as string[]).includes('Service'))
            .map((r) => nodeToServiceSummary(r.get('consumer').properties)),
        };
      }

      case 'NgModule': {
        const declResult = await session.run(
          'MATCH (m:NgModule {id: $id})-[:DECLARES]->(n) RETURN n, labels(n) AS lbls',
          { id: entityId },
        );
        const impResult = await session.run(
          'MATCH (m:NgModule {id: $id})-[:IMPORTS]->(n) RETURN n, labels(n) AS lbls',
          { id: entityId },
        );
        const expResult = await session.run(
          'MATCH (m:NgModule {id: $id})-[:EXPORTS]->(n) RETURN n, labels(n) AS lbls',
          { id: entityId },
        );
        const bootResult = await session.run(
          'MATCH (m:NgModule {id: $id})-[:BOOTSTRAPS]->(c:Component) RETURN c',
          { id: entityId },
        );
        const prvResult = await session.run(
          'MATCH (m:NgModule {id: $id})-[:PROVIDES]->(s:Service) RETURN s',
          { id: entityId },
        );
        return {
          ...nodeToNgModuleSummary(props),
          declares: declResult.records.map((r) => {
            const p = r.get('n').properties;
            const lbls = r.get('lbls') as string[];
            if (lbls.includes('Component')) return nodeToComponentSummary(p);
            if (lbls.includes('Directive')) return nodeToDirectiveSummary(p);
            return nodeToPipeSummary(p);
          }),
          imports: impResult.records.map((r) => {
            const p = r.get('n').properties;
            const lbls = r.get('lbls') as string[];
            return lbls.includes('Component') ? nodeToComponentSummary(p) : nodeToNgModuleSummary(p);
          }),
          exports: expResult.records.map((r) => {
            const p = r.get('n').properties;
            const lbls = r.get('lbls') as string[];
            if (lbls.includes('Component')) return nodeToComponentSummary(p);
            if (lbls.includes('Directive')) return nodeToDirectiveSummary(p);
            if (lbls.includes('NgModule')) return nodeToNgModuleSummary(p);
            return nodeToPipeSummary(p);
          }),
          bootstrap: bootResult.records.map((r) => nodeToComponentSummary(r.get('c').properties)),
          providers: prvResult.records.map((r) => nodeToServiceSummary(r.get('s').properties)),
        };
      }

      case 'Class': {
        const methodsR = await session.run(
          'MATCH (c:Class {id: $id})-[:HAS_METHOD]->(m:Method) RETURN m ORDER BY m.name',
          { id: entityId },
        );
        const propsR = await session.run(
          'MATCH (c:Class {id: $id})-[:HAS_PROPERTY]->(p:Property) RETURN p ORDER BY p.name',
          { id: entityId },
        );
        const testsR = await session.run(
          'MATCH (spec:SpecFile)-[r:TESTS]->(c:Class {id: $id}) RETURN spec.filePath AS fp, r.via AS via',
          { id: entityId },
        );
        const consumersR = await session.run(
          'MATCH (consumer)-[:INJECTS]->(c:Class {id: $id}) RETURN consumer.name AS name, labels(consumer) AS lbls',
          { id: entityId },
        );
        return {
          id: props['id'],
          name: props['name'],
          sourceFile: props['sourceFile'],
          isAbstract: props['isAbstract'],
          isExported: props['isExported'],
          methods: methodsR.records.map((r) => {
            const p = r.get('m').properties as Record<string, unknown>;
            return { name: p['name'], isPublic: p['isPublic'], returnType: p['returnType'] ?? null };
          }),
          properties: propsR.records.map((r) => {
            const p = r.get('p').properties as Record<string, unknown>;
            return { name: p['name'], isPublic: p['isPublic'], type: p['type'] ?? null, isInput: p['isInput'], isOutput: p['isOutput'] };
          }),
          specFiles: testsR.records.map((r) => ({ filePath: r.get('fp'), via: r.get('via') })),
          diConsumerCount: consumersR.records.length,
        };
      }

      case 'Directive':
        return nodeToDirectiveSummary(props);

      case 'Pipe':
        return nodeToPipeSummary(props);

      case 'Route': {
        const compResult = await session.run(
          'MATCH (r:Route {id: $id})-[:LOADS_COMPONENT]->(c:Component) RETURN c LIMIT 1',
          { id: entityId },
        );
        const modResult = await session.run(
          'MATCH (r:Route {id: $id})-[:LOADS_MODULE]->(m:NgModule) RETURN m LIMIT 1',
          { id: entityId },
        );
        const childrenResult = await session.run(
          'MATCH (child:Route)-[:CHILD_OF]->(r:Route {id: $id}) RETURN child',
          { id: entityId },
        );
        const parentResult = await session.run(
          'MATCH (r:Route {id: $id})-[:CHILD_OF]->(parent:Route) RETURN parent LIMIT 1',
          { id: entityId },
        );
        return {
          ...nodeToRouteSummary(props),
          loadsComponent: compResult.records.length > 0
            ? nodeToComponentSummary(compResult.records[0].get('c').properties)
            : null,
          loadsModule: modResult.records.length > 0
            ? nodeToNgModuleSummary(modResult.records[0].get('m').properties)
            : null,
          children: childrenResult.records.map((r) => nodeToRouteSummary(r.get('child').properties)),
          parent: parentResult.records.length > 0
            ? nodeToRouteSummary(parentResult.records[0].get('parent').properties)
            : null,
        };
      }
    }
  } finally {
    await session.close();
  }
}
