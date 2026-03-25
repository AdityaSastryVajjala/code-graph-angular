/**
 * Shared Cypher query helpers for MCP tools.
 * Converts Neo4j record fields to typed summary/detail shapes.
 */

import { Record as NeoRecord } from 'neo4j-driver';
import { ImpactResult, ImpactSummary } from '../core/types/graph-ir.js';

export function toRecord(r: NeoRecord, key: string): Record<string, unknown> | null {
  const node = r.get(key);
  if (!node) return null;
  return node.properties as Record<string, unknown>;
}

export function toRecordList(r: NeoRecord, key: string): Record<string, unknown>[] {
  const list = r.get(key);
  if (!Array.isArray(list)) return [];
  return list.map((n: { properties: Record<string, unknown> }) => n.properties);
}

export function nodeToComponentSummary(props: Record<string, unknown>) {
  return {
    id: props['id'],
    name: props['name'],
    selector: props['selector'],
    filePath: props['filePath'],
    isStandalone: props['isStandalone'] ?? false,
  };
}

export function nodeToServiceSummary(props: Record<string, unknown>) {
  return {
    id: props['id'],
    name: props['name'],
    filePath: props['filePath'],
    providedIn: props['providedIn'] ?? null,
  };
}

export function nodeToDirectiveSummary(props: Record<string, unknown>) {
  return {
    id: props['id'],
    name: props['name'],
    selector: props['selector'],
    filePath: props['filePath'],
    hostBindings: (props['hostBindings'] as string[]) ?? [],
  };
}

export function nodeToPipeSummary(props: Record<string, unknown>) {
  return {
    id: props['id'],
    name: props['name'],
    pipeName: props['pipeName'],
    filePath: props['filePath'],
  };
}

export function nodeToNgModuleSummary(props: Record<string, unknown>) {
  return {
    id: props['id'],
    name: props['name'],
    filePath: props['filePath'],
  };
}

export function nodeToRouteSummary(props: Record<string, unknown>) {
  return {
    id: props['id'],
    path: props['path'],
    isLazy: props['isLazy'] ?? false,
    isDynamic: props['isDynamic'] ?? false,
    filePath: props['filePath'] ?? '',
  };
}

// ─── Phase 3: Cursor and Impact Helpers ──────────────────────────────────────

export function encodeCursor(skip: number): string {
  return Buffer.from(JSON.stringify({ skip }), 'utf-8').toString('base64');
}

export function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64').toString('utf-8')) as { skip?: unknown };
    const skip = decoded.skip;
    return typeof skip === 'number' && isFinite(skip) ? Math.max(0, skip) : 0;
  } catch {
    return 0;
  }
}

export function buildImpactSummary(items: ImpactResult[]): ImpactSummary {
  let directCount = 0;
  let indirectCount = 0;
  let templateDerivedCount = 0;
  let structuralCount = 0;

  for (const item of items) {
    switch (item.impactClass) {
      case 'direct': directCount++; break;
      case 'indirect': indirectCount++; break;
      case 'template-derived': templateDerivedCount++; break;
      case 'structural': structuralCount++; break;
    }
  }

  return {
    directCount,
    indirectCount,
    templateDerivedCount,
    structuralCount,
    totalCount: items.length,
  };
}

export function formatImpactItem(
  result: ImpactResult,
  summaryMode: boolean,
): Record<string, unknown> {
  const item: Record<string, unknown> = {
    id: result.nodeId,
    label: result.nodeLabel,
    name: result.nodeName,
    filePath: result.filePath,
    impactClass: result.impactClass,
    depth: result.depth,
    isTestFile: result.isTestFile,
    projectId: result.projectId,
  };
  if (!summaryMode) {
    item['edgeChain'] = result.edgeChain;
  }
  return item;
}
