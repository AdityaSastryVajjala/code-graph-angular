/**
 * SpecExtractor — indexes *.spec.ts files as first-class graph nodes.
 * Links spec files to the Angular entities they test.
 *
 * Phase 2 enhancements:
 * - TESTS edges now carry `via` property: 'import' | 'testbed' | 'naming'
 * - TestBed.configureTestingModule declarations/providers scanning (Strategy 2)
 * - Naming-convention heuristic is now Strategy 3 (fallback only)
 * - De-duplication: no duplicate TESTS edges for same (fromId, pendingTargetName) pair
 */

import ts from 'typescript';
import { relative, basename } from 'path';
import {
  GraphIR,
  GraphNode,
  GraphRelationship,
  NodeLabel,
  RelationshipType,
} from '../types/graph-ir.js';
import { makeFileId } from './ts-extractor.js';
import { createHash } from 'crypto';
import { logger } from '../../shared/logger.js';

/**
 * Extract a SpecFile node and TESTS relationships from a *.spec.ts file.
 */
export function extractSpecFile(
  absolutePath: string,
  source: string,
  appRoot: string,
): GraphIR {
  const relPath = relative(appRoot, absolutePath).replace(/\\/g, '/');
  const specFileId = makeFileId(relPath);

  const nodes: GraphNode[] = [
    {
      id: specFileId,
      label: NodeLabel.SpecFile,
      properties: {
        id: specFileId,
        filePath: relPath,
      },
    },
  ];

  const relationships: GraphRelationship[] = [];
  const sourceFile = ts.createSourceFile(absolutePath, source, ts.ScriptTarget.ESNext, true);
  const seenTargets = new Set<string>();

  // Strategy 1: import-based — find imported Angular class names and link via 'import'
  const importedEntities = extractImportedEntities(sourceFile);

  for (const entity of importedEntities) {
    if (seenTargets.has(entity.name)) continue;
    seenTargets.add(entity.name);

    const relId = createHash('sha256')
      .update(`${specFileId}->tests->${entity.name}`)
      .digest('hex')
      .slice(0, 16);
    relationships.push({
      id: relId,
      type: RelationshipType.Tests,
      fromId: specFileId,
      toId: '',
      pendingTargetName: entity.name,
      properties: { via: 'import', confidence: 'explicit' },
    });
  }

  // Strategy 2: TestBed.configureTestingModule scanning via 'testbed'
  const testbedEntities = extractTestBedEntities(sourceFile);

  for (const entity of testbedEntities) {
    if (seenTargets.has(entity.name)) continue;
    seenTargets.add(entity.name);

    const relId = createHash('sha256')
      .update(`${specFileId}->tests->${entity.name}-testbed`)
      .digest('hex')
      .slice(0, 16);
    relationships.push({
      id: relId,
      type: RelationshipType.Tests,
      fromId: specFileId,
      toId: '',
      pendingTargetName: entity.name,
      properties: { via: 'testbed' },
    });
  }

  // Strategy 3: naming convention — fallback when no import/TestBed targets found
  if (seenTargets.size === 0) {
    const baseName = basename(relPath, '.spec.ts');
    const inferredName = toPascalCase(baseName);

    logger.info('spec_naming_heuristic', { filePath: relPath, inferredName });

    const relId = createHash('sha256')
      .update(`${specFileId}->tests->${inferredName}`)
      .digest('hex')
      .slice(0, 16);
    relationships.push({
      id: relId,
      type: RelationshipType.Tests,
      fromId: specFileId,
      toId: '',
      pendingTargetName: inferredName,
      properties: { via: 'naming', confidence: 'inferred' },
    });
  }

  return { nodes, relationships, sourceFile: relPath };
}

// ─── Strategy 1: Import-based ─────────────────────────────────────────────────

interface ImportedEntity {
  name: string;
}

function extractImportedEntities(sourceFile: ts.SourceFile): ImportedEntity[] {
  const entities: ImportedEntity[] = [];
  const seen = new Set<string>();

  ts.forEachChild(sourceFile, (node) => {
    if (!ts.isImportDeclaration(node)) return;
    if (!ts.isStringLiteral(node.moduleSpecifier)) return;

    const importPath = node.moduleSpecifier.text;
    // Only consider relative imports (they reference local Angular entities)
    if (!importPath.startsWith('.')) return;

    const importedNames = extractImportedNames(node);
    for (const name of importedNames) {
      if (looksLikeAngularClass(name) && !seen.has(name)) {
        seen.add(name);
        entities.push({ name });
      }
    }
  });

  return entities;
}

function extractImportedNames(decl: ts.ImportDeclaration): string[] {
  const names: string[] = [];
  if (!decl.importClause) return names;

  const clause = decl.importClause;
  if (clause.name) names.push(clause.name.text);

  if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
    for (const element of clause.namedBindings.elements) {
      // Use the original name (not alias) for matching
      const originalName = element.propertyName?.text ?? element.name.text;
      names.push(originalName);
    }
  }
  return names;
}

// ─── Strategy 2: TestBed scanning ────────────────────────────────────────────

function extractTestBedEntities(sourceFile: ts.SourceFile): ImportedEntity[] {
  const entities: ImportedEntity[] = [];

  const visit = (node: ts.Node): void => {
    // Look for: TestBed.configureTestingModule({ declarations: [...], providers: [...] })
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'TestBed' &&
      node.expression.name.text === 'configureTestingModule' &&
      node.arguments.length > 0
    ) {
      const arg = node.arguments[0];
      if (ts.isObjectLiteralExpression(arg)) {
        for (const prop of arg.properties) {
          if (!ts.isPropertyAssignment(prop)) continue;
          const propName = ts.isIdentifier(prop.name) ? prop.name.text : null;
          if (propName !== 'declarations' && propName !== 'providers') continue;

          if (ts.isArrayLiteralExpression(prop.initializer)) {
            for (const el of prop.initializer.elements) {
              if (ts.isIdentifier(el)) {
                entities.push({ name: el.text });
              } else if (ts.isObjectLiteralExpression(el)) {
                // { provide: X, useClass: Y } — extract useClass identifier
                for (const objProp of el.properties) {
                  if (!ts.isPropertyAssignment(objProp)) continue;
                  const key = ts.isIdentifier(objProp.name) ? objProp.name.text : null;
                  if (key === 'useClass' && ts.isIdentifier(objProp.initializer)) {
                    entities.push({ name: objProp.initializer.text });
                  }
                }
              }
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return entities;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function looksLikeAngularClass(name: string): boolean {
  return (
    name.endsWith('Component') ||
    name.endsWith('Service') ||
    name.endsWith('Directive') ||
    name.endsWith('Pipe') ||
    name.endsWith('Module') ||
    name.endsWith('Guard') ||
    name.endsWith('Resolver') ||
    name.endsWith('Interceptor')
  );
}

function toPascalCase(str: string): string {
  return str
    .split(/[-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}
