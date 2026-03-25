import { traverseFromFile, traverseFromSymbol } from '../../../src/impact/traversal-engine.js';
import type { Session } from 'neo4j-driver';

// Helper to create a mock Neo4j session
function createMockSession(queryResponses: Map<string, { records: unknown[] }>): Session {
  return {
    run: jest.fn().mockImplementation((cypher: string) => {
      // Return responses based on what's being queried
      for (const [pattern, response] of queryResponses.entries()) {
        if (cypher.includes(pattern)) {
          return Promise.resolve(response);
        }
      }
      return Promise.resolve({ records: [] });
    }),
    close: jest.fn().mockResolvedValue(undefined),
  } as unknown as Session;
}

function makeRecord(fields: Record<string, unknown>) {
  return {
    get: (key: string) => fields[key],
  };
}

describe('traverseFromFile', () => {
  it('returns empty array when file has no declared nodes', async () => {
    const session = createMockSession(new Map([
      ['fp}', { records: [makeRecord({ seedIds: [] })] }],
    ]));

    const results = await traverseFromFile(session, 'src/app/auth.service.ts', { maxDepth: 5 });
    expect(results).toEqual([]);
  });

  it('respects depth limit', async () => {
    // With maxDepth:1, only direct dependents should be returned
    const session = createMockSession(new Map([
      ['fp}', { records: [makeRecord({ seedIds: ['seed-id-1'] })] }],
      ['UNWIND', { records: [
        makeRecord({
          fromId: 'seed-id-1',
          edgeType: 'INJECTS',
          consumerId: 'consumer-1',
          consumerLabel: 'Component',
          consumerName: 'LoginComponent',
          consumerFilePath: 'src/app/login.component.ts',
          isTest: false,
        }),
      ] }],
    ]));

    const results = await traverseFromFile(session, 'src/app/auth.service.ts', { maxDepth: 1 });
    expect(results.every((r) => r.depth <= 1)).toBe(true);
  });

  it('excludes SpecFile nodes when includeTests is false', async () => {
    const session = createMockSession(new Map([
      ['fp}', { records: [makeRecord({ seedIds: ['seed-id-1'] })] }],
      ['UNWIND', { records: [
        makeRecord({
          fromId: 'seed-id-1',
          edgeType: 'INJECTS',
          consumerId: 'spec-consumer-1',
          consumerLabel: 'SpecFile',
          consumerName: 'auth.service.spec.ts',
          consumerFilePath: 'src/app/auth.service.spec.ts',
          isTest: true,
        }),
      ] }],
    ]));

    const results = await traverseFromFile(session, 'src/app/auth.service.ts', {
      maxDepth: 5,
      includeTests: false,
    });
    expect(results.filter((r) => r.isTestFile)).toHaveLength(0);
  });

  it('includes SpecFile nodes when includeTests is true', async () => {
    const session = createMockSession(new Map([
      ['fp}', { records: [makeRecord({ seedIds: ['seed-id-1'] })] }],
      ['UNWIND', { records: [
        makeRecord({
          fromId: 'seed-id-1',
          edgeType: 'INJECTS',
          consumerId: 'spec-consumer-1',
          consumerLabel: 'SpecFile',
          consumerName: 'auth.service.spec.ts',
          consumerFilePath: 'src/app/auth.service.spec.ts',
          isTest: true,
        }),
      ] }],
    ]));

    const results = await traverseFromFile(session, 'src/app/auth.service.ts', {
      maxDepth: 5,
      includeTests: true,
    });
    expect(results.some((r) => r.isTestFile)).toBe(true);
  });

  it('does not re-traverse already visited nodes (cycle detection)', async () => {
    let callCount = 0;
    const session = {
      run: jest.fn().mockImplementation((cypher: string) => {
        if (cypher.includes('fp}')) {
          return Promise.resolve({ records: [makeRecord({ seedIds: ['node-a'] })] });
        }
        // First call: node-a → node-b, node-b → node-a (cycle)
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            records: [
              makeRecord({
                fromId: 'node-a', edgeType: 'INJECTS', consumerId: 'node-b',
                consumerLabel: 'Service', consumerName: 'ServiceB',
                consumerFilePath: 'src/app/b.service.ts', isTest: false,
              }),
            ],
          });
        }
        if (callCount === 2) {
          return Promise.resolve({
            records: [
              makeRecord({
                fromId: 'node-b', edgeType: 'INJECTS', consumerId: 'node-a', // cycle back
                consumerLabel: 'Service', consumerName: 'ServiceA',
                consumerFilePath: 'src/app/a.service.ts', isTest: false,
              }),
            ],
          });
        }
        return Promise.resolve({ records: [] });
      }),
      close: jest.fn().mockResolvedValue(undefined),
    } as unknown as Session;

    const results = await traverseFromFile(session, 'src/app/a.service.ts', { maxDepth: 10 });
    // node-a is in the visited set from the start, node-b is added after first traversal
    // The cycle (b → a) should be ignored
    const nodeIds = results.map((r) => r.nodeId);
    const uniqueIds = new Set(nodeIds);
    expect(uniqueIds.size).toBe(nodeIds.length); // no duplicates
  });
});

describe('traverseFromSymbol', () => {
  it('returns empty array when symbol has no dependents', async () => {
    const session = createMockSession(new Map([
      ['UNWIND', { records: [] }],
    ]));

    const results = await traverseFromSymbol(session, 'auth-service-id', { maxDepth: 5 });
    expect(results).toEqual([]);
  });

  it('classifies direct injections as direct', async () => {
    const session = createMockSession(new Map([
      ['UNWIND', { records: [
        makeRecord({
          fromId: 'auth-service-id',
          edgeType: 'INJECTS',
          consumerId: 'login-component-id',
          consumerLabel: 'Component',
          consumerName: 'LoginComponent',
          consumerFilePath: 'src/app/login.component.ts',
          isTest: false,
        }),
      ] }],
    ]));

    const results = await traverseFromSymbol(session, 'auth-service-id', { maxDepth: 5 });
    expect(results).toHaveLength(1);
    expect(results[0].impactClass).toBe('direct');
    expect(results[0].depth).toBe(1);
  });

  it('applies projectId filter when specified', async () => {
    let callCount = 0;
    const mockRun = jest.fn().mockImplementation((cypher: string) => {
      callCount++;
      // First UNWIND call: return 2 consumers
      if (cypher.includes('UNWIND') && callCount === 1) {
        return Promise.resolve({
          records: [
            makeRecord({
              fromId: 'sym-id', edgeType: 'INJECTS', consumerId: 'comp-a',
              consumerLabel: 'Component', consumerName: 'CompA',
              consumerFilePath: 'src/app/a.component.ts', isTest: false,
            }),
            makeRecord({
              fromId: 'sym-id', edgeType: 'INJECTS', consumerId: 'comp-b',
              consumerLabel: 'Component', consumerName: 'CompB',
              consumerFilePath: 'libs/other/b.component.ts', isTest: false,
            }),
          ],
        });
      }
      // projectId filter query
      if (cypher.includes('BELONGS_TO_PROJECT')) {
        return Promise.resolve({
          records: [makeRecord({ validIds: ['comp-a'] })],
        });
      }
      return Promise.resolve({ records: [] });
    });

    const session = {
      run: mockRun,
      close: jest.fn().mockResolvedValue(undefined),
    } as unknown as Session;

    const results = await traverseFromSymbol(session, 'sym-id', {
      maxDepth: 1, // limit depth to 1 to avoid recursive BFS calls
      projectId: 'project-shell-id',
    });

    expect(results).toHaveLength(1);
    expect(results[0].nodeId).toBe('comp-a');
  });
});
