/**
 * MCP Server — bootstraps the Model Context Protocol server with stdio transport.
 *
 * Registers all 6 Angular CodeGraph tools.
 * No authentication — tools are available to any connected MCP client.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { Driver } from 'neo4j-driver';
import { findComponent } from './tools/find-component.js';
import { getComponentDependencies } from './tools/get-component-dependencies.js';
import { findServiceUsage } from './tools/find-service-usage.js';
import { traceRoute } from './tools/trace-route.js';
import { getModuleStructure } from './tools/get-module-structure.js';
import { getEntityDetail } from './tools/get-entity-detail.js';
import { getClassMembers } from './tools/get-class-members.js';
import { getTemplateBindings } from './tools/get-template-bindings.js';
import { getDiConsumers } from './tools/get-di-consumers.js';
import { getTestCoverage } from './tools/get-test-coverage.js';
import { getImpactFromFile } from './tools/get-impact-from-file.js';
import { getImpactFromSymbol } from './tools/get-impact-from-symbol.js';
import { getDependents } from './tools/get-dependents.js';
import { getDependencies } from './tools/get-dependencies.js';
import { getProjectDependencies } from './tools/get-project-dependencies.js';
import { getTemplateUsages } from './tools/get-template-usages.js';
import { getMetrics } from './tools/get-metrics.js';
import { findSymbol } from './tools/find-symbol.js';
import { getInjections } from './tools/get-injections.js';
import { getStandaloneCandidates } from './tools/get-standalone-candidates.js';
import { getMigrationFindings } from './tools/get-migration-findings.js';
import { getMigrationOrder } from './tools/get-migration-order.js';
import { getDeprecatedPatterns } from './tools/get-deprecated-patterns.js';
import { getMigrationSummary } from './tools/get-migration-summary.js';
import { getPackageCompatibility } from './tools/get-package-compatibility.js';
import { getMigrationTasks } from './tools/get-migration-tasks.js';
import { logger } from '../shared/logger.js';

// ─── Pagination Helpers ───────────────────────────────────────────────────────

export interface PagedResponse<T> {
  items: T[];
  cursor?: string;
  total: number;
  appDb: string;
}

export function parseCursor(cursor?: string): number {
  if (!cursor) return 0;
  try {
    return parseInt(Buffer.from(cursor, 'base64').toString('utf-8'), 10) || 0;
  } catch {
    return 0;
  }
}

export function makeCursor(skip: number): string {
  return Buffer.from(String(skip), 'utf-8').toString('base64');
}

export function createPaginatedResponse<T>(
  allItems: T[],
  pageSize: number,
  skip: number,
  appDb: string,
): PagedResponse<T> {
  const total = allItems.length;
  const items = allItems.slice(skip, skip + pageSize);
  const nextSkip = skip + pageSize;
  return {
    items,
    cursor: nextSkip < total ? makeCursor(nextSkip) : undefined,
    total,
    appDb,
  };
}

// ─── Tool Registry ────────────────────────────────────────────────────────────

const TOOL_DEFINITIONS = [
  {
    name: 'find_component',
    description: 'Find Angular components by name or CSS selector',
    inputSchema: {
      type: 'object',
      properties: {
        appDb: { type: 'string', description: 'Target application database name' },
        name: { type: 'string', description: 'Partial or exact class name (case-insensitive)' },
        selector: { type: 'string', description: 'Partial or exact CSS selector' },
        isStandalone: { type: 'boolean' },
        detail: { type: 'boolean', default: false },
        pageSize: { type: 'number', default: 20 },
        cursor: { type: 'string' },
      },
      required: ['appDb'],
    },
  },
  {
    name: 'get_component_dependencies',
    description: 'Get the full dependency tree for a component',
    inputSchema: {
      type: 'object',
      properties: {
        appDb: { type: 'string' },
        componentId: { type: 'string' },
        detail: { type: 'boolean', default: false },
      },
      required: ['appDb', 'componentId'],
    },
  },
  {
    name: 'find_service_usage',
    description: 'Find all consumers of a service',
    inputSchema: {
      type: 'object',
      properties: {
        appDb: { type: 'string' },
        name: { type: 'string' },
        detail: { type: 'boolean', default: false },
        pageSize: { type: 'number', default: 20 },
        cursor: { type: 'string' },
      },
      required: ['appDb', 'name'],
    },
  },
  {
    name: 'trace_route',
    description: 'Trace a URL path to the component or module it loads',
    inputSchema: {
      type: 'object',
      properties: {
        appDb: { type: 'string' },
        path: { type: 'string' },
        detail: { type: 'boolean', default: false },
      },
      required: ['appDb', 'path'],
    },
  },
  {
    name: 'get_module_structure',
    description: 'Get the full declaration/import/export structure of an NgModule',
    inputSchema: {
      type: 'object',
      properties: {
        appDb: { type: 'string' },
        name: { type: 'string' },
        detail: { type: 'boolean', default: false },
        pageSize: { type: 'number', default: 20 },
        cursor: { type: 'string' },
      },
      required: ['appDb', 'name'],
    },
  },
  {
    name: 'get_entity_detail',
    description: 'Fetch full detail for any graph entity by ID',
    inputSchema: {
      type: 'object',
      properties: {
        appDb: { type: 'string' },
        entityId: { type: 'string' },
        entityType: {
          type: 'string',
          enum: ['Component', 'Service', 'NgModule', 'Directive', 'Pipe', 'Route', 'Class'],
        },
      },
      required: ['appDb', 'entityId', 'entityType'],
    },
  },
  {
    name: 'get_class_members',
    description: 'Get methods and properties for a TypeScript class',
    inputSchema: {
      type: 'object',
      properties: {
        appDb: { type: 'string' },
        className: { type: 'string' },
        filePath: { type: 'string' },
        detail: { type: 'boolean', default: false },
        cursor: { type: 'string' },
        limit: { type: 'number', default: 20 },
      },
      required: ['appDb', 'className'],
    },
  },
  {
    name: 'get_template_bindings',
    description: 'Get template bindings (interpolations, property/event bindings) for a component',
    inputSchema: {
      type: 'object',
      properties: {
        appDb: { type: 'string' },
        componentName: { type: 'string' },
        detail: { type: 'boolean', default: false },
      },
      required: ['appDb', 'componentName'],
    },
  },
  {
    name: 'get_di_consumers',
    description: 'Find all classes that inject a given service or InjectionToken',
    inputSchema: {
      type: 'object',
      properties: {
        appDb: { type: 'string' },
        serviceName: { type: 'string' },
        cursor: { type: 'string' },
        limit: { type: 'number', default: 20 },
      },
      required: ['appDb', 'serviceName'],
    },
  },
  {
    name: 'get_test_coverage',
    description: 'Find spec files that test a given Angular entity',
    inputSchema: {
      type: 'object',
      properties: {
        appDb: { type: 'string' },
        targetName: { type: 'string' },
      },
      required: ['appDb', 'targetName'],
    },
  },
  {
    name: 'get_impact_from_file',
    description: 'Full impact analysis from a file — returns all affected nodes classified by impact type',
    inputSchema: {
      type: 'object',
      properties: {
        appDb: { type: 'string' },
        filePath: { type: 'string' },
        depth: { type: 'number', default: 5 },
        includeTests: { type: 'boolean', default: false },
        projectId: { type: 'string' },
        summary: { type: 'boolean', default: true },
        pageSize: { type: 'number', default: 50 },
        cursor: { type: 'string' },
      },
      required: ['appDb', 'filePath'],
    },
  },
  {
    name: 'get_impact_from_symbol',
    description: 'Full impact analysis from a symbol — returns all affected nodes classified by impact type',
    inputSchema: {
      type: 'object',
      properties: {
        appDb: { type: 'string' },
        symbolId: { type: 'string' },
        depth: { type: 'number', default: 5 },
        includeTests: { type: 'boolean', default: false },
        projectId: { type: 'string' },
        summary: { type: 'boolean', default: true },
        pageSize: { type: 'number', default: 50 },
        cursor: { type: 'string' },
      },
      required: ['appDb', 'symbolId'],
    },
  },
  {
    name: 'get_dependents',
    description: 'Find all nodes that depend on a given symbol (inbound edges)',
    inputSchema: {
      type: 'object',
      properties: {
        appDb: { type: 'string' },
        symbolId: { type: 'string' },
        depth: { type: 'number', default: 3 },
        edgeKinds: { type: 'array', items: { type: 'string' } },
        projectId: { type: 'string' },
        includeTests: { type: 'boolean', default: false },
        minimal: { type: 'boolean', default: true },
        pageSize: { type: 'number', default: 20 },
        cursor: { type: 'string' },
      },
      required: ['appDb', 'symbolId'],
    },
  },
  {
    name: 'get_dependencies',
    description: 'Find all nodes that a given symbol depends on (outbound edges)',
    inputSchema: {
      type: 'object',
      properties: {
        appDb: { type: 'string' },
        symbolId: { type: 'string' },
        depth: { type: 'number', default: 3 },
        edgeKinds: { type: 'array', items: { type: 'string' } },
        projectId: { type: 'string' },
        minimal: { type: 'boolean', default: true },
        pageSize: { type: 'number', default: 20 },
        cursor: { type: 'string' },
      },
      required: ['appDb', 'symbolId'],
    },
  },
  {
    name: 'get_project_dependencies',
    description: 'Show project-level dependency graph — which projects depend on which',
    inputSchema: {
      type: 'object',
      properties: {
        appDb: { type: 'string' },
        projectId: { type: 'string' },
        direction: { type: 'string', enum: ['dependencies', 'consumers', 'both'], default: 'both' },
      },
      required: ['appDb'],
    },
  },
  {
    name: 'get_template_usages',
    description: 'Find all templates that use a given component, directive, pipe, or component member',
    inputSchema: {
      type: 'object',
      properties: {
        appDb: { type: 'string' },
        symbolId: { type: 'string' },
        minimal: { type: 'boolean', default: true },
        pageSize: { type: 'number', default: 20 },
        cursor: { type: 'string' },
      },
      required: ['appDb', 'symbolId'],
    },
  },
  {
    name: 'get_metrics',
    description: 'Return dependency and usage counts for a node or project',
    inputSchema: {
      type: 'object',
      properties: {
        appDb: { type: 'string' },
        entityId: { type: 'string' },
        entityType: {
          type: 'string',
          enum: ['File', 'Component', 'Service', 'Directive', 'Pipe', 'Class', 'Interface', 'Method', 'Property', 'InjectionToken', 'Project'],
        },
      },
      required: ['appDb', 'entityId', 'entityType'],
    },
  },
  {
    name: 'find_symbol',
    description: 'Search for any graph symbol by name, kind, or file',
    inputSchema: {
      type: 'object',
      properties: {
        appDb: { type: 'string' },
        name: { type: 'string' },
        kind: { type: 'string', enum: ['Component', 'Service', 'Directive', 'Pipe', 'Class', 'Interface', 'Method', 'Property', 'InjectionToken', 'NgModule'] },
        filePath: { type: 'string' },
        minimal: { type: 'boolean', default: true },
        pageSize: { type: 'number', default: 20 },
        cursor: { type: 'string' },
      },
      required: ['appDb', 'name'],
    },
  },
  {
    name: 'get_injections',
    description: 'Find all classes that inject a given Service or InjectionToken',
    inputSchema: {
      type: 'object',
      properties: {
        appDb: { type: 'string' },
        symbolId: { type: 'string' },
        minimal: { type: 'boolean', default: true },
        pageSize: { type: 'number', default: 20 },
        cursor: { type: 'string' },
      },
      required: ['appDb', 'symbolId'],
    },
  },
  // Phase 4 — migration intelligence tools
  {
    name: 'get_standalone_candidates',
    description: 'List Angular artifacts (components, directives, pipes) that are candidates for standalone migration',
    inputSchema: {
      type: 'object',
      properties: {
        appDb: { type: 'string' },
        projectId: { type: 'string' },
        candidatesOnly: { type: 'boolean', default: false },
        includeBlockers: { type: 'boolean', default: true },
        pageSize: { type: 'number', default: 50 },
        cursor: { type: 'string' },
      },
      required: ['appDb'],
    },
  },
  {
    name: 'get_migration_findings',
    description: 'Query migration findings by type, category, severity, scope, or affected node',
    inputSchema: {
      type: 'object',
      properties: {
        appDb: { type: 'string' },
        type: { type: 'string', enum: ['blocker', 'risk', 'opportunity'] },
        category: { type: 'string', enum: ['angular', 'rxjs', 'template', 'architecture'] },
        severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
        scope: { type: 'string', enum: ['production', 'test'] },
        affectedNodeId: { type: 'string' },
        projectId: { type: 'string' },
        minConfidence: { type: 'number', default: 0 },
        pageSize: { type: 'number', default: 50 },
        cursor: { type: 'string' },
      },
      required: ['appDb'],
    },
  },
  {
    name: 'get_migration_order',
    description: 'Get the dependency-safe migration order for an app or project with parallelizable groups',
    inputSchema: {
      type: 'object',
      properties: {
        appDb: { type: 'string' },
        projectId: { type: 'string' },
        includeBlockers: { type: 'boolean', default: true },
        pageSize: { type: 'number', default: 100 },
        cursor: { type: 'string' },
      },
      required: ['appDb'],
    },
  },
  {
    name: 'get_deprecated_patterns',
    description: 'List all deprecated Angular and RxJS pattern findings for an app',
    inputSchema: {
      type: 'object',
      properties: {
        appDb: { type: 'string' },
        category: { type: 'string', enum: ['angular', 'rxjs'] },
        severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
        scope: { type: 'string', enum: ['production', 'test'] },
        projectId: { type: 'string' },
        pageSize: { type: 'number', default: 50 },
        cursor: { type: 'string' },
      },
      required: ['appDb'],
    },
  },
  {
    name: 'get_migration_summary',
    description: 'High-level migration readiness summary for an app — standalone candidates, deprecated patterns, migration order, and work item seeds',
    inputSchema: {
      type: 'object',
      properties: {
        appDb: { type: 'string' },
        projectId: { type: 'string' },
        includeWorkItemSeeds: { type: 'boolean', default: false },
      },
      required: ['appDb'],
    },
  },
  // Phase 5 — package compatibility
  {
    name: 'get_package_compatibility',
    description: 'Return package compatibility findings grouped as blockers and risks. Supports filtering by severity and target Angular version.',
    inputSchema: {
      type: 'object',
      properties: {
        appDb: { type: 'string', description: 'Target application database name' },
        severity: { type: 'string', enum: ['blocker', 'risk'], description: 'Filter by severity class' },
        targetAngularVersion: { type: 'string', description: 'Filter by target Angular major version (e.g. "17")' },
        pageSize: { type: 'number', default: 50, description: 'Items per page (max 200)' },
        cursor: { type: 'string', description: 'Pagination cursor from previous response' },
      },
      required: ['appDb'],
    },
  },
  // Phase 5 — topological migration task ordering
  {
    name: 'get_migration_tasks',
    description: 'Returns dependency-safe migration task batches ordered via Kahn\'s algorithm. All tasks in a batch can run in parallel; each batch must complete before the next begins.',
    inputSchema: {
      type: 'object',
      properties: {
        appDb: { type: 'string', description: 'Target application database name' },
        migrationRunId: { type: 'string', description: 'Filter to a specific migration run ID' },
        findingType: { type: 'string', enum: ['blocker', 'risk', 'opportunity'], description: 'Filter by finding type' },
        limit: { type: 'number', default: 200, description: 'Maximum total tasks to return (max 500)' },
      },
      required: ['appDb'],
    },
  },
];

// ─── Server Bootstrap ─────────────────────────────────────────────────────────

export async function startMcpServer(driver: Driver): Promise<void> {
  const server = new Server(
    { name: 'codegraph-angular', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  // List tools handler
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFINITIONS,
  }));

  // Call tool handler — routes to the correct tool implementation
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const input = (args ?? {}) as Record<string, unknown>;

    try {
      let result: unknown;

      switch (name) {
        case 'find_component':
          result = await findComponent(driver, input);
          break;
        case 'get_component_dependencies':
          result = await getComponentDependencies(driver, input);
          break;
        case 'find_service_usage':
          result = await findServiceUsage(driver, input);
          break;
        case 'trace_route':
          result = await traceRoute(driver, input);
          break;
        case 'get_module_structure':
          result = await getModuleStructure(driver, input);
          break;
        case 'get_entity_detail':
          result = await getEntityDetail(driver, input);
          break;
        case 'get_class_members':
          result = await getClassMembers(driver, input);
          break;
        case 'get_template_bindings':
          result = await getTemplateBindings(driver, input);
          break;
        case 'get_di_consumers':
          result = await getDiConsumers(driver, input);
          break;
        case 'get_test_coverage':
          result = await getTestCoverage(driver, input);
          break;
        case 'get_impact_from_file':
          result = await getImpactFromFile(driver, input);
          break;
        case 'get_impact_from_symbol':
          result = await getImpactFromSymbol(driver, input);
          break;
        case 'get_dependents':
          result = await getDependents(driver, input);
          break;
        case 'get_dependencies':
          result = await getDependencies(driver, input);
          break;
        case 'get_project_dependencies':
          result = await getProjectDependencies(driver, input);
          break;
        case 'get_template_usages':
          result = await getTemplateUsages(driver, input);
          break;
        case 'get_metrics':
          result = await getMetrics(driver, input);
          break;
        case 'find_symbol':
          result = await findSymbol(driver, input);
          break;
        case 'get_injections':
          result = await getInjections(driver, input);
          break;
        // Phase 4 — migration intelligence
        case 'get_standalone_candidates':
          result = await getStandaloneCandidates(driver, input);
          break;
        case 'get_migration_findings':
          result = await getMigrationFindings(driver, input);
          break;
        case 'get_migration_order':
          result = await getMigrationOrder(driver, input);
          break;
        case 'get_deprecated_patterns':
          result = await getDeprecatedPatterns(driver, input);
          break;
        case 'get_migration_summary':
          result = await getMigrationSummary(driver, input);
          break;
        // Phase 5 — package compatibility
        case 'get_package_compatibility':
          result = await getPackageCompatibility(driver, input);
          break;
        case 'get_migration_tasks':
          result = await getMigrationTasks(driver, input);
          break;
        default:
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: 'Unknown tool', code: 'INVALID_INPUT' }) }],
            isError: true,
          };
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      logger.warn('mcp_tool_error', {
        tool: name,
        error: err instanceof Error ? err.message : String(err),
      });
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: err instanceof Error ? err.message : String(err),
            code: 'QUERY_ERROR',
          }),
        }],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info('mcp_server_started', { tools: TOOL_DEFINITIONS.map((t) => t.name) });
}
