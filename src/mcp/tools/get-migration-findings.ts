/**
 * Phase 4 — get_migration_findings
 * Query migration findings by type, category, severity, scope, or affected node.
 */

import { z } from 'zod';
import { Driver } from 'neo4j-driver';
import { getSession } from '../../graph/db/connection.js';
import { parseCursor, makeCursor } from '../server.js';

const InputSchema = z.object({
  appDb: z.string(),
  type: z.enum(['blocker', 'risk', 'opportunity']).optional(),
  category: z.enum(['angular', 'rxjs', 'template', 'architecture']).optional(),
  severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  scope: z.enum(['production', 'test']).optional(),
  affectedNodeId: z.string().optional(),
  projectId: z.string().optional(),
  minConfidence: z.number().min(0).max(1).optional().default(0),
  pageSize: z.number().min(1).max(200).optional().default(50),
  cursor: z.string().optional(),
});

export async function getMigrationFindings(
  driver: Driver,
  input: Record<string, unknown>,
): Promise<unknown> {
  const params = InputSchema.parse(input);
  const session = getSession(driver, params.appDb);

  try {
    const skip = parseCursor(params.cursor);

    const conditions: string[] = ['f.id IS NOT NULL', `f.confidenceScore >= $minConfidence`];
    if (params.type) conditions.push('f.type = $type');
    if (params.category) conditions.push('f.category = $category');
    if (params.severity) conditions.push('f.severity = $severity');
    if (params.scope) conditions.push('f.scope = $scope');
    if (params.affectedNodeId) conditions.push('f.affectedNodeId = $affectedNodeId');
    if (params.projectId) {
      conditions.push(
        'EXISTS { MATCH (artifact { id: f.affectedNodeId })-[:BELONGS_TO_PROJECT]->(p:Project { id: $projectId }) }',
      );
    }

    const whereStr = conditions.join(' AND ');

    // Summary
    const summaryResult = await session.run(
      `MATCH (f:Finding)
       WHERE ${whereStr}
       RETURN
         count(f) AS totalFindings,
         collect(DISTINCT f.type) AS types,
         collect(DISTINCT f.severity) AS severities,
         collect(DISTINCT f.category) AS categories`,
      {
        minConfidence: params.minConfidence,
        type: params.type ?? null,
        category: params.category ?? null,
        severity: params.severity ?? null,
        scope: params.scope ?? null,
        affectedNodeId: params.affectedNodeId ?? null,
        projectId: params.projectId ?? null,
      },
    );

    // Aggregated counts
    const countResult = await session.run(
      `MATCH (f:Finding)
       WHERE ${whereStr}
       RETURN f.type AS t, f.severity AS s, f.category AS c, count(f) AS cnt`,
      {
        minConfidence: params.minConfidence,
        type: params.type ?? null,
        category: params.category ?? null,
        severity: params.severity ?? null,
        scope: params.scope ?? null,
        affectedNodeId: params.affectedNodeId ?? null,
        projectId: params.projectId ?? null,
      },
    );

    const byType: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};
    const byCategory: Record<string, number> = {};
    for (const rec of countResult.records) {
      const cnt = (rec.get('cnt') as { toNumber(): number }).toNumber();
      const t = rec.get('t') as string;
      const s = rec.get('s') as string;
      const c = rec.get('c') as string;
      byType[t] = (byType[t] ?? 0) + cnt;
      bySeverity[s] = (bySeverity[s] ?? 0) + cnt;
      byCategory[c] = (byCategory[c] ?? 0) + cnt;
    }

    const totalFindings = summaryResult.records[0]?.get('totalFindings')?.toNumber?.() ?? 0;

    // Items with affected node info
    const itemsResult = await session.run(
      `MATCH (f:Finding)
       WHERE ${whereStr}
       OPTIONAL MATCH (artifact { id: f.affectedNodeId })
       RETURN f.id AS id,
              f.type AS type,
              f.category AS category,
              f.severity AS severity,
              f.scope AS scope,
              f.affectedNodeId AS affectedNodeId,
              coalesce(artifact.name, f.affectedNodeId) AS affectedNodeName,
              coalesce(labels(artifact)[0], 'Unknown') AS affectedNodeKind,
              f.reasonCode AS reasonCode,
              f.description AS description,
              f.recommendedAction AS recommendedAction,
              f.confidenceScore AS confidenceScore,
              f.isDeprecatedUsage AS isDeprecatedUsage
       ORDER BY
         CASE f.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
         f.category
       SKIP $skip LIMIT $pageSize`,
      {
        skip,
        pageSize: params.pageSize,
        minConfidence: params.minConfidence,
        type: params.type ?? null,
        category: params.category ?? null,
        severity: params.severity ?? null,
        scope: params.scope ?? null,
        affectedNodeId: params.affectedNodeId ?? null,
        projectId: params.projectId ?? null,
      },
    );

    const items = itemsResult.records.map((r) => ({
      id: r.get('id') as string,
      type: r.get('type') as string,
      category: r.get('category') as string,
      severity: r.get('severity') as string,
      scope: r.get('scope') as string,
      affectedNodeId: r.get('affectedNodeId') as string,
      affectedNodeName: r.get('affectedNodeName') as string,
      affectedNodeKind: r.get('affectedNodeKind') as string,
      reasonCode: r.get('reasonCode') as string,
      description: r.get('description') as string,
      recommendedAction: r.get('recommendedAction') as string,
      confidenceScore: r.get('confidenceScore') as number,
      isDeprecatedUsage: (r.get('isDeprecatedUsage') as boolean | null) ?? false,
    }));

    const hasMore = items.length === params.pageSize;

    return {
      appDb: params.appDb,
      summary: { totalFindings, byType, bySeverity, byCategory },
      items,
      nextCursor: hasMore ? makeCursor(skip + params.pageSize) : null,
    };
  } finally {
    await session.close();
  }
}
