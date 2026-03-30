/**
 * get_migration_tasks — returns topologically-ordered migration task batches.
 *
 * Queries WorkItemSeed nodes and WORK_ITEM_DEPENDS_ON edges, computes
 * dependency-safe batches via Kahn's algorithm, and returns each batch
 * with its parallelisable task list. An agent can execute all tasks in
 * a batch concurrently before moving to the next batch.
 */

import { z } from 'zod';
import { Driver } from 'neo4j-driver';
import { getSession } from '../../graph/db/connection.js';

const InputSchema = z.object({
  appDb: z.string(),
  /** Filter to a specific migration run ID. Omit for the latest run. */
  migrationRunId: z.string().optional(),
  /** Only include tasks with this finding type (blocker | risk | opportunity). */
  findingType: z.enum(['blocker', 'risk', 'opportunity']).optional(),
  /** Maximum number of tasks to return across all batches (default 200). */
  limit: z.number().int().min(1).max(500).optional().default(200),
});

interface MigrationTask {
  taskId: string;
  title: string;
  findingType: string;
  severity: string;
  reasonCode: string;
  affectedNodeId: string;
  affectedFile: string | null;
  migrationRunId: string;
  dependsOnTaskIds: string[];
}

interface TaskBatch {
  batchIndex: number;
  canRunInParallel: boolean;
  tasks: MigrationTask[];
}

export async function getMigrationTasks(
  driver: Driver,
  input: Record<string, unknown>,
): Promise<unknown> {
  const params = InputSchema.parse(input);
  const session = getSession(driver, params.appDb);

  try {
    // Build run filter — either specified run or all runs
    const runFilter = params.migrationRunId
      ? 'WHERE w.migrationRunId = $migrationRunId'
      : '';

    const typeFilter = params.findingType
      ? `${runFilter ? 'AND' : 'WHERE'} w.findingType = $findingType`
      : '';

    const whereClause = [runFilter, typeFilter].filter(Boolean).join('\n       ');

    // Fetch all WorkItemSeed nodes
    const nodesResult = await session.run(
      `MATCH (w:WorkItemSeed)
       ${whereClause}
       OPTIONAL MATCH (f:Finding)-[:FINDING_GENERATES]->(w)
       RETURN w.id AS id,
              w.title AS title,
              w.migrationRunId AS migrationRunId,
              f.type AS findingType,
              f.severity AS severity,
              f.reasonCode AS reasonCode,
              f.affectedNodeId AS affectedNodeId,
              f.filePath AS affectedFile
       LIMIT $limit`,
      {
        migrationRunId: params.migrationRunId ?? null,
        findingType: params.findingType ?? null,
        limit: params.limit,
      },
    );

    if (nodesResult.records.length === 0) {
      return {
        appDb: params.appDb,
        totalTasks: 0,
        totalBatches: 0,
        batches: [],
      };
    }

    // Build node map
    const taskMap = new Map<string, MigrationTask>();
    for (const r of nodesResult.records) {
      const id = r.get('id') as string;
      taskMap.set(id, {
        taskId: id,
        title: (r.get('title') as string | null) ?? id,
        findingType: (r.get('findingType') as string | null) ?? 'unknown',
        severity: (r.get('severity') as string | null) ?? 'unknown',
        reasonCode: (r.get('reasonCode') as string | null) ?? 'unknown',
        affectedNodeId: (r.get('affectedNodeId') as string | null) ?? '',
        affectedFile: r.get('affectedFile') as string | null,
        migrationRunId: (r.get('migrationRunId') as string | null) ?? '',
        dependsOnTaskIds: [],
      });
    }

    const taskIds = [...taskMap.keys()];

    // Fetch dependency edges between the returned tasks
    const edgesResult = await session.run(
      `MATCH (w1:WorkItemSeed)-[:WORK_ITEM_DEPENDS_ON]->(w2:WorkItemSeed)
       WHERE w1.id IN $ids AND w2.id IN $ids
       RETURN w1.id AS from, w2.id AS to`,
      { ids: taskIds },
    );

    // Build adjacency structures for Kahn's algorithm
    // Edge: w1 DEPENDS_ON w2  →  w2 must run before w1
    // So in topological order: w2 comes first
    const inDegree = new Map<string, number>();
    const dependents = new Map<string, string[]>(); // task → list of tasks that depend on it

    for (const id of taskIds) {
      inDegree.set(id, 0);
      dependents.set(id, []);
    }

    for (const r of edgesResult.records) {
      const from = r.get('from') as string; // depends on 'to'
      const to = r.get('to') as string;     // must run before 'from'

      // Record dependency in task object
      const task = taskMap.get(from);
      if (task) task.dependsOnTaskIds.push(to);

      // For Kahn's: 'from' has higher in-degree (must wait)
      inDegree.set(from, (inDegree.get(from) ?? 0) + 1);
      dependents.get(to)?.push(from);
    }

    // Kahn's algorithm — produce batches (layers)
    const batches: TaskBatch[] = [];
    let queue = taskIds.filter((id) => (inDegree.get(id) ?? 0) === 0);
    let batchIndex = 0;

    while (queue.length > 0) {
      const batchTasks = queue.map((id) => taskMap.get(id)!);
      batches.push({
        batchIndex,
        canRunInParallel: batchTasks.length > 1,
        tasks: batchTasks,
      });

      const nextQueue: string[] = [];
      for (const id of queue) {
        for (const dependent of dependents.get(id) ?? []) {
          const newDegree = (inDegree.get(dependent) ?? 1) - 1;
          inDegree.set(dependent, newDegree);
          if (newDegree === 0) {
            nextQueue.push(dependent);
          }
        }
      }

      queue = nextQueue;
      batchIndex++;
    }

    // Nodes with cycles (if any) won't appear in batches — add them last
    const processedIds = new Set(batches.flatMap((b) => b.tasks.map((t) => t.taskId)));
    const cycleIds = taskIds.filter((id) => !processedIds.has(id));
    if (cycleIds.length > 0) {
      batches.push({
        batchIndex,
        canRunInParallel: false,
        tasks: cycleIds.map((id) => taskMap.get(id)!),
      });
    }

    const totalTasks = batches.reduce((sum, b) => sum + b.tasks.length, 0);

    return {
      appDb: params.appDb,
      totalTasks,
      totalBatches: batches.length,
      batches,
    };
  } finally {
    await session.close();
  }
}
