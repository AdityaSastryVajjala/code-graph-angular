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
import {
  GraphIR,
  GraphNode,
  GraphRelationship,
  NodeLabel,
  RelationshipType,
  SelectorMap,
} from '../types/graph-ir.js';
import { logger } from '../../shared/logger.js';

function makeRelId(...parts: string[]): string {
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 16);
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
