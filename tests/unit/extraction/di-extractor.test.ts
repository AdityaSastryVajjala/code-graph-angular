/**
 * Unit tests for Phase 2 DI extraction —
 * InjectionToken nodes, INJECTS edges via constructor/@Inject/inject().
 */

import { resolve } from 'path';
import { readFileSync } from 'fs';
import { extractDi } from '../../../src/core/extraction/di-extractor.js';
import { NodeLabel, RelationshipType } from '../../../src/core/types/graph-ir.js';

const SA_FIXTURE_ROOT = resolve(__dirname, '../../fixtures/standalone-app');

function readSA(relPath: string): string {
  return readFileSync(resolve(SA_FIXTURE_ROOT, relPath), 'utf-8');
}

function extractSA(relPath: string) {
  return extractDi(resolve(SA_FIXTURE_ROOT, relPath), readSA(relPath), SA_FIXTURE_ROOT);
}

// ─── tokens.ts — InjectionToken declarations ─────────────────────────────────

describe('DiExtractor — tokens.ts', () => {
  const ir = extractSA('src/app/tokens.ts');

  it('creates InjectionToken node for API_URL', () => {
    const token = ir.nodes.find(
      (n) => n.label === NodeLabel.InjectionToken && n.properties['name'] === 'API_URL',
    );
    expect(token).toBeDefined();
  });

  it('creates InjectionToken node for MAX_RETRIES', () => {
    const token = ir.nodes.find(
      (n) => n.label === NodeLabel.InjectionToken && n.properties['name'] === 'MAX_RETRIES',
    );
    expect(token).toBeDefined();
  });

  it('InjectionToken node has composite id', () => {
    const token = ir.nodes.find(
      (n) => n.label === NodeLabel.InjectionToken && n.properties['name'] === 'API_URL',
    );
    expect(token?.id).toBe('src/app/tokens.ts::InjectionToken::API_URL');
  });

  it('InjectionToken node has sourceFile', () => {
    const token = ir.nodes.find((n) => n.label === NodeLabel.InjectionToken);
    expect(token?.properties['sourceFile']).toBe('src/app/tokens.ts');
  });

  it('emits DECLARES_SYMBOL from File to InjectionToken', () => {
    const rels = ir.relationships.filter((r) => r.type === RelationshipType.DeclaresSymbol);
    expect(rels.length).toBeGreaterThanOrEqual(2);
  });
});

// ─── auth.service.ts — @Inject + inject() ────────────────────────────────────

describe('DiExtractor — auth.service.ts', () => {
  const ir = extractSA('src/app/auth.service.ts');

  it('emits INJECTS edge via @Inject(API_URL) with via="@Inject"', () => {
    const rel = ir.relationships.find(
      (r) => r.type === RelationshipType.Injects && r.pendingTargetName === 'API_URL',
    );
    expect(rel).toBeDefined();
    expect(rel?.properties?.['via']).toBe('@Inject');
  });

  it('emits INJECTS edge for inject(HttpClient) with via="inject_fn"', () => {
    const rel = ir.relationships.find(
      (r) =>
        r.type === RelationshipType.Injects &&
        r.pendingTargetName === 'HttpClient' &&
        r.properties?.['via'] === 'inject_fn',
    );
    expect(rel).toBeDefined();
  });

  it('emits INJECTS edge for inject(UserService) with via="inject_fn"', () => {
    const rel = ir.relationships.find(
      (r) =>
        r.type === RelationshipType.Injects &&
        r.pendingTargetName === 'UserService' &&
        r.properties?.['via'] === 'inject_fn',
    );
    expect(rel).toBeDefined();
  });
});

// ─── Constructor injection ────────────────────────────────────────────────────

describe('DiExtractor — constructor injection', () => {
  it('emits INJECTS for typed constructor param with via="constructor"', () => {
    const source = `
      import { Injectable } from '@angular/core';
      import { UserService } from './user.service';

      @Injectable({ providedIn: 'root' })
      export class AdminService {
        constructor(private userService: UserService) {}
      }
    `;
    const absPath = resolve(SA_FIXTURE_ROOT, 'src/app/admin.service.ts');
    const ir = extractDi(absPath, source, SA_FIXTURE_ROOT);
    const rel = ir.relationships.find(
      (r) => r.type === RelationshipType.Injects && r.pendingTargetName === 'UserService',
    );
    expect(rel).toBeDefined();
    expect(rel?.properties?.['via']).toBe('constructor');
  });
});

// ─── Unresolvable / non-identifier patterns — no crash ───────────────────────

describe('DiExtractor — unresolvable patterns', () => {
  it('does not crash on inject() with non-identifier argument', () => {
    const source = `
      import { Injectable, inject } from '@angular/core';
      @Injectable()
      export class FooService {
        private x = inject(getToken());
      }
    `;
    const absPath = resolve(SA_FIXTURE_ROOT, 'src/app/foo.service.ts');
    expect(() => extractDi(absPath, source, SA_FIXTURE_ROOT)).not.toThrow();
  });

  it('does not crash on missing type annotation', () => {
    const source = `
      import { Injectable } from '@angular/core';
      @Injectable()
      export class BarService {
        constructor(private something: any) {}
      }
    `;
    const absPath = resolve(SA_FIXTURE_ROOT, 'src/app/bar.service.ts');
    expect(() => extractDi(absPath, source, SA_FIXTURE_ROOT)).not.toThrow();
  });
});
