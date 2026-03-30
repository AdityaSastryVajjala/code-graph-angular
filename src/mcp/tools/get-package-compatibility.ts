/**
 * Phase 5 — get_package_compatibility
 * Returns package compatibility findings for an Angular application,
 * grouped as blockers and risks.
 *
 * Contract: specs/005-pkg-compat-analyzer/contracts/get-package-compatibility.md
 */

import { z } from 'zod';
import { Driver } from 'neo4j-driver';
import { getSession } from '../../graph/db/connection.js';
import { parseCursor, makeCursor } from '../server.js';

const InputSchema = z.object({
  appDb: z.string(),
  severity: z.enum(['blocker', 'risk']).optional(),
  targetAngularVersion: z.string().optional(),
  pageSize: z.number().min(1).max(200).optional().default(50),
  cursor: z.string().optional(),
});

interface PackageCompatibilityItem {
  id: string;
  packageName: string;
  installedVersion: string;
  requiredVersion: string | null;
  reasonCode: string;
  severity: 'blocker' | 'risk';
  targetAngularVersion: string;
  description: string;
  recommendedAction: string;
  confidenceScore: number;
}

export async function getPackageCompatibility(
  driver: Driver,
  input: Record<string, unknown>,
): Promise<unknown> {
  const params = InputSchema.parse(input);
  const session = getSession(driver, params.appDb);

  try {
    const skip = parseCursor(params.cursor);

    const conditions: string[] = ["f.category = 'package'"];
    if (params.targetAngularVersion) {
      conditions.push('f.targetAngularVersion = $targetAngularVersion');
    }
    if (params.severity) {
      conditions.push('f.type = $severity');
    }

    const whereStr = conditions.join(' AND ');

    // Summary counts (blockers + risks)
    const summaryResult = await session.run(
      `MATCH (f:Finding)
       WHERE ${whereStr}
       RETURN
         count(f) AS total,
         sum(CASE WHEN f.type = 'blocker' THEN 1 ELSE 0 END) AS blockers,
         sum(CASE WHEN f.type = 'risk'    THEN 1 ELSE 0 END) AS risks`,
      {
        targetAngularVersion: params.targetAngularVersion ?? null,
        severity: params.severity ?? null,
      },
    );

    const totalRaw = summaryResult.records[0]?.get('total');
    const blockersRaw = summaryResult.records[0]?.get('blockers');
    const risksRaw = summaryResult.records[0]?.get('risks');

    const total = typeof totalRaw?.toNumber === 'function' ? totalRaw.toNumber() : Number(totalRaw ?? 0);
    const blockerCount = typeof blockersRaw?.toNumber === 'function' ? blockersRaw.toNumber() : Number(blockersRaw ?? 0);
    const riskCount = typeof risksRaw?.toNumber === 'function' ? risksRaw.toNumber() : Number(risksRaw ?? 0);

    // Paginated items — ordered: blockers first, then risks; within each group by confidenceScore DESC, packageName ASC
    const itemsResult = await session.run(
      `MATCH (f:Finding)
       WHERE ${whereStr}
       RETURN
         f.id                  AS id,
         f.packageName         AS packageName,
         f.installedVersion    AS installedVersion,
         f.requiredVersion     AS requiredVersion,
         f.reasonCode          AS reasonCode,
         f.type                AS type,
         f.targetAngularVersion AS targetAngularVersion,
         f.description         AS description,
         f.recommendedAction   AS recommendedAction,
         f.confidenceScore     AS confidenceScore
       ORDER BY
         CASE f.type WHEN 'blocker' THEN 0 ELSE 1 END,
         f.confidenceScore DESC,
         f.packageName ASC
       SKIP $skip LIMIT $pageSize`,
      {
        skip,
        pageSize: params.pageSize,
        targetAngularVersion: params.targetAngularVersion ?? null,
        severity: params.severity ?? null,
      },
    );

    const allItems: PackageCompatibilityItem[] = itemsResult.records.map((r) => ({
      id: r.get('id') as string,
      packageName: (r.get('packageName') as string | null) ?? '',
      installedVersion: (r.get('installedVersion') as string | null) ?? '',
      requiredVersion: r.get('requiredVersion') as string | null,
      reasonCode: r.get('reasonCode') as string,
      severity: r.get('type') as 'blocker' | 'risk',
      targetAngularVersion: (r.get('targetAngularVersion') as string | null) ?? '',
      description: r.get('description') as string,
      recommendedAction: r.get('recommendedAction') as string,
      confidenceScore: r.get('confidenceScore') as number,
    }));

    const blockers = allItems.filter((i) => i.severity === 'blocker');
    const risks = allItems.filter((i) => i.severity === 'risk');

    const hasMore = allItems.length === params.pageSize;

    return {
      appDb: params.appDb,
      summary: { total, blockers: blockerCount, risks: riskCount },
      blockers,
      risks,
      nextCursor: hasMore ? makeCursor(skip + params.pageSize) : undefined,
    };
  } finally {
    await session.close();
  }
}
