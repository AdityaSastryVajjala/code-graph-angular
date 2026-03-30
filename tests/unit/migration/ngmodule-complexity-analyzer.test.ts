/**
 * Unit tests for NgModuleComplexityAnalyzer scoring formula (T033)
 */

// Test the scoring formula and band assignment in isolation
// (without Neo4j — tests the algorithm directly)

const MAX_THEORETICAL_SCORE = 300;

function computeScore(
  declCount: number,
  importCount: number,
  exportCount: number,
  consumerCount: number,
  crossProjectImports: number,
): number {
  const rawScore =
    declCount * 1.0 +
    importCount * 1.5 +
    exportCount * 1.2 +
    consumerCount * 2.0 +
    crossProjectImports * 3.0;

  return Math.min(100, Math.round((rawScore / MAX_THEORETICAL_SCORE) * 100 * 10) / 10);
}

function scoreToBand(score: number): 'high' | 'medium' | 'low' | 'blocked' {
  if (score <= 20) return 'high';
  if (score <= 50) return 'medium';
  if (score <= 80) return 'low';
  return 'blocked';
}

describe('NgModuleComplexityAnalyzer (scoring formula)', () => {
  describe('computeScore', () => {
    it('returns 0 for a completely empty module', () => {
      expect(computeScore(0, 0, 0, 0, 0)).toBe(0);
    });

    it('returns a higher score for a heavily-coupled module than a simple one', () => {
      const simple = computeScore(2, 1, 1, 0, 0);
      const complex = computeScore(20, 15, 10, 8, 3);
      expect(complex).toBeGreaterThan(simple);
    });

    it('clamps to 100 for unrealistically large modules', () => {
      const score = computeScore(1000, 1000, 1000, 1000, 1000);
      expect(score).toBe(100);
    });

    it('weights cross-project imports most heavily (3.0)', () => {
      // 1 cross-project import vs 1 consumer (2.0) vs 1 import (1.5)
      const crossProject = computeScore(0, 0, 0, 0, 1);
      const consumer = computeScore(0, 0, 0, 1, 0);
      const importMod = computeScore(0, 1, 0, 0, 0);
      expect(crossProject).toBeGreaterThan(consumer);
      expect(consumer).toBeGreaterThan(importMod);
    });
  });

  describe('scoreToBand', () => {
    it('maps score 0 to high feasibility', () => {
      expect(scoreToBand(0)).toBe('high');
    });

    it('maps score 20 to high feasibility (boundary)', () => {
      expect(scoreToBand(20)).toBe('high');
    });

    it('maps score 21 to medium feasibility', () => {
      expect(scoreToBand(21)).toBe('medium');
    });

    it('maps score 50 to medium feasibility (boundary)', () => {
      expect(scoreToBand(50)).toBe('medium');
    });

    it('maps score 51 to low feasibility', () => {
      expect(scoreToBand(51)).toBe('low');
    });

    it('maps score 80 to low feasibility (boundary)', () => {
      expect(scoreToBand(80)).toBe('low');
    });

    it('maps score 81 to blocked', () => {
      expect(scoreToBand(81)).toBe('blocked');
    });

    it('maps score 100 to blocked', () => {
      expect(scoreToBand(100)).toBe('blocked');
    });
  });

  describe('module characterization', () => {
    it('a simple module (few declarations, no consumers) scores low', () => {
      const score = computeScore(3, 2, 0, 0, 0);
      expect(scoreToBand(score)).toBe('high');
    });

    it('a heavily coupled shared module (many consumers, cross-project) scores worse than simple', () => {
      const simpleScore = computeScore(2, 1, 1, 0, 0);
      const complexScore = computeScore(10, 8, 6, 15, 4);
      expect(complexScore).toBeGreaterThan(simpleScore);
      // Feasibility gets worse (high → medium → low → blocked) as score increases
      const simpleBand = scoreToBand(simpleScore);
      const complexBand = scoreToBand(complexScore);
      const bands = ['high', 'medium', 'low', 'blocked'];
      expect(bands.indexOf(complexBand)).toBeGreaterThanOrEqual(bands.indexOf(simpleBand));
    });
  });
});
