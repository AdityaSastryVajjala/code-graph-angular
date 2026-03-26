/**
 * Phase 4 — Migration Intelligence
 * FindingBuilder: constructs and validates Finding and WorkItemSeed objects.
 * IDs are deterministic SHA-256 prefixes for idempotent MERGE writes.
 */

import { createHash } from 'crypto';
import { getConfidenceRule } from './confidence-rules.js';
import { FindingNode, WorkItemSeedNode } from '../graph/schema/nodes.js';

export interface FindingInput {
  affectedNodeId: string;
  reasonCode: string;
  scope: 'production' | 'test';
  migrationRunId: string;
  /** Override type; if omitted, derived from severity via confidence rule */
  type?: 'blocker' | 'risk' | 'opportunity';
}

/**
 * Build a validated FindingNode from a reason code + affected node.
 * Uses CONFIDENCE_RULES for deterministic severity, category, description, and action.
 */
export function buildFinding(input: FindingInput): FindingNode {
  const rule = getConfidenceRule(input.reasonCode);

  const derivedType = input.type ?? deriveType(rule.severity);

  // Validate: blocker must have high or critical severity
  if (derivedType === 'blocker' && rule.severity !== 'high' && rule.severity !== 'critical') {
    throw new Error(
      `Finding with type=blocker must have severity high or critical. ` +
      `Got ${rule.severity} for reasonCode=${input.reasonCode}`,
    );
  }

  const id = buildFindingId(input.affectedNodeId, input.reasonCode, input.scope);

  return {
    id,
    type: derivedType,
    category: rule.category,
    severity: rule.severity,
    affectedNodeId: input.affectedNodeId,
    reasonCode: input.reasonCode,
    description: rule.description,
    recommendedAction: rule.recommendedAction,
    confidenceScore: rule.confidenceScore,
    scope: input.scope,
    isDeprecatedUsage: rule.category === 'angular' || rule.category === 'rxjs',
    migrationRunId: input.migrationRunId,
  };
}

/**
 * Build a WorkItemSeedNode from a FindingNode.
 */
export function buildWorkItemSeed(
  finding: FindingNode,
  title: string,
  description: string,
  affectedArtifacts: string[],
  dependencyHints?: string[],
): WorkItemSeedNode {
  if (affectedArtifacts.length === 0) {
    throw new Error('WorkItemSeed must have at least one affectedArtifact');
  }

  const id = buildWorkItemId(finding.id);

  return {
    id,
    title,
    description,
    priority: derivePriority(finding.severity),
    affectedArtifacts,
    dependencyHints,
    migrationRunId: finding.migrationRunId,
  };
}

/**
 * Deterministic finding ID: SHA-256 prefix of {affectedNodeId}::{reasonCode}::{scope}
 */
export function buildFindingId(
  affectedNodeId: string,
  reasonCode: string,
  scope: 'production' | 'test',
): string {
  return createHash('sha256')
    .update(`${affectedNodeId}::${reasonCode}::${scope}`)
    .digest('hex')
    .slice(0, 16);
}

/**
 * Deterministic work item ID: SHA-256 prefix of workitem::{findingId}
 */
export function buildWorkItemId(findingId: string): string {
  return createHash('sha256')
    .update(`workitem::${findingId}`)
    .digest('hex')
    .slice(0, 16);
}

function deriveType(severity: 'low' | 'medium' | 'high' | 'critical'): 'blocker' | 'risk' | 'opportunity' {
  if (severity === 'critical') return 'blocker';
  if (severity === 'high') return 'risk';
  if (severity === 'medium') return 'risk';
  return 'opportunity';
}

function derivePriority(severity: 'low' | 'medium' | 'high' | 'critical'): 'p1' | 'p2' | 'p3' {
  if (severity === 'critical' || severity === 'high') return 'p1';
  if (severity === 'medium') return 'p2';
  return 'p3';
}
