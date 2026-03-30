/**
 * MCP tool: get_test_coverage
 * Returns spec files that test a given class, component, or service.
 */

import { Driver } from 'neo4j-driver';

export async function getTestCoverage(
  driver: Driver,
  input: Record<string, unknown>,
): Promise<unknown> {
  const appDb = input['appDb'] as string;
  const targetName = (input['targetName'] as string | undefined)?.trim();

  if (!targetName) {
    return { error: 'targetName is required', code: 'INVALID_INPUT' };
  }

  const session = driver.session({ database: appDb });
  try {
    const result = await session.run(
      `MATCH (spec:SpecFile)-[r:TESTS]->(target)
       WHERE target.name = $targetName
       RETURN spec.filePath AS filePath,
              r.via AS via,
              labels(target) AS targetLabels
       ORDER BY spec.filePath`,
      { targetName },
    );

    const specs = result.records.map((r) => ({
      filePath: r.get('filePath') as string,
      via: r.get('via') as string | null,
    }));

    return {
      target: targetName,
      specs,
    };
  } finally {
    await session.close();
  }
}
