/**
 * ProjectDiscovery — locates Angular applications in a workspace or single-app directory.
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { AngularApp } from '../types/graph-ir.js';

/**
 * Walk up the directory tree from `startDir` to find a package.json
 * that contains `@angular/core`, then return its coerced semver string.
 * Returns 'unknown' when no suitable package.json is found.
 */
function readAngularVersion(startDir: string): string {
  let dir = resolve(startDir);
  const root = dirname(dir); // filesystem root guard

  while (dir !== root) {
    const pkgPath = join(dir, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>;
        const deps = {
          ...(pkg['dependencies'] as Record<string, string> | undefined ?? {}),
          ...(pkg['devDependencies'] as Record<string, string> | undefined ?? {}),
        };
        const raw = deps['@angular/core'];
        if (raw) {
          // Strip range prefixes (^, ~, >=, etc.) and return the bare version
          const match = raw.match(/(\d+\.\d+\.\d+(?:-[A-Za-z0-9.]+)?)/);
          if (match) return match[1];
          // Fallback: return everything after leading non-digit chars
          const coerced = raw.replace(/^[^0-9]*/, '');
          if (coerced) return coerced;
        }
      } catch {
        // malformed package.json — keep walking up
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }

  return 'unknown';
}

interface AngularJsonProject {
  projectType?: string;
  sourceRoot?: string;
  architect?: {
    build?: {
      options?: {
        main?: string;
      };
    };
  };
}

interface AngularJson {
  defaultProject?: string;
  projects?: Record<string, AngularJsonProject>;
}

interface NxProjectJson {
  name?: string;
  projectType?: string;
  sourceRoot?: string;
  tags?: string[];
}

export interface ProjectDiscovery {
  name: string;
  type: 'app' | 'lib';
  sourceRoot: string;
  tags: string[];
  configFile: string;
}

/**
 * Discover a single Angular application from an angular.json root.
 */
export function discoverApp(rootPath: string): AngularApp {
  const absRoot = resolve(rootPath);
  const angularJsonPath = join(absRoot, 'angular.json');

  if (!existsSync(angularJsonPath)) {
    // Could be an Nx app with project.json
    return discoverFromProjectJson(absRoot);
  }

  const angularJson: AngularJson = JSON.parse(readFileSync(angularJsonPath, 'utf-8'));
  const projects = angularJson.projects ?? {};
  const names = Object.keys(projects);

  if (names.length === 0) {
    throw new Error(`No projects found in ${angularJsonPath}`);
  }

  // Single-app: use defaultProject or first project
  const appName = angularJson.defaultProject ?? names[0];
  const project = projects[appName];

  if (!project) {
    throw new Error(`Project '${appName}' not found in ${angularJsonPath}`);
  }

  return buildAngularApp(appName, absRoot, project);
}

/**
 * Discover all projects (apps and libraries) from a workspace.
 * Reads angular.json for all entries, or nx.json + project.json files.
 * Leaves existing discoverWorkspace() function unchanged.
 */
export function discoverAllProjects(workspaceRoot: string): ProjectDiscovery[] {
  const absRoot = resolve(workspaceRoot);

  // Try Nx workspace first (nx.json + project.json)
  const nxJsonPath = join(absRoot, 'nx.json');
  if (existsSync(nxJsonPath)) {
    return discoverAllNxProjects(absRoot);
  }

  // Fall back to angular.json
  const angularJsonPath = join(absRoot, 'angular.json');
  if (existsSync(angularJsonPath)) {
    return discoverAllAngularProjects(absRoot);
  }

  return [];
}

function discoverAllAngularProjects(rootPath: string): ProjectDiscovery[] {
  const angularJsonPath = join(rootPath, 'angular.json');
  const angularJson: AngularJson = JSON.parse(readFileSync(angularJsonPath, 'utf-8'));
  const projects = angularJson.projects ?? {};

  return Object.entries(projects).map(([name, project]) => ({
    name,
    type: project.projectType === 'library' ? 'lib' : 'app',
    sourceRoot: project.sourceRoot ?? 'src',
    tags: [],
    configFile: angularJsonPath,
  }));
}

function discoverAllNxProjects(rootPath: string): ProjectDiscovery[] {
  const { readdirSync, statSync } = require('fs') as typeof import('fs');
  const results: ProjectDiscovery[] = [];

  const scanDir = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      const entryPath = join(dir, entry);
      if (!statSync(entryPath).isDirectory()) continue;
      const projectJsonPath = join(entryPath, 'project.json');
      if (existsSync(projectJsonPath)) {
        const projectJson: NxProjectJson = JSON.parse(readFileSync(projectJsonPath, 'utf-8'));
        const name = projectJson.name ?? entry;
        const type: 'app' | 'lib' = projectJson.projectType === 'library' ? 'lib' : 'app';
        results.push({
          name,
          type,
          sourceRoot: projectJson.sourceRoot ?? 'src',
          tags: projectJson.tags ?? [],
          configFile: projectJsonPath,
        });
      }
    }
  };

  scanDir(join(rootPath, 'apps'));
  scanDir(join(rootPath, 'libs'));
  return results;
}

/**
 * Discover all Angular applications in a workspace (angular.json multi-project or Nx).
 */
export function discoverWorkspace(rootPath: string): AngularApp[] {
  const absRoot = resolve(rootPath);

  // Try Nx workspace first
  const nxJsonPath = join(absRoot, 'nx.json');
  if (existsSync(nxJsonPath)) {
    return discoverNxWorkspace(absRoot);
  }

  // Fall back to angular.json multi-project
  const angularJsonPath = join(absRoot, 'angular.json');
  if (existsSync(angularJsonPath)) {
    return discoverAngularWorkspace(absRoot);
  }

  throw new Error(
    `No angular.json or nx.json found in ${absRoot}. ` +
    'Pass --app-root for a single application or --workspace for a workspace root.',
  );
}

// ─── Internals ────────────────────────────────────────────────────────────────

function discoverAngularWorkspace(rootPath: string): AngularApp[] {
  const angularJson: AngularJson = JSON.parse(
    readFileSync(join(rootPath, 'angular.json'), 'utf-8'),
  );
  const projects = angularJson.projects ?? {};

  return Object.entries(projects)
    .filter(([, p]) => p.projectType === 'application' || !p.projectType)
    .map(([name, project]) => buildAngularApp(name, rootPath, project));
}

function discoverNxWorkspace(rootPath: string): AngularApp[] {
  const appsDir = join(rootPath, 'apps');
  if (!existsSync(appsDir)) return [];

  const { readdirSync, statSync } = require('fs') as typeof import('fs');
  const entries = readdirSync(appsDir);
  const apps: AngularApp[] = [];

  for (const entry of entries) {
    const appDir = join(appsDir, entry);
    if (!statSync(appDir).isDirectory()) continue;

    const projectJsonPath = join(appDir, 'project.json');
    if (!existsSync(projectJsonPath)) continue;

    const projectJson: NxProjectJson = JSON.parse(readFileSync(projectJsonPath, 'utf-8'));

    // Only index applications, not libraries
    if (projectJson.projectType === 'library') continue;

    const name = projectJson.name ?? entry;
    apps.push({
      name,
      rootPath: appDir,
      sourceRoot: projectJson.sourceRoot ?? 'src',
      angularVersion: readAngularVersion(appDir),
      isStandaloneBootstrap: false,
    });
  }

  return apps;
}

function discoverFromProjectJson(appDir: string): AngularApp {
  const projectJsonPath = join(appDir, 'project.json');
  if (!existsSync(projectJsonPath)) {
    throw new Error(
      `No angular.json or project.json found in ${appDir}. ` +
      'Ensure this is an Angular application root.',
    );
  }
  const projectJson: NxProjectJson = JSON.parse(readFileSync(projectJsonPath, 'utf-8'));
  return {
    name: projectJson.name ?? appDir.split('/').pop() ?? 'app',
    rootPath: appDir,
    sourceRoot: projectJson.sourceRoot ?? 'src',
    angularVersion: readAngularVersion(appDir),
    isStandaloneBootstrap: false,
  };
}

function buildAngularApp(
  name: string,
  rootPath: string,
  project: AngularJsonProject,
): AngularApp {
  return {
    name,
    rootPath,
    sourceRoot: project.sourceRoot ?? 'src',
    angularVersion: readAngularVersion(rootPath),
    isStandaloneBootstrap: false,
  };
}
