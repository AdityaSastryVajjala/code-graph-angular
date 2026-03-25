/**
 * DiExtractor — Phase 2 Dependency Injection extraction.
 *
 * Extracts:
 * - InjectionToken node declarations (`new InjectionToken<T>('desc')`)
 * - INJECTS edges via constructor injection, @Inject(TOKEN), inject() calls
 */

import ts from 'typescript';
import { relative } from 'path';
import { createHash } from 'crypto';
import {
  GraphIR,
  GraphNode,
  GraphRelationship,
  NodeLabel,
  RelationshipType,
} from '../types/graph-ir.js';
import { logger } from '../../shared/logger.js';

// Local copies to avoid circular import with ts-extractor.ts
function makeFileId(filePath: string): string {
  return createHash('sha256').update(filePath).digest('hex').slice(0, 16);
}

function makeSemanticNodeId(filePath: string, kind: string, qualifiedName: string): string {
  return `${filePath}::${kind}::${qualifiedName}`;
}

/**
 * Extract DI-related nodes and relationships from a single TypeScript file.
 * Companion to ts-extractor.ts: emits InjectionToken nodes and all INJECTS edges.
 */
export function extractDi(
  absolutePath: string,
  source: string,
  appRoot: string,
): GraphIR {
  const relPath = relative(appRoot, absolutePath).replace(/\\/g, '/');
  const sourceFile = ts.createSourceFile(absolutePath, source, ts.ScriptTarget.ESNext, true);

  const nodes: GraphNode[] = [];
  const relationships: GraphRelationship[] = [];

  const fileId = makeFileId(relPath);

  // 1. Scan top-level for InjectionToken declarations
  extractInjectionTokens(sourceFile, relPath, fileId, nodes, relationships);

  // 2. Scan class members for @Inject() and inject() patterns
  ts.forEachChild(sourceFile, (node) => {
    if (!ts.isClassDeclaration(node) || !node.name) return;
    const className = node.name.text;
    const classId = makeSemanticNodeId(relPath, 'Class', className);

    extractInjectDecorator(node, classId, relPath, relationships);
    extractInjectFunctionCalls(node, classId, relPath, relationships);
    extractConstructorInjectionDi(node, classId, relPath, relationships);
  });

  return { nodes, relationships, sourceFile: relPath };
}

// ─── InjectionToken declarations ─────────────────────────────────────────────

function extractInjectionTokens(
  sourceFile: ts.SourceFile,
  relPath: string,
  fileId: string,
  nodes: GraphNode[],
  rels: GraphRelationship[],
): void {
  ts.forEachChild(sourceFile, (node) => {
    // Match: const/let/var VAR = new InjectionToken<T>('description')
    if (!ts.isVariableStatement(node)) return;

    for (const decl of node.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name)) continue;
      if (!decl.initializer || !ts.isNewExpression(decl.initializer)) continue;

      const newExpr = decl.initializer;
      if (!ts.isIdentifier(newExpr.expression)) continue;
      if (newExpr.expression.text !== 'InjectionToken') continue;

      const tokenVarName = decl.name.text;
      const tokenId = makeSemanticNodeId(relPath, 'InjectionToken', tokenVarName);

      // Extract description string from first argument
      let description: string | null = null;
      if (newExpr.arguments && newExpr.arguments.length > 0) {
        const firstArg = newExpr.arguments[0];
        if (ts.isStringLiteral(firstArg)) {
          description = firstArg.text;
        }
      }

      nodes.push({
        id: tokenId,
        label: NodeLabel.InjectionToken,
        properties: {
          id: tokenId,
          name: tokenVarName,
          description,
          sourceFile: relPath,
        },
      });

      rels.push({
        id: `${fileId}->declares_symbol->${tokenId}`,
        type: RelationshipType.DeclaresSymbol,
        fromId: fileId,
        toId: tokenId,
      });
    }
  });
}

// ─── @Inject(TOKEN) constructor parameter decorator ──────────────────────────

function extractInjectDecorator(
  classNode: ts.ClassDeclaration,
  ownerNodeId: string,
  relPath: string,
  rels: GraphRelationship[],
): void {
  for (const member of classNode.members) {
    if (!ts.isConstructorDeclaration(member)) continue;

    for (const param of member.parameters) {
      const paramDecorators = ts.getDecorators(param) ?? [];

      for (const dec of paramDecorators) {
        if (!ts.isCallExpression(dec.expression)) continue;
        const decName = ts.isIdentifier(dec.expression.expression)
          ? dec.expression.expression.text
          : null;
        if (decName !== 'Inject') continue;

        const args = dec.expression.arguments;
        if (args.length === 0) continue;

        const tokenArg = args[0];
        if (!ts.isIdentifier(tokenArg)) {
          logger.warn('unresolvable_inject_decorator', {
            filePath: relPath,
            reason: 'non-identifier argument to @Inject()',
          });
          continue;
        }

        rels.push({
          id: `${ownerNodeId}->injects->${tokenArg.text}-at-inject`,
          type: RelationshipType.Injects,
          fromId: ownerNodeId,
          toId: '',
          pendingTargetName: tokenArg.text,
          properties: { via: '@Inject' },
        });
      }
    }
  }
}

// ─── inject() function calls in class body ───────────────────────────────────

function extractInjectFunctionCalls(
  classNode: ts.ClassDeclaration,
  ownerNodeId: string,
  _relPath: string,
  rels: GraphRelationship[],
): void {
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'inject' &&
      node.arguments.length > 0
    ) {
      const arg = node.arguments[0];
      if (ts.isIdentifier(arg)) {
        rels.push({
          id: `${ownerNodeId}->injects->${arg.text}-inject-fn`,
          type: RelationshipType.Injects,
          fromId: ownerNodeId,
          toId: '',
          pendingTargetName: arg.text,
          properties: { via: 'inject_fn' },
        });
      } else {
        logger.warn('unresolvable_inject_fn', {
          filePath: _relPath,
          reason: 'non-identifier first argument to inject()',
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(classNode, visit);
}

// ─── Constructor-typed-param injection (plain constructor) ───────────────────

function extractConstructorInjectionDi(
  classNode: ts.ClassDeclaration,
  ownerNodeId: string,
  _relPath: string,
  rels: GraphRelationship[],
): void {
  for (const member of classNode.members) {
    if (!ts.isConstructorDeclaration(member)) continue;

    for (const param of member.parameters) {
      const paramDecorators = ts.getDecorators(param) ?? [];

      // Skip params that already have @Inject() — handled by extractInjectDecorator
      const hasInjectDecorator = paramDecorators.some((d) => {
        if (!ts.isCallExpression(d.expression)) return false;
        return ts.isIdentifier(d.expression.expression) && d.expression.expression.text === 'Inject';
      });
      if (hasInjectDecorator) continue;

      if (!param.type || !ts.isTypeReferenceNode(param.type)) continue;
      const typeName = param.type.typeName;
      if (!ts.isIdentifier(typeName)) continue;

      rels.push({
        id: `${ownerNodeId}->injects->${typeName.text}-ctor`,
        type: RelationshipType.Injects,
        fromId: ownerNodeId,
        toId: '',
        pendingTargetName: typeName.text,
        properties: { via: 'constructor' },
      });
    }
  }
}
