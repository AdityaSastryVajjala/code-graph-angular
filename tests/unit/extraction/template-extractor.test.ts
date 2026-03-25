/**
 * Unit tests for TemplateExtractor.
 */

import { extractTemplate, extractTemplateBindings } from '../../../src/core/extraction/template-extractor.js';
import { RelationshipType, SelectorMap } from '../../../src/core/types/graph-ir.js';

const OWNER_ID = 'owner-node-id';
const OWNER_FILE = 'src/app/app.component.ts';

function makeSelector(
  entries: Array<{ selector: string; nodeId: string; kind: 'component' | 'directive' }>,
): SelectorMap {
  const map: SelectorMap = new Map();
  for (const e of entries) map.set(e.selector, { nodeId: e.nodeId, kind: e.kind });
  return map;
}

// ─── USES_COMPONENT ───────────────────────────────────────────────────────────

describe('TemplateExtractor — USES_COMPONENT', () => {
  it('extracts USES_COMPONENT for a known element selector', async () => {
    const template = `<app-header></app-header>`;
    const selectors = makeSelector([
      { selector: 'app-header', nodeId: 'header-id', kind: 'component' },
    ]);
    const ir = await extractTemplate(template, 'app.component.html', OWNER_ID, OWNER_FILE, selectors);
    const rel = ir.relationships.find((r) => r.type === RelationshipType.UsesComponent);
    expect(rel).toBeDefined();
    expect(rel?.fromId).toBe(OWNER_ID);
    expect(rel?.toId).toBe('header-id');
  });

  it('does not throw for unresolved custom element — logs warning', async () => {
    const template = `<unknown-element></unknown-element>`;
    const selectors: SelectorMap = new Map();
    await expect(
      extractTemplate(template, 'test.html', OWNER_ID, OWNER_FILE, selectors),
    ).resolves.toBeDefined();
  });
});

// ─── USES_DIRECTIVE ───────────────────────────────────────────────────────────

describe('TemplateExtractor — USES_DIRECTIVE', () => {
  it('extracts USES_DIRECTIVE for a known attribute selector', async () => {
    const template = `<div highlight></div>`;
    const selectors = makeSelector([
      { selector: '[highlight]', nodeId: 'highlight-id', kind: 'directive' },
    ]);
    const ir = await extractTemplate(template, 'test.html', OWNER_ID, OWNER_FILE, selectors);
    const rel = ir.relationships.find((r) => r.type === RelationshipType.UsesDirective);
    expect(rel).toBeDefined();
    expect(rel?.toId).toBe('highlight-id');
  });
});

// ─── USES_PIPE ────────────────────────────────────────────────────────────────

describe('TemplateExtractor — USES_PIPE', () => {
  it('extracts USES_PIPE for a pipe in a bound attribute expression', async () => {
    const template = `<p [class]="name | truncate"></p>`;
    const selectors = makeSelector([
      { selector: 'truncate', nodeId: 'truncate-id', kind: 'directive' },
    ]);
    const ir = await extractTemplate(template, 'test.html', OWNER_ID, OWNER_FILE, selectors);
    const rel = ir.relationships.find((r) => r.type === RelationshipType.UsesPipe);
    expect(rel).toBeDefined();
    expect(rel?.toId).toBe('truncate-id');
  });
});

// ─── Nested children ──────────────────────────────────────────────────────────

describe('TemplateExtractor — nested elements', () => {
  it('recurses into children and extracts nested component usage', async () => {
    const template = `<div><section><app-header></app-header></section></div>`;
    const selectors = makeSelector([
      { selector: 'app-header', nodeId: 'header-id', kind: 'component' },
    ]);
    const ir = await extractTemplate(template, 'test.html', OWNER_ID, OWNER_FILE, selectors);
    const rel = ir.relationships.find((r) => r.type === RelationshipType.UsesComponent);
    expect(rel).toBeDefined();
  });
});

// ─── Empty template ───────────────────────────────────────────────────────────

describe('TemplateExtractor — empty template', () => {
  it('returns empty relationships for blank template', async () => {
    const ir = await extractTemplate('', 'empty.html', OWNER_ID, OWNER_FILE, new Map());
    expect(ir.relationships).toHaveLength(0);
  });
});

// ─── Phase 3: Typed binding relationships ─────────────────────────────────────

describe('TemplateExtractor — Phase 3 typed bindings (extractTemplateBindings)', () => {
  const COMP_NAME = 'TestComponent';
  const COMP_NODE_ID = 'test-component-id';
  const COMP_FILE = 'src/app/test.component.ts';

  it('emits TemplateBindsProperty for [title]="value" property binding', async () => {
    const knownMembers = new Map([
      ['value', { nodeId: 'prop-value-id', kind: 'property' as const }],
    ]);
    const ir = await extractTemplateBindings(
      '<div [title]="value"></div>',
      COMP_FILE,
      COMP_FILE,
      COMP_NAME,
      COMP_NODE_ID,
      knownMembers,
    );
    const rel = ir.relationships.find((r) => r.type === RelationshipType.TemplateBindsProperty);
    expect(rel).toBeDefined();
    expect(rel?.toId).toBe('prop-value-id');
    expect(rel?.properties?.['confidence']).toBe('compiler');
  });

  it('emits TemplateBindsEvent for (click)="handler()" event binding', async () => {
    const knownMembers = new Map([
      ['handler', { nodeId: 'method-handler-id', kind: 'method' as const }],
    ]);
    const ir = await extractTemplateBindings(
      '<button (click)="handler()">Click</button>',
      COMP_FILE,
      COMP_FILE,
      COMP_NAME,
      COMP_NODE_ID,
      knownMembers,
    );
    const rel = ir.relationships.find((r) => r.type === RelationshipType.TemplateBindsEvent);
    expect(rel).toBeDefined();
    expect(rel?.toId).toBe('method-handler-id');
  });

  it('emits TemplateTwoWayBinds for [(ngModel)]="name" two-way binding', async () => {
    const knownMembers = new Map([
      ['name', { nodeId: 'prop-name-id', kind: 'property' as const }],
    ]);
    const ir = await extractTemplateBindings(
      '<input [(ngModel)]="name" />',
      COMP_FILE,
      COMP_FILE,
      COMP_NAME,
      COMP_NODE_ID,
      knownMembers,
    );
    const rel = ir.relationships.find((r) => r.type === RelationshipType.TemplateTwoWayBinds);
    expect(rel).toBeDefined();
    expect(rel?.toId).toBe('prop-name-id');
  });

  it('emits best-effort confidence for unresolved symbol', async () => {
    const knownMembers = new Map<string, { nodeId: string; kind: 'method' | 'property' }>();
    const ir = await extractTemplateBindings(
      '<div [title]="unknownProp"></div>',
      COMP_FILE,
      COMP_FILE,
      COMP_NAME,
      COMP_NODE_ID,
      knownMembers,
    );
    // Unknown prop should not produce TemplateBindsProperty (no member found)
    const typedRels = ir.relationships.filter((r) => r.type === RelationshipType.TemplateBindsProperty);
    expect(typedRels).toHaveLength(0);
  });
});

describe('TemplateExtractor — Phase 3 directive and pipe bindings (extractTemplate)', () => {
  it('emits TemplateUsesDirective for attribute directive', async () => {
    const template = `<div appHighlight></div>`;
    const selectors = makeSelector([
      { selector: 'appHighlight', nodeId: 'highlight-directive-id', kind: 'directive' },
    ]);
    const ir = await extractTemplate(template, 'test.html', OWNER_ID, OWNER_FILE, selectors);
    const rel = ir.relationships.find((r) => r.type === RelationshipType.TemplateUsesDirective);
    expect(rel).toBeDefined();
    expect(rel?.toId).toBe('highlight-directive-id');
    expect(rel?.properties?.['usageType']).toBe('attribute');
  });

  it('emits TemplateUsesPipe alongside UsesPipe for pipe usage', async () => {
    const template = `<p [class]="name | uppercase"></p>`;
    const selectors = makeSelector([
      { selector: 'uppercase', nodeId: 'uppercase-pipe-id', kind: 'directive' },
    ]);
    const ir = await extractTemplate(template, 'test.html', OWNER_ID, OWNER_FILE, selectors);
    const pipeRel = ir.relationships.find((r) => r.type === RelationshipType.TemplateUsesPipe);
    const legacyRel = ir.relationships.find((r) => r.type === RelationshipType.UsesPipe);
    // Phase 3 typed pipe rel
    expect(pipeRel).toBeDefined();
    expect(pipeRel?.toId).toBe('uppercase-pipe-id');
    // Legacy UsesPipe rel still present
    expect(legacyRel).toBeDefined();
  });
});
