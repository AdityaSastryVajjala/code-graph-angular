/**
 * Unit tests for TsExtractor against standalone-app fixture.
 */

import { resolve } from 'path';
import { readFileSync } from 'fs';
import { extractTsFile } from '../../../src/core/extraction/ts-extractor.js';
import { NodeLabel, RelationshipType } from '../../../src/core/types/graph-ir.js';

const FIXTURE_ROOT = resolve(__dirname, '../../fixtures/standalone-app');

function extractFixture(relPath: string) {
  const abs = resolve(FIXTURE_ROOT, relPath);
  const source = readFileSync(abs, 'utf-8');
  return extractTsFile(abs, source, FIXTURE_ROOT);
}

// ─── AppComponent (standalone) ────────────────────────────────────────────────

describe('TsExtractor standalone — AppComponent', () => {
  const ir = extractFixture('src/app/app.component.ts');

  it('detects standalone: true', () => {
    const comp = ir.nodes.find((n) => n.label === NodeLabel.Component);
    expect(comp?.properties['isStandalone']).toBe(true);
  });

  it('extracts selector', () => {
    const comp = ir.nodes.find((n) => n.label === NodeLabel.Component);
    expect(comp?.properties['selector']).toBe('app-root');
  });

  it('creates File node', () => {
    const file = ir.nodes.find((n) => n.label === NodeLabel.File);
    expect(file).toBeDefined();
  });
});

// ─── HeaderComponent (standalone) ────────────────────────────────────────────

describe('TsExtractor standalone — HeaderComponent', () => {
  const ir = extractFixture('src/app/header.component.ts');

  it('detects standalone: true', () => {
    const comp = ir.nodes.find((n) => n.label === NodeLabel.Component);
    expect(comp?.properties['isStandalone']).toBe(true);
  });
});

// ─── inject() DI detection ────────────────────────────────────────────────────

describe('TsExtractor standalone — inject() DI detection', () => {
  const ir = extractFixture('src/app/user-list.component.ts');

  it('creates Component node', () => {
    const comp = ir.nodes.find((n) => n.label === NodeLabel.Component);
    expect(comp).toBeDefined();
    expect(comp?.properties['name']).toBe('UserListComponent');
  });

  it('detects inject() DI and creates INJECTS relationship', () => {
    const injectRels = ir.relationships.filter((r) => r.type === RelationshipType.Injects);
    expect(injectRels.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── TruncatePipe (standalone) ────────────────────────────────────────────────

describe('TsExtractor standalone — TruncatePipe', () => {
  const ir = extractFixture('src/app/truncate.pipe.ts');

  it('detects standalone: true', () => {
    const pipe = ir.nodes.find((n) => n.label === NodeLabel.Pipe);
    expect(pipe?.properties['isStandalone']).toBe(true);
  });

  it('extracts pipe name', () => {
    const pipe = ir.nodes.find((n) => n.label === NodeLabel.Pipe);
    expect(pipe?.properties['pipeName']).toBe('truncate');
  });
});
