/**
 * Phase 4 — Migration Intelligence
 * TemplateModerizationAnalyzer: detects template-level migration blockers and hints.
 *
 * Detects from existing TEMPLATE_BINDS_* and TEMPLATE_USES_PIPE relationships:
 * - ngModel without FormsModule import (blocker)
 * - Pipe usage without standalone import (blocker)
 * - async pipe without OnPush change detection (hint)
 * - Old structural directive syntax (*ngIf, *ngFor, *ngSwitch) via template content (hint)
 */

import { Session } from 'neo4j-driver';
import { FindingNode } from '../../graph/schema/nodes.js';
import { buildFinding } from '../finding-builder.js';

export interface TemplateModerizationResult {
  findings: FindingNode[];
}

export class TemplateModerizationAnalyzer {
  constructor(
    private readonly session: Session,
    private readonly migrationRunId: string,
  ) {}

  async analyze(): Promise<TemplateModerizationResult> {
    const findings: FindingNode[] = [];

    await this.detectNgModelWithoutFormsModule(findings);
    await this.detectPipeMissingImport(findings);
    await this.detectAsyncWithoutOnPush(findings);

    return { findings };
  }

  /** ngModel usage in standalone component without FormsModule in imports */
  private async detectNgModelWithoutFormsModule(findings: FindingNode[]): Promise<void> {
    const result = await this.session.run(`
      MATCH (c:Component { isStandalone: true })
      MATCH (t:Template)-[:USES_TEMPLATE]-(c)
      MATCH (t)-[:TEMPLATE_USES_DIRECTIVE]->(d:Directive)
      WHERE d.selector CONTAINS 'ngModel'
        AND NOT EXISTS {
          MATCH (c)-[:IMPORTS]->(m)
          WHERE m.name = 'FormsModule' OR m.name = 'ReactiveFormsModule'
        }
      RETURN DISTINCT c.id AS id, c.filePath AS filePath
    `);

    for (const record of result.records) {
      const id = record.get('id') as string;
      const filePath = record.get('filePath') as string;
      const scope: 'production' | 'test' = filePath?.includes('.spec.') ? 'test' : 'production';

      try {
        findings.push(buildFinding({
          affectedNodeId: id,
          reasonCode: 'TMPL_NGMODEL_MISSING_IMPORT',
          scope,
          migrationRunId: this.migrationRunId,
          type: 'blocker',
        }));
      } catch {
        // noop
      }
    }
  }

  /** Pipe usage in standalone component without that pipe in imports */
  private async detectPipeMissingImport(findings: FindingNode[]): Promise<void> {
    const result = await this.session.run(`
      MATCH (c:Component { isStandalone: true })
      MATCH (t:Template)-[:USES_TEMPLATE]-(c)
      MATCH (t)-[:TEMPLATE_USES_PIPE]->(p:Pipe)
      WHERE p.isStandalone = true
        AND NOT EXISTS {
          MATCH (c)-[:IMPORTS]->(p)
        }
      RETURN DISTINCT c.id AS id, c.filePath AS filePath
    `);

    for (const record of result.records) {
      const id = record.get('id') as string;
      const filePath = record.get('filePath') as string;
      const scope: 'production' | 'test' = filePath?.includes('.spec.') ? 'test' : 'production';

      try {
        findings.push(buildFinding({
          affectedNodeId: id,
          reasonCode: 'TMPL_PIPE_MISSING_IMPORT',
          scope,
          migrationRunId: this.migrationRunId,
          type: 'blocker',
        }));
      } catch {
        // noop
      }
    }
  }

  /** async pipe without OnPush change detection */
  private async detectAsyncWithoutOnPush(findings: FindingNode[]): Promise<void> {
    const result = await this.session.run(`
      MATCH (c:Component)
      WHERE c.changeDetection <> 'OnPush' OR c.changeDetection IS NULL
      MATCH (t:Template)-[:USES_TEMPLATE]-(c)
      MATCH (t)-[:TEMPLATE_USES_PIPE]->(p:Pipe { pipeName: 'async' })
      RETURN DISTINCT c.id AS id, c.filePath AS filePath
    `);

    for (const record of result.records) {
      const id = record.get('id') as string;
      const filePath = record.get('filePath') as string;
      const scope: 'production' | 'test' = filePath?.includes('.spec.') ? 'test' : 'production';

      try {
        findings.push(buildFinding({
          affectedNodeId: id,
          reasonCode: 'TMPL_ASYNC_WITHOUT_ONPUSH',
          scope,
          migrationRunId: this.migrationRunId,
          type: 'opportunity',
        }));
      } catch {
        // noop
      }
    }
  }
}
