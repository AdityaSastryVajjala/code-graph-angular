/**
 * Phase 4 — Migration Intelligence
 * MigrationOrderAnalyzer: computes a dependency-safe migration order using
 * Kahn's BFS topological sort over NgModule/Component/Project dependency edges.
 *
 * Algorithm (from research.md):
 *  1. Build directed dependency graph from Neo4j (IMPORTS, DECLARES-inverted,
 *     LOADS_LAZY_MODULE, PROJECT_DEPENDS_ON)
 *  2. DFS cycle detection (white/gray/black)
 *  3. Kahn's BFS topological sort — assigns migrationOrderIndex per level
 *  4. Write MIGRATION_ORDER relationships and migrationOrderIndex onto nodes
 *  5. Emit HardBlocker Finding for each artifact in a detected cycle
 */

import { Session } from 'neo4j-driver';
import { FindingNode } from '../../graph/schema/nodes.js';
import { buildFinding } from '../finding-builder.js';

export interface MigrationOrderResult {
  findings: FindingNode[];
  orderedCount: number;
  blockedCount: number;
}

interface DepNode {
  id: string;
  filePath: string;
  deps: string[];       // node IDs this node depends on (must be migrated first)
}

export class MigrationOrderAnalyzer {
  constructor(
    private readonly session: Session,
    private readonly migrationRunId: string,
  ) {}

  async analyze(): Promise<MigrationOrderResult> {
    const findings: FindingNode[] = [];

    // Load all migration-relevant nodes and their dependencies
    const nodes = await this.loadDependencyGraph();

    // Detect cycles using DFS coloring
    const cyclicIds = this.detectCycles(nodes);

    // Emit HardBlocker Finding for each cyclic artifact
    for (const id of cyclicIds) {
      const node = nodes.get(id);
      const scope: 'production' | 'test' =
        node?.filePath?.includes('.spec.') ? 'test' : 'production';
      try {
        findings.push(buildFinding({
          affectedNodeId: id,
          reasonCode: 'ARCH_CIRCULAR_DEPENDENCY',
          scope,
          migrationRunId: this.migrationRunId,
          type: 'blocker',
        }));
      } catch {
        // noop
      }
    }

    // Remove cyclic nodes and compute topological order on remaining graph
    const nonCyclicNodes = new Map(
      [...nodes.entries()].filter(([id]) => !cyclicIds.has(id)),
    );

    // Remove cyclic ids from deps of non-cyclic nodes
    for (const node of nonCyclicNodes.values()) {
      node.deps = node.deps.filter((dep) => !cyclicIds.has(dep) && nonCyclicNodes.has(dep));
    }

    const orderMap = this.kahnsSort(nonCyclicNodes);

    // Write migrationOrderIndex to nodes and MIGRATION_ORDER relationships
    await this.writeOrderToGraph(orderMap, nonCyclicNodes);

    return {
      findings,
      orderedCount: orderMap.size,
      blockedCount: cyclicIds.size,
    };
  }

  private async loadDependencyGraph(): Promise<Map<string, DepNode>> {
    const nodes = new Map<string, DepNode>();

    // Fetch NgModule → NgModule dependencies (via IMPORTS)
    const modResult = await this.session.run(`
      MATCH (m:NgModule)
      OPTIONAL MATCH (m)-[:IMPORTS]->(dep:NgModule)
      OPTIONAL MATCH (m)-[:LOADS_LAZY_MODULE]->(lazy:NgModule)
      RETURN m.id AS id,
             m.filePath AS filePath,
             collect(DISTINCT dep.id) + collect(DISTINCT lazy.id) AS deps
    `);

    for (const record of modResult.records) {
      const id = record.get('id') as string;
      nodes.set(id, {
        id,
        filePath: record.get('filePath') as string,
        deps: (record.get('deps') as (string | null)[]).filter((d): d is string => d !== null),
      });
    }

    // Fetch Component/Directive/Pipe → NgModule dependencies (declaring module)
    const artifactResult = await this.session.run(`
      MATCH (artifact)
      WHERE artifact:Component OR artifact:Directive OR artifact:Pipe
      OPTIONAL MATCH (mod:NgModule)-[:DECLARES]->(artifact)
      RETURN artifact.id AS id,
             artifact.filePath AS filePath,
             collect(DISTINCT mod.id) AS deps
    `);

    for (const record of artifactResult.records) {
      const id = record.get('id') as string;
      if (!nodes.has(id)) {
        nodes.set(id, {
          id,
          filePath: record.get('filePath') as string,
          deps: (record.get('deps') as (string | null)[]).filter((d): d is string => d !== null),
        });
      }
    }

    // Fetch Project → Project dependencies
    const projectResult = await this.session.run(`
      MATCH (p:Project)
      OPTIONAL MATCH (p)-[:PROJECT_DEPENDS_ON]->(dep:Project)
      RETURN p.id AS id,
             p.sourceRoot AS filePath,
             collect(DISTINCT dep.id) AS deps
    `);

    for (const record of projectResult.records) {
      const id = record.get('id') as string;
      if (!nodes.has(id)) {
        nodes.set(id, {
          id,
          filePath: record.get('filePath') as string,
          deps: (record.get('deps') as (string | null)[]).filter((d): d is string => d !== null),
        });
      }
    }

    return nodes;
  }

  /** DFS-based cycle detection using white(0)/gray(1)/black(2) coloring */
  private detectCycles(nodes: Map<string, DepNode>): Set<string> {
    const color = new Map<string, 0 | 1 | 2>();
    const cyclicIds = new Set<string>();

    for (const id of nodes.keys()) {
      color.set(id, 0);
    }

    const dfs = (id: string, path: Set<string>): boolean => {
      const c = color.get(id) ?? 0;
      if (c === 2) return false; // fully processed — no cycle through this node
      if (c === 1) return true;  // back edge — cycle detected

      color.set(id, 1);
      path.add(id);

      const node = nodes.get(id);
      if (node) {
        for (const dep of node.deps) {
          if (dfs(dep, path)) {
            cyclicIds.add(id);
          }
        }
      }

      path.delete(id);
      color.set(id, 2);
      return cyclicIds.has(id);
    };

    for (const id of nodes.keys()) {
      if ((color.get(id) ?? 0) === 0) {
        dfs(id, new Set());
      }
    }

    return cyclicIds;
  }

  /**
   * Kahn's BFS topological sort.
   * Returns a map of nodeId → migrationOrderIndex (0-based levels).
   * Nodes at the same level can be migrated in parallel.
   */
  private kahnsSort(nodes: Map<string, DepNode>): Map<string, number> {
    const inDegree = new Map<string, number>();
    const consumers = new Map<string, string[]>(); // id → list of nodes depending on this one

    for (const [id] of nodes) {
      inDegree.set(id, 0);
      consumers.set(id, []);
    }

    for (const [id, node] of nodes) {
      for (const dep of node.deps) {
        if (nodes.has(dep)) {
          inDegree.set(id, (inDegree.get(id) ?? 0) + 1);
          consumers.get(dep)!.push(id);
        }
      }
    }

    const orderMap = new Map<string, number>();
    const queue: string[] = [];

    // Enqueue all zero-in-degree nodes (level 0)
    for (const [id, deg] of inDegree) {
      if (deg === 0) queue.push(id);
    }

    let level = 0;

    while (queue.length > 0) {
      const levelSize = queue.length;
      const nextQueue: string[] = [];

      for (let i = 0; i < levelSize; i++) {
        const id = queue[i];
        orderMap.set(id, level);

        for (const consumer of consumers.get(id) ?? []) {
          const newDeg = (inDegree.get(consumer) ?? 1) - 1;
          inDegree.set(consumer, newDeg);
          if (newDeg === 0) {
            nextQueue.push(consumer);
          }
        }
      }

      queue.splice(0, levelSize, ...nextQueue);
      if (nextQueue.length > 0) level++;
    }

    return orderMap;
  }

  private async writeOrderToGraph(
    orderMap: Map<string, number>,
    nodes: Map<string, DepNode>,
  ): Promise<void> {
    // Count nodes per level to determine parallelizable groups
    const levelCounts = new Map<number, number>();
    for (const level of orderMap.values()) {
      levelCounts.set(level, (levelCounts.get(level) ?? 0) + 1);
    }

    const BATCH = 100;
    const entries = [...orderMap.entries()];

    for (let i = 0; i < entries.length; i += BATCH) {
      const batch = entries.slice(i, i + BATCH).map(([id, idx]) => ({
        id,
        orderIndex: idx,
        isParallelGroup: (levelCounts.get(idx) ?? 1) > 1,
      }));

      await this.session.run(
        `UNWIND $batch AS item
         MATCH (n { id: item.id })
         SET n.migrationOrderIndex = item.orderIndex,
             n.migrationRunId = $runId`,
        { batch, runId: this.migrationRunId },
      );
    }

    // Write MIGRATION_ORDER relationships
    const relBatch: Array<{ fromId: string; toId: string; orderIndex: number; isParallelGroup: boolean }> = [];
    for (const [id, node] of nodes) {
      const fromLevel = orderMap.get(id);
      if (fromLevel === undefined) continue;

      for (const dep of node.deps) {
        const toLevel = orderMap.get(dep);
        if (toLevel === undefined) continue;
        relBatch.push({
          fromId: id,
          toId: dep,
          orderIndex: fromLevel,
          isParallelGroup: (levelCounts.get(fromLevel) ?? 1) > 1,
        });
      }
    }

    for (let i = 0; i < relBatch.length; i += BATCH) {
      const batch = relBatch.slice(i, i + BATCH);
      await this.session.run(
        `UNWIND $batch AS item
         MATCH (from { id: item.fromId })
         MATCH (to { id: item.toId })
         MERGE (from)-[r:MIGRATION_ORDER]->(to)
         SET r.orderIndex = item.orderIndex, r.isParallelGroup = item.isParallelGroup`,
        { batch },
      );
    }
  }
}
