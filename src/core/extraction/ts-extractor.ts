/**
 * TsExtractor — extracts Angular metadata from TypeScript source files.
 * Uses the TypeScript Compiler API for semantically correct extraction.
 */

import ts from 'typescript';
import { createHash } from 'crypto';
import { relative, dirname, resolve } from 'path';
import {
  GraphIR,
  GraphNode,
  GraphRelationship,
  InlineTemplateInfo,
  NodeLabel,
  RelationshipType,
} from '../types/graph-ir.js';
import { logger } from '../../shared/logger.js';
import { extractDi } from './di-extractor.js';
import { extractRoutes } from './route-extractor.js';

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

/**
 * Phase 2 — human-readable composite key for semantic symbol nodes.
 * Format: filePath::Kind::qualifiedName
 * Example: 'src/app/user.service.ts::Class::UserService'
 */
export function makeSemanticNodeId(filePath: string, kind: string, qualifiedName: string): string {
  return `${filePath}::${kind}::${qualifiedName}`;
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
  const relPath = relative(appRoot, absolutePath).replace(/\\/g, '/');
  const sourceFile = ts.createSourceFile(absolutePath, source, ts.ScriptTarget.ESNext, true);

  const nodes: GraphNode[] = [];
  const relationships: GraphRelationship[] = [];
  const inlineTemplates: InlineTemplateInfo[] = [];

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
          extractComponent(node, className, relPath, fileId, decorator, nodes, relationships, inlineTemplates);
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

  // Phase 2 — extract semantic symbols (Class, Interface, Method, Property)
  extractSemanticSymbols(sourceFile, relPath, fileId, nodes, relationships);

  // Phase 2 — extract DI: InjectionToken nodes + @Inject() pattern INJECTS edges
  const diIR = extractDi(absolutePath, source, appRoot);
  nodes.push(...diIR.nodes);
  relationships.push(...diIR.relationships);

  // Phase 2 — extract routing: ROUTES_TO + LAZY_LOADS relationships
  const routeIR = extractRoutes(absolutePath, source, appRoot);
  relationships.push(...routeIR.relationships);

  // Phase 5 — emit IMPORTS_FROM edges for relative TypeScript imports
  const thisDir = dirname(absolutePath);
  ts.forEachChild(sourceFile, (node) => {
    if (!ts.isImportDeclaration(node)) return;
    const spec = node.moduleSpecifier;
    if (!ts.isStringLiteral(spec)) return;
    const importPath = spec.text;
    if (!importPath.startsWith('./') && !importPath.startsWith('../')) return;

    let resolved = resolve(thisDir, importPath);
    // Normalise .js extension (ESM output) to .ts source
    if (resolved.endsWith('.js')) {
      resolved = resolved.slice(0, -3) + '.ts';
    } else if (!resolved.endsWith('.ts')) {
      resolved = resolved + '.ts';
    }
    const targetRelPath = relative(appRoot, resolved).replace(/\\/g, '/');
    const targetFileId = makeFileId(targetRelPath);
    const edgeId = `${fileId}->IMPORTS_FROM->${targetFileId}`;
    if (!relationships.some((r) => r.id === edgeId)) {
      relationships.push({
        id: edgeId,
        type: RelationshipType.ImportsFrom,
        fromId: fileId,
        toId: targetFileId,
      });
    }
  });

  return {
    nodes,
    relationships,
    sourceFile: relPath,
    meta: inlineTemplates.length > 0 ? { inlineTemplates } : undefined,
  };
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
  inlineTemplates: InlineTemplateInfo[],
): void {
  const meta = getDecoratorObjectArg(decorator);
  const nodeId = makeNodeId(relPath, className);

  const selector = getStringProp(meta, 'selector') ?? '';
  const templateUrl = getStringProp(meta, 'templateUrl');
  const inlineTemplate = getTemplateProp(meta, 'template');
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

  // Capture inline template for pipeline processing
  if (inlineTemplate !== undefined) {
    inlineTemplates.push({
      componentNodeId: nodeId,
      componentFilePath: relPath,
      templateSource: inlineTemplate,
    });
  }

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

// ─── Phase 2: Semantic Symbol Extraction ─────────────────────────────────────

/**
 * Walk the source file and emit Class/Interface/Method/Property nodes plus
 * DECLARES_SYMBOL, HAS_METHOD, HAS_PROPERTY, IMPLEMENTS, EXTENDS relationships.
 */
function extractSemanticSymbols(
  sourceFile: ts.SourceFile,
  relPath: string,
  fileId: string,
  nodes: GraphNode[],
  rels: GraphRelationship[],
): void {
  ts.forEachChild(sourceFile, (node) => {
    try {
      if (ts.isClassDeclaration(node) && node.name) {
        extractClassSymbol(node, relPath, fileId, nodes, rels);
      } else if (ts.isInterfaceDeclaration(node) && node.name) {
        extractInterfaceSymbol(node, relPath, fileId, nodes, rels);
      }
    } catch (err) {
      logger.warn('semantic_extraction_error', {
        filePath: relPath,
        kind: ts.isClassDeclaration(node) ? 'Class' : 'Interface',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
}

function extractClassSymbol(
  node: ts.ClassDeclaration,
  relPath: string,
  fileId: string,
  nodes: GraphNode[],
  rels: GraphRelationship[],
): void {
  const className = node.name!.text;
  const classId = makeSemanticNodeId(relPath, 'Class', className);
  const modifiers = ts.getModifiers(node) ?? [];
  const isAbstract = modifiers.some((m) => m.kind === ts.SyntaxKind.AbstractKeyword);
  const isExported = modifiers.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

  nodes.push({
    id: classId,
    label: NodeLabel.Class,
    properties: {
      id: classId,
      name: className,
      sourceFile: relPath,
      isAbstract,
      isExported,
    },
  });

  // DECLARES_SYMBOL: File → Class
  rels.push({
    id: `${fileId}->declares_symbol->${classId}`,
    type: RelationshipType.DeclaresSymbol,
    fromId: fileId,
    toId: classId,
  });

  // EXTENDS heritage
  if (node.heritageClauses) {
    for (const clause of node.heritageClauses) {
      if (clause.token === ts.SyntaxKind.ExtendsKeyword) {
        for (const type of clause.types) {
          try {
            const baseName = ts.isIdentifier(type.expression) ? type.expression.text : null;
            if (baseName) {
              rels.push({
                id: `${classId}->extends->${baseName}`,
                type: RelationshipType.Extends,
                fromId: classId,
                toId: '',
                pendingTargetName: baseName,
              });
            }
          } catch {
            logger.warn('heritage_extraction_error', { filePath: relPath, className, clause: 'extends' });
          }
        }
      } else if (clause.token === ts.SyntaxKind.ImplementsKeyword) {
        for (const type of clause.types) {
          try {
            const ifaceName = ts.isIdentifier(type.expression) ? type.expression.text : null;
            if (ifaceName) {
              rels.push({
                id: `${classId}->implements->${ifaceName}`,
                type: RelationshipType.Implements,
                fromId: classId,
                toId: '',
                pendingTargetName: ifaceName,
              });
            }
          } catch {
            logger.warn('heritage_extraction_error', { filePath: relPath, className, clause: 'implements' });
          }
        }
      }
    }
  }

  // Members: Methods and Properties
  for (const member of node.members) {
    try {
      if (ts.isMethodDeclaration(member) && member.name) {
        extractMethodSymbol(member, className, classId, relPath, nodes, rels);
      } else if (ts.isPropertyDeclaration(member) && member.name) {
        extractPropertySymbol(member, className, classId, relPath, nodes, rels);
      }
    } catch (err) {
      logger.warn('member_extraction_error', {
        filePath: relPath,
        className,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

function extractInterfaceSymbol(
  node: ts.InterfaceDeclaration,
  relPath: string,
  fileId: string,
  nodes: GraphNode[],
  rels: GraphRelationship[],
): void {
  const ifaceName = node.name.text;
  const ifaceId = makeSemanticNodeId(relPath, 'Interface', ifaceName);
  const modifiers = ts.getModifiers(node) ?? [];
  const isExported = modifiers.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

  nodes.push({
    id: ifaceId,
    label: NodeLabel.Interface,
    properties: {
      id: ifaceId,
      name: ifaceName,
      sourceFile: relPath,
      isExported,
    },
  });

  rels.push({
    id: `${fileId}->declares_symbol->${ifaceId}`,
    type: RelationshipType.DeclaresSymbol,
    fromId: fileId,
    toId: ifaceId,
  });
}

function extractMethodSymbol(
  node: ts.MethodDeclaration,
  className: string,
  classId: string,
  relPath: string,
  nodes: GraphNode[],
  rels: GraphRelationship[],
): void {
  const methodName = ts.isIdentifier(node.name) ? node.name.text : null;
  if (!methodName) return;

  const qualifiedName = `${className}.${methodName}`;
  const methodId = makeSemanticNodeId(relPath, 'Method', qualifiedName);
  const modifiers = ts.getModifiers(node) ?? [];
  const isPublic = !modifiers.some(
    (m) => m.kind === ts.SyntaxKind.PrivateKeyword || m.kind === ts.SyntaxKind.ProtectedKeyword,
  );
  const isStatic = modifiers.some((m) => m.kind === ts.SyntaxKind.StaticKeyword);

  let returnType: string | null = null;
  if (node.type) {
    try {
      returnType = node.type.getText();
    } catch {
      returnType = null;
    }
  }

  nodes.push({
    id: methodId,
    label: NodeLabel.Method,
    properties: {
      id: methodId,
      name: methodName,
      className,
      sourceFile: relPath,
      isPublic,
      isStatic,
      returnType,
    },
  });

  rels.push({
    id: `${classId}->has_method->${methodId}`,
    type: RelationshipType.HasMethod,
    fromId: classId,
    toId: methodId,
  });

  // Extract CALLS_METHOD relationships from the method body
  extractMethodCallRelationships(node, methodId, className, relPath, rels);
}

/**
 * Walk a method body and emit CALLS_METHOD relationships for:
 * - `this.methodName()`         → same-class call (toId resolved directly)
 * - `this.dep.methodName()`     → cross-object call (pendingTargetName for normalizer resolution)
 * The `line` property (1-based) marks where in the source the call appears.
 */
function extractMethodCallRelationships(
  methodNode: ts.MethodDeclaration,
  methodId: string,
  className: string,
  relPath: string,
  rels: GraphRelationship[],
): void {
  if (!methodNode.body) return;

  const sourceFile = methodNode.getSourceFile();

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const propAccess = node.expression;
      const calleeName = ts.isIdentifier(propAccess.name) ? propAccess.name.text : null;
      if (!calleeName) {
        ts.forEachChild(node, visit);
        return;
      }

      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart());
      const lineNumber = line + 1; // convert to 1-based

      if (propAccess.expression.kind === ts.SyntaxKind.ThisKeyword) {
        // this.methodName() — call within the same class
        const targetId = makeSemanticNodeId(relPath, 'Method', `${className}.${calleeName}`);
        rels.push({
          id: `${methodId}->calls->${targetId}:${lineNumber}`,
          type: RelationshipType.CallsMethod,
          fromId: methodId,
          toId: targetId,
          properties: { line: lineNumber, callee: calleeName },
        });
      } else if (
        ts.isPropertyAccessExpression(propAccess.expression) &&
        propAccess.expression.expression.kind === ts.SyntaxKind.ThisKeyword &&
        ts.isIdentifier(propAccess.expression.name)
      ) {
        // this.dep.methodName() — call on an injected dependency
        const depName = propAccess.expression.name.text;
        rels.push({
          id: `${methodId}->calls->${depName}.${calleeName}:${lineNumber}`,
          type: RelationshipType.CallsMethod,
          fromId: methodId,
          toId: '',
          pendingTargetName: calleeName,
          properties: { line: lineNumber, callee: calleeName, via: depName },
        });
      }
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(methodNode.body, visit);
}

function extractPropertySymbol(
  node: ts.PropertyDeclaration,
  className: string,
  classId: string,
  relPath: string,
  nodes: GraphNode[],
  rels: GraphRelationship[],
): void {
  const propName = ts.isIdentifier(node.name) ? node.name.text : null;
  if (!propName) return;

  const qualifiedName = `${className}.${propName}`;
  const propId = makeSemanticNodeId(relPath, 'Property', qualifiedName);
  const modifiers = ts.getModifiers(node) ?? [];
  const isPublic = !modifiers.some(
    (m) => m.kind === ts.SyntaxKind.PrivateKeyword || m.kind === ts.SyntaxKind.ProtectedKeyword,
  );
  const isStatic = modifiers.some((m) => m.kind === ts.SyntaxKind.StaticKeyword);

  const decorators = ts.getDecorators(node) ?? [];
  const isInput = decorators.some((d) => {
    if (!ts.isCallExpression(d.expression)) return false;
    return getDecoratorName(d.expression) === 'Input';
  });
  const isOutput = decorators.some((d) => {
    if (!ts.isCallExpression(d.expression)) return false;
    return getDecoratorName(d.expression) === 'Output';
  });

  let type: string | null = null;
  if (node.type) {
    try {
      type = node.type.getText();
    } catch {
      type = null;
    }
  }

  nodes.push({
    id: propId,
    label: NodeLabel.Property,
    properties: {
      id: propId,
      name: propName,
      className,
      sourceFile: relPath,
      isPublic,
      isStatic,
      isInput,
      isOutput,
      type,
    },
  });

  rels.push({
    id: `${classId}->has_property->${propId}`,
    type: RelationshipType.HasProperty,
    fromId: classId,
    toId: propId,
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

/** Like getStringProp but also handles NoSubstitutionTemplateLiteral (backtick strings without expressions). */
function getTemplateProp(
  meta: ts.ObjectLiteralExpression | null,
  key: string,
): string | undefined {
  if (!meta) return undefined;
  for (const prop of meta.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    if (!isPropertyNamed(prop, key)) continue;
    if (ts.isStringLiteral(prop.initializer)) return prop.initializer.text;
    if (ts.isNoSubstitutionTemplateLiteral(prop.initializer)) return prop.initializer.text;
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
