/**
 * Phase 4 — Migration Intelligence
 * DeprecatedPatternAnalyzer: detects deprecated Angular and RxJS patterns.
 *
 * Two detection passes:
 *  1. Graph-first: uses already-indexed node/relationship properties
 *  2. Supplementary AST pass: uses TypeScript Compiler API for patterns
 *     that require source inspection (patch imports, non-pipeable, toPromise, etc.)
 */

import { Session } from 'neo4j-driver';
import { readFileSync } from 'fs';
import ts from 'typescript';
import { FindingNode } from '../../graph/schema/nodes.js';
import { buildFinding } from '../finding-builder.js';

export interface DeprecatedPatternResult {
  findings: FindingNode[];
}

export class DeprecatedPatternAnalyzer {
  constructor(
    private readonly session: Session,
    private readonly migrationRunId: string,
  ) {}

  async analyze(): Promise<DeprecatedPatternResult> {
    const findings: FindingNode[] = [];

    await this.detectGraphBasedPatterns(findings);
    await this.detectAstBasedPatterns(findings);

    return { findings };
  }

  // ─── Graph-based detection ────────────────────────────────────────────────

  private async detectGraphBasedPatterns(findings: FindingNode[]): Promise<void> {
    await this.detectClassBasedGuards(findings);
    await this.detectClassBasedResolvers(findings);
    await this.detectChangeDetectionDefault(findings);
    await this.detectSubscriptionLeaks(findings);
  }

  private async detectClassBasedGuards(findings: FindingNode[]): Promise<void> {
    const guardInterfaces = ['CanActivate', 'CanDeactivate', 'CanLoad', 'CanMatch', 'CanActivateChild'];
    const result = await this.session.run(
      `MATCH (c:Class)-[:IMPLEMENTS]->(i:Interface)
       WHERE i.name IN $guardInterfaces
       RETURN DISTINCT c.id AS id, c.sourceFile AS sourceFile`,
      { guardInterfaces },
    );

    for (const record of result.records) {
      const id = record.get('id') as string;
      const sourceFile = record.get('sourceFile') as string;
      const scope: 'production' | 'test' = sourceFile?.includes('.spec.') ? 'test' : 'production';
      this.pushFinding(findings, id, 'ANG_CLASS_BASED_GUARD', scope, 'risk');
    }
  }

  private async detectClassBasedResolvers(findings: FindingNode[]): Promise<void> {
    const result = await this.session.run(
      `MATCH (c:Class)-[:IMPLEMENTS]->(i:Interface)
       WHERE i.name STARTS WITH 'Resolve'
       RETURN DISTINCT c.id AS id, c.sourceFile AS sourceFile`,
    );

    for (const record of result.records) {
      const id = record.get('id') as string;
      const sourceFile = record.get('sourceFile') as string;
      const scope: 'production' | 'test' = sourceFile?.includes('.spec.') ? 'test' : 'production';
      this.pushFinding(findings, id, 'ANG_CLASS_BASED_RESOLVER', scope, 'risk');
    }
  }

  private async detectChangeDetectionDefault(findings: FindingNode[]): Promise<void> {
    const result = await this.session.run(
      `MATCH (c:Component)
       WHERE (c.changeDetection = 'Default' OR c.changeDetection IS NULL)
         AND c.isStandalone = false
       RETURN c.id AS id, c.filePath AS filePath`,
    );

    for (const record of result.records) {
      const id = record.get('id') as string;
      const filePath = record.get('filePath') as string;
      const scope: 'production' | 'test' = filePath?.includes('.spec.') ? 'test' : 'production';
      this.pushFinding(findings, id, 'ANG_CD_DEFAULT', scope, 'opportunity');
    }
  }

  private async detectSubscriptionLeaks(findings: FindingNode[]): Promise<void> {
    // Methods with a subscribe() call but no takeUntil/unsubscribe/async in same method
    const result = await this.session.run(
      `MATCH (m:Method)-[:CALLS_METHOD { callee: 'subscribe' }]->(:Method)
       WHERE NOT EXISTS {
         MATCH (m)-[:CALLS_METHOD]->(other:Method)
         WHERE other.name IN ['unsubscribe', 'takeUntil', 'takeUntilDestroyed', 'take']
       }
       RETURN DISTINCT m.id AS id, m.sourceFile AS sourceFile`,
    );

    for (const record of result.records) {
      const id = record.get('id') as string;
      const sourceFile = record.get('sourceFile') as string;
      const scope: 'production' | 'test' = sourceFile?.includes('.spec.') ? 'test' : 'production';

      // Mark the Method node
      await this.session.run(
        `MATCH (m:Method { id: $id }) SET m.hasSubscriptionLeak = true, m.migrationRunId = $runId`,
        { id, runId: this.migrationRunId },
      );

      this.pushFinding(findings, id, 'RXJS_SUBSCRIPTION_LEAK', scope, 'risk');
    }
  }

  // ─── AST-based detection ──────────────────────────────────────────────────

  private async detectAstBasedPatterns(findings: FindingNode[]): Promise<void> {
    // Fetch all indexed TS file paths
    const result = await this.session.run(
      `MATCH (f:File) WHERE f.fileType = 'ts' RETURN f.filePath AS filePath, f.id AS id`,
    );

    for (const record of result.records) {
      const filePath = record.get('filePath') as string;
      const fileId = record.get('id') as string;
      const scope: 'production' | 'test' = filePath?.includes('.spec.') ? 'test' : 'production';

      let source: string;
      try {
        source = readFileSync(filePath, 'utf-8');
      } catch {
        continue; // file may have been deleted since indexing
      }

      const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);

      this.scanImports(sourceFile, fileId, scope, findings);
      this.scanCallExpressions(sourceFile, fileId, scope, findings);
      this.scanReturnTypes(sourceFile, fileId, scope, findings);
    }
  }

  private scanImports(
    sourceFile: ts.SourceFile,
    fileId: string,
    scope: 'production' | 'test',
    findings: FindingNode[],
  ): void {
    ts.forEachChild(sourceFile, (node) => {
      if (!ts.isImportDeclaration(node)) return;
      const moduleSpec = node.moduleSpecifier;
      if (!ts.isStringLiteral(moduleSpec)) return;
      const path = moduleSpec.text;

      // RxJS patch imports: rxjs/add/operator/* or rxjs/add/observable/*
      if (path.startsWith('rxjs/add/')) {
        this.pushFinding(findings, fileId, 'RXJS_PATCH_IMPORTS', scope, 'risk');
      }
    });
  }

  private scanCallExpressions(
    sourceFile: ts.SourceFile,
    fileId: string,
    scope: 'production' | 'test',
    findings: FindingNode[],
  ): void {
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const expr = node.expression;

        // toPromise()
        if (ts.isPropertyAccessExpression(expr) && expr.name.text === 'toPromise') {
          this.pushFinding(findings, fileId, 'RXJS_TO_PROMISE', scope, 'risk');
        }

        // throwError('string') — first arg is string literal
        if (ts.isIdentifier(expr) && expr.text === 'throwError') {
          const firstArg = node.arguments[0];
          if (firstArg && ts.isStringLiteral(firstArg)) {
            this.pushFinding(findings, fileId, 'RXJS_THROW_ERROR_STRING', scope, 'risk');
          }
        }

        // ComponentFactoryResolver in constructor injection
        if (
          ts.isPropertyAccessExpression(expr) &&
          (expr.name.text === 'resolveComponentFactory' ||
           (ts.isIdentifier(expr.expression) &&
            expr.expression.text === 'ComponentFactoryResolver'))
        ) {
          this.pushFinding(findings, fileId, 'ANG_COMPONENT_FACTORY', scope, 'risk');
        }
      }

      ts.forEachChild(node, visit);
    };

    ts.forEachChild(sourceFile, visit);
  }

  private scanReturnTypes(
    sourceFile: ts.SourceFile,
    fileId: string,
    scope: 'production' | 'test',
    findings: FindingNode[],
  ): void {
    const visit = (node: ts.Node): void => {
      // ModuleWithProviders return type
      if (
        (ts.isMethodDeclaration(node) || ts.isFunctionDeclaration(node)) &&
        node.type &&
        ts.isTypeReferenceNode(node.type)
      ) {
        const typeName = ts.isIdentifier(node.type.typeName)
          ? node.type.typeName.text
          : '';
        if (typeName === 'ModuleWithProviders') {
          this.pushFinding(findings, fileId, 'ANG_MODULE_WITH_PROVIDERS', scope, 'opportunity');
        }
      }

      ts.forEachChild(node, visit);
    };

    ts.forEachChild(sourceFile, visit);
  }

  private pushFinding(
    findings: FindingNode[],
    nodeId: string,
    reasonCode: string,
    scope: 'production' | 'test',
    type: 'blocker' | 'risk' | 'opportunity',
  ): void {
    try {
      const finding = buildFinding({
        affectedNodeId: nodeId,
        reasonCode,
        scope,
        migrationRunId: this.migrationRunId,
        type,
      });
      // Deduplicate by id
      if (!findings.some((f) => f.id === finding.id)) {
        findings.push(finding);
      }
    } catch {
      // Unknown reason code — skip
    }
  }
}
