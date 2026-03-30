/**
 * Phase 4 — get_migration_order
 * Returns the dependency-safe migration order for an app or project.
 */

import { z } from 'zod';
import { Driver } from 'neo4j-driver';
import { getSession } from '../../graph/db/connection.js';
import { parseCursor, makeCursor } from '../server.js';

const InputSchema = z.object({
  appDb: z.string(),
  projectId: z.string().optional(),
  includeBlockers: z.boolean().optional().default(true),
  pageSize: z.number().min(1).max(500).optional().default(100),
  cursor: z.string().optional(),
});

export async function getMigrationOrder(
  driver: Driver,
  input: Record<string, unknown>,
): Promise<unknown> {
  const params = InputSchema.parse(input);
  const session = getSession(driver, params.appDb);

  try {
    const skip = parseCursor(params.cursor);

    const projectFilter = params.projectId
      ? 'AND EXISTS { MATCH (n)-[:BELONGS_TO_PROJECT]->(p:Project { id: $projectId }) }'
      : '';

    // Summary
    const summaryResult = await session.run(
      `MATCH (n)
       WHERE (n:NgModule OR n:Component OR n:Directive OR n:Pipe)
         ${projectFilter}
       RETURN
         count(n) AS totalArtifacts,
         count(CASE WHEN n.migrationOrderIndex IS NOT NULL THEN 1 END) AS orderedArtifacts,
         count(CASE WHEN n.migrationOrderIndex IS NULL THEN 1 END) AS blockedArtifacts,
         count(DISTINCT n.migrationOrderIndex) AS parallelGroups`,
      { projectId: params.projectId ?? null },
    );

    const sr = summaryResult.records[0];
    const summary = {
      totalArtifacts: sr?.get('totalArtifacts')?.toNumber?.() ?? 0,
      orderedArtifacts: sr?.get('orderedArtifacts')?.toNumber?.() ?? 0,
      blockedArtifacts: sr?.get('blockedArtifacts')?.toNumber?.() ?? 0,
      parallelGroups: sr?.get('parallelGroups')?.toNumber?.() ?? 0,
    };

    // Ordered items grouped by migrationOrderIndex
    const orderedResult = await session.run(
      `MATCH (n)
       WHERE (n:NgModule OR n:Component OR n:Directive OR n:Pipe)
         AND n.migrationOrderIndex IS NOT NULL
         ${projectFilter}
       OPTIONAL MATCH (n)-[:MIGRATION_ORDER]->(dep)
       OPTIONAL MATCH (n)-[:BELONGS_TO_PROJECT]->(proj:Project)
       WITH n, collect(DISTINCT dep.id) AS dependsOn, proj
       ORDER BY n.migrationOrderIndex, n.name
       SKIP $skip LIMIT $pageSize
       RETURN n.migrationOrderIndex AS orderIndex,
              n.id AS nodeId,
              n.name AS name,
              labels(n)[0] AS kind,
              n.filePath AS filePath,
              proj.id AS projectId,
              dependsOn`,
      { skip, pageSize: params.pageSize, projectId: params.projectId ?? null },
    );

    // Group by orderIndex
    const groupMap = new Map<number, {
      migrationOrderIndex: number;
      isParallelGroup: boolean;
      artifacts: unknown[];
    }>();

    for (const r of orderedResult.records) {
      const idx = (r.get('orderIndex') as { toNumber(): number }).toNumber();
      if (!groupMap.has(idx)) {
        groupMap.set(idx, { migrationOrderIndex: idx, isParallelGroup: false, artifacts: [] });
      }
      groupMap.get(idx)!.artifacts.push({
        nodeId: r.get('nodeId') as string,
        name: r.get('name') as string,
        kind: r.get('kind') as string,
        filePath: r.get('filePath') as string,
        projectId: (r.get('projectId') as string | null) ?? undefined,
        dependsOn: ((r.get('dependsOn') as (string | null)[]) ?? []).filter(Boolean),
      });
    }

    // Mark parallel groups
    for (const group of groupMap.values()) {
      group.isParallelGroup = group.artifacts.length > 1;
    }

    const order = [...groupMap.values()].sort((a, b) => a.migrationOrderIndex - b.migrationOrderIndex);

    // Blocked artifacts (cyclic — no migrationOrderIndex)
    let blockedArtifacts: unknown[] = [];
    if (params.includeBlockers) {
      const blockedResult = await session.run(
        `MATCH (n)
         WHERE (n:NgModule OR n:Component OR n:Directive OR n:Pipe)
           AND n.migrationOrderIndex IS NULL
           ${projectFilter}
         OPTIONAL MATCH (n)-[:HAS_FINDING]->(f:Finding { reasonCode: 'ARCH_CIRCULAR_DEPENDENCY' })
         RETURN n.id AS nodeId,
                n.name AS name,
                labels(n)[0] AS kind,
                f.id AS findingId,
                [] AS cycleWith`,
        { projectId: params.projectId ?? null },
      );

      blockedArtifacts = blockedResult.records.map((r) => ({
        nodeId: r.get('nodeId') as string,
        name: r.get('name') as string,
        kind: r.get('kind') as string,
        findingId: (r.get('findingId') as string | null) ?? null,
        cycleWith: [],
      }));
    }

    const hasMore = orderedResult.records.length === params.pageSize;

    return {
      appDb: params.appDb,
      summary,
      order,
      blockedArtifacts,
      nextCursor: hasMore ? makeCursor(skip + params.pageSize) : null,
    };
  } finally {
    await session.close();
  }
}
