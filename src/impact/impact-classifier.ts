/**
 * ImpactClassifier — classifies impact results based on edge chain and depth.
 */

import { ImpactClass } from '../core/types/graph-ir.js';

const TEMPLATE_EDGE_TYPES = new Set([
  'BINDS_TO',
  'TEMPLATE_BINDS_PROPERTY',
  'TEMPLATE_BINDS_EVENT',
  'TEMPLATE_TWO_WAY_BINDS',
  'TEMPLATE_USES_DIRECTIVE',
  'TEMPLATE_USES_PIPE',
]);

const STRUCTURAL_EDGE_TYPES = new Set([
  'EXTENDS',
  'IMPLEMENTS',
  'DECLARES',
  'IMPORTS',
]);

/**
 * Classify an impact result based on the edge chain and traversal depth.
 *
 * Classification rules (in priority order):
 * 1. If any edge in chain is a template binding type → 'template-derived'
 * 2. If all edges are Extends/Implements/Declares/Imports → 'structural'
 * 3. If depth is 1 and no structural/template edges → 'direct'
 * 4. Otherwise → 'indirect'
 */
export function classifyImpact(edgeChain: string[], depth: number): ImpactClass {
  // 1. Template-derived: any edge is a template binding type
  if (edgeChain.some((edge) => TEMPLATE_EDGE_TYPES.has(edge))) {
    return 'template-derived';
  }

  // 2. Structural: all edges are structural types
  if (edgeChain.length > 0 && edgeChain.every((edge) => STRUCTURAL_EDGE_TYPES.has(edge))) {
    return 'structural';
  }

  // 3. Direct: depth is 1 and no template/structural edges
  if (depth === 1) {
    return 'direct';
  }

  // 4. Indirect
  return 'indirect';
}
