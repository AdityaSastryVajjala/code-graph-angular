/**
 * Unit tests for TsExtractor against simple-ngmodule-app fixture.
 */

import { resolve } from 'path';
import { readFileSync } from 'fs';
import { extractTsFile } from '../../../src/core/extraction/ts-extractor.js';
import { NodeLabel, RelationshipType } from '../../../src/core/types/graph-ir.js';

const FIXTURE_ROOT = resolve(__dirname, '../../fixtures/simple-ngmodule-app');
const APP_DIR = resolve(FIXTURE_ROOT, 'src/app');

function readFixture(relPath: string): string {
  return readFileSync(resolve(FIXTURE_ROOT, relPath), 'utf-8');
}

function extractFixture(relPath: string) {
  const abs = resolve(FIXTURE_ROOT, relPath);
  return extractTsFile(abs, readFixture(relPath), FIXTURE_ROOT);
}

// ─── AppComponent ─────────────────────────────────────────────────────────────

describe('TsExtractor — AppComponent', () => {
  const ir = extractFixture('src/app/app.component.ts');

  it('creates a Component node', () => {
    const comp = ir.nodes.find((n) => n.label === NodeLabel.Component);
    expect(comp).toBeDefined();
  });

  it('extracts selector', () => {
    const comp = ir.nodes.find((n) => n.label === NodeLabel.Component);
    expect(comp?.properties['selector']).toBe('app-root');
  });

  it('extracts templateUrl', () => {
    const comp = ir.nodes.find((n) => n.label === NodeLabel.Component);
    expect(comp?.properties['templatePath']).toBe('./app.component.html');
  });

  it('extracts styleUrls', () => {
    const comp = ir.nodes.find((n) => n.label === NodeLabel.Component);
    expect(comp?.properties['styleUrls']).toEqual(['./app.component.scss']);
  });

  it('extracts changeDetection OnPush', () => {
    const comp = ir.nodes.find((n) => n.label === NodeLabel.Component);
    expect(comp?.properties['changeDetection']).toBe('OnPush');
  });

  it('is not standalone', () => {
    const comp = ir.nodes.find((n) => n.label === NodeLabel.Component);
    expect(comp?.properties['isStandalone']).toBe(false);
  });

  it('creates BELONGS_TO_FILE relationship', () => {
    const rel = ir.relationships.find((r) => r.type === RelationshipType.BelongsToFile);
    expect(rel).toBeDefined();
  });
});

// ─── AppModule ────────────────────────────────────────────────────────────────

describe('TsExtractor — AppModule', () => {
  const ir = extractFixture('src/app/app.module.ts');

  it('creates an NgModule node', () => {
    const mod = ir.nodes.find((n) => n.label === NodeLabel.NgModule);
    expect(mod).toBeDefined();
    expect(mod?.properties['name']).toBe('AppModule');
  });

  it('creates DECLARES relationships', () => {
    const decls = ir.relationships.filter((r) => r.type === RelationshipType.Declares);
    expect(decls.length).toBeGreaterThanOrEqual(5); // 5 declarations
  });

  it('creates BOOTSTRAPS relationship', () => {
    const boot = ir.relationships.find((r) => r.type === RelationshipType.Bootstraps);
    expect(boot).toBeDefined();
  });
});

// ─── UserService ──────────────────────────────────────────────────────────────

describe('TsExtractor — UserService', () => {
  const ir = extractFixture('src/app/user.service.ts');

  it('creates a Service node', () => {
    const svc = ir.nodes.find((n) => n.label === NodeLabel.Service);
    expect(svc).toBeDefined();
    expect(svc?.properties['name']).toBe('UserService');
  });

  it('has providedIn: root', () => {
    const svc = ir.nodes.find((n) => n.label === NodeLabel.Service);
    expect(svc?.properties['providedIn']).toBe('root');
  });
});

// ─── HighlightDirective ───────────────────────────────────────────────────────

describe('TsExtractor — HighlightDirective', () => {
  const ir = extractFixture('src/app/highlight.directive.ts');

  it('creates a Directive node', () => {
    const dir = ir.nodes.find((n) => n.label === NodeLabel.Directive);
    expect(dir).toBeDefined();
    expect(dir?.properties['name']).toBe('HighlightDirective');
  });

  it('extracts selector', () => {
    const dir = ir.nodes.find((n) => n.label === NodeLabel.Directive);
    expect(dir?.properties['selector']).toBe('[highlight]');
  });

  it('extracts hostBindings from host: {}', () => {
    const dir = ir.nodes.find((n) => n.label === NodeLabel.Directive);
    const bindings = dir?.properties['hostBindings'] as string[];
    expect(bindings).toContain('[class.highlighted]');
    expect(bindings).toContain('(mouseenter)');
    expect(bindings).toContain('(mouseleave)');
  });
});

// ─── TruncatePipe ─────────────────────────────────────────────────────────────

describe('TsExtractor — TruncatePipe', () => {
  const ir = extractFixture('src/app/truncate.pipe.ts');

  it('creates a Pipe node', () => {
    const pipe = ir.nodes.find((n) => n.label === NodeLabel.Pipe);
    expect(pipe).toBeDefined();
    expect(pipe?.properties['name']).toBe('TruncatePipe');
  });

  it('extracts pipe name', () => {
    const pipe = ir.nodes.find((n) => n.label === NodeLabel.Pipe);
    expect(pipe?.properties['pipeName']).toBe('truncate');
  });

  it('is pure', () => {
    const pipe = ir.nodes.find((n) => n.label === NodeLabel.Pipe);
    expect(pipe?.properties['isPure']).toBe(true);
  });
});
