import { z } from 'zod';
import { Driver } from 'neo4j-driver';
import { getSession } from '../../graph/db/connection.js';
import { getSymbolMetrics, getFileMetrics, getProjectMetrics } from '../../metrics/metrics-service.js';

const InputSchema = z.object({
  appDb: z.string(),
  entityId: z.string(),
  entityType: z.enum([
    'File', 'Component', 'Service', 'Directive', 'Pipe',
    'Class', 'Interface', 'Method', 'Property', 'InjectionToken', 'Project',
  ]),
});

export async function getMetrics(
  driver: Driver,
  input: Record<string, unknown>,
): Promise<unknown> {
  const params = InputSchema.parse(input);
  const session = getSession(driver, params.appDb);

  try {
    let metrics;
    if (params.entityType === 'File') {
      metrics = await getFileMetrics(session, params.entityId);
    } else if (params.entityType === 'Project') {
      metrics = await getProjectMetrics(session, params.entityId);
    } else {
      metrics = await getSymbolMetrics(session, params.entityId);
    }

    return {
      entityId: metrics.entityId,
      entityLabel: metrics.entityLabel,
      entityName: metrics.entityName,
      metrics: {
        inboundCount: metrics.inboundCount,
        outboundCount: metrics.outboundCount,
        injectionCount: metrics.injectionCount,
        templateUsageCount: metrics.templateUsageCount,
        selectorUsageCount: metrics.selectorUsageCount,
        projectDependencyCount: metrics.projectDependencyCount,
        projectConsumerCount: metrics.projectConsumerCount,
      },
      appDb: params.appDb,
    };
  } finally {
    await session.close();
  }
}
