/**
 * Phase 4 — Migration Intelligence
 * MigrationRunner: orchestrates the full migration analysis lifecycle.
 *
 * Lifecycle per run:
 *  1. Generate a unique migrationRunId (ISO timestamp)
 *  2. Clear all previous Finding/WorkItemSeed nodes and enriched migration
 *     properties from the target database
 *  3. Run each analyzer in sequence (standalone → deprecated → template →
 *     ngmodule → migration order)
 *  4. Write WorkItemSeed nodes for each Finding
 *  5. Emit observability stdout signals throughout
 */

import { Driver, Session } from 'neo4j-driver';
import { getSession } from '../graph/db/connection.js';
import { logger } from '../shared/logger.js';
import { FindingNode, WorkItemSeedNode } from '../graph/schema/nodes.js';
import { buildWorkItemSeed } from './finding-builder.js';
import { StandaloneCandidateAnalyzer } from './analyzers/standalone-candidate-analyzer.js';
import { DeprecatedPatternAnalyzer } from './analyzers/deprecated-pattern-analyzer.js';
import { TemplateModerizationAnalyzer } from './analyzers/template-modernization-analyzer.js';
import { NgModuleComplexityAnalyzer } from './analyzers/ngmodule-complexity-analyzer.js';
import { MigrationOrderAnalyzer } from './analyzers/migration-order-analyzer.js';
import { PackageCompatibilityAnalyzer } from './analyzers/package-compatibility-analyzer.js';

export interface MigrationRunResult {
  migrationRunId: string;
  durationMs: number;
  totalFindings: number;
  blockers: number;
  risks: number;
  opportunities: number;
  standaloneCandidates: number;
  totalArtifacts: number;
  /** Semver read from the ApplicationNode stored in Neo4j, e.g. "17.3.0" */
  currentAngularVersion: string;
  /** Desired migration target, supplied by the caller (defaults to "latest") */
  targetAngularVersion: string;
}

export interface MigrationRunnerOptions {
  appDb: string;
  /**
   * The Angular version you want to migrate TO (e.g. "19.0.0").
   * Defaults to "latest" when not provided.
   * Used to scope version-specific risk recommendations.
   */
  targetAngularVersion?: string;
  /** Optional: absolute path to write JSON export (FR-022) */
  outputPath?: string;
  /**
   * Optional: absolute path to the workspace root directory containing package.json.
   * When provided, Step 0 package compatibility analysis runs before all other steps.
   * When absent, the package compatibility step is skipped gracefully.
   */
  workspaceRootPath?: string;
}

export class MigrationRunner {
  constructor(private readonly driver: Driver) {}

  async run(options: MigrationRunnerOptions): Promise<MigrationRunResult> {
    const { appDb } = options;
    const targetAngularVersion = options.targetAngularVersion ?? 'latest';
    const migrationRunId = new Date().toISOString();
    const startMs = Date.now();

    process.stdout.write(`[migrate] Starting full migration analysis for app: ${appDb}\n`);
    logger.info('migration_run_start', { appDb, migrationRunId });

    const session = getSession(this.driver, appDb);

    try {
      // Verify the database has been indexed
      await this.verifyDatabaseExists(session, appDb);

      // Read the Angular version and workspace root path from the ApplicationNode
      const { angularVersion: currentAngularVersion, rootPath: discoveredRoot } = await this.readApplicationInfo(session);

      // Resolve workspaceRootPath: explicit option wins, then discovered from graph
      const workspaceRootPath = options.workspaceRootPath ?? discoveredRoot;

      process.stdout.write(
        `[migrate] Angular version: ${currentAngularVersion} → target: ${targetAngularVersion}\n`,
      );

      // Step 1: Clear all previous migration findings and enriched properties
      await this.clearPreviousFindings(session);

      // Step 0: Package compatibility analysis (runs before all other steps)
      const allFindings: FindingNode[] = [];

      if (workspaceRootPath) {
        process.stdout.write('[migrate] Step 0: Package compatibility analysis...');
        const t0 = Date.now();
        const pkgAnalyzer = new PackageCompatibilityAnalyzer(this.driver, appDb);
        const pkgResult = await pkgAnalyzer.analyze(
          workspaceRootPath,
          targetAngularVersion,
          migrationRunId,
        );
        allFindings.push(...pkgResult.findings);
        process.stdout.write(
          `  [done in ${Date.now() - t0}ms, ` +
          `${pkgResult.packagesAnalyzed} packages analyzed, ` +
          `${pkgResult.blockersFound} blockers, ${pkgResult.risksFound} risks]\n`,
        );
      }

      // Step 2: Run all analyzers
      // Standalone candidate analysis
      process.stdout.write('[migrate] Analyzing standalone candidates...');
      const t1 = Date.now();
      const standaloneAnalyzer = new StandaloneCandidateAnalyzer(session, migrationRunId);
      const standaloneResult = await standaloneAnalyzer.analyze();
      allFindings.push(...standaloneResult.findings);
      process.stdout.write(
        `   [done in ${Date.now() - t1}ms, ${standaloneResult.artifactCount} artifacts]\n`,
      );

      // NgModule complexity analysis
      process.stdout.write('[migrate] Analyzing NgModule complexity...');
      const t2 = Date.now();
      const ngmoduleAnalyzer = new NgModuleComplexityAnalyzer(session, migrationRunId);
      const ngmoduleResult = await ngmoduleAnalyzer.analyze();
      allFindings.push(...ngmoduleResult.findings);
      process.stdout.write(
        `      [done in ${Date.now() - t2}ms, ${ngmoduleResult.moduleCount} modules]\n`,
      );

      // Deprecated pattern detection
      process.stdout.write('[migrate] Detecting deprecated patterns...');
      const t3 = Date.now();
      const deprecatedAnalyzer = new DeprecatedPatternAnalyzer(session, migrationRunId);
      const deprecatedResult = await deprecatedAnalyzer.analyze();
      allFindings.push(...deprecatedResult.findings);
      process.stdout.write(
        `      [done in ${Date.now() - t3}ms, ${deprecatedResult.findings.length} findings]\n`,
      );

      // Template modernization detection
      process.stdout.write('[migrate] Detecting template modernization...');
      const t4 = Date.now();
      const templateAnalyzer = new TemplateModerizationAnalyzer(session, migrationRunId);
      const templateResult = await templateAnalyzer.analyze();
      allFindings.push(...templateResult.findings);
      process.stdout.write(
        `      [done in ${Date.now() - t4}ms, ${templateResult.findings.length} findings]\n`,
      );

      // Migration order computation
      process.stdout.write('[migrate] Computing migration order...');
      const t5 = Date.now();
      const orderAnalyzer = new MigrationOrderAnalyzer(session, migrationRunId);
      const orderResult = await orderAnalyzer.analyze();
      allFindings.push(...orderResult.findings);
      process.stdout.write(
        `          [done in ${Date.now() - t5}ms, ` +
        `${orderResult.orderedCount} ordered, ${orderResult.blockedCount} blocked]\n`,
      );

      // Step 3: Write all findings and generate WorkItemSeeds
      process.stdout.write('[migrate] Writing findings to graph...');
      const t6 = Date.now();
      const { nodeCount, edgeCount } = await this.writeFindings(session, allFindings, migrationRunId);
      process.stdout.write(
        `          [done in ${Date.now() - t6}ms, ${nodeCount} nodes, ${edgeCount} edges]\n`,
      );

      // Step 4: Wire WORK_ITEM_DEPENDS_ON edges between WorkItemSeeds via MIGRATION_ORDER
      process.stdout.write('[migrate] Linking work item dependencies...');
      const t7 = Date.now();
      const depEdgeCount = await this.linkWorkItemDependencies(session, migrationRunId);
      process.stdout.write(`  [done in ${Date.now() - t7}ms, ${depEdgeCount} dependency edges]\n`);

      const durationMs = Date.now() - startMs;
      const blockers = allFindings.filter((f) => f.type === 'blocker').length;
      const risks = allFindings.filter((f) => f.type === 'risk').length;
      const opportunities = allFindings.filter((f) => f.type === 'opportunity').length;

      const result: MigrationRunResult = {
        migrationRunId,
        durationMs,
        totalFindings: allFindings.length,
        blockers,
        risks,
        opportunities,
        standaloneCandidates: standaloneResult.candidateCount,
        totalArtifacts: standaloneResult.artifactCount,
        currentAngularVersion,
        targetAngularVersion,
      };

      process.stdout.write(
        `[migrate] Analysis complete.\n` +
        `          Run ID: ${migrationRunId}\n` +
        `          Duration: ${Math.round(durationMs / 1000)}s\n` +
        `          Angular: ${currentAngularVersion} → ${targetAngularVersion}\n` +
        `          Findings: ${allFindings.length} total ` +
        `(${blockers} blockers, ${risks} risks, ${opportunities} opportunities)\n` +
        `          Standalone candidates: ${standaloneResult.candidateCount}/${standaloneResult.artifactCount}\n`,
      );

      logger.info('migration_run_complete', {
        appDb,
        migrationRunId,
        durationMs,
        totalFindings: allFindings.length,
        currentAngularVersion,
        targetAngularVersion,
      });

      if (options.outputPath) {
        await this.writeJsonExport(options.outputPath, result, allFindings);
      }

      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`migration_run_error appDb=${appDb}`, undefined, err instanceof Error ? err : new Error(msg));
      throw err;
    } finally {
      await session.close();
    }
  }

  private async verifyDatabaseExists(session: Session, appDb: string): Promise<void> {
    const result = await session.run(
      "MATCH (m:_IndexMeta) WHERE m.status = 'complete' RETURN count(m) AS cnt LIMIT 1",
    );
    const cnt = result.records[0]?.get('cnt')?.toNumber?.() ?? 0;
    if (cnt === 0) {
      const err = new Error(`App '${appDb}' not found in graph. Run 'codegraph index' first.`);
      (err as NodeJS.ErrnoException).code = 'APP_NOT_FOUND';
      throw err;
    }
  }

  private async clearPreviousFindings(session: Session): Promise<void> {
    // Delete all Finding and WorkItemSeed nodes
    await session.run('MATCH (f:Finding) DETACH DELETE f');
    await session.run('MATCH (w:WorkItemSeed) DETACH DELETE w');

    // Clear enriched migration properties from Component/Directive/Pipe
    await session.run(`
      MATCH (n)
      WHERE n:Component OR n:Directive OR n:Pipe
      REMOVE n.isStandaloneCandidate, n.standaloneBlockers,
             n.migrationRisk, n.riskSeverity,
             n.migrationOrderIndex, n.migrationRunId
    `);

    // Clear enriched migration properties from NgModule
    await session.run(`
      MATCH (m:NgModule)
      REMOVE m.moduleComplexityScore, m.standaloneMigrationFeasibility,
             m.migrationOrderIndex, m.migrationRisk,
             m.riskSeverity, m.migrationRunId
    `);

    // Clear enriched migration properties from Method (RxJS)
    await session.run(`
      MATCH (m:Method)
      REMOVE m.hasSubscriptionLeak, m.migrationRunId
    `);
  }

  private async writeFindings(
    session: Session,
    findings: FindingNode[],
    migrationRunId: string,
  ): Promise<{ nodeCount: number; edgeCount: number }> {
    let nodeCount = 0;
    let edgeCount = 0;

    const BATCH = 50;
    for (let i = 0; i < findings.length; i += BATCH) {
      const batch = findings.slice(i, i + BATCH);

      // Write Finding nodes
      await session.run(
        `UNWIND $findings AS f
         MERGE (n:Finding { id: f.id })
         SET n += f`,
        { findings: batch },
      );
      nodeCount += batch.length;

      // Write HAS_FINDING relationships
      await session.run(
        `UNWIND $findings AS f
         MATCH (artifact { id: f.affectedNodeId })
         MATCH (finding:Finding { id: f.id })
         MERGE (artifact)-[:HAS_FINDING { runId: $runId }]->(finding)`,
        { findings: batch, runId: migrationRunId },
      );
      edgeCount += batch.length;

      // Write WorkItemSeeds
      const seeds: WorkItemSeedNode[] = batch.map((f) =>
        buildWorkItemSeed(
          f,
          buildWorkItemTitle(f),
          f.recommendedAction,
          [f.affectedNodeId],
        ),
      );

      await session.run(
        `UNWIND $seeds AS s
         MERGE (w:WorkItemSeed { id: s.id })
         SET w += s`,
        { seeds },
      );
      nodeCount += seeds.length;

      // Write FINDING_GENERATES relationships
      await session.run(
        `UNWIND $pairs AS p
         MATCH (f:Finding { id: p.findingId })
         MATCH (w:WorkItemSeed { id: p.seedId })
         MERGE (f)-[:FINDING_GENERATES]->(w)`,
        { pairs: batch.map((f, idx) => ({ findingId: f.id, seedId: seeds[idx].id })) },
      );
      edgeCount += batch.length;
    }

    return { nodeCount, edgeCount };
  }

  /**
   * Reads the Angular version and workspace root path stored on the ApplicationNode in Neo4j.
   * Falls back to 'unknown' / undefined if no Application node is present.
   */
  private async readApplicationInfo(session: Session): Promise<{ angularVersion: string; rootPath: string | undefined }> {
    const result = await session.run(
      'MATCH (a:Application) RETURN a.angularVersion AS v, a.rootPath AS rootPath LIMIT 1',
    );
    const v = result.records[0]?.get('v');
    const rootPath = result.records[0]?.get('rootPath');
    return {
      angularVersion: typeof v === 'string' && v.length > 0 ? v : 'unknown',
      rootPath: typeof rootPath === 'string' && rootPath.length > 0 ? rootPath : undefined,
    };
  }

  /**
   * Creates WORK_ITEM_DEPENDS_ON edges between WorkItemSeed nodes by traversing
   * the existing MIGRATION_ORDER edges on their affected artifacts.
   *
   * Semantics:
   *   (w1)-[:WORK_ITEM_DEPENDS_ON]->(w2)
   *   means "w1 cannot begin until w2 is complete"
   *
   * This mirrors the artifact-level ordering:
   *   (artifact_for_w1)-[:MIGRATION_ORDER]->(artifact_for_w2)
   *   meaning artifact_for_w1 depends on artifact_for_w2 (it must be done first).
   *
   * Returns the number of dependency edges written.
   */
  private async linkWorkItemDependencies(session: Session, migrationRunId: string): Promise<number> {
    const result = await session.run(
      `MATCH (f1:Finding { migrationRunId: $runId })-[:FINDING_GENERATES]->(w1:WorkItemSeed)
       MATCH (f2:Finding { migrationRunId: $runId })-[:FINDING_GENERATES]->(w2:WorkItemSeed)
       MATCH (a1 { id: f1.affectedNodeId })-[:MIGRATION_ORDER]->(a2 { id: f2.affectedNodeId })
       WHERE w1.id <> w2.id
       MERGE (w1)-[:WORK_ITEM_DEPENDS_ON]->(w2)
       RETURN count(*) AS edgeCount`,
      { runId: migrationRunId },
    );
    return result.records[0]?.get('edgeCount')?.toNumber?.() ?? 0;
  }

  private async writeJsonExport(
    outputPath: string,
    result: MigrationRunResult,
    findings: FindingNode[],
  ): Promise<void> {
    const { writeFileSync } = await import('fs');
    const report = {
      migrationRunId: result.migrationRunId,
      analysisTimestamp: result.migrationRunId,
      durationMs: result.durationMs,
      angularVersions: {
        current: result.currentAngularVersion,
        target: result.targetAngularVersion,
      },
      summary: {
        totalFindings: result.totalFindings,
        blockers: result.blockers,
        risks: result.risks,
        opportunities: result.opportunities,
        standaloneCandidates: result.standaloneCandidates,
        totalArtifacts: result.totalArtifacts,
      },
      findings,
    };
    writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf-8');
    logger.info('migration_json_export', { outputPath });
  }
}

function buildWorkItemTitle(finding: FindingNode): string {
  const kindMap: Record<string, string> = {
    ANG_CLASS_BASED_GUARD: 'Convert class-based guard to functional guard',
    ANG_CLASS_BASED_RESOLVER: 'Convert class-based resolver to functional resolver',
    ANG_NGMODULE_HEAVY: 'Migrate NgModule-based artifact to standalone',
    ANG_ENTRY_COMPONENTS: 'Remove entryComponents from NgModule',
    ANG_COMPONENT_FACTORY: 'Replace ComponentFactoryResolver with ViewContainerRef.createComponent()',
    ANG_LEGACY_ROUTER_CONFIG: 'Migrate forRoot/forChild to provideRouter()',
    RXJS_PATCH_IMPORTS: 'Replace RxJS patch imports with pipeable operators',
    RXJS_NON_PIPEABLE: 'Refactor non-pipeable operators to pipe() syntax',
    RXJS_SUBSCRIPTION_LEAK: 'Fix subscription leak with takeUntilDestroyed()',
    RXJS_TO_PROMISE: 'Replace toPromise() with firstValueFrom()',
    RXJS_THROW_ERROR_STRING: 'Fix throwError() to use factory function',
    TMPL_NGMODEL_MISSING_IMPORT: 'Add FormsModule to standalone component imports',
    TMPL_PIPE_MISSING_IMPORT: 'Add missing pipe to standalone component imports',
    ARCH_CIRCULAR_DEPENDENCY: 'Resolve circular module dependency',
  };
  return kindMap[finding.reasonCode] ?? `Fix ${finding.reasonCode} (${finding.category})`;
}
