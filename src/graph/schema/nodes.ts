/**
 * Node label property type definitions.
 * These interfaces define the shape of each node stored in Neo4j.
 */

export interface ApplicationNode {
  id: string;
  name: string;
  rootPath: string;
  angularVersion: string;
  isStandaloneBootstrap: boolean;
}

export interface FileNode {
  id: string;
  filePath: string;
  fileType: 'ts' | 'html' | 'css' | 'scss' | 'less' | 'spec';
  contentHash?: string;
}

export interface ComponentNode {
  id: string;
  name: string;
  selector: string;
  filePath: string;
  isStandalone: boolean;
  templateType: 'inline' | 'external';
  templatePath?: string;
  changeDetection?: 'Default' | 'OnPush';
}

export interface ServiceNode {
  id: string;
  name: string;
  filePath: string;
  providedIn?: 'root' | 'any' | 'platform' | 'none';
}

export interface NgModuleNode {
  id: string;
  name: string;
  filePath: string;
}

export interface DirectiveNode {
  id: string;
  name: string;
  selector: string;
  filePath: string;
  isStandalone: boolean;
  hostBindings?: string[];
}

export interface PipeNode {
  id: string;
  name: string;
  pipeName: string;
  filePath: string;
  isStandalone: boolean;
  isPure?: boolean;
}

export interface RouteNode {
  id: string;
  path: string;
  filePath: string;
  isLazy: boolean;
  isDynamic: boolean;
}

export interface StyleFileNode {
  id: string;
  filePath: string;
  format: 'css' | 'scss' | 'less' | 'sass';
}

export interface SpecFileNode {
  id: string;
  filePath: string;
}

export interface ExternalComponentNode {
  id: string;
  selector: string;
  package: string;    // inferred from selector prefix, e.g. "p-*" → "primeng"
}

export interface IndexMetaNode {
  status: 'indexing' | 'complete';
  startedAt: string;       // ISO datetime string
  completedAt?: string;
  indexerVersion: string;
}

// ─── Phase 2: Semantic Symbol Nodes ──────────────────────────────────────────

export interface ClassNode {
  id: string;           // filePath::Class::ClassName
  name: string;
  sourceFile: string;   // relative path (for incremental updates)
  isAbstract: boolean;
  isExported: boolean;
}

export interface InterfaceNode {
  id: string;           // filePath::Interface::InterfaceName
  name: string;
  sourceFile: string;
  isExported: boolean;
}

export interface MethodNode {
  id: string;           // filePath::Method::ClassName.methodName
  name: string;
  className: string;
  sourceFile: string;
  isPublic: boolean;
  isStatic: boolean;
  returnType: string | null;
}

export interface PropertyNode {
  id: string;           // filePath::Property::ClassName.propName
  name: string;
  className: string;
  sourceFile: string;
  isPublic: boolean;
  isStatic: boolean;
  isInput: boolean;
  isOutput: boolean;
  type: string | null;
}

export interface TemplateNode {
  id: string;           // filePath::Template::ComponentName
  componentName: string;
  sourceFile: string;   // .ts path (inline) or .html path (external)
  templateType: 'inline' | 'external';
  templatePath: string | null;
}

export interface InjectionTokenNode {
  id: string;           // filePath::InjectionToken::tokenVarName
  name: string;
  description: string | null;
  sourceFile: string;
}

// ─── Phase 3: Workspace Nodes ─────────────────────────────────────────────────

export interface ProjectNode {
  id: string;           // sha256(workspaceRoot + '::' + projectName).slice(0, 16)
  name: string;
  type: 'app' | 'lib';
  category: 'feature' | 'domain' | 'shared' | 'utility' | null;
  sourceRoot: string;
  tags: string[];
  workspaceRoot: string;
}
