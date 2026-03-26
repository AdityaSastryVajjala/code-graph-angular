/**
 * Phase 4 — get_migration_summary
 * High-level migration readiness summary for an entire app or scoped project.
 */

import { z } from 'zod';
import { Driver } from 'neo4j-driver';
import { getSession } from '../../graph/db/connection.js';

const InputSchema = z.object({
  appDb: z.string(),
  projectId: z.string().optional(),
  includeWorkItemSeeds: z.boolean().optional().default(false),
});

export async function getMigrationSummary(
  driver: Driver,
  input: Record<string, unknown>,
): Promise<unknown> {
  const params = InputSchema.parse(input);
  const session = getSession(driver, params.appDb);

  try {
    const projectFilter = params.projectId
      ? 'AND EXISTS { MATCH (n)-[:BELONGS_TO_PROJECT]->(p:Project { id: $projectId }) }'
      : '';

    // Get migrationRunId from any Finding
    const runResult = await session.run(
      'MATCH (f:Finding) RETURN f.migrationRunId AS runId LIMIT 1',
    );
    const migrationRunId = (runResult.records[0]?.get('runId') as string | null) ?? 'unknown';

    // Standalone migration readiness
    const standaloneResult = await session.run(
      `MATCH (n)
       WHERE (n:Component OR n:Directive OR n:Pipe)
         ${projectFilter}
       RETURN
         count(n) AS totalArtifacts,
         count(CASE WHEN n.isStandaloneCandidate = true THEN 1 END) AS candidates,
         count(CASE WHEN n.isStandalone = true THEN 1 END) AS alreadyStandalone,
         count(CASE WHEN n.isStandaloneCandidate = false AND n.isStandalone = false THEN 1 END) AS blocked`,
      { projectId: params.projectId ?? null },
    );
    const sr = standaloneResult.records[0];
    const totalArtifacts = sr?.get('totalArtifacts')?.toNumber?.() ?? 0;
    const candidates = sr?.get('candidates')?.toNumber?.() ?? 0;
    const alreadyStandalone = sr?.get('alreadyStandalone')?.toNumber?.() ?? 0;
    const blocked = sr?.get('blocked')?.toNumber?.() ?? 0;
    const readinessPercent = (candidates + blocked) > 0
      ? Math.round((candidates / (candidates + blocked)) * 100)
      : 0;

    // NgModule health
    const ngmoduleResult = await session.run(
      `MATCH (m:NgModule)
       WHERE m.moduleComplexityScore IS NOT NULL
         ${projectFilter}
       RETURN
         count(m) AS totalModules,
         avg(m.moduleComplexityScore) AS avgScore,
         count(CASE WHEN m.standaloneMigrationFeasibility = 'high' THEN 1 END) AS high,
         count(CASE WHEN m.standaloneMigrationFeasibility = 'medium' THEN 1 END) AS medium,
         count(CASE WHEN m.standaloneMigrationFeasibility = 'low' THEN 1 END) AS low,
         count(CASE WHEN m.standaloneMigrationFeasibility = 'blocked' THEN 1 END) AS blocked`,
      { projectId: params.projectId ?? null },
    );
    const nr = ngmoduleResult.records[0];

    // Deprecated patterns
    const deprecatedResult = await session.run(
      `MATCH (f:Finding)
       WHERE f.isDeprecatedUsage = true
       RETURN f.severity AS s, count(f) AS cnt`,
    );
    const depBySeverity: Record<string, number> = {};
    for (const rec of deprecatedResult.records) {
      depBySeverity[rec.get('s') as string] =
        (rec.get('cnt') as { toNumber(): number }).toNumber();
    }

    const topRcResult = await session.run(
      `MATCH (f:Finding)
       WHERE f.isDeprecatedUsage = true
       RETURN f.reasonCode AS rc, count(f) AS cnt
       ORDER BY cnt DESC LIMIT 5`,
    );
    const topReasonCodes = topRcResult.records.map((r) => r.get('rc') as string);

    // Migration order stats
    const orderResult = await session.run(
      `MATCH (n)
       WHERE (n:NgModule OR n:Component OR n:Directive OR n:Pipe)
         AND n.migrationOrderIndex IS NOT NULL
         ${projectFilter}
       RETURN
         count(n) AS orderedArtifacts,
         count(DISTINCT n.migrationOrderIndex) AS estimatedWaves`,
      { projectId: params.projectId ?? null },
    );
    const or = orderResult.records[0];

    const blockedOrderResult = await session.run(
      `MATCH (f:Finding { reasonCode: 'ARCH_CIRCULAR_DEPENDENCY' })
       RETURN count(DISTINCT f.affectedNodeId) AS blockedByCircular`,
    );

    // Findings breakdown
    const findingsResult = await session.run(
      `MATCH (f:Finding)
       RETURN
         count(CASE WHEN f.type = 'blocker' THEN 1 END) AS blockers,
         count(CASE WHEN f.type = 'risk' THEN 1 END) AS risks,
         count(CASE WHEN f.type = 'opportunity' THEN 1 END) AS opportunities,
         count(CASE WHEN f.scope = 'production' THEN 1 END) AS productionScope,
         count(CASE WHEN f.scope = 'test' THEN 1 END) AS testScope`,
    );
    const fr = findingsResult.records[0];

    const response: Record<string, unknown> = {
      appDb: params.appDb,
      projectId: params.projectId,
      migrationRunId,
      analysisTimestamp: migrationRunId,
      standaloneMigration: {
        totalArtifacts,
        candidates,
        alreadyStandalone,
        blocked,
        readinessPercent,
      },
      ngmoduleHealth: {
        totalModules: nr?.get('totalModules')?.toNumber?.() ?? 0,
        feasibilityBreakdown: {
          high: nr?.get('high')?.toNumber?.() ?? 0,
          medium: nr?.get('medium')?.toNumber?.() ?? 0,
          low: nr?.get('low')?.toNumber?.() ?? 0,
          blocked: nr?.get('blocked')?.toNumber?.() ?? 0,
        },
        avgComplexityScore: Math.round(((nr?.get('avgScore') as number | null) ?? 0) * 10) / 10,
      },
      deprecatedPatterns: {
        totalFindings: Object.values(depBySeverity).reduce((a, b) => a + b, 0),
        bySeverity: depBySeverity,
        topReasonCodes,
      },
      migrationOrder: {
        orderedArtifacts: or?.get('orderedArtifacts')?.toNumber?.() ?? 0,
        blockedByCircularDeps:
          blockedOrderResult.records[0]?.get('blockedByCircular')?.toNumber?.() ?? 0,
        parallelGroups: or?.get('estimatedWaves')?.toNumber?.() ?? 0,
        estimatedWaves: or?.get('estimatedWaves')?.toNumber?.() ?? 0,
      },
      findings: {
        blockers: fr?.get('blockers')?.toNumber?.() ?? 0,
        risks: fr?.get('risks')?.toNumber?.() ?? 0,
        opportunities: fr?.get('opportunities')?.toNumber?.() ?? 0,
        productionScope: fr?.get('productionScope')?.toNumber?.() ?? 0,
        testScope: fr?.get('testScope')?.toNumber?.() ?? 0,
      },
    };

    if (params.includeWorkItemSeeds) {
      const seedsResult = await session.run(
        `MATCH (w:WorkItemSeed)
         RETURN w.id AS id, w.title AS title, w.description AS description,
                w.priority AS priority, w.affectedArtifacts AS affectedArtifacts,
                coalesce(w.dependencyHints, []) AS dependencyHints
         ORDER BY CASE w.priority WHEN 'p1' THEN 0 WHEN 'p2' THEN 1 ELSE 2 END
         LIMIT 50`,
      );
      response['workItemSeeds'] = seedsResult.records.map((r) => ({
        id: r.get('id') as string,
        title: r.get('title') as string,
        description: r.get('description') as string,
        priority: r.get('priority') as string,
        affectedArtifacts: (r.get('affectedArtifacts') as string[]) ?? [],
        dependencyHints: (r.get('dependencyHints') as string[]) ?? [],
      }));
    }

    return response;
  } finally {
    await session.close();
  }
}
