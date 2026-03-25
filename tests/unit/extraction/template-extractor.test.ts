/**
 * Unit tests for TemplateExtractor.
 */

import { extractTemplate } from '../../../src/core/extraction/template-extractor.js';
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
  it('extracts USES_COMPONENT for a known element selector', () => {
    const template = `<app-header></app-header>`;
    const selectors = makeSelector([
      { selector: 'app-header', nodeId: 'header-id', kind: 'component' },
    ]);
    const ir = extractTemplate(template, 'app.component.html', OWNER_ID, OWNER_FILE, selectors);
    const rel = ir.relationships.find((r) => r.type === RelationshipType.UsesComponent);
    expect(rel).toBeDefined();
    expect(rel?.fromId).toBe(OWNER_ID);
    expect(rel?.toId).toBe('header-id');
  });

  it('does not throw for unresolved custom element — logs warning', () => {
    const template = `<unknown-element></unknown-element>`;
    const selectors: SelectorMap = new Map();
    expect(() =>
      extractTemplate(template, 'test.html', OWNER_ID, OWNER_FILE, selectors),
    ).not.toThrow();
  });
});

// ─── USES_DIRECTIVE ───────────────────────────────────────────────────────────

describe('TemplateExtractor — USES_DIRECTIVE', () => {
  it('extracts USES_DIRECTIVE for a known attribute selector', () => {
    const template = `<div highlight></div>`;
    const selectors = makeSelector([
      { selector: '[highlight]', nodeId: 'highlight-id', kind: 'directive' },
    ]);
    const ir = extractTemplate(template, 'test.html', OWNER_ID, OWNER_FILE, selectors);
    const rel = ir.relationships.find((r) => r.type === RelationshipType.UsesDirective);
    expect(rel).toBeDefined();
    expect(rel?.toId).toBe('highlight-id');
  });
});

// ─── USES_PIPE ────────────────────────────────────────────────────────────────

describe('TemplateExtractor — USES_PIPE', () => {
  it('extracts USES_PIPE for a pipe in a binding expression', () => {
    const template = `<p>{{ name | truncate }}</p>`;
    const selectors = makeSelector([
      { selector: 'truncate', nodeId: 'truncate-id', kind: 'directive' },
    ]);
    const ir = extractTemplate(template, 'test.html', OWNER_ID, OWNER_FILE, selectors);
    const rel = ir.relationships.find((r) => r.type === RelationshipType.UsesPipe);
    expect(rel).toBeDefined();
    expect(rel?.toId).toBe('truncate-id');
  });
});

// ─── Nested children ──────────────────────────────────────────────────────────

describe('TemplateExtractor — nested elements', () => {
  it('recurses into children and extracts nested component usage', () => {
    const template = `<div><section><app-header></app-header></section></div>`;
    const selectors = makeSelector([
      { selector: 'app-header', nodeId: 'header-id', kind: 'component' },
    ]);
    const ir = extractTemplate(template, 'test.html', OWNER_ID, OWNER_FILE, selectors);
    const rel = ir.relationships.find((r) => r.type === RelationshipType.UsesComponent);
    expect(rel).toBeDefined();
  });
});

// ─── Empty template ───────────────────────────────────────────────────────────

describe('TemplateExtractor — empty template', () => {
  it('returns empty relationships for blank template', () => {
    const ir = extractTemplate('', 'empty.html', OWNER_ID, OWNER_FILE, new Map());
    expect(ir.relationships).toHaveLength(0);
  });
});
