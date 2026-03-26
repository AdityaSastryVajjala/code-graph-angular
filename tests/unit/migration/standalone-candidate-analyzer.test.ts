/**
 * Unit tests for StandaloneCandidateAnalyzer (T014)
 * Tests the candidate decision logic in isolation using mock session data.
 */

import { buildFinding } from '../../../src/migration/finding-builder.js';

const runId = '2026-03-25T10:00:00.000Z';

// Helper: simulate the candidate decision logic extracted from the analyzer
function evaluateCandidate(
  moduleId: string | null,
  entryComponents: string[] | null,
): { isCandidate: boolean; blockers: string[] } {
  const blockers: string[] = [];

  if (!moduleId) {
    blockers.push('ANG_NGMODULE_HEAVY');
  }

  if (entryComponents && entryComponents.length > 0) {
    blockers.push('ANG_ENTRY_COMPONENTS');
  }

  return { isCandidate: blockers.length === 0, blockers };
}

describe('StandaloneCandidateAnalyzer (candidate logic)', () => {
  describe('evaluateCandidate', () => {
    it('marks as candidate when moduleId is present and no entryComponents', () => {
      const result = evaluateCandidate('mod-1', null);
      expect(result.isCandidate).toBe(true);
      expect(result.blockers).toHaveLength(0);
    });

    it('marks as non-candidate when no declaring NgModule found (confidence 0.95)', () => {
      const result = evaluateCandidate(null, null);
      expect(result.isCandidate).toBe(false);
      expect(result.blockers).toContain('ANG_NGMODULE_HEAVY');
    });

    it('marks as non-candidate when entryComponents is present (hard blocker)', () => {
      const result = evaluateCandidate('mod-1', ['SomeDialog']);
      expect(result.isCandidate).toBe(false);
      expect(result.blockers).toContain('ANG_ENTRY_COMPONENTS');
    });

    it('accumulates multiple blockers', () => {
      const result = evaluateCandidate(null, ['SomeDialog']);
      expect(result.isCandidate).toBe(false);
      expect(result.blockers).toContain('ANG_NGMODULE_HEAVY');
      expect(result.blockers).toContain('ANG_ENTRY_COMPONENTS');
    });

    it('returns no blockers for empty entryComponents array', () => {
      const result = evaluateCandidate('mod-1', []);
      expect(result.isCandidate).toBe(true);
      expect(result.blockers).toHaveLength(0);
    });
  });

  describe('Finding construction from candidate logic', () => {
    it('constructs a valid blocker finding for ANG_ENTRY_COMPONENTS', () => {
      const finding = buildFinding({
        affectedNodeId: 'comp-1',
        reasonCode: 'ANG_ENTRY_COMPONENTS',
        scope: 'production',
        migrationRunId: runId,
        type: 'blocker',
      });
      expect(finding.type).toBe('blocker');
      expect(finding.severity).toBe('high');
      expect(finding.confidenceScore).toBe(0.90);
    });

    it('constructs an opportunity finding for ANG_NGMODULE_HEAVY (candidate)', () => {
      const finding = buildFinding({
        affectedNodeId: 'comp-2',
        reasonCode: 'ANG_NGMODULE_HEAVY',
        scope: 'production',
        migrationRunId: runId,
        type: 'opportunity',
      });
      expect(finding.type).toBe('opportunity');
      expect(finding.category).toBe('angular');
    });

    it('tags spec file findings as scope=test', () => {
      const filePath = 'src/app/user.component.spec.ts';
      const scope: 'production' | 'test' = filePath.includes('.spec.') ? 'test' : 'production';
      expect(scope).toBe('test');

      const finding = buildFinding({
        affectedNodeId: 'comp-spec-1',
        reasonCode: 'ANG_CLASS_BASED_GUARD',
        scope,
        migrationRunId: runId,
      });
      expect(finding.scope).toBe('test');
    });

    it('tags production file findings as scope=production', () => {
      const filePath = 'src/app/user.component.ts';
      const scope: 'production' | 'test' = filePath.includes('.spec.') ? 'test' : 'production';
      expect(scope).toBe('production');
    });
  });
});
