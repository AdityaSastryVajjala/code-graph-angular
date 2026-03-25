/**
 * Phase 3 impact integration tests.
 *
 * Requires a running Neo4j instance.
 * Verifies find_symbol, get_injections, get_dependents, get_dependencies tool behavior.
 */

// These tests verify tool schema contracts without a live DB
// by testing the validation and response shape logic.

import { encodeCursor, decodeCursor } from '../../src/mcp/cypher-helpers.js';
import { validateTraversalOptions } from '../../src/impact/traversal-options.js';

describe('Phase 3 impact integration', () => {
  describe('cursor encoding/decoding', () => {
    it('encodes and decodes cursor correctly', () => {
      const cursor = encodeCursor(50);
      expect(decodeCursor(cursor)).toBe(50);
    });

    it('returns 0 for undefined cursor', () => {
      expect(decodeCursor(undefined)).toBe(0);
    });

    it('returns 0 for invalid cursor', () => {
      expect(decodeCursor('not-valid-base64!!')).toBe(0);
    });

    it('pagination cursor advances on second page', () => {
      const firstCursor = encodeCursor(0);
      expect(decodeCursor(firstCursor)).toBe(0);

      const secondCursor = encodeCursor(20);
      expect(decodeCursor(secondCursor)).toBe(20);

      const thirdCursor = encodeCursor(40);
      expect(decodeCursor(thirdCursor)).toBe(40);
    });
  });

  describe('traversal options validation', () => {
    it('clamps maxDepth to maximum of 20', () => {
      const opts = validateTraversalOptions({ maxDepth: 100 });
      expect(opts.maxDepth).toBe(20);
    });

    it('normalizes zero/negative depth to 1', () => {
      expect(validateTraversalOptions({ maxDepth: 0 }).maxDepth).toBe(1);
      expect(validateTraversalOptions({ maxDepth: -5 }).maxDepth).toBe(1);
    });

    it('uses default depth of 10 when not specified', () => {
      const opts = validateTraversalOptions({});
      expect(opts.maxDepth).toBe(10);
    });

    it('passes through optional fields unchanged', () => {
      const opts = validateTraversalOptions({
        edgeKinds: ['INJECTS', 'USES_COMPONENT'],
        projectId: 'project-id-1',
        includeTests: true,
        summaryMode: false,
      });
      expect(opts.edgeKinds).toEqual(['INJECTS', 'USES_COMPONENT']);
      expect(opts.projectId).toBe('project-id-1');
      expect(opts.includeTests).toBe(true);
      expect(opts.summaryMode).toBe(false);
    });
  });

  describe('minimal mode field contract', () => {
    it('formatImpactItem omits edgeChain in summary mode', async () => {
      const { formatImpactItem } = await import('../../src/mcp/cypher-helpers.js');
      const item = formatImpactItem(
        {
          nodeId: 'id-1',
          nodeLabel: 'Component',
          nodeName: 'LoginComponent',
          filePath: 'src/app/login.component.ts',
          impactClass: 'direct',
          depth: 1,
          edgeChain: ['INJECTS'],
          isTestFile: false,
          projectId: null,
        },
        true, // summaryMode
      );
      expect(item['edgeChain']).toBeUndefined();
    });

    it('formatImpactItem includes edgeChain in expanded mode', async () => {
      const { formatImpactItem } = await import('../../src/mcp/cypher-helpers.js');
      const item = formatImpactItem(
        {
          nodeId: 'id-1',
          nodeLabel: 'Component',
          nodeName: 'LoginComponent',
          filePath: 'src/app/login.component.ts',
          impactClass: 'direct',
          depth: 1,
          edgeChain: ['INJECTS'],
          isTestFile: false,
          projectId: null,
        },
        false, // expanded mode
      );
      expect(item['edgeChain']).toEqual(['INJECTS']);
    });
  });
});
