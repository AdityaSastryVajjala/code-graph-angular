/**
 * Phase 4 — Migration Intelligence
 * NgModuleComplexityAnalyzer: computes moduleComplexityScore and
 * standaloneMigrationFeasibility for every NgModule in the graph.
 *
 * Scoring formula (from research.md):
 *   score = declarations×1.0 + imports×1.5 + exports×1.2 + consumers×2.0 + crossProjectImports×3.0
 * Normalized to [0, 100].
 *
 * Feasibility bands:
 *   0–20   → high
 *   21–50  → medium
 *   51–80  → low
 *   81–100 → blocked
 */

import { Session } from 'neo4j-driver';
import { FindingNode } from '../../graph/schema/nodes.js';
import { buildFinding } from '../finding-builder.js';

export interface NgModuleComplexityResult {
  findings: FindingNode[];
  moduleCount: number;
}

const MAX_THEORETICAL_SCORE = 300; // normalization ceiling

export class NgModuleComplexityAnalyzer {
  constructor(
    private readonly session: Session,
    private readonly migrationRunId: string,
  ) {}

  async analyze(): Promise<NgModuleComplexityResult> {
    const findings: FindingNode[] = [];

    const result = await this.session.run(`
      MATCH (m:NgModule)
      OPTIONAL MATCH (m)-[:DECLARES]->(decl)
      OPTIONAL MATCH (m)-[:IMPORTS]->(imp)
      OPTIONAL MATCH (m)-[:EXPORTS]->(exp)
      OPTIONAL MATCH (consumer:NgModule)-[:IMPORTS]->(m)
      WITH m,
           count(DISTINCT decl) AS declCount,
           count(DISTINCT imp)  AS importCount,
           count(DISTINCT exp)  AS exportCount,
           count(DISTINCT consumer) AS consumerCount
      OPTIONAL MATCH (m)-[:IMPORTS]->(crossImp:NgModule)
      WHERE EXISTS { MATCH (m)-[:BELONGS_TO_PROJECT]->(p1:Project)
                     MATCH (crossImp)-[:BELONGS_TO_PROJECT]->(p2:Project)
                     WHERE p1.id <> p2.id }
      WITH m, declCount, importCount, exportCount, consumerCount,
           count(DISTINCT crossImp) AS crossProjectImports
      RETURN m.id AS id,
             m.filePath AS filePath,
             declCount,
             importCount,
             exportCount,
             consumerCount,
             crossProjectImports
    `);

    for (const record of result.records) {
      const id = record.get('id') as string;
      const filePath = record.get('filePath') as string;
      const declCount = (record.get('declCount') as { toNumber(): number }).toNumber();
      const importCount = (record.get('importCount') as { toNumber(): number }).toNumber();
      const exportCount = (record.get('exportCount') as { toNumber(): number }).toNumber();
      const consumerCount = (record.get('consumerCount') as { toNumber(): number }).toNumber();
      const crossProjectImports = (record.get('crossProjectImports') as { toNumber(): number }).toNumber();

      const rawScore =
        declCount * 1.0 +
        importCount * 1.5 +
        exportCount * 1.2 +
        consumerCount * 2.0 +
        crossProjectImports * 3.0;

      const moduleComplexityScore = Math.min(
        100,
        Math.round((rawScore / MAX_THEORETICAL_SCORE) * 100 * 10) / 10,
      );

      const standaloneMigrationFeasibility = scoreToBand(moduleComplexityScore);
      const migrationRisk = moduleComplexityScore > 50;
      const riskSeverity = moduleComplexityScore > 80
        ? 'critical'
        : moduleComplexityScore > 50
          ? 'high'
          : moduleComplexityScore > 20
            ? 'medium'
            : 'low';

      await this.session.run(
        `MATCH (m:NgModule { id: $id })
         SET m.moduleComplexityScore = $score,
             m.standaloneMigrationFeasibility = $feasibility,
             m.migrationRisk = $risk,
             m.riskSeverity = $riskSeverity,
             m.migrationRunId = $runId`,
        {
          id,
          score: moduleComplexityScore,
          feasibility: standaloneMigrationFeasibility,
          risk: migrationRisk,
          riskSeverity,
          runId: this.migrationRunId,
        },
      );

      // Emit a finding for blocked modules (very high complexity)
      if (standaloneMigrationFeasibility === 'blocked') {
        const scope: 'production' | 'test' = filePath?.includes('.spec.') ? 'test' : 'production';
        try {
          findings.push(buildFinding({
            affectedNodeId: id,
            reasonCode: 'ANG_NGMODULE_HEAVY',
            scope,
            migrationRunId: this.migrationRunId,
            type: 'risk',
          }));
        } catch {
          // noop
        }
      }
    }

    return { findings, moduleCount: result.records.length };
  }
}

function scoreToBand(score: number): 'high' | 'medium' | 'low' | 'blocked' {
  if (score <= 20) return 'high';
  if (score <= 50) return 'medium';
  if (score <= 80) return 'low';
  return 'blocked';
}
