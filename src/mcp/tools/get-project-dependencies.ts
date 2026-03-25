import { z } from 'zod';
import { Driver } from 'neo4j-driver';
import { getSession } from '../../graph/db/connection.js';

const InputSchema = z.object({
  appDb: z.string(),
  projectId: z.string().optional(),
  direction: z.enum(['dependencies', 'consumers', 'both']).optional().default('both'),
});

export async function getProjectDependencies(
  driver: Driver,
  input: Record<string, unknown>,
): Promise<unknown> {
  const params = InputSchema.parse(input);
  const session = getSession(driver, params.appDb);

  try {
    let projectsCypher: string;
    let edgesCypher: string;

    if (params.projectId) {
      if (params.direction === 'dependencies') {
        projectsCypher = `
          MATCH (p:Project {id: $projectId})-[:PROJECT_DEPENDS_ON]->(dep:Project)
          RETURN collect(DISTINCT p) + collect(DISTINCT dep) AS projects
        `;
        edgesCypher = `
          MATCH (p:Project {id: $projectId})-[r:PROJECT_DEPENDS_ON]->(dep:Project)
          RETURN p.id AS fromProjectId, dep.id AS toProjectId, r.importCount AS importCount
        `;
      } else if (params.direction === 'consumers') {
        projectsCypher = `
          MATCH (consumer:Project)-[:PROJECT_DEPENDS_ON]->(p:Project {id: $projectId})
          RETURN collect(DISTINCT consumer) + collect(DISTINCT p) AS projects
        `;
        edgesCypher = `
          MATCH (consumer:Project)-[r:PROJECT_DEPENDS_ON]->(p:Project {id: $projectId})
          RETURN consumer.id AS fromProjectId, p.id AS toProjectId, r.importCount AS importCount
        `;
      } else {
        projectsCypher = `
          MATCH (p:Project {id: $projectId})
          OPTIONAL MATCH (p)-[:PROJECT_DEPENDS_ON]->(dep:Project)
          OPTIONAL MATCH (consumer:Project)-[:PROJECT_DEPENDS_ON]->(p)
          RETURN collect(DISTINCT p) + collect(DISTINCT dep) + collect(DISTINCT consumer) AS projects
        `;
        edgesCypher = `
          MATCH (p:Project {id: $projectId})
          OPTIONAL MATCH (p)-[r1:PROJECT_DEPENDS_ON]->(dep:Project)
          OPTIONAL MATCH (consumer:Project)-[r2:PROJECT_DEPENDS_ON]->(p)
          RETURN
            [x IN collect({from: p.id, to: dep.id, count: r1.importCount}) WHERE x.to IS NOT NULL] +
            [x IN collect({from: consumer.id, to: p.id, count: r2.importCount}) WHERE x.from IS NOT NULL] AS edges
        `;
      }
    } else {
      projectsCypher = 'MATCH (p:Project) RETURN collect(p) AS projects';
      edgesCypher = `
        MATCH (p:Project)-[r:PROJECT_DEPENDS_ON]->(dep:Project)
        RETURN p.id AS fromProjectId, dep.id AS toProjectId, r.importCount AS importCount
      `;
    }

    const projectsResult = await session.run(projectsCypher, { projectId: params.projectId });
    const edgesResult = await session.run(edgesCypher, { projectId: params.projectId });

    const projectsRaw = projectsResult.records.length > 0
      ? (projectsResult.records[0].get('projects') as Array<{ properties: Record<string, unknown> }>)
      : [];

    // Deduplicate projects
    const seenProjectIds = new Set<string>();
    const projects = projectsRaw
      .filter((p) => p !== null && p.properties)
      .filter((p) => {
        const id = p.properties['id'] as string;
        if (seenProjectIds.has(id)) return false;
        seenProjectIds.add(id);
        return true;
      })
      .map((p) => ({
        id: p.properties['id'],
        name: p.properties['name'],
        type: p.properties['type'],
        category: p.properties['category'] ?? null,
      }));

    let edges: Array<{ fromProjectId: string; toProjectId: string; importCount: number }>;

    if (params.projectId && params.direction === 'both') {
      // Special case: edges returned as array in single record
      const edgesRaw = edgesResult.records.length > 0
        ? (edgesResult.records[0].get('edges') as Array<{ from: string; to: string; count: number }>)
        : [];
      edges = edgesRaw.map((e) => ({
        fromProjectId: e.from,
        toProjectId: e.to,
        importCount: e.count ?? 0,
      }));
    } else {
      edges = edgesResult.records.map((r) => ({
        fromProjectId: r.get('fromProjectId') as string,
        toProjectId: r.get('toProjectId') as string,
        importCount: (r.get('importCount') as number) ?? 0,
      }));
    }

    return { projects, edges, appDb: params.appDb };
  } finally {
    await session.close();
  }
}
