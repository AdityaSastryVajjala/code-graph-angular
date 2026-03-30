/**
 * Unit tests for MigrationOrderAnalyzer — Kahn's BFS + cycle detection (T021)
 */

import { MigrationOrderAnalyzer } from '../../../src/migration/analyzers/migration-order-analyzer.js';

// Access private methods for unit testing via type casting
type PrivateAnalyzer = {
  detectCycles(nodes: Map<string, { id: string; filePath: string; deps: string[] }>): Set<string>;
  kahnsSort(nodes: Map<string, { id: string; filePath: string; deps: string[] }>): Map<string, number>;
};

function makeNode(id: string, deps: string[]) {
  return { id, filePath: `src/${id}.ts`, deps };
}

function makeNodes(entries: [string, string[]][]) {
  return new Map(entries.map(([id, deps]) => [id, makeNode(id, deps)]));
}

describe('MigrationOrderAnalyzer (unit — graph algorithms)', () => {
  let analyzer: MigrationOrderAnalyzer;
  let priv: PrivateAnalyzer;

  beforeEach(() => {
    // Session is not used in unit tests of the algorithm methods
    analyzer = new MigrationOrderAnalyzer({} as never, 'test-run-id');
    priv = analyzer as unknown as PrivateAnalyzer;
  });

  describe('detectCycles', () => {
    it('returns empty set for a linear chain (no cycles)', () => {
      // A → B → C (A depends on B, B depends on C)
      const nodes = makeNodes([
        ['A', ['B']],
        ['B', ['C']],
        ['C', []],
      ]);
      const cyclic = priv.detectCycles(nodes);
      expect(cyclic.size).toBe(0);
    });

    it('detects a simple 2-node cycle', () => {
      const nodes = makeNodes([
        ['A', ['B']],
        ['B', ['A']],
      ]);
      const cyclic = priv.detectCycles(nodes);
      expect(cyclic.size).toBeGreaterThan(0);
      // Both A and B are in the cycle
      expect(cyclic.has('A') || cyclic.has('B')).toBe(true);
    });

    it('detects a 3-node cycle while leaving non-cyclic nodes clean', () => {
      const nodes = makeNodes([
        ['X', []],       // clean — no deps
        ['A', ['B']],
        ['B', ['C']],
        ['C', ['A']],    // cycle: A→B→C→A
      ]);
      const cyclic = priv.detectCycles(nodes);
      expect(cyclic.has('X')).toBe(false);
      // At least some of A/B/C should be marked
      const cyclicInChain = ['A', 'B', 'C'].filter((id) => cyclic.has(id));
      expect(cyclicInChain.length).toBeGreaterThan(0);
    });
  });

  describe('kahnsSort', () => {
    it('assigns lower index to dependencies (A depends on B → B gets lower index)', () => {
      // A depends on B, B depends on C → C=0, B=1, A=2
      const nodes = makeNodes([
        ['A', ['B']],
        ['B', ['C']],
        ['C', []],
      ]);
      const order = priv.kahnsSort(nodes);
      expect(order.get('C')).toBeLessThan(order.get('B')!);
      expect(order.get('B')).toBeLessThan(order.get('A')!);
    });

    it('assigns the same index to parallel (independent) nodes', () => {
      // B and C both depend only on A
      const nodes = makeNodes([
        ['A', []],
        ['B', ['A']],
        ['C', ['A']],
      ]);
      const order = priv.kahnsSort(nodes);
      expect(order.get('B')).toBe(order.get('C'));
    });

    it('handles a disconnected graph (all nodes receive valid indices)', () => {
      const nodes = makeNodes([
        ['X', []],
        ['Y', []],
        ['Z', []],
      ]);
      const order = priv.kahnsSort(nodes);
      expect(order.has('X')).toBe(true);
      expect(order.has('Y')).toBe(true);
      expect(order.has('Z')).toBe(true);
      // All disconnected nodes with no deps → level 0
      expect(order.get('X')).toBe(0);
      expect(order.get('Y')).toBe(0);
      expect(order.get('Z')).toBe(0);
    });

    it('returns empty map for empty input', () => {
      const order = priv.kahnsSort(new Map());
      expect(order.size).toBe(0);
    });

    it('handles a single node with no deps', () => {
      const nodes = makeNodes([['Alone', []]]);
      const order = priv.kahnsSort(nodes);
      expect(order.get('Alone')).toBe(0);
    });
  });
});
