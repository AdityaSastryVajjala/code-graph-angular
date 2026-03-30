#!/usr/bin/env node
/**
 * CLI entry point — `codegraph index` command.
 *
 * Wires: ProjectDiscovery → SourceCollector → TsExtractor → TemplateExtractor
 *        → SpecExtractor → AngularNormalizer → BulkImporter
 */

import { program } from 'commander';
import { readFileSync } from 'fs';
import { resolve, dirname, relative, normalize as normalizePath } from 'path';
import { discoverApp, discoverWorkspace } from '../core/discovery/project-discovery.js';
import { collectFiles } from '../core/collection/source-collector.js';
import { extractTsFile } from '../core/extraction/ts-extractor.js';
import { extractTemplate, extractTemplateBindings } from '../core/extraction/template-extractor.js';
import { extractSpecFile } from '../core/extraction/spec-extractor.js';
import { normalize, buildSelectorMap } from '../core/normalization/angular-normalizer.js';
import { fullIndex } from '../graph/importer/bulk-importer.js';
import { createDriver, closeDriver } from '../graph/db/connection.js';
import { startMcpServer } from '../mcp/server.js';
import { watch as chokidarWatch } from '../incremental/detectors/chokidar-detector.js';
import { RollingDebounce } from '../incremental/debounce/rolling-debounce.js';
import { processChanges } from '../incremental/change-processor.js';
import { AngularApp, GraphIR, NodeLabel } from '../core/types/graph-ir.js';
import { logger } from '../shared/logger.js';

program
  .name('codegraph')
  .description('Angular CodeGraph — build a Neo4j knowledge graph of your Angular codebase');

program
  .command('index')
  .description('Index an Angular application or workspace into Neo4j')
  .option('--app-root <path>', 'Path to a single Angular application root')
  .option('--workspace <path>', 'Path to an Angular/Nx workspace root')
  .option('--neo4j-url <url>', 'Neo4j Bolt URL', process.env['NEO4J_URL'] ?? 'bolt://localhost:7687')
  .option('--neo4j-user <user>', 'Neo4j username', process.env['NEO4J_USER'] ?? 'neo4j')
  .option('--neo4j-password <password>', 'Neo4j password', process.env['NEO4J_PASSWORD'] ?? 'codegraph')
  .option('--force-reindex', 'Drop and re-index even if a complete index already exists', false)
  .action(async (opts) => {
    if (!opts.appRoot && !opts.workspace) {
      console.error('Error: provide --app-root or --workspace');
      process.exit(1);
    }

    const driver = await createDriver({
      url: opts.neo4jUrl,
      user: opts.neo4jUser,
      password: opts.neo4jPassword,
    });

    try {
      const apps: AngularApp[] = opts.workspace
        ? discoverWorkspace(resolve(opts.workspace))
        : [discoverApp(resolve(opts.appRoot))];

      for (const app of apps) {
        await indexApp(driver, app, opts.forceReindex);
      }
    } finally {
      await closeDriver(driver);
    }
  });

program
  .command('watch')
  .description('Watch an Angular application for changes and incrementally update the graph')
  .option('--app-root <path>', 'Path to the Angular application root')
  .option('--neo4j-url <url>', 'Neo4j Bolt URL', process.env['NEO4J_URL'] ?? 'bolt://localhost:7687')
  .option('--neo4j-user <user>', 'Neo4j username', process.env['NEO4J_USER'] ?? 'neo4j')
  .option('--neo4j-password <password>', 'Neo4j password', process.env['NEO4J_PASSWORD'] ?? 'codegraph')
  .option('--debounce-ms <ms>', 'Debounce window in milliseconds', '30000')
  .action(async (opts) => {
    if (!opts.appRoot) {
      console.error('Error: --app-root is required for watch mode');
      process.exit(1);
    }

    const appRoot = resolve(opts.appRoot);
    const app = discoverApp(appRoot);

    const driver = await createDriver({
      url: opts.neo4jUrl,
      user: opts.neo4jUser,
      password: opts.neo4jPassword,
    });

    // Perform initial full index
    console.log(`Performing initial index of '${app.name}'...`);
    await indexApp(driver, app, false);
    console.log(`Watching '${appRoot}' for changes (${opts.debounceMs}ms debounce)...`);

    const debounce = new RollingDebounce(
      parseInt(opts.debounceMs, 10),
      async (changedFileSet) => {
        try {
          const stats = await processChanges(driver, app, changedFileSet, appRoot);
          console.log(
            `\n✓ Incremental update: ${stats.deltaNodes} nodes, ${stats.deltaEdges} edges ` +
            `(${stats.changedFileCount} files) in ${stats.duration}ms`,
          );
        } catch (err) {
          console.error('\n✗ Incremental update failed:', err instanceof Error ? err.message : err);
        }
      },
    );

    chokidarWatch(appRoot, (changedSet) => debounce.push(changedSet));

    // Keep process alive; handle shutdown gracefully
    process.on('SIGINT', async () => {
      console.log('\nShutting down watcher...');
      debounce.forceFlush();
      await closeDriver(driver);
      process.exit(0);
    });
  });

program
  .command('mcp-server')
  .description('Start the Angular CodeGraph MCP server (stdio transport)')
  .option('--neo4j-url <url>', 'Neo4j Bolt URL', process.env['NEO4J_URL'] ?? 'bolt://localhost:7687')
  .option('--neo4j-user <user>', 'Neo4j username', process.env['NEO4J_USER'] ?? 'neo4j')
  .option('--neo4j-password <password>', 'Neo4j password', process.env['NEO4J_PASSWORD'] ?? 'codegraph')
  .action(async (opts) => {
    const driver = await createDriver({
      url: opts.neo4jUrl,
      user: opts.neo4jUser,
      password: opts.neo4jPassword,
    });

    logger.info('mcp_server_starting', { neo4jUrl: opts.neo4jUrl });

    // MCP server runs until process exits; driver stays open for the lifetime
    await startMcpServer(driver);
  });

// ─── migrate analyze ──────────────────────────────────────────────────────────

program
  .command('migrate')
  .description('Migration intelligence commands')
  .addCommand(
    (() => {
      const cmd = program.createCommand('analyze')
        .description('Run full migration analysis for an Angular application')
        .requiredOption('--app <appName>', 'Application database name (same as used during index)')
        .option('--neo4j-url <url>', 'Neo4j Bolt URL', process.env['NEO4J_URL'] ?? 'bolt://localhost:7687')
        .option('--neo4j-user <user>', 'Neo4j username', process.env['NEO4J_USER'] ?? 'neo4j')
        .option('--neo4j-password <password>', 'Neo4j password', process.env['NEO4J_PASSWORD'] ?? 'codegraph')
        .option('--output <path>', 'Write JSON export to this file path')
        .option('--target-version <version>', 'Target Angular version to migrate to (e.g. "19.0.0")', 'latest')
        .action(async (opts) => {
          const driver = await createDriver({
            url: opts.neo4jUrl,
            user: opts.neo4jUser,
            password: opts.neo4jPassword,
          }).catch((err) => {
            console.error('[migrate] Database connection error:', err instanceof Error ? err.message : err);
            process.exit(1);
          });

          try {
            const { MigrationRunner } = await import('../migration/migration-runner.js');
            const runner = new MigrationRunner(driver);
            await runner.run({ appDb: opts.app, outputPath: opts.output, targetAngularVersion: opts.targetVersion });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            const code = (err as NodeJS.ErrnoException).code;
            if (code === 'APP_NOT_FOUND') {
              console.error(`[migrate] App '${opts.app}' not found in graph. Run 'codegraph index' first.`);
              process.exit(2);
            }
            console.error('[migrate] Analysis error:', msg);
            process.exit(3);
          } finally {
            await closeDriver(driver);
          }
        });
      return cmd;
    })(),
  );

program.parse();

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function indexApp(
  driver: ReturnType<typeof createDriver> extends Promise<infer D> ? D : never,
  app: AngularApp,
  _forceReindex: boolean,
): Promise<void> {
  logger.info('index_start', { appName: app.name, appRoot: app.rootPath });

  const fileSet = await collectFiles(app.rootPath);
  const irs: GraphIR[] = [];

  // Extract TypeScript files
  for (const tsFile of fileSet.tsFiles) {
    try {
      const source = readFileSync(tsFile, 'utf-8');
      irs.push(extractTsFile(tsFile, source, app.rootPath));
    } catch (err) {
      logger.warn('ts_extract_error', {
        filePath: tsFile,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Build selector map for template extraction
  const preNorm = normalize(irs);
  const selectorMap = buildSelectorMap(preNorm);

  // Extract HTML templates
  for (const htmlFile of fileSet.htmlFiles) {
    try {
      const source = readFileSync(htmlFile, 'utf-8');
      // Find owning component from pre-normalized IR.
      // templatePath is the raw templateUrl from the decorator (relative to the component
      // file), so resolve it to an absolute path before comparing with htmlFile.
      const ownerNode = preNorm.nodes.find((n) => {
        if (n.label !== 'Component') return false;
        const tmplPath = n.properties['templatePath'] as string | null;
        if (!tmplPath) return false;
        const componentAbsDir = dirname(resolve(app.rootPath, n.properties['filePath'] as string));
        return normalizePath(resolve(componentAbsDir, tmplPath)) === normalizePath(htmlFile);
      });
      if (ownerNode) {
        const ownerRelPath = ownerNode.properties['filePath'] as string;
        const componentName = ownerNode.properties['name'] as string;
        const relHtmlPath = relative(app.rootPath, htmlFile).replace(/\\/g, '/');

        // Selector-level relationships (USES_COMPONENT, USES_DIRECTIVE, etc.)
        irs.push(
          await extractTemplate(source, htmlFile, ownerNode.id, ownerRelPath, selectorMap),
        );

        // Template node + USES_TEMPLATE edge + binding relationships
        irs.push(
          await extractTemplateBindings(
            source,
            relHtmlPath,
            ownerRelPath,
            componentName,
            ownerNode.id,
            new Map(),
          ),
        );
      }
    } catch (err) {
      logger.warn('html_extract_error', {
        filePath: htmlFile,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Extract inline templates (captured during TS extraction above)
  const inlineTemplateIrs: typeof irs = [];
  for (const ir of irs) {
    if (!ir.meta?.inlineTemplates) continue;
    for (const info of ir.meta.inlineTemplates) {
      try {
        const absoluteComponentPath = resolve(app.rootPath, info.componentFilePath);
        const ownerNode = preNorm.nodes.find((n) => n.id === info.componentNodeId);
        const componentName = (ownerNode?.properties['name'] as string | undefined)
          ?? info.componentNodeId;

        // Selector-level relationships
        inlineTemplateIrs.push(
          await extractTemplate(
            info.templateSource,
            absoluteComponentPath,
            info.componentNodeId,
            info.componentFilePath,
            selectorMap,
          ),
        );

        // Template node + USES_TEMPLATE edge (inline: templateUrl = component .ts relPath)
        inlineTemplateIrs.push(
          await extractTemplateBindings(
            info.templateSource,
            info.componentFilePath,
            info.componentFilePath,
            componentName,
            info.componentNodeId,
            new Map(),
          ),
        );
      } catch (err) {
        logger.warn('inline_template_extract_error', {
          filePath: info.componentFilePath,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
  irs.push(...inlineTemplateIrs);

  // Extract spec files
  for (const specFile of fileSet.specFiles) {
    try {
      const source = readFileSync(specFile, 'utf-8');
      irs.push(extractSpecFile(specFile, source, app.rootPath));
    } catch (err) {
      logger.warn('spec_extract_error', {
        filePath: specFile,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Normalize all IRs into a single graph
  const finalIr = normalize(irs);

  // Inject an Application root node so migration analyzers can read angularVersion
  const appNodeId = `app::${app.name}`;
  if (!finalIr.nodes.some((n) => n.id === appNodeId)) {
    finalIr.nodes.push({
      id: appNodeId,
      label: NodeLabel.Application,
      properties: {
        id: appNodeId,
        name: app.name,
        rootPath: app.rootPath,
        angularVersion: app.angularVersion,
      },
    });
  }

  // Index into Neo4j
  const stats = await fullIndex(driver, app, finalIr, app.rootPath);

  console.log(
    `✓ Indexed '${app.name}' → database '${stats.databaseName}' ` +
    `(${stats.nodeCount} nodes, ${stats.edgeCount} edges, ${stats.fileCount} files) ` +
    `in ${stats.duration}ms`,
  );
}
