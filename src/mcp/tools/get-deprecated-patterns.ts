/**
 * Phase 4 — get_deprecated_patterns
 * List all deprecated Angular and RxJS pattern findings for an app.
 */

import { z } from 'zod';
import { Driver } from 'neo4j-driver';
import { getSession } from '../../graph/db/connection.js';
import { parseCursor, makeCursor } from '../server.js';

const InputSchema = z.object({
  appDb: z.string(),
  category: z.enum(['angular', 'rxjs']).optional(),
  severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  scope: z.enum(['production', 'test']).optional(),
  projectId: z.string().optional(),
  pageSize: z.number().min(1).max(200).optional().default(50),
  cursor: z.string().optional(),
});

export async function getDeprecatedPatterns(
  driver: Driver,
  input: Record<string, unknown>,
): Promise<unknown> {
  const params = InputSchema.parse(input);
  const session = getSession(driver, params.appDb);

  try {
    const skip = parseCursor(params.cursor);

    const conditions = [
      'f.isDeprecatedUsage = true',
      ...(params.category ? [`f.category = $category`] : []),
      ...(params.severity ? [`f.severity = $severity`] : []),
      ...(params.scope ? [`f.scope = $scope`] : []),
      ...(params.projectId
        ? [`EXISTS { MATCH (artifact { id: f.affectedNodeId })-[:BELONGS_TO_PROJECT]->(p:Project { id: $projectId }) }`]
        : []),
    ];

    const whereStr = conditions.join(' AND ');

    const summaryResult = await session.run(
      `MATCH (f:Finding)
       WHERE ${whereStr}
       RETURN
         count(f) AS total,
         count(CASE WHEN f.category = 'angular' THEN 1 END) AS angularCount,
         count(CASE WHEN f.category = 'rxjs' THEN 1 END) AS rxjsCount`,
      {
        category: params.category ?? null,
        severity: params.severity ?? null,
        scope: params.scope ?? null,
        projectId: params.projectId ?? null,
      },
    );

    const countResult = await session.run(
      `MATCH (f:Finding)
       WHERE ${whereStr}
       RETURN f.severity AS s, f.reasonCode AS rc, count(f) AS cnt`,
      {
        category: params.category ?? null,
        severity: params.severity ?? null,
        scope: params.scope ?? null,
        projectId: params.projectId ?? null,
      },
    );

    const bySeverity: Record<string, number> = {};
    const byReasonCode: Record<string, number> = {};
    for (const rec of countResult.records) {
      const cnt = (rec.get('cnt') as { toNumber(): number }).toNumber();
      const s = rec.get('s') as string;
      const rc = rec.get('rc') as string;
      bySeverity[s] = (bySeverity[s] ?? 0) + cnt;
      byReasonCode[rc] = (byReasonCode[rc] ?? 0) + cnt;
    }

    const topReasonCodes = Object.entries(byReasonCode)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([rc]) => rc);

    const sr = summaryResult.records[0];
    const summary = {
      totalDeprecatedUsages: sr?.get('total')?.toNumber?.() ?? 0,
      angularPatterns: sr?.get('angularCount')?.toNumber?.() ?? 0,
      rxjsPatterns: sr?.get('rxjsCount')?.toNumber?.() ?? 0,
      bySeverity,
      byReasonCode,
    };

    const itemsResult = await session.run(
      `MATCH (f:Finding)
       WHERE ${whereStr}
       OPTIONAL MATCH (artifact { id: f.affectedNodeId })
       RETURN f.id AS id,
              f.category AS category,
              f.severity AS severity,
              f.reasonCode AS reasonCode,
              f.description AS description,
              f.recommendedAction AS recommendedAction,
              f.scope AS scope,
              f.affectedNodeId AS affectedNodeId,
              coalesce(artifact.name, f.affectedNodeId) AS affectedNodeName,
              coalesce(labels(artifact)[0], 'Unknown') AS affectedNodeKind,
              coalesce(artifact.filePath, artifact.sourceFile, '') AS filePath,
              f.confidenceScore AS confidenceScore
       ORDER BY
         CASE f.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
         f.reasonCode
       SKIP $skip LIMIT $pageSize`,
      {
        skip,
        pageSize: params.pageSize,
        category: params.category ?? null,
        severity: params.severity ?? null,
        scope: params.scope ?? null,
        projectId: params.projectId ?? null,
      },
    );

    const items = itemsResult.records.map((r) => ({
      id: r.get('id') as string,
      category: r.get('category') as string,
      severity: r.get('severity') as string,
      reasonCode: r.get('reasonCode') as string,
      description: r.get('description') as string,
      recommendedAction: r.get('recommendedAction') as string,
      scope: r.get('scope') as string,
      affectedNodeId: r.get('affectedNodeId') as string,
      affectedNodeName: r.get('affectedNodeName') as string,
      affectedNodeKind: r.get('affectedNodeKind') as string,
      filePath: r.get('filePath') as string,
      confidenceScore: r.get('confidenceScore') as number,
    }));

    const hasMore = items.length === params.pageSize;

    return {
      appDb: params.appDb,
      summary: { ...summary, topReasonCodes },
      items,
      nextCursor: hasMore ? makeCursor(skip + params.pageSize) : null,
    };
  } finally {
    await session.close();
  }
}
