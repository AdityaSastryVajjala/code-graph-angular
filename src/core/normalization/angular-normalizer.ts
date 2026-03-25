/**
 * AngularNormalizer — merges per-file GraphIR objects into a single write batch.
 *
 * Responsibilities:
 * - Deduplicate nodes by ID
 * - Deduplicate relationships by ID
 * - Create StyleFile nodes + HAS_STYLE edges from component styleUrls
 * - Create File nodes and BELONGS_TO_FILE edges
 * - Build the global SelectorMap for template extraction
 */

import { extname } from 'path';
import {
  GraphIR,
  GraphNode,
  GraphRelationship,
  NodeLabel,
  RelationshipType,
  SelectorMap,
} from '../types/graph-ir.js';
import { createHash as cryptoHash } from 'crypto';

function makeStyleFileId(filePath: string): string {
  return cryptoHash('sha256').update(filePath).digest('hex').slice(0, 16);
}

type StyleFormat = 'css' | 'scss' | 'less' | 'sass';

function styleFormat(filePath: string): StyleFormat {
  const ext = extname(filePath).toLowerCase().replace('.', '');
  if (ext === 'scss') return 'scss';
  if (ext === 'less') return 'less';
  if (ext === 'sass') return 'sass';
  return 'css';
}

/**
 * Merge all per-file IRs and produce a single consolidated GraphIR ready for writing.
 */
export function normalize(irs: GraphIR[]): GraphIR {
  const nodeMap = new Map<string, GraphNode>();
  const relMap = new Map<string, GraphRelationship>();

  for (const ir of irs) {
    for (const node of ir.nodes) {
      if (!nodeMap.has(node.id)) {
        nodeMap.set(node.id, node);
      }
    }
    for (const rel of ir.relationships) {
      if (!relMap.has(rel.id)) {
        relMap.set(rel.id, rel);
      }
    }
  }

  // Post-process: create StyleFile nodes + HAS_STYLE edges from Component styleUrls
  for (const node of nodeMap.values()) {
    if (node.label !== NodeLabel.Component) continue;

    const styleUrls = node.properties['styleUrls'] as string[] | undefined;
    if (!styleUrls || styleUrls.length === 0) continue;

    const componentDir = (node.properties['filePath'] as string).replace(/\/[^/]+$/, '');

    styleUrls.forEach((rawUrl, order) => {
      // Resolve relative URL against component file location
      const stylePath = resolveRelativePath(componentDir, rawUrl);
      const styleFileId = makeStyleFileId(stylePath);

      if (!nodeMap.has(styleFileId)) {
        nodeMap.set(styleFileId, {
          id: styleFileId,
          label: NodeLabel.StyleFile,
          properties: {
            id: styleFileId,
            filePath: stylePath,
            format: styleFormat(stylePath),
          },
        });
      }

      const relId = cryptoHash('sha256')
        .update(`${node.id}->has_style->${styleFileId}->${order}`)
        .digest('hex')
        .slice(0, 16);

      if (!relMap.has(relId)) {
        relMap.set(relId, {
          id: relId,
          type: RelationshipType.HasStyle,
          fromId: node.id,
          toId: styleFileId,
          properties: { order },
        });
      }
    });
  }

  // Resolution pass — map class name → nodeId for cross-file reference resolution.
  // Used by relationships that stored a pendingTargetName instead of a toId.
  const nameToNodeId = new Map<string, string>();
  for (const node of nodeMap.values()) {
    const name = node.properties['name'] as string | undefined;
    if (name) nameToNodeId.set(name, node.id);
  }

  // Resolve pending relationships and drop unresolvable ones.
  const resolvedRelMap = new Map<string, GraphRelationship>();
  for (const rel of relMap.values()) {
    if (rel.pendingTargetName) {
      const resolvedId = nameToNodeId.get(rel.pendingTargetName);
      if (!resolvedId) continue; // target not in graph — skip
      const { pendingTargetName: _, ...rest } = rel;
      resolvedRelMap.set(rest.id, { ...rest, toId: resolvedId });
    } else {
      resolvedRelMap.set(rel.id, rel);
    }
  }

  return {
    nodes: Array.from(nodeMap.values()),
    relationships: Array.from(resolvedRelMap.values()),
    sourceFile: '',
  };
}

/**
 * Build a SelectorMap from the normalized GraphIR.
 * Used by TemplateExtractor to resolve element/attribute selectors.
 */
export function buildSelectorMap(ir: GraphIR): SelectorMap {
  const map: SelectorMap = new Map();

  for (const node of ir.nodes) {
    if (node.label === NodeLabel.Component) {
      const selector = node.properties['selector'] as string;
      if (selector) map.set(selector, { nodeId: node.id, kind: 'component' });
    } else if (node.label === NodeLabel.Directive) {
      const selector = node.properties['selector'] as string;
      if (selector) map.set(selector, { nodeId: node.id, kind: 'directive' });
    } else if (node.label === NodeLabel.Pipe) {
      const pipeName = node.properties['pipeName'] as string;
      if (pipeName) map.set(pipeName, { nodeId: node.id, kind: 'directive' }); // pipes use directive slot
    }
  }

  return map;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function resolveRelativePath(baseDir: string, relativePath: string): string {
  if (!relativePath.startsWith('.')) return relativePath;
  const parts = [...baseDir.split('/'), ...relativePath.split('/')];
  const result: string[] = [];
  for (const part of parts) {
    if (part === '..') result.pop();
    else if (part !== '.') result.push(part);
  }
  return result.join('/');
}
