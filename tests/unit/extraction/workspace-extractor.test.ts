import * as path from 'path';
import { extractWorkspace } from '../../../src/core/extraction/workspace-extractor.js';
import type { FileNode } from '../../../src/graph/schema/nodes.js';
import { NodeLabel, RelationshipType } from '../../../src/core/types/graph-ir.js';

const NX_WORKSPACE = path.resolve(__dirname, '../../../tests/fixtures/nx-workspace');
const STANDALONE_APP = path.resolve(__dirname, '../../../tests/fixtures/standalone-app');

function makeFileNode(filePath: string): FileNode {
  return { id: `file-${filePath}`, filePath, fileType: 'ts' };
}

describe('extractWorkspace', () => {
  describe('angular.json detection', () => {
    it('discovers all projects from angular.json', () => {
      const result = extractWorkspace(NX_WORKSPACE, []);
      const names = result.projectNodes.map((n) => n.properties['name']);
      expect(names).toContain('shell');
      expect(names).toContain('shared-ui');
      expect(names).toContain('data-access');
    });

    it('correctly identifies app vs lib project types', () => {
      const result = extractWorkspace(NX_WORKSPACE, []);
      const shell = result.projectNodes.find((n) => n.properties['name'] === 'shell');
      const sharedUi = result.projectNodes.find((n) => n.properties['name'] === 'shared-ui');
      const dataAccess = result.projectNodes.find((n) => n.properties['name'] === 'data-access');

      expect(shell?.properties['type']).toBe('app');
      expect(sharedUi?.properties['type']).toBe('lib');
      expect(dataAccess?.properties['type']).toBe('lib');
    });

    it('emits Project nodes with correct label', () => {
      const result = extractWorkspace(NX_WORKSPACE, []);
      for (const node of result.projectNodes) {
        expect(node.label).toBe(NodeLabel.Project);
      }
    });

    it('emits deterministic IDs for projects', () => {
      const result1 = extractWorkspace(NX_WORKSPACE, []);
      const result2 = extractWorkspace(NX_WORKSPACE, []);
      const ids1 = result1.projectNodes.map((n) => n.id).sort();
      const ids2 = result2.projectNodes.map((n) => n.id).sort();
      expect(ids1).toEqual(ids2);
    });
  });

  describe('single angular project', () => {
    it('discovers a single project from a non-workspace angular.json', () => {
      const result = extractWorkspace(STANDALONE_APP, []);
      expect(result.projectNodes.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('BelongsToProject edges', () => {
    it('emits BelongsToProject edges for files in project source roots', () => {
      const fileNodes: FileNode[] = [
        makeFileNode('apps/shell/src/app/app.component.ts'),
        makeFileNode('libs/shared-ui/src/lib/button.component.ts'),
      ];
      const result = extractWorkspace(NX_WORKSPACE, fileNodes);
      const rels = result.relationships.filter((r) => r.type === RelationshipType.BelongsToProject);
      expect(rels.length).toBeGreaterThanOrEqual(2);
    });

    it('links files to correct projects', () => {
      const fileNodes: FileNode[] = [
        makeFileNode('apps/shell/src/app/app.component.ts'),
        makeFileNode('libs/shared-ui/src/lib/button.component.ts'),
      ];
      const result = extractWorkspace(NX_WORKSPACE, fileNodes);

      const shellProject = result.projectNodes.find((n) => n.properties['name'] === 'shell');
      const sharedUiProject = result.projectNodes.find((n) => n.properties['name'] === 'shared-ui');

      const shellRel = result.relationships.find(
        (r) => r.type === RelationshipType.BelongsToProject && r.toId === shellProject?.id,
      );
      const sharedUiRel = result.relationships.find(
        (r) => r.type === RelationshipType.BelongsToProject && r.toId === sharedUiProject?.id,
      );

      expect(shellRel).toBeDefined();
      expect(sharedUiRel).toBeDefined();
    });
  });

  describe('Nx tag → category derivation', () => {
    it('returns null category when no matching tag present', () => {
      // Use NX_WORKSPACE which doesn't have Nx tags
      const result = extractWorkspace(NX_WORKSPACE, []);
      const shell = result.projectNodes.find((n) => n.properties['name'] === 'shell');
      expect(shell?.properties['category']).toBeNull();
    });
  });

  describe('graceful handling', () => {
    it('returns empty result for directory with no angular.json or nx.json', () => {
      const result = extractWorkspace(path.resolve(__dirname, '../../../tests/fixtures'), []);
      expect(result.projectNodes).toHaveLength(0);
      expect(result.relationships).toHaveLength(0);
    });
  });
});
