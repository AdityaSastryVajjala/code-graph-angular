/**
 * TraversalEngine — graph traversal for impact analysis.
 */

import { Session } from 'neo4j-driver';
import { ImpactResult, TraversalOptions } from '../core/types/graph-ir.js';
import { classifyImpact } from './impact-classifier.js';
import { ELIGIBLE_EDGE_TYPES, validateTraversalOptions } from './traversal-options.js';

/**
 * Traverse from a file path and return all impacted nodes.
 */
export async function traverseFromFile(
  session: Session,
  filePath: string,
  opts: TraversalOptions,
): Promise<ImpactResult[]> {
  const validated = validateTraversalOptions(opts);
  const depth = validated.maxDepth ?? 10;
  const edgeTypes = validated.edgeKinds ?? ELIGIBLE_EDGE_TYPES;
  const includeTests = validated.includeTests ?? false;
  const projectId = validated.projectId;

  // Use BFS traversal (compatible without APOC)
  return traverseWithoutApoc(session, filePath, depth, edgeTypes, includeTests, projectId ?? null, true);
}

/**
 * Traverse from a symbol ID and return all impacted nodes.
 */
export async function traverseFromSymbol(
  session: Session,
  symbolId: string,
  opts: TraversalOptions,
): Promise<ImpactResult[]> {
  const validated = validateTraversalOptions(opts);
  const depth = validated.maxDepth ?? 10;
  const edgeTypes = validated.edgeKinds ?? ELIGIBLE_EDGE_TYPES;
  const includeTests = validated.includeTests ?? false;
  const projectId = validated.projectId ?? null;

  return traverseSymbolWithBFS(session, symbolId, depth, edgeTypes, includeTests, projectId);
}

// ─── Traversal Implementations ────────────────────────────────────────────────

async function traverseWithoutApoc(
  session: Session,
  filePath: string,
  depth: number,
  edgeTypes: string[],
  includeTests: boolean,
  projectId: string | null,
  _fromFile: boolean,
): Promise<ImpactResult[]> {
  // First, get declared symbols in the file
  const seedResult = await session.run(
    `MATCH (f:File {filePath: $fp})
     OPTIONAL MATCH (f)<-[:BELONGS_TO_FILE|DECLARES_SYMBOL]-(declared)
     RETURN collect(DISTINCT declared.id) AS seedIds`,
    { fp: filePath },
  );

  if (seedResult.records.length === 0) return [];
  const seedIds = (seedResult.records[0].get('seedIds') as (string | null)[])
    .filter((id): id is string => id !== null);

  if (seedIds.length === 0) return [];

  const results: ImpactResult[] = [];
  for (const seedId of seedIds) {
    const items = await traverseSymbolWithBFS(session, seedId, depth, edgeTypes, includeTests, projectId);
    results.push(...items);
  }

  // Deduplicate by nodeId
  return deduplicateResults(results);
}

async function traverseSymbolWithBFS(
  session: Session,
  startId: string,
  maxDepth: number,
  edgeTypes: string[],
  includeTests: boolean,
  projectId: string | null,
): Promise<ImpactResult[]> {
  const visited = new Set<string>();
  visited.add(startId);

  const results: ImpactResult[] = [];
  // queue: [nodeId, depth, edgeChain]
  let queue: Array<[string, number, string[]]> = [[startId, 0, []]];

  while (queue.length > 0) {
    const currentBatch = queue;
    queue = [];

    const currentIds = currentBatch.map(([id]) => id);

    // Build relationship filter string for Cypher
    const relTypesClause = edgeTypes.map((t) => `<-[:${t}]-`).join('|');
    void relTypesClause;

    // Query inbound edges for all current nodes in one batch
    const result = await session.run(
      `UNWIND $nodeIds AS nodeId
       MATCH (node) WHERE node.id = nodeId
       MATCH (consumer)-[r]->(node)
       WHERE type(r) IN $edgeTypes
       RETURN
         nodeId AS fromId,
         type(r) AS edgeType,
         consumer.id AS consumerId,
         [x IN labels(consumer) WHERE x <> '_IndexMeta'][0] AS consumerLabel,
         COALESCE(consumer.name, consumer.path, consumer.filePath, consumer.id) AS consumerName,
         COALESCE(consumer.filePath, consumer.sourceFile, '') AS consumerFilePath,
         CASE WHEN 'SpecFile' IN labels(consumer) THEN true ELSE false END AS isTest
       `,
      { nodeIds: currentIds, edgeTypes },
    );

    const nextBatch: Array<[string, number, string[]]> = [];

    for (const record of result.records) {
      const consumerId = record.get('consumerId') as string;
      const edgeType = record.get('edgeType') as string;
      const fromId = record.get('fromId') as string;
      const isTest = record.get('isTest') as boolean;

      if (visited.has(consumerId)) continue;
      if (!includeTests && isTest) continue;

      visited.add(consumerId);

      // Find parent chain
      const parentEntry = currentBatch.find(([id]) => id === fromId);
      const parentChain = parentEntry ? parentEntry[2] : [];
      const newChain = [...parentChain, edgeType];
      const newDepth = parentEntry ? parentEntry[1] + 1 : 1;

      if (newDepth > maxDepth) continue;

      const impactClass = classifyImpact(newChain, newDepth);

      results.push({
        nodeId: consumerId,
        nodeLabel: record.get('consumerLabel') as string ?? 'Unknown',
        nodeName: record.get('consumerName') as string ?? consumerId,
        filePath: record.get('consumerFilePath') as string ?? '',
        impactClass,
        depth: newDepth,
        edgeChain: newChain,
        isTestFile: isTest,
        projectId: null, // resolved below if projectId filter needed
      });

      if (newDepth < maxDepth) {
        nextBatch.push([consumerId, newDepth, newChain]);
      }
    }

    queue.push(...nextBatch);
  }

  // Apply projectId filter if specified
  if (projectId) {
    const ids = results.map((r) => r.nodeId);
    if (ids.length === 0) return results;

    const projResult = await session.run(
      `UNWIND $ids AS nodeId
       MATCH (n {id: nodeId})-[:BELONGS_TO_PROJECT]->(p:Project {id: $projectId})
       RETURN collect(n.id) AS validIds`,
      { ids, projectId },
    );
    const validIds = new Set<string>(
      projResult.records.length > 0
        ? (projResult.records[0].get('validIds') as string[])
        : [],
    );

    return results.filter((r) => validIds.has(r.nodeId));
  }

  return results;
}

function deduplicateResults(results: ImpactResult[]): ImpactResult[] {
  const seen = new Map<string, ImpactResult>();
  for (const r of results) {
    if (!seen.has(r.nodeId) || r.depth < (seen.get(r.nodeId)?.depth ?? Infinity)) {
      seen.set(r.nodeId, r);
    }
  }
  return Array.from(seen.values());
}
