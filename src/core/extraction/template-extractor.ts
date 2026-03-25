/**
 * TemplateExtractor — extracts Angular template relationships.
 * Uses @angular/compiler's parseTemplate() for accurate AST-based extraction.
 *
 * @angular/compiler is ESM-only, so it must be loaded via dynamic import()
 * rather than a static require() (which would fail in a CommonJS build).
 */

import type {
  TmplAstElement,
  TmplAstTemplate,
  TmplAstNode,
  TmplAstBoundAttribute,
  TmplAstBoundEvent,
  TmplAstBoundText,
  BindingPipe,
  ASTWithSource,
} from '@angular/compiler';

// Lazily resolved once; shared across all calls.
// Use Function() to prevent TypeScript's CommonJS transform from rewriting
// the dynamic import() into require(), which fails for ESM-only packages.
let compilerModule: typeof import('@angular/compiler') | null = null;
async function getCompiler(): Promise<typeof import('@angular/compiler')> {
  if (!compilerModule) {
    compilerModule = await (Function('return import("@angular/compiler")')() as Promise<typeof import('@angular/compiler')>);
  }
  return compilerModule;
}
import { createHash } from 'crypto';
import { makeSemanticNodeId } from './ts-extractor.js';
import {
  GraphIR,
  GraphNode,
  GraphRelationship,
  NodeLabel,
  RelationshipType,
  SelectorMap,
} from '../types/graph-ir.js';
// Phase 3 typed relationship types (re-exported from RelationshipType for clarity)
const {
  TemplateBindsProperty,
  TemplateBindsEvent,
  TemplateTwoWayBinds,
  TemplateUsesDirective,
  TemplateUsesPipe,
} = RelationshipType;
import { logger } from '../../shared/logger.js';

function makeRelId(...parts: string[]): string {
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 16);
}

/**
 * Phase 2 — generate a deterministic Template node ID.
 * Inline templates use the .ts sourceFile path; external templates use the .html path.
 */
export function makeTemplateNodeId(
  sourceFile: string,
  componentName: string,
  _templateType: 'inline' | 'external',
): string {
  return makeSemanticNodeId(sourceFile, 'Template', componentName);
}

/** Known component members map: memberName → { nodeId, kind } */
export type ComponentMembersMap = Map<string, { nodeId: string; kind: 'method' | 'property' }>;

/**
 * Phase 2 — extract Template node and BINDS_TO edges.
 *
 * @param templateContent   Raw HTML / inline template string
 * @param templateUrl       Used for error reporting and ID generation. For inline templates this
 *                          is the component .ts path; for external templates it is the .html path.
 * @param componentRelPath  Relative path to the owning component .ts file
 * @param componentName     Name of the owning component class
 * @param componentNodeId   Graph node ID of the owning Component node
 * @param knownMembers      Map of member name → { nodeId, kind } for BINDS_TO resolution
 */
export async function extractTemplateBindings(
  templateContent: string,
  templateUrl: string,
  componentRelPath: string,
  componentName: string,
  componentNodeId: string,
  knownMembers: ComponentMembersMap,
): Promise<GraphIR> {
  const { parseTemplate, TmplAstBoundText, TmplAstBoundAttribute, TmplAstBoundEvent } =
    await getCompiler();

  const nodes: GraphNode[] = [];
  const relationships: GraphRelationship[] = [];

  // Determine template type: external if templateUrl ends in .html
  const templateType: 'inline' | 'external' = templateUrl.endsWith('.html') ? 'external' : 'inline';
  const sourceFile = templateType === 'external' ? templateUrl : componentRelPath;
  const templateId = makeTemplateNodeId(sourceFile, componentName, templateType);

  nodes.push({
    id: templateId,
    label: NodeLabel.Template,
    properties: {
      id: templateId,
      componentName,
      sourceFile,
      templateType,
      templatePath: templateType === 'external' ? templateUrl : null,
    },
  });

  relationships.push({
    id: `${componentNodeId}->uses_template->${templateId}`,
    type: RelationshipType.UsesTemplate,
    fromId: componentNodeId,
    toId: templateId,
  });

  // Parse template
  let parsed;
  try {
    parsed = parseTemplate(templateContent, templateUrl, { preserveWhitespaces: false });
  } catch (err) {
    logger.warn('template_parse_error', {
      filePath: templateUrl,
      error: err instanceof Error ? err.message : String(err),
    });
    return { nodes, relationships, sourceFile };
  }

  if (parsed.errors && parsed.errors.length > 0) {
    for (const e of parsed.errors) {
      logger.warn(`template_parse_warning in ${templateUrl}: ${e.msg}`);
    }
  }

  // Walk the template AST and emit BINDS_TO edges
  walkBindings(
    parsed.nodes,
    templateId,
    componentRelPath,
    componentName,
    knownMembers,
    relationships,
    { TmplAstBoundText, TmplAstBoundAttribute, TmplAstBoundEvent },
  );

  return { nodes, relationships, sourceFile };
}

type BindingClasses = {
  TmplAstBoundText: typeof TmplAstBoundText;
  TmplAstBoundAttribute: typeof TmplAstBoundAttribute;
  TmplAstBoundEvent: typeof TmplAstBoundEvent;
};

function walkBindings(
  tmplNodes: TmplAstNode[],
  templateId: string,
  componentRelPath: string,
  componentName: string,
  knownMembers: ComponentMembersMap,
  rels: GraphRelationship[],
  classes: BindingClasses,
): void {
  const { TmplAstBoundText, TmplAstBoundAttribute, TmplAstBoundEvent } = classes;

  for (const node of tmplNodes) {
    // Interpolation: {{ expr }}
    if (node instanceof TmplAstBoundText) {
      const identifiers = extractIdentifiersFromAst((node.value as ASTWithSource).ast);
      for (const name of identifiers) {
        emitBindsTo(name, 'interpolation', String((node.value as ASTWithSource).source ?? name), templateId, componentRelPath, componentName, knownMembers, rels);
      }
    }

    // Property / two-way binding + event binding live on TmplAstElement / TmplAstTemplate
    const asAny = node as unknown as Record<string, unknown>;

    // inputs: BoundAttribute[]
    if (Array.isArray(asAny['inputs'])) {
      for (const bound of asAny['inputs'] as unknown[]) {
        if (bound instanceof TmplAstBoundAttribute) {
          const isTwoWay = bound.name === 'ngModel';
          const bindingType = isTwoWay ? 'two-way' : 'property';
          const src = String((bound.value as ASTWithSource).source ?? bound.name);
          const identifiers = extractIdentifiersFromAst((bound.value as ASTWithSource).ast);
          for (const name of identifiers) {
            emitBindsTo(name, bindingType, src, templateId, componentRelPath, componentName, knownMembers, rels);
            // Phase 3: also emit typed binding relationship
            emitTypedBinding(name, isTwoWay ? TemplateTwoWayBinds : TemplateBindsProperty, bindingType, src, templateId, componentRelPath, componentName, knownMembers, rels);
          }
        }
      }
    }

    // outputs: BoundEvent[]
    if (Array.isArray(asAny['outputs'])) {
      for (const evt of asAny['outputs'] as unknown[]) {
        if (evt instanceof TmplAstBoundEvent) {
          const src = String((evt.handler as ASTWithSource).source ?? evt.name);
          const identifiers = extractIdentifiersFromAst((evt.handler as ASTWithSource).ast);
          for (const name of identifiers) {
            emitBindsTo(name, 'event', src, templateId, componentRelPath, componentName, knownMembers, rels);
            // Phase 3: also emit typed event binding relationship
            emitTypedBinding(name, TemplateBindsEvent, 'event', src, templateId, componentRelPath, componentName, knownMembers, rels);
          }
        }
      }
    }

    // Recurse into children
    if (Array.isArray(asAny['children'])) {
      walkBindings(
        asAny['children'] as TmplAstNode[],
        templateId,
        componentRelPath,
        componentName,
        knownMembers,
        rels,
        classes,
      );
    }
  }
}

function emitBindsTo(
  memberName: string,
  bindingType: string,
  expression: string,
  templateId: string,
  componentRelPath: string,
  componentName: string,
  knownMembers: ComponentMembersMap,
  rels: GraphRelationship[],
): void {
  const member = knownMembers.get(memberName);
  if (!member) {
    logger.warn('unresolved_template_binding', {
      filePath: componentRelPath,
      componentName,
      expression,
      memberName,
      reason: 'no matching method or property found on component',
    });
    return;
  }

  const relId = makeRelId(templateId, 'binds_to', member.nodeId, bindingType, expression);
  rels.push({
    id: relId,
    type: RelationshipType.BindsTo,
    fromId: templateId,
    toId: member.nodeId,
    properties: { bindingType, expression },
  });
}

function emitTypedBinding(
  memberName: string,
  relType: RelationshipType,
  bindingType: string,
  expression: string,
  templateId: string,
  _componentRelPath: string,
  _componentName: string,
  knownMembers: ComponentMembersMap,
  rels: GraphRelationship[],
): void {
  const member = knownMembers.get(memberName);
  if (!member) return; // already warned in emitBindsTo

  const relId = makeRelId(templateId, relType, member.nodeId, bindingType, expression);
  // Avoid duplicates if already exists
  if (rels.some((r) => r.id === relId)) return;
  rels.push({
    id: relId,
    type: relType,
    fromId: templateId,
    toId: member.nodeId,
    properties: { bindingType, expression, confidence: 'compiler' },
  });
}

/**
 * Best-effort extraction of simple identifier names from an Angular AST node.
 * Returns identifiers referenced in the expression (e.g. property reads, method calls).
 */
function extractIdentifiersFromAst(ast: unknown): string[] {
  if (!ast || typeof ast !== 'object') return [];
  const names: string[] = [];
  const seen = new Set<string>();

  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const n = node as Record<string, unknown>;
    const ctorName = (n['constructor'] as { name?: string } | undefined)?.name;

    if (ctorName === 'PropertyRead' || ctorName === 'MethodCall' || ctorName === 'SafePropertyRead' || ctorName === 'SafeMethodCall') {
      const name = n['name'] as string | undefined;
      // Only collect implicit receiver reads (receiver is ImplicitReceiver = component scope)
      const receiverCtor = ((n['receiver'] as Record<string, unknown> | null)?.['constructor'] as { name?: string } | undefined)?.name;
      if (name && (receiverCtor === 'ImplicitReceiver' || receiverCtor === 'ThisReceiver') && !seen.has(name)) {
        seen.add(name);
        names.push(name);
      }
    }

    for (const key of Object.keys(n)) {
      if (key === 'constructor') continue;
      const val = n[key];
      if (Array.isArray(val)) val.forEach(visit);
      else if (val && typeof val === 'object') visit(val);
    }
  };

  visit(ast);
  return names;
}

/**
 * Extract template relationships from HTML source.
 *
 * @param templateSource  Raw HTML content
 * @param templateUrl     Path used for error reporting (relative to app root)
 * @param ownerNodeId     Node ID of the Component that owns this template
 * @param ownerFilePath   Relative file path of the owning component
 * @param knownSelectors  Map of CSS selectors → { nodeId, kind }
 * @param appRoot         Absolute app root (for ID generation)
 */
export async function extractTemplate(
  templateSource: string,
  templateUrl: string,
  ownerNodeId: string,
  ownerFilePath: string,
  knownSelectors: SelectorMap,
): Promise<GraphIR> {
  const { parseTemplate, TmplAstElement, TmplAstTemplate, TmplAstBoundAttribute, TmplAstBoundEvent } =
    await getCompiler();

  const relationships: GraphRelationship[] = [];

  let parsed;
  try {
    parsed = parseTemplate(templateSource, templateUrl, {
      preserveWhitespaces: false,
    });
  } catch (err) {
    logger.warn(`Failed to parse template: ${templateUrl}`, {
      error: err instanceof Error ? err.message : String(err),
    });
    return { nodes: [], relationships: [], sourceFile: templateUrl };
  }

  if (parsed.errors && parsed.errors.length > 0) {
    for (const e of parsed.errors) {
      logger.warn(`Template parse warning in ${templateUrl}: ${e.msg}`);
    }
  }

  const classes = { TmplAstElement, TmplAstTemplate, TmplAstBoundAttribute, TmplAstBoundEvent };
  const externalNodes: GraphNode[] = [];
  walkNodes(parsed.nodes, ownerNodeId, ownerFilePath, knownSelectors, relationships, externalNodes, classes);

  return { nodes: externalNodes, relationships, sourceFile: templateUrl };
}

// ─── AST Walker ──────────────────────────────────────────────────────────────

type AstClasses = {
  TmplAstElement: typeof TmplAstElement;
  TmplAstTemplate: typeof TmplAstTemplate;
  TmplAstBoundAttribute: typeof TmplAstBoundAttribute;
  TmplAstBoundEvent: typeof TmplAstBoundEvent;
};

function walkNodes(
  nodes: TmplAstNode[],
  ownerNodeId: string,
  ownerFilePath: string,
  knownSelectors: SelectorMap,
  rels: GraphRelationship[],
  externalNodes: GraphNode[],
  classes: AstClasses,
): void {
  const { TmplAstElement, TmplAstTemplate, TmplAstBoundAttribute, TmplAstBoundEvent } = classes;
  for (const node of nodes) {
    if (node instanceof TmplAstElement || node instanceof TmplAstTemplate) {
      const tagName = node instanceof TmplAstElement ? node.name : node.tagName ?? '';

      // Check element name against known component/directive selectors
      const elementMatch = knownSelectors.get(tagName);
      if (elementMatch) {
        if (elementMatch.kind === 'component') {
          const relId = makeRelId(ownerNodeId, 'uses_component', elementMatch.nodeId);
          rels.push({
            id: relId,
            type: RelationshipType.UsesComponent,
            fromId: ownerNodeId,
            toId: elementMatch.nodeId,
            properties: { inTemplate: true },
          });
        } else {
          const relId = makeRelId(ownerNodeId, 'uses_directive', elementMatch.nodeId);
          rels.push({
            id: relId,
            type: RelationshipType.UsesDirective,
            fromId: ownerNodeId,
            toId: elementMatch.nodeId,
            properties: { selector: tagName },
          });
          // Phase 3: also emit typed directive relationship
          const typedRelId = makeRelId(ownerNodeId, 'template_uses_directive', elementMatch.nodeId);
          rels.push({
            id: typedRelId,
            type: TemplateUsesDirective,
            fromId: ownerNodeId,
            toId: elementMatch.nodeId,
            properties: { selector: tagName, usageType: 'element' },
          });
        }
      } else if (tagName.includes('-') && !isNativeElement(tagName)) {
        // Unknown custom element — record as ExternalComponent node + USES_EXTERNAL edge.
        const extId = makeRelId('external', tagName);
        externalNodes.push({
          id: extId,
          label: NodeLabel.ExternalComponent,
          properties: {
            id: extId,
            selector: tagName,
            package: inferPackage(tagName),
          },
        });
        rels.push({
          id: makeRelId(ownerNodeId, 'uses_external', extId),
          type: RelationshipType.UsesExternal,
          fromId: ownerNodeId,
          toId: extId,
        });
        logger.debug(`External selector in template ${ownerFilePath}: <${tagName}>`);
      }

      // Check attribute selectors on this element
      const attrs = node instanceof TmplAstElement ? node.attributes : node.attributes;
      for (const attr of attrs) {
        const attrSelector = `[${attr.name}]`;
        const attrMatch = knownSelectors.get(attrSelector) ?? knownSelectors.get(attr.name);
        if (attrMatch && attrMatch.kind === 'directive') {
          const relId = makeRelId(ownerNodeId, 'uses_directive_attr', attrMatch.nodeId, attr.name);
          rels.push({
            id: relId,
            type: RelationshipType.UsesDirective,
            fromId: ownerNodeId,
            toId: attrMatch.nodeId,
            properties: { selector: attr.name },
          });
          // Phase 3: also emit typed directive relationship for attribute directive
          const typedRelId = makeRelId(ownerNodeId, 'template_uses_directive_attr', attrMatch.nodeId, attr.name);
          rels.push({
            id: typedRelId,
            type: TemplateUsesDirective,
            fromId: ownerNodeId,
            toId: attrMatch.nodeId,
            properties: { selector: attr.name, usageType: 'attribute', confidence: 'compiler' },
          });
        }
      }

      // Extract host property bindings and host listener events
      const boundAttrs = node instanceof TmplAstElement ? node.inputs : node.inputs;
      const hostBindings: string[] = [];
      for (const bound of boundAttrs) {
        if (bound instanceof TmplAstBoundAttribute) {
          hostBindings.push(`[${bound.name}]`);
        }
      }
      const boundEvents = node instanceof TmplAstElement ? node.outputs : node.outputs;
      for (const evt of boundEvents) {
        if (evt instanceof TmplAstBoundEvent) {
          hostBindings.push(`(${evt.name})`);
        }
      }

      // Extract pipe usages from bound attributes
      const allBound = node instanceof TmplAstElement ? node.inputs : node.inputs;
      for (const bound of allBound) {
        if (bound instanceof TmplAstBoundAttribute) {
          extractPipeUsages(bound.value as ASTWithSource, ownerNodeId, knownSelectors, rels);
        }
      }

      // Recurse into children
      const children = node instanceof TmplAstElement ? node.children : node.children;
      walkNodes(children, ownerNodeId, ownerFilePath, knownSelectors, rels, externalNodes, classes);
    }
  }
}

function extractPipeUsages(
  ast: ASTWithSource,
  ownerNodeId: string,
  knownSelectors: SelectorMap,
  rels: GraphRelationship[],
): void {
  if (!ast || !ast.ast) return;

  const visitAst = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const n = node as Record<string, unknown>;

    if (n['constructor'] && (n['constructor'] as { name?: string }).name === 'BindingPipe') {
      const pipeNode = n as unknown as BindingPipe;
      const pipeName = pipeNode.name;
      // Find pipe by name in selector map
      for (const [selector, entry] of knownSelectors) {
        if (selector === pipeName && entry.kind !== 'component') {
          const relId = makeRelId(ownerNodeId, 'uses_pipe', entry.nodeId);
          rels.push({
            id: relId,
            type: RelationshipType.UsesPipe,
            fromId: ownerNodeId,
            toId: entry.nodeId,
            properties: { expression: pipeName },
          });
          // Phase 3: also emit typed pipe relationship
          const typedRelId = makeRelId(ownerNodeId, 'template_uses_pipe', entry.nodeId, pipeName);
          rels.push({
            id: typedRelId,
            type: TemplateUsesPipe,
            fromId: ownerNodeId,
            toId: entry.nodeId,
            properties: { expression: pipeName },
          });
        }
      }
      visitAst(pipeNode.exp);
    }

    for (const key of Object.keys(n)) {
      if (key === 'constructor') continue;
      const val = n[key];
      if (Array.isArray(val)) val.forEach(visitAst);
      else if (val && typeof val === 'object') visitAst(val);
    }
  };

  visitAst(ast.ast);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PACKAGE_PREFIXES: Array<[string, string]> = [
  ['p-', 'primeng'],
  ['mat-', '@angular/material'],
  ['mdc-', '@angular/material'],
  ['nz-', 'ng-zorro-antd'],
  ['nb-', '@nebular/theme'],
  ['ion-', '@ionic/angular'],
  ['igx-', 'igniteui-angular'],
  ['ng-', 'ng-*'],
  ['dx-', 'devextreme-angular'],
  ['kendo-', '@progress/kendo-angular'],
  ['po-', '@po-ui/ng-components'],
];

function inferPackage(selector: string): string {
  for (const [prefix, pkg] of PACKAGE_PREFIXES) {
    if (selector.startsWith(prefix)) return pkg;
  }
  return 'unknown';
}

const NATIVE_ELEMENTS = new Set([
  'div', 'span', 'p', 'a', 'button', 'input', 'form', 'label', 'select', 'option',
  'textarea', 'table', 'tr', 'td', 'th', 'thead', 'tbody', 'tfoot', 'ul', 'ol', 'li',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'footer', 'main', 'nav', 'section',
  'article', 'aside', 'img', 'video', 'audio', 'canvas', 'svg', 'path',
]);

function isNativeElement(tagName: string): boolean {
  return NATIVE_ELEMENTS.has(tagName.toLowerCase());
}
