/**
 * SpecExtractor — indexes *.spec.ts files as first-class graph nodes.
 * Links spec files to the Angular entities they test.
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

/**
 * Extract a SpecFile node and TESTS relationships from a *.spec.ts file.
 */
export function extractSpecFile(
  absolutePath: string,
  source: string,
  appRoot: string,
): GraphIR {
  const relPath = relative(appRoot, absolutePath);
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

  // Strategy 1: explicit imports — find imported class names and link to them.
  // Use pendingTargetName so the normalizer resolves by class name; avoids
  // cross-platform path hash mismatches (Windows backslash vs forward slash).
  const importedEntities = extractImportedEntities(sourceFile, relPath);

  for (const entity of importedEntities) {
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
      properties: { confidence: 'explicit' },
    });
  }

  // Strategy 2: naming convention — infer from file name if no explicit import found
  if (importedEntities.length === 0) {
    const baseName = basename(relPath, '.spec.ts');
    const inferredName = toPascalCase(baseName);
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
      properties: { confidence: 'inferred' },
    });
  }

  return { nodes, relationships, sourceFile: relPath };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface ImportedEntity {
  name: string;
}

function extractImportedEntities(
  sourceFile: ts.SourceFile,
  _specRelPath: string,
): ImportedEntity[] {
  const entities: ImportedEntity[] = [];

  ts.forEachChild(sourceFile, (node) => {
    if (!ts.isImportDeclaration(node)) return;
    if (!ts.isStringLiteral(node.moduleSpecifier)) return;

    const importPath = node.moduleSpecifier.text;
    // Only consider relative imports (they reference local Angular entities)
    if (!importPath.startsWith('.')) return;

    const importedNames = extractImportedNames(node);
    for (const name of importedNames) {
      if (looksLikeAngularClass(name)) {
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
      names.push(element.name.text);
    }
  }
  return names;
}


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
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}
