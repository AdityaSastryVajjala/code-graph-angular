/**
 * GraphIR — Intermediate Representation
 *
 * All extractors produce GraphIR objects. The AngularNormalizer merges them
 * before any database write occurs, decoupling extraction from persistence.
 */

// ─── Node Labels ────────────────────────────────────────────────────────────

export enum NodeLabel {
  Application = 'Application',
  File = 'File',
  Component = 'Component',
  Service = 'Service',
  NgModule = 'NgModule',
  Directive = 'Directive',
  Pipe = 'Pipe',
  Route = 'Route',
  StyleFile = 'StyleFile',
  SpecFile = 'SpecFile',
  ExternalComponent = 'ExternalComponent',
  IndexMeta = '_IndexMeta',
  // Phase 2 — semantic symbols
  Class = 'Class',
  Interface = 'Interface',
  Method = 'Method',
  Property = 'Property',
  Template = 'Template',
  InjectionToken = 'InjectionToken',
  // Phase 3 — workspace
  Project = 'Project',
  // Phase 4 — migration intelligence
  Finding = 'Finding',
  WorkItemSeed = 'WorkItemSeed',
}

// ─── Relationship Types ──────────────────────────────────────────────────────

export enum RelationshipType {
  // File ownership
  BelongsToFile = 'BELONGS_TO_FILE',

  // Template relationships
  UsesComponent = 'USES_COMPONENT',
  UsesDirective = 'USES_DIRECTIVE',
  UsesPipe = 'USES_PIPE',
  HasStyle = 'HAS_STYLE',

  // Module relationships
  Declares = 'DECLARES',
  Imports = 'IMPORTS',
  Exports = 'EXPORTS',
  Bootstraps = 'BOOTSTRAPS',
  Provides = 'PROVIDES',

  // Dependency injection
  Injects = 'INJECTS',

  // Routing
  LoadsComponent = 'LOADS_COMPONENT',
  LoadsModule = 'LOADS_MODULE',
  LoadsLazyComponent = 'LOADS_LAZY_COMPONENT',
  LoadsLazyModule = 'LOADS_LAZY_MODULE',
  ChildOf = 'CHILD_OF',
  RouteIn = 'ROUTE_IN',

  // Spec coverage
  Tests = 'TESTS',

  // External / third-party usage
  UsesExternal = 'USES_EXTERNAL',

  // Phase 2 — semantic relationships
  // Use DECLARES_SYMBOL for File→Class/Interface to avoid collision with NgModule DECLARES
  DeclaresSymbol = 'DECLARES_SYMBOL',
  HasMethod = 'HAS_METHOD',
  HasProperty = 'HAS_PROPERTY',
  Implements = 'IMPLEMENTS',
  Extends = 'EXTENDS',
  UsesTemplate = 'USES_TEMPLATE',
  BindsTo = 'BINDS_TO',
  RoutesTo = 'ROUTES_TO',
  LazyLoads = 'LAZY_LOADS',
  // Phase 3 — workspace and template binding relationships
  BelongsToProject = 'BELONGS_TO_PROJECT',
  ProjectDependsOn = 'PROJECT_DEPENDS_ON',
  TemplateBindsProperty = 'TEMPLATE_BINDS_PROPERTY',
  TemplateBindsEvent = 'TEMPLATE_BINDS_EVENT',
  TemplateTwoWayBinds = 'TEMPLATE_TWO_WAY_BINDS',
  TemplateUsesDirective = 'TEMPLATE_USES_DIRECTIVE',
  TemplateUsesPipe = 'TEMPLATE_USES_PIPE',
  // Phase 3 — method call tracking
  CallsMethod = 'CALLS_METHOD',
  // Phase 4 — migration intelligence
  HasFinding = 'HAS_FINDING',
  FindingGenerates = 'FINDING_GENERATES',
  MigrationOrder = 'MIGRATION_ORDER',
  WorkItemDependsOn = 'WORK_ITEM_DEPENDS_ON',
}

// ─── Core GraphIR Types ──────────────────────────────────────────────────────

export interface GraphNode {
  id: string;
  label: NodeLabel;
  properties: Record<string, unknown>;
}

export interface GraphRelationship {
  id: string;
  type: RelationshipType;
  fromId: string;
  toId: string;
  /** Class name to resolve to a toId after all nodes are known. Set by extractors
   *  for cross-file references where the target file path is not known at extraction time. */
  pendingTargetName?: string;
  properties?: Record<string, unknown>;
}

/**
 * The primary output of every extractor.
 * sourceFile is relative to the application root.
 */
export interface GraphIR {
  nodes: GraphNode[];
  relationships: GraphRelationship[];
  sourceFile: string;
}

// ─── Change Detection Types ──────────────────────────────────────────────────

export type ChangeKind = 'added' | 'modified' | 'deleted';

export interface ChangedFile {
  path: string;       // relative to app root
  kind: ChangeKind;
}

export interface ChangedFileSet {
  files: ChangedFile[];
  detectedAt: Date;
}

// ─── Domain Types ────────────────────────────────────────────────────────────

export interface AngularApp {
  name: string;
  rootPath: string;           // absolute path
  sourceRoot: string;         // relative to rootPath
  angularVersion: string;     // semver or 'unknown'
  isStandaloneBootstrap: boolean;
}

export interface SourceFileSet {
  tsFiles: string[];          // absolute paths
  htmlFiles: string[];
  specFiles: string[];
}

/** Map from CSS selector string to the node ID of the entity that declares it. */
export type SelectorMap = Map<string, { nodeId: string; kind: 'component' | 'directive' }>;

// ─── Stats Types ─────────────────────────────────────────────────────────────

export interface WriteStats {
  written: number;
  duration: number;   // ms
}

export interface IndexStats {
  nodeCount: number;
  edgeCount: number;
  fileCount: number;
  duration: number;   // ms
  databaseName: string;
}

export interface IncrementalStats {
  deltaNodes: number;
  deltaEdges: number;
  changedFileCount: number;
  duration: number;   // ms
}

export type IndexMetaStatus = 'indexing' | 'complete' | 'absent';

// ─── Phase 3: Impact & Workspace Types ───────────────────────────────────────

export type ImpactClass =
  | 'direct'            // node directly depends on the changed file/symbol (1 hop)
  | 'indirect'          // node transitively depends via strong edges (2+ hops)
  | 'template-derived'  // dependency path passes through a Template node
  | 'structural';       // dependency is via Extends/Implements only (no runtime reference)

export interface ImpactResult {
  nodeId: string;
  nodeLabel: string;
  nodeName: string;
  filePath: string;
  impactClass: ImpactClass;
  depth: number;
  edgeChain: string[];
  isTestFile: boolean;
  projectId: string | null;
}

export interface TraversalOptions {
  maxDepth?: number;
  edgeKinds?: string[];
  projectId?: string;
  includeTests?: boolean;
  summaryMode?: boolean;
}

export interface ImpactSummary {
  directCount: number;
  indirectCount: number;
  templateDerivedCount: number;
  structuralCount: number;
  totalCount: number;
}

export interface MetricSnapshot {
  entityId: string;
  entityLabel: string;
  entityName: string;
  inboundCount: number;
  outboundCount: number;
  injectionCount: number;
  templateUsageCount: number;
  selectorUsageCount: number;
  projectDependencyCount: number;
  projectConsumerCount: number;
}
