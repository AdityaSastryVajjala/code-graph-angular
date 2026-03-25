/**
 * Unit tests for Phase 2 TypeScript semantic extraction —
 * Class, Interface, Method, Property nodes and their relationships.
 */

import { resolve } from 'path';
import { readFileSync } from 'fs';
import { extractTsFile } from '../../../src/core/extraction/ts-extractor.js';
import { NodeLabel, RelationshipType } from '../../../src/core/types/graph-ir.js';

const FIXTURE_ROOT = resolve(__dirname, '../../fixtures/simple-ngmodule-app');

function readFixture(relPath: string): string {
  return readFileSync(resolve(FIXTURE_ROOT, relPath), 'utf-8');
}

function extractFixture(relPath: string) {
  const abs = resolve(FIXTURE_ROOT, relPath);
  return extractTsFile(abs, readFixture(relPath), FIXTURE_ROOT);
}

// ─── makeSemanticNodeId ───────────────────────────────────────────────────────

describe('makeSemanticNodeId', () => {
  it('is exported and returns composite key', async () => {
    const { makeSemanticNodeId } = await import('../../../src/core/extraction/ts-extractor.js');
    expect(makeSemanticNodeId('src/app/user.service.ts', 'Class', 'UserService'))
      .toBe('src/app/user.service.ts::Class::UserService');
  });

  it('handles method qualified name', async () => {
    const { makeSemanticNodeId } = await import('../../../src/core/extraction/ts-extractor.js');
    expect(makeSemanticNodeId('src/app/user.service.ts', 'Method', 'UserService.getUser'))
      .toBe('src/app/user.service.ts::Method::UserService.getUser');
  });
});

// ─── UserService — plain @Injectable class ────────────────────────────────────

describe('TsExtractor Phase 2 — UserService', () => {
  const ir = extractFixture('src/app/user.service.ts');

  it('creates a Class node for UserService', () => {
    const cls = ir.nodes.find((n) => n.label === NodeLabel.Class && n.properties['name'] === 'UserService');
    expect(cls).toBeDefined();
  });

  it('Class node has sourceFile property', () => {
    const cls = ir.nodes.find((n) => n.label === NodeLabel.Class && n.properties['name'] === 'UserService');
    expect(cls?.properties['sourceFile']).toBe('src/app/user.service.ts');
  });

  it('Class node isExported=true', () => {
    const cls = ir.nodes.find((n) => n.label === NodeLabel.Class && n.properties['name'] === 'UserService');
    expect(cls?.properties['isExported']).toBe(true);
  });

  it('Class node isAbstract=false', () => {
    const cls = ir.nodes.find((n) => n.label === NodeLabel.Class && n.properties['name'] === 'UserService');
    expect(cls?.properties['isAbstract']).toBe(false);
  });

  it('emits DECLARES_SYMBOL from File to Class', () => {
    const rel = ir.relationships.find(
      (r) => r.type === RelationshipType.DeclaresSymbol && r.toId.includes('UserService'),
    );
    expect(rel).toBeDefined();
  });

  it('extracts getUser() as a Method node', () => {
    const method = ir.nodes.find(
      (n) => n.label === NodeLabel.Method && n.properties['name'] === 'getUser',
    );
    expect(method).toBeDefined();
    expect(method?.properties['className']).toBe('UserService');
  });

  it('Method has sourceFile', () => {
    const method = ir.nodes.find((n) => n.label === NodeLabel.Method && n.properties['name'] === 'getUser');
    expect(method?.properties['sourceFile']).toBe('src/app/user.service.ts');
  });

  it('emits HAS_METHOD from Class to Method', () => {
    const cls = ir.nodes.find((n) => n.label === NodeLabel.Class && n.properties['name'] === 'UserService');
    const rel = ir.relationships.find(
      (r) => r.type === RelationshipType.HasMethod && r.fromId === cls?.id,
    );
    expect(rel).toBeDefined();
  });
});

// ─── BaseService — abstract class ─────────────────────────────────────────────

describe('TsExtractor Phase 2 — BaseService (abstract)', () => {
  const ir = extractFixture('src/app/base.service.ts');

  it('creates a Class node for BaseService', () => {
    const cls = ir.nodes.find((n) => n.label === NodeLabel.Class && n.properties['name'] === 'BaseService');
    expect(cls).toBeDefined();
  });

  it('isAbstract=true', () => {
    const cls = ir.nodes.find((n) => n.label === NodeLabel.Class && n.properties['name'] === 'BaseService');
    expect(cls?.properties['isAbstract']).toBe(true);
  });

  it('extracts protected Property node for tag', () => {
    const prop = ir.nodes.find(
      (n) => n.label === NodeLabel.Property && n.properties['name'] === 'tag',
    );
    expect(prop).toBeDefined();
    expect(prop?.properties['className']).toBe('BaseService');
    expect(prop?.properties['isPublic']).toBe(false);
  });

  it('extracts abstract method fetchAll', () => {
    const method = ir.nodes.find((n) => n.label === NodeLabel.Method && n.properties['name'] === 'fetchAll');
    expect(method).toBeDefined();
  });

  it('extracts protected method log', () => {
    const method = ir.nodes.find((n) => n.label === NodeLabel.Method && n.properties['name'] === 'log');
    expect(method).toBeDefined();
    expect(method?.properties['isPublic']).toBe(false);
  });
});

// ─── UserDetailComponent — @Input/@Output + IMPLEMENTS ───────────────────────

describe('TsExtractor Phase 2 — UserDetailComponent', () => {
  const ir = extractFixture('src/app/user-detail.component.ts');

  it('creates a Class node for UserDetailComponent', () => {
    const cls = ir.nodes.find(
      (n) => n.label === NodeLabel.Class && n.properties['name'] === 'UserDetailComponent',
    );
    expect(cls).toBeDefined();
  });

  it('extracts @Input() id as a Property node with isInput=true', () => {
    const prop = ir.nodes.find(
      (n) => n.label === NodeLabel.Property && n.properties['name'] === 'id',
    );
    expect(prop).toBeDefined();
    expect(prop?.properties['isInput']).toBe(true);
    expect(prop?.properties['isOutput']).toBe(false);
  });

  it('extracts @Output() saved as a Property node with isOutput=true', () => {
    const prop = ir.nodes.find(
      (n) => n.label === NodeLabel.Property && n.properties['name'] === 'saved',
    );
    expect(prop).toBeDefined();
    expect(prop?.properties['isOutput']).toBe(true);
  });

  it('emits IMPLEMENTS for OnInit', () => {
    const impl = ir.relationships.find(
      (r) => r.type === RelationshipType.Implements && r.pendingTargetName === 'OnInit',
    );
    expect(impl).toBeDefined();
  });

  it('emits IMPLEMENTS for UserModel', () => {
    const impl = ir.relationships.find(
      (r) => r.type === RelationshipType.Implements && r.pendingTargetName === 'UserModel',
    );
    expect(impl).toBeDefined();
  });

  it('extracts onSave() Method', () => {
    const method = ir.nodes.find(
      (n) => n.label === NodeLabel.Method && n.properties['name'] === 'onSave',
    );
    expect(method).toBeDefined();
    expect(method?.properties['isPublic']).toBe(true);
  });
});

// ─── domain.interface.ts — Interface extraction ───────────────────────────────

describe('TsExtractor Phase 2 — Interfaces', () => {
  const ir = extractFixture('src/app/domain.interface.ts');

  it('creates Interface nodes for all exported interfaces', () => {
    const ifaces = ir.nodes.filter((n) => n.label === NodeLabel.Interface);
    const names = ifaces.map((n) => n.properties['name'] as string);
    expect(names).toContain('Identifiable');
    expect(names).toContain('Named');
    expect(names).toContain('UserModel');
  });

  it('Interface nodes have isExported=true', () => {
    const iface = ir.nodes.find(
      (n) => n.label === NodeLabel.Interface && n.properties['name'] === 'UserModel',
    );
    expect(iface?.properties['isExported']).toBe(true);
  });

  it('emits DECLARES_SYMBOL for each interface', () => {
    const decls = ir.relationships.filter((r) => r.type === RelationshipType.DeclaresSymbol);
    expect(decls.length).toBeGreaterThanOrEqual(3);
  });

  it('Interface nodes have sourceFile', () => {
    const iface = ir.nodes.find((n) => n.label === NodeLabel.Interface);
    expect(iface?.properties['sourceFile']).toBe('src/app/domain.interface.ts');
  });
});

// ─── No crash on file with no classes ─────────────────────────────────────────

describe('TsExtractor Phase 2 — empty / non-class file', () => {
  it('returns empty semantic nodes for a file with no class declarations', () => {
    const source = `export const VALUE = 42;`;
    const abs = resolve(FIXTURE_ROOT, 'src/app/fake.ts');
    const ir = extractTsFile(abs, source, FIXTURE_ROOT);
    const classes = ir.nodes.filter((n) => n.label === NodeLabel.Class);
    const ifaces = ir.nodes.filter((n) => n.label === NodeLabel.Interface);
    expect(classes).toHaveLength(0);
    expect(ifaces).toHaveLength(0);
  });
});
