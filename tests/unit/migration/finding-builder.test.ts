/**
 * Unit tests for FindingBuilder (T025/T028)
 */

import { buildFinding, buildWorkItemSeed, buildFindingId, buildWorkItemId } from '../../../src/migration/finding-builder.js';

describe('FindingBuilder', () => {
  const runId = '2026-03-25T10:00:00.000Z';

  describe('buildFindingId', () => {
    it('produces the same ID for the same inputs (deterministic)', () => {
      const id1 = buildFindingId('node-abc', 'ANG_CLASS_BASED_GUARD', 'production');
      const id2 = buildFindingId('node-abc', 'ANG_CLASS_BASED_GUARD', 'production');
      expect(id1).toBe(id2);
    });

    it('produces different IDs for different inputs', () => {
      const id1 = buildFindingId('node-abc', 'ANG_CLASS_BASED_GUARD', 'production');
      const id2 = buildFindingId('node-xyz', 'ANG_CLASS_BASED_GUARD', 'production');
      expect(id1).not.toBe(id2);
    });

    it('produces a 16-character hex string', () => {
      const id = buildFindingId('node-abc', 'ANG_CLASS_BASED_GUARD', 'production');
      expect(id).toHaveLength(16);
      expect(id).toMatch(/^[0-9a-f]+$/);
    });
  });

  describe('buildWorkItemId', () => {
    it('produces a deterministic 16-char hex ID from a finding ID', () => {
      const id1 = buildWorkItemId('abc123');
      const id2 = buildWorkItemId('abc123');
      expect(id1).toBe(id2);
      expect(id1).toHaveLength(16);
    });
  });

  describe('buildFinding', () => {
    it('builds a valid finding for ANG_CLASS_BASED_GUARD', () => {
      const finding = buildFinding({
        affectedNodeId: 'node-guard-1',
        reasonCode: 'ANG_CLASS_BASED_GUARD',
        scope: 'production',
        migrationRunId: runId,
      });

      expect(finding.reasonCode).toBe('ANG_CLASS_BASED_GUARD');
      expect(finding.severity).toBe('medium');
      expect(finding.category).toBe('angular');
      expect(finding.confidenceScore).toBe(0.92);
      expect(finding.scope).toBe('production');
      expect(finding.migrationRunId).toBe(runId);
      expect(finding.id).toHaveLength(16);
      expect(finding.isDeprecatedUsage).toBe(true);
    });

    it('derives p1 priority for critical/high severity findings', () => {
      const finding = buildFinding({
        affectedNodeId: 'node-1',
        reasonCode: 'RXJS_PATCH_IMPORTS',
        scope: 'production',
        migrationRunId: runId,
      });
      expect(finding.severity).toBe('high');
      // buildWorkItemSeed will map this to p1
    });

    it('uses scope=test correctly', () => {
      const finding = buildFinding({
        affectedNodeId: 'node-spec-1',
        reasonCode: 'ANG_CLASS_BASED_GUARD',
        scope: 'test',
        migrationRunId: runId,
      });
      expect(finding.scope).toBe('test');
    });

    it('accepts explicit type override', () => {
      const finding = buildFinding({
        affectedNodeId: 'node-2',
        reasonCode: 'ANG_ENTRY_COMPONENTS',
        scope: 'production',
        migrationRunId: runId,
        type: 'blocker',
      });
      expect(finding.type).toBe('blocker');
    });

    it('throws for unknown reason code', () => {
      expect(() =>
        buildFinding({
          affectedNodeId: 'node-x',
          reasonCode: 'NONEXISTENT_CODE',
          scope: 'production',
          migrationRunId: runId,
        }),
      ).toThrow('Unknown reason code');
    });

    it('throws when blocker type is combined with low/medium severity', () => {
      expect(() =>
        buildFinding({
          affectedNodeId: 'node-x',
          reasonCode: 'ANG_BARREL_COUPLING', // severity: low
          scope: 'production',
          migrationRunId: runId,
          type: 'blocker',
        }),
      ).toThrow('blocker');
    });
  });

  describe('buildWorkItemSeed', () => {
    it('derives p1 priority for high severity findings', () => {
      const finding = buildFinding({
        affectedNodeId: 'node-rxjs',
        reasonCode: 'RXJS_PATCH_IMPORTS',
        scope: 'production',
        migrationRunId: runId,
      });
      const seed = buildWorkItemSeed(
        finding,
        'Replace RxJS patch imports',
        'Migrate to pipeable operators',
        ['node-rxjs'],
      );
      expect(seed.priority).toBe('p1');
      expect(seed.affectedArtifacts).toEqual(['node-rxjs']);
      expect(seed.migrationRunId).toBe(runId);
    });

    it('derives p2 priority for medium severity findings', () => {
      const finding = buildFinding({
        affectedNodeId: 'node-m',
        reasonCode: 'ANG_CLASS_BASED_GUARD',
        scope: 'production',
        migrationRunId: runId,
      });
      const seed = buildWorkItemSeed(finding, 'Fix guard', 'desc', ['node-m']);
      expect(seed.priority).toBe('p2');
    });

    it('derives p3 priority for low severity findings', () => {
      const finding = buildFinding({
        affectedNodeId: 'node-low',
        reasonCode: 'ANG_CD_DEFAULT',
        scope: 'production',
        migrationRunId: runId,
      });
      const seed = buildWorkItemSeed(finding, 'Optimize CD', 'desc', ['node-low']);
      expect(seed.priority).toBe('p3');
    });

    it('throws when affectedArtifacts is empty', () => {
      const finding = buildFinding({
        affectedNodeId: 'node-x',
        reasonCode: 'ANG_CLASS_BASED_GUARD',
        scope: 'production',
        migrationRunId: runId,
      });
      expect(() => buildWorkItemSeed(finding, 'title', 'desc', [])).toThrow(
        'at least one affectedArtifact',
      );
    });

    it('has a deterministic ID matching buildWorkItemId(finding.id)', () => {
      const finding = buildFinding({
        affectedNodeId: 'node-det',
        reasonCode: 'ANG_CLASS_BASED_GUARD',
        scope: 'production',
        migrationRunId: runId,
      });
      const seed = buildWorkItemSeed(finding, 'title', 'desc', ['node-det']);
      expect(seed.id).toBe(buildWorkItemId(finding.id));
    });
  });
});
