/**
 * TsExtractor — extracts Angular metadata from TypeScript source files.
 * Uses the TypeScript Compiler API for semantically correct extraction.
 */

import ts from 'typescript';
import { createHash } from 'crypto';
import { relative } from 'path';
import {
  GraphIR,
  GraphNode,
  GraphRelationship,
  NodeLabel,
  RelationshipType,
} from '../types/graph-ir.js';

// ─── ID Generation ────────────────────────────────────────────────────────────

export function makeNodeId(filePath: string, symbolName: string): string {
  return createHash('sha256')
    .update(`${filePath}:${symbolName}`)
    .digest('hex')
    .slice(0, 16);
}

export function makeFileId(filePath: string): string {
  return createHash('sha256').update(filePath).digest('hex').slice(0, 16);
}

// ─── Main Extractor ───────────────────────────────────────────────────────────

/**
 * Extract Angular entities from a single TypeScript source file.
 * @param absolutePath  Absolute path to the .ts file
 * @param source        File contents as string
 * @param appRoot       Absolute path to app root (for relative path calculation)
 */
export function extractTsFile(
  absolutePath: string,
  source: string,
  appRoot: string,
): GraphIR {
  const relPath = relative(appRoot, absolutePath);
  const sourceFile = ts.createSourceFile(absolutePath, source, ts.ScriptTarget.ESNext, true);

  const nodes: GraphNode[] = [];
  const relationships: GraphRelationship[] = [];

  // Create File node
  const fileId = makeFileId(relPath);
  nodes.push({
    id: fileId,
    label: NodeLabel.File,
    properties: {
      id: fileId,
      filePath: relPath,
      fileType: relPath.endsWith('.html') ? 'html' : 'ts',
    },
  });

  ts.forEachChild(sourceFile, (node) => {
    if (!ts.isClassDeclaration(node) || !node.name) return;

    const className = node.name.text;
    const decorators = ts.getDecorators(node) ?? [];

    for (const decorator of decorators) {
      if (!ts.isCallExpression(decorator.expression)) continue;
      const decoratorName = getDecoratorName(decorator.expression);

      switch (decoratorName) {
        case 'Component':
          extractComponent(node, className, relPath, fileId, decorator, nodes, relationships);
          break;
        case 'Injectable':
          extractService(node, className, relPath, fileId, decorator, nodes, relationships);
          break;
        case 'NgModule':
          extractNgModule(node, className, relPath, fileId, decorator, nodes, relationships);
          break;
        case 'Directive':
          extractDirective(node, className, relPath, fileId, decorator, nodes, relationships);
          break;
        case 'Pipe':
          extractPipe(node, className, relPath, fileId, decorator, nodes, relationships);
          break;
      }
    }
  });

  return { nodes, relationships, sourceFile: relPath };
}

// ─── Entity Extractors ────────────────────────────────────────────────────────

function extractComponent(
  node: ts.ClassDeclaration,
  className: string,
  relPath: string,
  fileId: string,
  decorator: ts.Decorator,
  nodes: GraphNode[],
  rels: GraphRelationship[],
): void {
  const meta = getDecoratorObjectArg(decorator);
  const nodeId = makeNodeId(relPath, className);

  const selector = getStringProp(meta, 'selector') ?? '';
  const templateUrl = getStringProp(meta, 'templateUrl');
  const isStandalone = getBoolProp(meta, 'standalone') ?? false;
  const styleUrlsArr = getStringArrayProp(meta, 'styleUrls');

  nodes.push({
    id: nodeId,
    label: NodeLabel.Component,
    properties: {
      id: nodeId,
      name: className,
      selector,
      filePath: relPath,
      isStandalone,
      templateType: templateUrl ? 'external' : 'inline',
      templatePath: templateUrl ?? null,
      changeDetection: getChangeDetectionValue(meta),
      styleUrls: styleUrlsArr,
    },
  });

  rels.push({
    id: `${nodeId}->${fileId}`,
    type: RelationshipType.BelongsToFile,
    fromId: nodeId,
    toId: fileId,
  });

  // Extract constructor injection
  extractConstructorInjection(node, nodeId, relPath, rels);
  // Extract inject() function calls
  extractInjectFunctionCalls(node, nodeId, relPath, rels);
}

function extractService(
  _node: ts.ClassDeclaration,
  className: string,
  relPath: string,
  fileId: string,
  decorator: ts.Decorator,
  nodes: GraphNode[],
  rels: GraphRelationship[],
): void {
  const meta = getDecoratorObjectArg(decorator);
  const nodeId = makeNodeId(relPath, className);

  nodes.push({
    id: nodeId,
    label: NodeLabel.Service,
    properties: {
      id: nodeId,
      name: className,
      filePath: relPath,
      providedIn: getStringProp(meta, 'providedIn') ?? null,
    },
  });

  rels.push({
    id: `${nodeId}->${fileId}`,
    type: RelationshipType.BelongsToFile,
    fromId: nodeId,
    toId: fileId,
  });
}

function extractNgModule(
  _node: ts.ClassDeclaration,
  className: string,
  relPath: string,
  fileId: string,
  decorator: ts.Decorator,
  nodes: GraphNode[],
  rels: GraphRelationship[],
): void {
  const nodeId = makeNodeId(relPath, className);

  nodes.push({
    id: nodeId,
    label: NodeLabel.NgModule,
    properties: {
      id: nodeId,
      name: className,
      filePath: relPath,
    },
  });

  rels.push({
    id: `${nodeId}->${fileId}`,
    type: RelationshipType.BelongsToFile,
    fromId: nodeId,
    toId: fileId,
  });

  // Extract module relationships (declarations, imports, exports, bootstrap)
  extractModuleRelationships(decorator, nodeId, relPath, rels);
}

function extractDirective(
  _node: ts.ClassDeclaration,
  className: string,
  relPath: string,
  fileId: string,
  decorator: ts.Decorator,
  nodes: GraphNode[],
  rels: GraphRelationship[],
): void {
  const meta = getDecoratorObjectArg(decorator);
  const nodeId = makeNodeId(relPath, className);

  nodes.push({
    id: nodeId,
    label: NodeLabel.Directive,
    properties: {
      id: nodeId,
      name: className,
      selector: getStringProp(meta, 'selector') ?? '',
      filePath: relPath,
      isStandalone: getBoolProp(meta, 'standalone') ?? false,
      hostBindings: extractHostBindings(meta),
    },
  });

  rels.push({
    id: `${nodeId}->${fileId}`,
    type: RelationshipType.BelongsToFile,
    fromId: nodeId,
    toId: fileId,
  });
}

function extractPipe(
  _node: ts.ClassDeclaration,
  className: string,
  relPath: string,
  fileId: string,
  decorator: ts.Decorator,
  nodes: GraphNode[],
  rels: GraphRelationship[],
): void {
  const meta = getDecoratorObjectArg(decorator);
  const nodeId = makeNodeId(relPath, className);

  nodes.push({
    id: nodeId,
    label: NodeLabel.Pipe,
    properties: {
      id: nodeId,
      name: className,
      pipeName: getStringProp(meta, 'name') ?? className.toLowerCase(),
      filePath: relPath,
      isStandalone: getBoolProp(meta, 'standalone') ?? false,
      isPure: getBoolProp(meta, 'pure') ?? true,
    },
  });

  rels.push({
    id: `${nodeId}->${fileId}`,
    type: RelationshipType.BelongsToFile,
    fromId: nodeId,
    toId: fileId,
  });
}

// ─── Helper Extractors ────────────────────────────────────────────────────────

function extractConstructorInjection(
  classNode: ts.ClassDeclaration,
  ownerNodeId: string,
  _ownerFilePath: string,
  rels: GraphRelationship[],
): void {
  for (const member of classNode.members) {
    if (!ts.isConstructorDeclaration(member)) continue;
    for (const param of member.parameters) {
      const paramDecorators = ts.getDecorators(param) ?? [];
      const hasInject = paramDecorators.some((d) => {
        if (!ts.isCallExpression(d.expression)) return false;
        return getDecoratorName(d.expression) === 'Inject';
      });
      if (hasInject || paramDecorators.length === 0) {
        if (ts.isTypeReferenceNode(param.type as ts.TypeNode)) {
          const typeName = (param.type as ts.TypeReferenceNode).typeName;
          if (ts.isIdentifier(typeName)) {
            rels.push({
              id: `${ownerNodeId}->injects->${typeName.text}`,
              type: RelationshipType.Injects,
              fromId: ownerNodeId,
              toId: '',
              pendingTargetName: typeName.text,
              properties: { via: 'constructor' },
            });
          }
        }
      }
    }
  }
}

function extractInjectFunctionCalls(
  classNode: ts.ClassDeclaration,
  ownerNodeId: string,
  _ownerFilePath: string,
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
          id: `${ownerNodeId}->injects->${arg.text}`,
          type: RelationshipType.Injects,
          fromId: ownerNodeId,
          toId: '',
          pendingTargetName: arg.text,
          properties: { via: 'inject_fn' },
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(classNode, visit);
}

function extractModuleRelationships(
  decorator: ts.Decorator,
  moduleNodeId: string,
  _moduleFilePath: string,
  rels: GraphRelationship[],
): void {
  const meta = getDecoratorObjectArg(decorator);
  if (!meta) return;

  const mapping: [string, RelationshipType][] = [
    ['declarations', RelationshipType.Declares],
    ['imports', RelationshipType.Imports],
    ['exports', RelationshipType.Exports],
    ['bootstrap', RelationshipType.Bootstraps],
    ['providers', RelationshipType.Provides],
  ];

  for (const [prop, relType] of mapping) {
    const items = getIdentifierArrayProp(meta, prop);
    for (const item of items) {
      rels.push({
        id: `${moduleNodeId}->${relType}->${item}`,
        type: relType,
        fromId: moduleNodeId,
        toId: '',
        pendingTargetName: item,
      });
    }
  }
}

function extractHostBindings(meta: ts.ObjectLiteralExpression | null): string[] {
  if (!meta) return [];
  const bindings: string[] = [];

  // Extract from host: { '[class.active]': 'isActive', '(click)': 'onClick()' }
  for (const prop of meta.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    if (!ts.isIdentifier(prop.name) && !ts.isStringLiteral(prop.name)) continue;
    const key = ts.isStringLiteral(prop.name) ? prop.name.text : prop.name.text;
    if (key === 'host' && ts.isObjectLiteralExpression(prop.initializer)) {
      for (const hostProp of prop.initializer.properties) {
        if (!ts.isPropertyAssignment(hostProp)) continue;
        if (ts.isStringLiteral(hostProp.name)) {
          bindings.push(hostProp.name.text);
        }
      }
    }
  }
  return bindings;
}

// ─── AST Helpers ─────────────────────────────────────────────────────────────

function getDecoratorName(callExpr: ts.CallExpression): string {
  if (ts.isIdentifier(callExpr.expression)) return callExpr.expression.text;
  if (
    ts.isPropertyAccessExpression(callExpr.expression) &&
    ts.isIdentifier(callExpr.expression.name)
  ) {
    return callExpr.expression.name.text;
  }
  return '';
}

function getDecoratorObjectArg(
  decorator: ts.Decorator,
): ts.ObjectLiteralExpression | null {
  if (!ts.isCallExpression(decorator.expression)) return null;
  const args = decorator.expression.arguments;
  if (args.length === 0) return null;
  const first = args[0];
  return ts.isObjectLiteralExpression(first) ? first : null;
}

function getStringProp(
  meta: ts.ObjectLiteralExpression | null,
  key: string,
): string | undefined {
  if (!meta) return undefined;
  for (const prop of meta.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    if (!isPropertyNamed(prop, key)) continue;
    if (ts.isStringLiteral(prop.initializer)) return prop.initializer.text;
  }
  return undefined;
}

function getBoolProp(
  meta: ts.ObjectLiteralExpression | null,
  key: string,
): boolean | undefined {
  if (!meta) return undefined;
  for (const prop of meta.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    if (!isPropertyNamed(prop, key)) continue;
    if (prop.initializer.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (prop.initializer.kind === ts.SyntaxKind.FalseKeyword) return false;
  }
  return undefined;
}

function getStringArrayProp(
  meta: ts.ObjectLiteralExpression | null,
  key: string,
): string[] {
  if (!meta) return [];
  for (const prop of meta.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    if (!isPropertyNamed(prop, key)) continue;
    if (!ts.isArrayLiteralExpression(prop.initializer)) return [];
    return prop.initializer.elements
      .filter(ts.isStringLiteral)
      .map((e) => (e as ts.StringLiteral).text);
  }
  return [];
}

function getIdentifierArrayProp(
  meta: ts.ObjectLiteralExpression | null,
  key: string,
): string[] {
  if (!meta) return [];
  for (const prop of meta.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    if (!isPropertyNamed(prop, key)) continue;
    if (!ts.isArrayLiteralExpression(prop.initializer)) return [];
    return prop.initializer.elements
      .filter(ts.isIdentifier)
      .map((e) => (e as ts.Identifier).text);
  }
  return [];
}

function isPropertyNamed(prop: ts.PropertyAssignment, key: string): boolean {
  return (
    (ts.isIdentifier(prop.name) && prop.name.text === key) ||
    (ts.isStringLiteral(prop.name) && prop.name.text === key)
  );
}

function getChangeDetectionValue(
  meta: ts.ObjectLiteralExpression | null,
): 'Default' | 'OnPush' | null {
  if (!meta) return null;
  for (const prop of meta.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    if (!isPropertyNamed(prop, 'changeDetection')) continue;
    const init = prop.initializer;
    if (ts.isPropertyAccessExpression(init)) {
      const name = init.name.text;
      if (name === 'OnPush') return 'OnPush';
      if (name === 'Default') return 'Default';
    }
  }
  return null;
}
