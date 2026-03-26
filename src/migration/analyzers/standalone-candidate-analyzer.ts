/**
 * Phase 4 — Migration Intelligence
 * StandaloneCandidateAnalyzer: determines which Components, Directives, and Pipes
 * are candidates for standalone migration and identifies blockers for non-candidates.
 *
 * Detection is fully graph-traversal-based — no AST re-parsing required.
 * Uses existing: isStandalone, DECLARES, IMPORTS, entryComponents properties.
 */

import { Session } from 'neo4j-driver';
import { FindingNode } from '../../graph/schema/nodes.js';
import { buildFinding } from '../finding-builder.js';

export interface StandaloneAnalysisResult {
  findings: FindingNode[];
  artifactCount: number;
  candidateCount: number;
}

export class StandaloneCandidateAnalyzer {
  constructor(
    private readonly session: Session,
    private readonly migrationRunId: string,
  ) {}

  async analyze(): Promise<StandaloneAnalysisResult> {
    const findings: FindingNode[] = [];

    // Query all Component/Directive/Pipe nodes and their module context
    const result = await this.session.run(`
      MATCH (artifact)
      WHERE (artifact:Component OR artifact:Directive OR artifact:Pipe)
        AND artifact.isStandalone = false
      OPTIONAL MATCH (mod:NgModule)-[:DECLARES]->(artifact)
      OPTIONAL MATCH (mod)-[:IMPORTS]->(importedMod:NgModule)
      WITH artifact,
           mod,
           artifact.filePath AS filePath,
           collect(DISTINCT importedMod.name) AS moduleImports
      RETURN artifact.id AS id,
             artifact.name AS name,
             labels(artifact)[0] AS kind,
             filePath,
             mod.id AS moduleId,
             mod.name AS moduleName,
             mod.entryComponents AS entryComponents,
             moduleImports
    `);

    const artifactIds: string[] = [];
    const candidateIds: string[] = [];

    for (const record of result.records) {
      const id = record.get('id') as string;
      const filePath = record.get('filePath') as string;
      const moduleId = record.get('moduleId') as string | null;
      const entryComponents = record.get('entryComponents') as string[] | null;

      artifactIds.push(id);

      const scope = filePath?.includes('.spec.') ? 'test' : 'production';
      const blockers: string[] = [];

      // Blocker: no declaring NgModule found in graph
      if (!moduleId) {
        blockers.push('ANG_NGMODULE_HEAVY');
      }

      // Blocker: entryComponents usage in declaring NgModule
      if (entryComponents && entryComponents.length > 0) {
        blockers.push('ANG_ENTRY_COMPONENTS');
      }

      const isCandidate = blockers.length === 0;

      const riskSeverity = blockers.length === 0
        ? 'low'
        : blockers.includes('ANG_ENTRY_COMPONENTS') ? 'high' : 'medium';

      // Write enriched properties onto the artifact
      await this.session.run(
        `MATCH (n { id: $id })
         SET n.isStandaloneCandidate = $isCandidate,
             n.standaloneBlockers = $blockers,
             n.migrationRisk = $migrationRisk,
             n.riskSeverity = $riskSeverity,
             n.migrationRunId = $runId`,
        {
          id,
          isCandidate,
          blockers,
          migrationRisk: !isCandidate,
          riskSeverity,
          runId: this.migrationRunId,
        },
      );

      if (isCandidate) {
        candidateIds.push(id);
      }

      // Emit a Finding for each blocker reason code
      for (const reasonCode of blockers) {
        try {
          const finding = buildFinding({
            affectedNodeId: id,
            reasonCode,
            scope,
            migrationRunId: this.migrationRunId,
            type: reasonCode === 'ANG_ENTRY_COMPONENTS' ? 'blocker' : 'risk',
          });
          findings.push(finding);
        } catch {
          // Skip unrecognised reason codes gracefully
        }
      }

      // Also emit an opportunity finding for NgModule-heavy artifacts that CAN be migrated
      if (isCandidate && moduleId) {
        try {
          const oppFinding = buildFinding({
            affectedNodeId: id,
            reasonCode: 'ANG_NGMODULE_HEAVY',
            scope,
            migrationRunId: this.migrationRunId,
            type: 'opportunity',
          });
          findings.push(oppFinding);
        } catch {
          // noop
        }
      }

    }

    // Handle already-standalone artifacts — mark them with no blockers
    await this.session.run(`
      MATCH (artifact)
      WHERE (artifact:Component OR artifact:Directive OR artifact:Pipe)
        AND artifact.isStandalone = true
      SET artifact.isStandaloneCandidate = false,
          artifact.standaloneBlockers = [],
          artifact.migrationRisk = false,
          artifact.riskSeverity = 'low',
          artifact.migrationRunId = $runId
    `, { runId: this.migrationRunId });

    return {
      findings,
      artifactCount: artifactIds.length,
      candidateCount: candidateIds.length,
    };
  }
}
