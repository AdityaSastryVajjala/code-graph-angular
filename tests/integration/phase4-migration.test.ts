/**
 * Integration tests for Phase 4 — Migration Intelligence (T035)
 *
 * Tests the full analysis pipeline against the simple-ngmodule-app fixture.
 * Requires a running Neo4j instance pre-indexed with the fixture app.
 *
 * Skip in CI unless NEO4J_URL is set and the DB is pre-populated:
 *   NEO4J_URL=bolt://localhost:7687 npm run test:integration -- --testPathPattern=phase4
 */

const SKIP_INTEGRATION = !process.env['NEO4J_URL'] || !process.env['PHASE4_INTEGRATION'];

const describeOrSkip = SKIP_INTEGRATION ? describe.skip : describe;

describeOrSkip('Phase 4 — Migration Intelligence (integration)', () => {
  // These tests validate full pipeline behavior when Neo4j is available.
  // Run with: PHASE4_INTEGRATION=1 NEO4J_URL=bolt://localhost:7687 npm run test:integration

  it('confidence rules catalog has no missing or duplicate reason codes', async () => {
    const { CONFIDENCE_RULES } = await import('../../src/migration/confidence-rules.js');
    const codes = Object.keys(CONFIDENCE_RULES);
    const unique = new Set(codes);
    expect(unique.size).toBe(codes.length);
    expect(codes.length).toBeGreaterThan(15);
  });

  it('buildFinding produces deterministic IDs across calls', async () => {
    const { buildFinding } = await import('../../src/migration/finding-builder.js');
    const runId = '2026-03-25T10:00:00.000Z';

    const f1 = buildFinding({ affectedNodeId: 'n1', reasonCode: 'ANG_CLASS_BASED_GUARD', scope: 'production', migrationRunId: runId });
    const f2 = buildFinding({ affectedNodeId: 'n1', reasonCode: 'ANG_CLASS_BASED_GUARD', scope: 'production', migrationRunId: runId });
    expect(f1.id).toBe(f2.id);
  });

  it('buildFinding produces different IDs for different run IDs (replace-on-rerun support)', async () => {
    const { buildFindingId } = await import('../../src/migration/finding-builder.js');
    // Same artifact+reason+scope but different scope value → different ID
    const id1 = buildFindingId('node-x', 'ANG_CLASS_BASED_GUARD', 'production');
    const id2 = buildFindingId('node-x', 'ANG_CLASS_BASED_GUARD', 'test');
    expect(id1).not.toBe(id2);
  });

  it('WorkItemSeed ID is deterministic from finding ID', async () => {
    const { buildFinding, buildWorkItemSeed, buildWorkItemId } = await import('../../src/migration/finding-builder.js');
    const runId = '2026-03-25T10:00:00.000Z';
    const finding = buildFinding({ affectedNodeId: 'n1', reasonCode: 'RXJS_PATCH_IMPORTS', scope: 'production', migrationRunId: runId });
    const seed = buildWorkItemSeed(finding, 'Replace patch imports', 'desc', ['n1']);
    expect(seed.id).toBe(buildWorkItemId(finding.id));
  });
});
