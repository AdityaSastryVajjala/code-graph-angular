/**
 * TraversalOptions — validation and constants for impact graph traversal.
 */

import { z } from 'zod';
import { TraversalOptions } from '../core/types/graph-ir.js';

export type { TraversalOptions };

/** All 16 eligible edge types for impact traversal. */
export const ELIGIBLE_EDGE_TYPES: string[] = [
  'INJECTS',
  'USES_COMPONENT',
  'USES_DIRECTIVE',
  'USES_PIPE',
  'BINDS_TO',
  'TEMPLATE_BINDS_PROPERTY',
  'TEMPLATE_BINDS_EVENT',
  'TEMPLATE_TWO_WAY_BINDS',
  'TEMPLATE_USES_DIRECTIVE',
  'TEMPLATE_USES_PIPE',
  'ROUTES_TO',
  'LAZY_LOADS',
  'EXTENDS',
  'IMPLEMENTS',
  'DECLARES',
  'IMPORTS',
];

const TraversalOptionsSchema = z.object({
  maxDepth: z
    .number()
    .optional()
    .transform((v) => {
      if (v === undefined) return 10;
      if (v <= 0) return 1;
      return Math.min(v, 20);
    }),
  edgeKinds: z.array(z.string()).optional(),
  projectId: z.string().optional(),
  includeTests: z.boolean().optional(),
  summaryMode: z.boolean().optional(),
});

export function validateTraversalOptions(opts: unknown): TraversalOptions {
  return TraversalOptionsSchema.parse(opts);
}
