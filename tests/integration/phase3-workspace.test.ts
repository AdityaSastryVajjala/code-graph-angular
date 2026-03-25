/**
 * Phase 3 integration test — workspace indexing.
 *
 * Requires a running Neo4j instance.
 * Skipped in unit test runs (jest.config.ts separates integration tests).
 */

import * as path from 'path';
import { extractWorkspace } from '../../src/core/extraction/workspace-extractor.js';
import { RelationshipType } from '../../src/core/types/graph-ir.js';

const NX_WORKSPACE = path.resolve(__dirname, '../fixtures/nx-workspace');

describe('Phase 3 workspace integration', () => {
  describe('extractWorkspace with nx-workspace fixture', () => {
    it('discovers shell app and shared-ui/data-access libraries', () => {
      const result = extractWorkspace(NX_WORKSPACE, []);
      const names = result.projectNodes.map((n) => n.properties['name'] as string);

      expect(names).toContain('shell');
      expect(names).toContain('shared-ui');
      expect(names).toContain('data-access');
    });

    it('emits BelongsToProject relationships', () => {
      const { NodeLabel } = require('../../src/core/types/graph-ir.js');
      const result = extractWorkspace(NX_WORKSPACE, [
        { id: 'f1', filePath: 'apps/shell/src/app/app.component.ts', fileType: 'ts' },
        { id: 'f2', filePath: 'libs/shared-ui/src/lib/button.component.ts', fileType: 'ts' },
        { id: 'f3', filePath: 'libs/data-access/src/lib/data.service.ts', fileType: 'ts' },
      ]);

      const belongsRels = result.relationships.filter(
        (r) => r.type === RelationshipType.BelongsToProject,
      );
      expect(belongsRels.length).toBeGreaterThanOrEqual(3);

      // shell app project node exists
      const shellProject = result.projectNodes.find((n) => n.properties['name'] === 'shell');
      expect(shellProject).toBeDefined();
      expect(shellProject?.properties['type']).toBe('app');

      // shared-ui is a lib
      const sharedUiProject = result.projectNodes.find((n) => n.properties['name'] === 'shared-ui');
      expect(sharedUiProject?.properties['type']).toBe('lib');

      void NodeLabel;
    });
  });
});
