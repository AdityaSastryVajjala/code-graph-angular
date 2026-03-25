import { getSymbolMetrics, getFileMetrics, getProjectMetrics } from '../../../src/metrics/metrics-service.js';
import type { Session } from 'neo4j-driver';

function makeNeoInt(n: number) {
  return { toNumber: () => n };
}

function makeRecord(fields: Record<string, unknown>) {
  return { get: (key: string) => fields[key] };
}

function createMockSession(records: unknown[]): Session {
  return {
    run: jest.fn().mockResolvedValue({ records }),
    close: jest.fn().mockResolvedValue(undefined),
  } as unknown as Session;
}

describe('getSymbolMetrics', () => {
  it('returns correct counts from session', async () => {
    const session = createMockSession([
      makeRecord({
        entityId: 'auth-service-id',
        entityLabel: 'Service',
        entityName: 'AuthService',
        inboundCount: makeNeoInt(3),
        outboundCount: makeNeoInt(2),
        injectionCount: makeNeoInt(3),
        templateUsageCount: makeNeoInt(1),
        selectorUsageCount: makeNeoInt(0),
      }),
    ]);

    const metrics = await getSymbolMetrics(session, 'auth-service-id');

    expect(metrics.entityId).toBe('auth-service-id');
    expect(metrics.entityLabel).toBe('Service');
    expect(metrics.entityName).toBe('AuthService');
    expect(metrics.inboundCount).toBe(3);
    expect(metrics.outboundCount).toBe(2);
    expect(metrics.injectionCount).toBe(3);
    expect(metrics.templateUsageCount).toBe(1);
    expect(metrics.selectorUsageCount).toBe(0);
    expect(metrics.projectDependencyCount).toBe(0);
    expect(metrics.projectConsumerCount).toBe(0);
  });

  it('returns zeros for non-applicable fields', async () => {
    const session = createMockSession([
      makeRecord({
        entityId: 'method-id',
        entityLabel: 'Method',
        entityName: 'login',
        inboundCount: makeNeoInt(2),
        outboundCount: makeNeoInt(0),
        injectionCount: makeNeoInt(0),
        templateUsageCount: makeNeoInt(0),
        selectorUsageCount: makeNeoInt(0),
      }),
    ]);

    const metrics = await getSymbolMetrics(session, 'method-id');

    expect(metrics.projectDependencyCount).toBe(0);
    expect(metrics.projectConsumerCount).toBe(0);
    expect(metrics.injectionCount).toBe(0);
  });

  it('returns empty metrics when symbol not found', async () => {
    const session = createMockSession([]);

    const metrics = await getSymbolMetrics(session, 'non-existent-id');

    expect(metrics.entityId).toBe('non-existent-id');
    expect(metrics.inboundCount).toBe(0);
    expect(metrics.outboundCount).toBe(0);
  });
});

describe('getFileMetrics', () => {
  it('returns aggregated counts for a file', async () => {
    const session = createMockSession([
      makeRecord({
        entityId: 'file-id-1',
        entityName: 'src/app/auth.service.ts',
        inboundCount: makeNeoInt(5),
        outboundCount: makeNeoInt(3),
      }),
    ]);

    const metrics = await getFileMetrics(session, 'src/app/auth.service.ts');

    expect(metrics.entityLabel).toBe('File');
    expect(metrics.inboundCount).toBe(5);
    expect(metrics.outboundCount).toBe(3);
    expect(metrics.injectionCount).toBe(0);
    expect(metrics.templateUsageCount).toBe(0);
  });

  it('returns empty metrics when file not found', async () => {
    const session = createMockSession([]);

    const metrics = await getFileMetrics(session, 'non-existent.ts');

    expect(metrics.entityLabel).toBe('File');
    expect(metrics.inboundCount).toBe(0);
  });
});

describe('getProjectMetrics', () => {
  it('returns project dependency and consumer counts', async () => {
    const session = createMockSession([
      makeRecord({
        entityId: 'shell-project-id',
        entityName: 'shell',
        projectDependencyCount: makeNeoInt(2),
        projectConsumerCount: makeNeoInt(0),
      }),
    ]);

    const metrics = await getProjectMetrics(session, 'shell-project-id');

    expect(metrics.entityLabel).toBe('Project');
    expect(metrics.entityName).toBe('shell');
    expect(metrics.projectDependencyCount).toBe(2);
    expect(metrics.projectConsumerCount).toBe(0);
    expect(metrics.inboundCount).toBe(0);
    expect(metrics.outboundCount).toBe(0);
    expect(metrics.injectionCount).toBe(0);
  });

  it('returns empty metrics when project not found', async () => {
    const session = createMockSession([]);

    const metrics = await getProjectMetrics(session, 'non-existent-project');

    expect(metrics.entityLabel).toBe('Project');
    expect(metrics.projectDependencyCount).toBe(0);
    expect(metrics.projectConsumerCount).toBe(0);
  });
});
