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
