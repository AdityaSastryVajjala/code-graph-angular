/**
 * Shared Cypher query helpers for MCP tools.
 * Converts Neo4j record fields to typed summary/detail shapes.
 */

import { Record as NeoRecord } from 'neo4j-driver';

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
