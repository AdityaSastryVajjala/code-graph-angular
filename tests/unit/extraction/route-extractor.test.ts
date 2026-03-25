/**
 * Unit tests for Phase 2 route extraction —
 * ROUTES_TO and LAZY_LOADS relationship emission.
 */

import { resolve } from 'path';
import { readFileSync } from 'fs';
import { extractRoutes } from '../../../src/core/extraction/route-extractor.js';
import { RelationshipType } from '../../../src/core/types/graph-ir.js';

const SA_FIXTURE_ROOT = resolve(__dirname, '../../fixtures/standalone-app');

function readSA(relPath: string): string {
  return readFileSync(resolve(SA_FIXTURE_ROOT, relPath), 'utf-8');
}

function extractSA(relPath: string) {
  return extractRoutes(resolve(SA_FIXTURE_ROOT, relPath), readSA(relPath), SA_FIXTURE_ROOT);
}

// ─── app.routes.ts fixture ────────────────────────────────────────────────────

describe('RouteExtractor — app.routes.ts (standalone-app)', () => {
  const ir = extractSA('src/app/app.routes.ts');

  it('emits ROUTES_TO for eager component route', () => {
    const rel = ir.relationships.find(
      (r) => r.type === RelationshipType.RoutesTo && r.pendingTargetName === 'UserListComponent',
    );
    expect(rel).toBeDefined();
  });

  it('emits LAZY_LOADS for loadChildren lazy module route', () => {
    const rel = ir.relationships.find(
      (r) => r.type === RelationshipType.LazyLoads && r.pendingTargetName === 'AdminModule',
    );
    expect(rel).toBeDefined();
    expect(rel?.properties?.['pattern']).toBe('loadChildren');
  });

  it('emits LAZY_LOADS for loadComponent lazy standalone route', () => {
    const rel = ir.relationships.find(
      (r) => r.type === RelationshipType.LazyLoads && r.pendingTargetName === 'ProfileComponent',
    );
    expect(rel).toBeDefined();
    expect(rel?.properties?.['pattern']).toBe('loadComponent');
  });
});

// ─── Dynamic / non-static route config — no crash ────────────────────────────

describe('RouteExtractor — dynamic loadChildren expression', () => {
  it('does not crash on non-import() loadChildren and emits no LAZY_LOADS', () => {
    const source = `
      import { Routes } from '@angular/router';
      const getRoute = () => import('./x.module');
      export const routes: Routes = [
        { path: 'x', loadChildren: getRoute },
      ];
    `;
    const absPath = resolve(SA_FIXTURE_ROOT, 'src/app/dyn.routes.ts');
    let ir: ReturnType<typeof extractRoutes>;
    expect(() => {
      ir = extractRoutes(absPath, source, SA_FIXTURE_ROOT);
    }).not.toThrow();
    const lazyLoads = ir!.relationships.filter((r) => r.type === RelationshipType.LazyLoads);
    expect(lazyLoads).toHaveLength(0);
  });
});

// ─── Route with dynamic path segment ─────────────────────────────────────────

describe('RouteExtractor — dynamic path segment (:id)', () => {
  it('still emits ROUTES_TO for a route with :id path', () => {
    const source = `
      import { Routes } from '@angular/router';
      import { UserDetailComponent } from './user-detail.component';
      export const routes: Routes = [
        { path: 'users/:id', component: UserDetailComponent },
      ];
    `;
    const absPath = resolve(SA_FIXTURE_ROOT, 'src/app/detail.routes.ts');
    const ir = extractRoutes(absPath, source, SA_FIXTURE_ROOT);
    const rel = ir.relationships.find(
      (r) => r.type === RelationshipType.RoutesTo && r.pendingTargetName === 'UserDetailComponent',
    );
    expect(rel).toBeDefined();
  });
});

// ─── File with no route config ────────────────────────────────────────────────

describe('RouteExtractor — no routes', () => {
  it('returns empty relationships for a non-route file', () => {
    const source = `export const VALUE = 42;`;
    const absPath = resolve(SA_FIXTURE_ROOT, 'src/app/no-routes.ts');
    const ir = extractRoutes(absPath, source, SA_FIXTURE_ROOT);
    expect(ir.relationships.filter(
      (r) => r.type === RelationshipType.RoutesTo || r.type === RelationshipType.LazyLoads,
    )).toHaveLength(0);
  });
});
