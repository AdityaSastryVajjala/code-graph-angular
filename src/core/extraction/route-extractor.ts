/**
 * RouteExtractor — Phase 2 routing relationship extraction.
 *
 * Emits:
 * - ROUTES_TO  (Route → Component) for eager `component:` properties
 * - LAZY_LOADS (Route → NgModule | Component) for `loadChildren:` / `loadComponent:`
 *
 * Preserves Phase 1 LOADS_COMPONENT / LOADS_LAZY_MODULE edges (no removal).
 */

import ts from 'typescript';
import { relative } from 'path';
import { createHash } from 'crypto';
import {
  GraphIR,
  GraphRelationship,
  RelationshipType,
} from '../types/graph-ir.js';
import { logger } from '../../shared/logger.js';

function makeRelId(...parts: string[]): string {
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 16);
}

/**
 * Extract ROUTES_TO and LAZY_LOADS relationships from a TypeScript source file.
 * Designed to run after existing Phase 1 route extraction (non-replacing).
 */
export function extractRoutes(
  absolutePath: string,
  source: string,
  appRoot: string,
): GraphIR {
  const relPath = relative(appRoot, absolutePath).replace(/\\/g, '/');
  const sourceFile = ts.createSourceFile(absolutePath, source, ts.ScriptTarget.ESNext, true);

  const relationships: GraphRelationship[] = [];

  ts.forEachChild(sourceFile, (node) => {
    try {
      collectRouteRelationships(node, relPath, relationships, sourceFile);
    } catch (err) {
      logger.warn('route_extraction_error', {
        filePath: relPath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  return { nodes: [], relationships, sourceFile: relPath };
}

// ─── AST traversal ────────────────────────────────────────────────────────────

function collectRouteRelationships(
  node: ts.Node,
  relPath: string,
  rels: GraphRelationship[],
  sourceFile: ts.SourceFile,
): void {
  // Walk arrays that look like Route[] — either variable initialisers or exported consts
  if (ts.isArrayLiteralExpression(node)) {
    for (const element of node.elements) {
      if (ts.isObjectLiteralExpression(element)) {
        processRouteObject(element, relPath, rels, sourceFile);
      }
    }
  }
  ts.forEachChild(node, (child) => collectRouteRelationships(child, relPath, rels, sourceFile));
}

function processRouteObject(
  routeObj: ts.ObjectLiteralExpression,
  relPath: string,
  rels: GraphRelationship[],
  sourceFile: ts.SourceFile,
): void {
  for (const prop of routeObj.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const propName = ts.isIdentifier(prop.name)
      ? prop.name.text
      : ts.isStringLiteral(prop.name)
      ? prop.name.text
      : null;

    if (!propName) continue;

    if (propName === 'component') {
      // eager route: { path: '...', component: SomeComponent }
      if (ts.isIdentifier(prop.initializer)) {
        const componentName = prop.initializer.text;
        const routeId = makeRelId(relPath, 'routes_to', componentName, sourceFile.fileName);
        rels.push({
          id: routeId,
          type: RelationshipType.RoutesTo,
          fromId: '',
          toId: '',
          pendingTargetName: componentName,
        });
      }
    } else if (propName === 'loadChildren' || propName === 'loadComponent') {
      // lazy route
      const lazyTarget = extractLazyTarget(prop.initializer, relPath, propName);
      if (lazyTarget) {
        const routeId = makeRelId(relPath, 'lazy_loads', lazyTarget, propName);
        rels.push({
          id: routeId,
          type: RelationshipType.LazyLoads,
          fromId: '',
          toId: '',
          pendingTargetName: lazyTarget,
          properties: { pattern: propName },
        });
      }
    }
  }
}

/**
 * Extract the lazy-loaded entity name from a `loadChildren`/`loadComponent` expression.
 * Handles: `() => import('./path').then(m => m.XModule)`
 * Returns the identifier after `.then(m => m.XXX)` or null if not statically resolvable.
 */
function extractLazyTarget(
  expr: ts.Expression,
  relPath: string,
  propName: string,
): string | null {
  // Arrow function: () => import('./x').then(m => m.X)
  if (!ts.isArrowFunction(expr)) return null;
  const body = expr.body;
  // body may be a call expression directly or a block — handle call expr case
  if (!ts.isCallExpression(body)) return null;

  // body = import('./x').then(m => m.X)
  if (!ts.isPropertyAccessExpression(body.expression)) return null;
  if (body.expression.name.text !== 'then') return null;

  if (body.arguments.length === 0) return null;
  const thenCallback = body.arguments[0];
  if (!ts.isArrowFunction(thenCallback)) return null;

  const thenBody = thenCallback.body;
  // then body: m => m.XModule
  if (!ts.isPropertyAccessExpression(thenBody)) {
    logger.warn('unresolvable_lazy_route', {
      filePath: relPath,
      prop: propName,
      reason: 'then() callback body is not a property access expression',
    });
    return null;
  }

  return thenBody.name.text;
}
