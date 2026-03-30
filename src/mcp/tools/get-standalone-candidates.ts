/**
 * Phase 4 — get_standalone_candidates
 * Lists Angular artifacts eligible for standalone migration with their blockers.
 */

import { z } from 'zod';
import { Driver } from 'neo4j-driver';
import { getSession } from '../../graph/db/connection.js';
import { parseCursor, makeCursor } from '../server.js';

const InputSchema = z.object({
  appDb: z.string(),
  projectId: z.string().optional(),
  candidatesOnly: z.boolean().optional().default(false),
  includeBlockers: z.boolean().optional().default(true),
  pageSize: z.number().min(1).max(200).optional().default(50),
  cursor: z.string().optional(),
});

export async function getStandaloneCandidates(
  driver: Driver,
  input: Record<string, unknown>,
): Promise<unknown> {
  const params = InputSchema.parse(input);
  const session = getSession(driver, params.appDb);

  try {
    const skip = parseCursor(params.cursor);

    const whereClause = [
      params.candidatesOnly ? 'artifact.isStandaloneCandidate = true' : null,
      params.projectId
        ? 'EXISTS { MATCH (artifact)-[:BELONGS_TO_PROJECT]->(p:Project { id: $projectId }) }'
        : null,
    ].filter(Boolean).join(' AND ');

    const whereStr = whereClause ? `AND ${whereClause}` : '';

    // Summary counts
    const summaryResult = await session.run(
      `MATCH (artifact)
       WHERE (artifact:Component OR artifact:Directive OR artifact:Pipe)
         AND artifact.isStandaloneCandidate IS NOT NULL
       RETURN
         count(artifact) AS totalArtifacts,
         count(CASE WHEN artifact.isStandaloneCandidate = true THEN 1 END) AS candidateCount,
         count(CASE WHEN artifact.isStandaloneCandidate = false THEN 1 END) AS blockedCount,
         count(CASE WHEN artifact.isStandalone = true THEN 1 END) AS alreadyStandalone`,
      { projectId: params.projectId ?? null },
    );

    const summaryRecord = summaryResult.records[0];
    const summary = {
      totalArtifacts: summaryRecord?.get('totalArtifacts')?.toNumber?.() ?? 0,
      candidateCount: summaryRecord?.get('candidateCount')?.toNumber?.() ?? 0,
      blockedCount: summaryRecord?.get('blockedCount')?.toNumber?.() ?? 0,
      alreadyStandalone: summaryRecord?.get('alreadyStandalone')?.toNumber?.() ?? 0,
    };

    // Items
    const itemsResult = await session.run(
      `MATCH (artifact)
       WHERE (artifact:Component OR artifact:Directive OR artifact:Pipe)
         AND artifact.isStandaloneCandidate IS NOT NULL
         ${whereStr}
       OPTIONAL MATCH (artifact)-[:BELONGS_TO_PROJECT]->(proj:Project)
       RETURN artifact.id AS nodeId,
              artifact.name AS name,
              labels(artifact)[0] AS kind,
              artifact.filePath AS filePath,
              artifact.isStandaloneCandidate AS isStandaloneCandidate,
              artifact.standaloneBlockers AS standaloneBlockers,
              artifact.riskSeverity AS riskSeverity,
              proj.id AS projectId
       ORDER BY artifact.name
       SKIP $skip LIMIT $pageSize`,
      {
        skip,
        pageSize: params.pageSize,
        projectId: params.projectId ?? null,
      },
    );

    const items = itemsResult.records.map((r) => ({
      nodeId: r.get('nodeId') as string,
      name: r.get('name') as string,
      kind: r.get('kind') as string,
      filePath: r.get('filePath') as string,
      isStandaloneCandidate: r.get('isStandaloneCandidate') as boolean,
      standaloneBlockers: params.includeBlockers
        ? ((r.get('standaloneBlockers') as string[] | null) ?? [])
        : [],
      riskSeverity: (r.get('riskSeverity') as string) ?? 'low',
      confidenceScore: (r.get('isStandaloneCandidate') as boolean) ? 0.90 : 0.95,
      projectId: (r.get('projectId') as string | null) ?? undefined,
    }));

    const nextSkip = skip + params.pageSize;
    const hasMore = items.length === params.pageSize;

    return {
      appDb: params.appDb,
      summary,
      items,
      nextCursor: hasMore ? makeCursor(nextSkip) : null,
    };
  } finally {
    await session.close();
  }
}
