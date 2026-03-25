/**
 * Unit tests for Phase 2 template binding extraction —
 * Template nodes, USES_TEMPLATE edges, and BINDS_TO edges.
 */

import { resolve } from 'path';
import { readFileSync } from 'fs';
import {
  extractTemplateBindings,
  makeTemplateNodeId,
} from '../../../src/core/extraction/template-extractor.js';
import { NodeLabel, RelationshipType } from '../../../src/core/types/graph-ir.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const FIXTURE_ROOT = resolve(__dirname, '../../fixtures/simple-ngmodule-app');

function readFixture(relPath: string): string {
  return readFileSync(resolve(FIXTURE_ROOT, relPath), 'utf-8');
}

/** Build the minimal known-members lookup the extractor needs. */
function makeKnownMembers(className: string, members: Array<{ name: string; kind: 'method' | 'property' }>): Map<string, { nodeId: string; kind: 'method' | 'property' }> {
  const map = new Map<string, { nodeId: string; kind: 'method' | 'property' }>();
  for (const m of members) {
    map.set(m.name, { nodeId: `fake::${m.kind}::${className}.${m.name}`, kind: m.kind });
  }
  return map;
}

// ─── makeTemplateNodeId ───────────────────────────────────────────────────────

describe('makeTemplateNodeId', () => {
  it('inline template uses .ts sourceFile', () => {
    const id = makeTemplateNodeId('src/app/user.component.ts', 'UserComponent', 'inline');
    expect(id).toBe('src/app/user.component.ts::Template::UserComponent');
  });

  it('external template uses .html sourceFile', () => {
    const id = makeTemplateNodeId('src/app/user.component.html', 'UserComponent', 'external');
    expect(id).toBe('src/app/user.component.html::Template::UserComponent');
  });
});

// ─── External template with real fixture ─────────────────────────────────────

describe('extractTemplateBindings — external template (user-detail.component.html)', () => {
  const templateContent = readFixture('src/app/user-detail.component.html');
  const componentRelPath = 'src/app/user-detail.component.ts';
  const templatePath = 'src/app/user-detail.component.html';
  const componentName = 'UserDetailComponent';
  const componentNodeId = `fake::Class::${componentName}`;

  const knownMembers = makeKnownMembers(componentName, [
    { name: 'getDisplayName', kind: 'method' },
    { name: 'name', kind: 'property' },
    { name: 'email', kind: 'property' },
    { name: 'isLoading', kind: 'property' },
    { name: 'onSave', kind: 'method' },
  ]);

  let ir: Awaited<ReturnType<typeof extractTemplateBindings>>;

  beforeAll(async () => {
    ir = await extractTemplateBindings(
      templateContent,
      templatePath,
      componentRelPath,
      componentName,
      componentNodeId,
      knownMembers,
    );
  });

  it('creates a Template node', () => {
    const tpl = ir.nodes.find((n) => n.label === NodeLabel.Template);
    expect(tpl).toBeDefined();
  });

  it('Template node has correct componentName', () => {
    const tpl = ir.nodes.find((n) => n.label === NodeLabel.Template);
    expect(tpl?.properties['componentName']).toBe('UserDetailComponent');
  });

  it('Template node templateType=external', () => {
    const tpl = ir.nodes.find((n) => n.label === NodeLabel.Template);
    expect(tpl?.properties['templateType']).toBe('external');
  });

  it('emits USES_TEMPLATE from Component to Template', () => {
    const rel = ir.relationships.find((r) => r.type === RelationshipType.UsesTemplate);
    expect(rel).toBeDefined();
    expect(rel?.fromId).toBe(componentNodeId);
  });

  it('emits BINDS_TO for interpolation (getDisplayName)', () => {
    const rel = ir.relationships.find(
      (r) => r.type === RelationshipType.BindsTo && (r.properties?.['expression'] as string)?.includes('getDisplayName'),
    );
    expect(rel).toBeDefined();
    expect(rel?.properties?.['bindingType']).toBe('interpolation');
  });

  it('emits BINDS_TO for property binding (isLoading)', () => {
    const rel = ir.relationships.find(
      (r) => r.type === RelationshipType.BindsTo && r.properties?.['bindingType'] === 'property',
    );
    expect(rel).toBeDefined();
  });

  it('emits BINDS_TO for event binding (onSave)', () => {
    const rel = ir.relationships.find(
      (r) => r.type === RelationshipType.BindsTo && r.properties?.['bindingType'] === 'event',
    );
    expect(rel).toBeDefined();
  });

  it('emits BINDS_TO for two-way binding (name via ngModel)', () => {
    const twoWay = ir.relationships.find(
      (r) => r.type === RelationshipType.BindsTo && r.properties?.['bindingType'] === 'two-way',
    );
    expect(twoWay).toBeDefined();
  });
});

// ─── Inline template ──────────────────────────────────────────────────────────

describe('extractTemplateBindings — inline template', () => {
  const inlineTemplate = `<div>{{ title }}</div><button (click)="submit()">OK</button>`;
  const componentRelPath = 'src/app/hello.component.ts';
  const componentName = 'HelloComponent';
  const componentNodeId = 'fake::Class::HelloComponent';

  const knownMembers = makeKnownMembers(componentName, [
    { name: 'title', kind: 'property' },
    { name: 'submit', kind: 'method' },
  ]);

  let ir: Awaited<ReturnType<typeof extractTemplateBindings>>;

  beforeAll(async () => {
    ir = await extractTemplateBindings(
      inlineTemplate,
      componentRelPath,   // templateUrl = component .ts path for inline
      componentRelPath,
      componentName,
      componentNodeId,
      knownMembers,
    );
  });

  it('creates Template node with templateType=inline', () => {
    const tpl = ir.nodes.find((n) => n.label === NodeLabel.Template);
    expect(tpl?.properties['templateType']).toBe('inline');
  });

  it('emits BINDS_TO for interpolation {{ title }}', () => {
    const rel = ir.relationships.find(
      (r) => r.type === RelationshipType.BindsTo && r.properties?.['bindingType'] === 'interpolation',
    );
    expect(rel).toBeDefined();
  });

  it('emits BINDS_TO for event (click)="submit()"', () => {
    const rel = ir.relationships.find(
      (r) => r.type === RelationshipType.BindsTo && r.properties?.['bindingType'] === 'event',
    );
    expect(rel).toBeDefined();
  });
});

// ─── Unresolved binding — no crash ────────────────────────────────────────────

describe('extractTemplateBindings — unresolved binding', () => {
  it('does not crash or emit BINDS_TO for unknown member', async () => {
    const ir = await extractTemplateBindings(
      `<div>{{ unknownProp }}</div>`,
      'src/app/test.component.ts',
      'src/app/test.component.ts',
      'TestComponent',
      'fake-id',
      new Map(), // no known members
    );
    const bindingsToUnknown = ir.relationships.filter((r) => r.type === RelationshipType.BindsTo);
    expect(bindingsToUnknown).toHaveLength(0);
  });
});

// ─── parseTemplate() exception — no crash ────────────────────────────────────

describe('extractTemplateBindings — parse error recovery', () => {
  it('returns empty IR on invalid template without throwing', async () => {
    // Angular's parseTemplate may error on severely malformed templates;
    // extractTemplateBindings must catch and return a valid (empty) GraphIR.
    const ir = await extractTemplateBindings(
      '<div [broken', // intentionally broken
      'src/app/broken.component.ts',
      'src/app/broken.component.ts',
      'BrokenComponent',
      'fake-id',
      new Map(),
    );
    expect(ir).toBeDefined();
    expect(Array.isArray(ir.nodes)).toBe(true);
    expect(Array.isArray(ir.relationships)).toBe(true);
  });
});
