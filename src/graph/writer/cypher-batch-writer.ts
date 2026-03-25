/**
 * CypherBatchWriter — writes GraphIR nodes and relationships to Neo4j
 * using UNWIND + MERGE batches for idempotent, performant writes.
 */

import { Session } from 'neo4j-driver';
import { GraphNode, GraphRelationship, WriteStats } from '../../core/types/graph-ir.js';

const DEFAULT_BATCH_SIZE = 500;

/**
 * Write nodes in batches using MERGE on id.
 * Each label is written in a separate query to satisfy Neo4j MERGE label syntax.
 */
export async function writeNodes(
  session: Session,
  nodes: GraphNode[],
  batchSize = DEFAULT_BATCH_SIZE,
): Promise<WriteStats> {
  const start = Date.now();
  let written = 0;

  // Group by label
  const byLabel = new Map<string, GraphNode[]>();
  for (const node of nodes) {
    const list = byLabel.get(node.label) ?? [];
    list.push(node);
    byLabel.set(node.label, list);
  }

  for (const [label, labelNodes] of byLabel) {
    for (let i = 0; i < labelNodes.length; i += batchSize) {
      const batch = labelNodes.slice(i, i + batchSize).map((n) => ({
        id: n.id,
        props: n.properties,
      }));
      await session.run(
        `UNWIND $batch AS row
         MERGE (n:\`${label}\` {id: row.id})
         SET n += row.props`,
        { batch },
      );
      written += batch.length;
    }
  }

  return { written, duration: Date.now() - start };
}

/**
 * Write relationships in batches.
 * Uses MATCH on fromId/toId then MERGE the relationship.
 */
export async function writeRelationships(
  session: Session,
  relationships: GraphRelationship[],
  batchSize = DEFAULT_BATCH_SIZE,
): Promise<WriteStats> {
  const start = Date.now();
  let written = 0;

  // Group by type
  const byType = new Map<string, GraphRelationship[]>();
  for (const rel of relationships) {
    const list = byType.get(rel.type) ?? [];
    list.push(rel);
    byType.set(rel.type, list);
  }

  for (const [type, typeRels] of byType) {
    for (let i = 0; i < typeRels.length; i += batchSize) {
      const batch = typeRels.slice(i, i + batchSize).map((r) => ({
        fromId: r.fromId,
        toId: r.toId,
        props: r.properties ?? {},
      }));
      await session.run(
        `UNWIND $batch AS row
         MATCH (from {id: row.fromId})
         MATCH (to {id: row.toId})
         MERGE (from)-[r:\`${type}\`]->(to)
         SET r += row.props`,
        { batch },
      );
      written += batch.length;
    }
  }

  return { written, duration: Date.now() - start };
}
