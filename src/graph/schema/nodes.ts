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
