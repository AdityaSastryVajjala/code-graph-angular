import { Session } from 'neo4j-driver';
import { MetricSnapshot } from '../core/types/graph-ir.js';

export async function getSymbolMetrics(
  session: Session,
  symbolId: string,
): Promise<MetricSnapshot> {
  const result = await session.run(
    `MATCH (n {id: $id})
     OPTIONAL MATCH (inbound)-[r_in]->(n) WHERE NOT r_in:BELONGS_TO_FILE AND NOT r_in:HAS_METHOD AND NOT r_in:HAS_PROPERTY AND NOT r_in:DECLARES_SYMBOL
     OPTIONAL MATCH (n)-[r_out]->(outbound) WHERE NOT r_out:BELONGS_TO_FILE AND NOT r_out:HAS_METHOD AND NOT r_out:HAS_PROPERTY AND NOT r_out:DECLARES_SYMBOL
     OPTIONAL MATCH (injector)-[:INJECTS]->(n)
     OPTIONAL MATCH (tmpl:Template)-[r_tmpl:TEMPLATE_BINDS_PROPERTY|TEMPLATE_BINDS_EVENT|TEMPLATE_TWO_WAY_BINDS|TEMPLATE_USES_DIRECTIVE|TEMPLATE_USES_PIPE|BINDS_TO]->(n)
     OPTIONAL MATCH (any)-[:USES_COMPONENT|USES_DIRECTIVE|USES_PIPE]->(n)
     RETURN
       n.id AS entityId,
       [x IN labels(n) WHERE x <> '_IndexMeta'][0] AS entityLabel,
       COALESCE(n.name, n.id) AS entityName,
       count(DISTINCT inbound) AS inboundCount,
       count(DISTINCT outbound) AS outboundCount,
       count(DISTINCT injector) AS injectionCount,
       count(DISTINCT tmpl) AS templateUsageCount,
       count(DISTINCT any) AS selectorUsageCount`,
    { id: symbolId },
  );

  if (result.records.length === 0) {
    return emptyMetrics(symbolId, 'Unknown', symbolId);
  }

  const r = result.records[0];
  return {
    entityId: r.get('entityId') as string,
    entityLabel: r.get('entityLabel') as string ?? 'Unknown',
    entityName: r.get('entityName') as string,
    inboundCount: toNumber(r.get('inboundCount')),
    outboundCount: toNumber(r.get('outboundCount')),
    injectionCount: toNumber(r.get('injectionCount')),
    templateUsageCount: toNumber(r.get('templateUsageCount')),
    selectorUsageCount: toNumber(r.get('selectorUsageCount')),
    projectDependencyCount: 0,
    projectConsumerCount: 0,
  };
}

export async function getFileMetrics(
  session: Session,
  filePath: string,
): Promise<MetricSnapshot> {
  const result = await session.run(
    `MATCH (f:File {filePath: $filePath})
     OPTIONAL MATCH (f)<-[:BELONGS_TO_FILE|DECLARES_SYMBOL]-(declared)
     WITH f, collect(DISTINCT declared) AS declaredNodes
     UNWIND declaredNodes AS sym
     OPTIONAL MATCH (inbound)-[]->(sym)
     OPTIONAL MATCH (sym)-[]->(outbound)
     RETURN
       f.id AS entityId,
       f.filePath AS entityName,
       count(DISTINCT inbound) AS inboundCount,
       count(DISTINCT outbound) AS outboundCount`,
    { filePath },
  );

  if (result.records.length === 0) {
    return emptyMetrics(filePath, 'File', filePath);
  }

  const r = result.records[0];
  return {
    entityId: r.get('entityId') as string ?? filePath,
    entityLabel: 'File',
    entityName: r.get('entityName') as string ?? filePath,
    inboundCount: toNumber(r.get('inboundCount')),
    outboundCount: toNumber(r.get('outboundCount')),
    injectionCount: 0,
    templateUsageCount: 0,
    selectorUsageCount: 0,
    projectDependencyCount: 0,
    projectConsumerCount: 0,
  };
}

export async function getProjectMetrics(
  session: Session,
  projectId: string,
): Promise<MetricSnapshot> {
  const result = await session.run(
    `MATCH (p:Project {id: $projectId})
     OPTIONAL MATCH (p)-[:PROJECT_DEPENDS_ON]->(dep:Project)
     OPTIONAL MATCH (consumer:Project)-[:PROJECT_DEPENDS_ON]->(p)
     RETURN
       p.id AS entityId,
       p.name AS entityName,
       count(DISTINCT dep) AS projectDependencyCount,
       count(DISTINCT consumer) AS projectConsumerCount`,
    { projectId },
  );

  if (result.records.length === 0) {
    return emptyMetrics(projectId, 'Project', projectId);
  }

  const r = result.records[0];
  return {
    entityId: r.get('entityId') as string,
    entityLabel: 'Project',
    entityName: r.get('entityName') as string ?? projectId,
    inboundCount: 0,
    outboundCount: 0,
    injectionCount: 0,
    templateUsageCount: 0,
    selectorUsageCount: 0,
    projectDependencyCount: toNumber(r.get('projectDependencyCount')),
    projectConsumerCount: toNumber(r.get('projectConsumerCount')),
  };
}

function emptyMetrics(entityId: string, entityLabel: string, entityName: string): MetricSnapshot {
  return {
    entityId,
    entityLabel,
    entityName,
    inboundCount: 0,
    outboundCount: 0,
    injectionCount: 0,
    templateUsageCount: 0,
    selectorUsageCount: 0,
    projectDependencyCount: 0,
    projectConsumerCount: 0,
  };
}

function toNumber(val: unknown): number {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') return val;
  // Neo4j Integer type
  if (typeof val === 'object' && val !== null && 'toNumber' in val) {
    return (val as { toNumber(): number }).toNumber();
  }
  return 0;
}
