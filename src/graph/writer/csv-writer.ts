/**
 * CsvWriter — serializes GraphIR nodes and relationships to CSV files
 * in the format expected by `neo4j-admin database import full`.
 *
 * Node files:   id:ID, <prop>:<type>, ...       (one file per label)
 * Rel files:    :START_ID, :END_ID, <prop>:<type>, ...  (one file per type)
 *
 * Label and relationship type are specified as CLI arguments to neo4j-admin,
 * not as CSV columns, so no :LABEL / :TYPE columns are written.
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { GraphNode, GraphRelationship } from '../../core/types/graph-ir.js';

export interface CsvManifest {
  /** label → absolute path to the node CSV file */
  nodeFiles: Map<string, string>;
  /** relationship type → absolute path to the rel CSV file */
  relFiles: Map<string, string>;
  dir: string;
}

// ─── Serialization helpers ────────────────────────────────────────────────────

/**
 * Serialize a single cell value to a CSV-safe string.
 * Arrays are joined with `;` (neo4j-admin's array element delimiter).
 * Strings containing commas, quotes, or newlines are double-quote wrapped.
 */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) {
    const joined = (value as unknown[])
      .map(v => String(v ?? '').replace(/"/g, '""'))
      .join(';');
    return `"${joined}"`;
  }
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Infer the neo4j-admin CSV type hint from an array of sample values.
 * Returns 'string' (the safe default) when all samples are null/undefined.
 */
function inferType(samples: unknown[]): string {
  for (const v of samples) {
    if (v == null) continue;
    if (typeof v === 'boolean') return 'boolean';
    if (typeof v === 'number') return Number.isInteger(v) ? 'int' : 'float';
    if (Array.isArray(v)) return 'string[]';
    return 'string';
  }
  return 'string';
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Write GraphIR nodes and relationships to CSV files under `outputDir`.
 * Creates `outputDir` if it does not exist.
 * Returns a manifest mapping labels/types to their absolute file paths.
 */
export function writeGraphIrToCsv(
  nodes: GraphNode[],
  relationships: GraphRelationship[],
  outputDir: string,
): CsvManifest {
  mkdirSync(outputDir, { recursive: true });

  const nodeFiles = new Map<string, string>();
  const relFiles = new Map<string, string>();

  // ── Nodes: group by label ─────────────────────────────────────────────────
  const byLabel = new Map<string, GraphNode[]>();
  for (const node of nodes) {
    const bucket = byLabel.get(node.label) ?? [];
    bucket.push(node);
    byLabel.set(node.label, bucket);
  }

  for (const [label, labelNodes] of byLabel) {
    // Collect all property keys, excluding 'id' — it is already the :ID column
    const keySet = new Set<string>();
    for (const node of labelNodes) {
      for (const k of Object.keys(node.properties)) {
        if (k !== 'id') keySet.add(k);
      }
    }
    const propKeys = [...keySet];

    // Build typed header: id:ID, propA:string, propB:boolean, ...
    const typedCols = propKeys.map(k => {
      const t = inferType(labelNodes.map(n => n.properties[k]));
      return `${k}:${t}`;
    });
    const header = ['id:ID', ...typedCols].join(',');

    const dataRows = labelNodes.map(node =>
      [csvCell(node.id), ...propKeys.map(k => csvCell(node.properties[k]))].join(','),
    );

    const filePath = join(outputDir, `nodes_${label}.csv`);
    writeFileSync(filePath, [header, ...dataRows].join('\n'), 'utf8');
    nodeFiles.set(label, filePath);
  }

  // ── Relationships: group by type ──────────────────────────────────────────
  const byType = new Map<string, GraphRelationship[]>();
  for (const rel of relationships) {
    const bucket = byType.get(rel.type) ?? [];
    bucket.push(rel);
    byType.set(rel.type, bucket);
  }

  for (const [type, typeRels] of byType) {
    const keySet = new Set<string>();
    for (const rel of typeRels) {
      for (const k of Object.keys(rel.properties ?? {})) keySet.add(k);
    }
    const propKeys = [...keySet];

    const typedCols = propKeys.map(k => {
      const t = inferType(typeRels.map(r => (r.properties ?? {})[k]));
      return `${k}:${t}`;
    });
    const header = [':START_ID', ':END_ID', ...typedCols].join(',');

    const dataRows = typeRels.map(rel =>
      [
        csvCell(rel.fromId),
        csvCell(rel.toId),
        ...propKeys.map(k => csvCell((rel.properties ?? {})[k])),
      ].join(','),
    );

    const filePath = join(outputDir, `rels_${type}.csv`);
    writeFileSync(filePath, [header, ...dataRows].join('\n'), 'utf8');
    relFiles.set(type, filePath);
  }

  return { nodeFiles, relFiles, dir: outputDir };
}
