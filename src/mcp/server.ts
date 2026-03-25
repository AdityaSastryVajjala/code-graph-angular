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
          enum: ['Component', 'Service', 'NgModule', 'Directive', 'Pipe', 'Route'],
        },
      },
      required: ['appDb', 'entityId', 'entityType'],
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
