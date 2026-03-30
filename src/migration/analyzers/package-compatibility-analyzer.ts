/**
 * Phase 5 — Package Compatibility Analyzer
 * Step 0 of MigrationRunner: evaluates Angular-adjacent dependencies from
 * package.json against a target Angular major version using COMPATIBILITY_RULES.
 *
 * No external network calls are made. Output is deterministic per input.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import * as semver from 'semver';
import { Driver } from 'neo4j-driver';
import { getSession } from '../../graph/db/connection.js';
import { FindingNode } from '../../graph/schema/nodes.js';
import { buildFinding, buildFindingId } from '../finding-builder.js';
import { findRule } from '../compatibility/compatibility-rules.js';
import { logger } from '../../shared/logger.js';

export interface PackageCompatibilityResult {
  findings: FindingNode[];
  packagesAnalyzed: number;
  blockersFound: number;
  risksFound: number;
}

/** @internal — exported for unit tests */
export type ClassificationCode =
  | 'PKG_INCOMPATIBLE_PEER'
  | 'PKG_MAJOR_UPGRADE_REQUIRED'
  | 'PKG_UNVERIFIED_COMPAT'
  | null;

/**
 * Classify a single package against the target Angular major.
 * Returns null when the package is compatible (no finding needed).
 */
export function classifyPackage(
  installedVersion: string,
  targetMajor: number,
  pattern: string,
): ClassificationCode {
  const rule = findRule(pattern);
  if (!rule) return null; // not Angular-adjacent

  // Unresolvable version strings → unverified
  const trimmed = installedVersion.trim();
  if (!trimmed || trimmed === '*' || trimmed === 'latest' || trimmed === 'x') {
    return 'PKG_UNVERIFIED_COMPAT';
  }

  // Normalize range-prefixed installed versions (e.g. ^14.0.0 → 14.0.0)
  const coerced = semver.coerce(trimmed);
  if (!coerced) {
    return 'PKG_UNVERIFIED_COMPAT';
  }
  const resolvedInstalled = coerced.version;

  const requiredRange = rule.angularVersionMap[targetMajor];

  if (requiredRange === undefined) {
    // No rule entry for this Angular major — not evaluated
    return null;
  }

  if (requiredRange === null) {
    // null entry → unknown compatibility
    return 'PKG_UNVERIFIED_COMPAT';
  }

  if (semver.satisfies(resolvedInstalled, requiredRange)) {
    return null; // compatible, no finding
  }

  // Not satisfied — determine sub-classification
  const minRequired = semver.minVersion(requiredRange);
  if (!minRequired) {
    return 'PKG_INCOMPATIBLE_PEER';
  }

  const installedMajor = semver.major(resolvedInstalled);
  const requiredMajor = semver.major(minRequired);

  if (installedMajor < requiredMajor) {
    return 'PKG_MAJOR_UPGRADE_REQUIRED';
  }

  return 'PKG_INCOMPATIBLE_PEER';
}

export class PackageCompatibilityAnalyzer {
  constructor(
    private readonly driver: Driver,
    private readonly appDb: string,
  ) {}

  async analyze(
    workspaceRootPath: string,
    targetAngularVersion: string,
    migrationRunId: string,
  ): Promise<PackageCompatibilityResult> {
    const targetMajor = parseInt(targetAngularVersion, 10);
    if (isNaN(targetMajor)) {
      logger.warn('pkg_compat_invalid_target', { targetAngularVersion });
      return { findings: [], packagesAnalyzed: 0, blockersFound: 0, risksFound: 0 };
    }

    // Read package.json
    const packageJsonPath = join(workspaceRootPath, 'package.json');
    let packageJson: Record<string, unknown>;
    try {
      const raw = readFileSync(packageJsonPath, 'utf-8');
      packageJson = JSON.parse(raw) as Record<string, unknown>;
    } catch (err) {
      logger.warn('pkg_compat_missing_package_json', {
        path: packageJsonPath,
        error: err instanceof Error ? err.message : String(err),
      });
      return { findings: [], packagesAnalyzed: 0, blockersFound: 0, risksFound: 0 };
    }

    // Merge dependencies + devDependencies, deduplicate by package name
    const deps: Record<string, string> = {};
    const depSection = packageJson['dependencies'];
    const devSection = packageJson['devDependencies'];

    if (depSection && typeof depSection === 'object') {
      for (const [name, version] of Object.entries(depSection as Record<string, string>)) {
        deps[name] = version;
      }
    }
    if (devSection && typeof devSection === 'object') {
      for (const [name, version] of Object.entries(devSection as Record<string, string>)) {
        if (!(name in deps)) {
          deps[name] = version;
        }
      }
    }

    // Fetch ApplicationNode.id from the graph
    const appNodeId = await this.fetchApplicationNodeId();

    const findings: FindingNode[] = [];

    for (const [packageName, installedVersion] of Object.entries(deps)) {
      const code = classifyPackage(installedVersion, targetMajor, packageName);
      if (!code) continue;

      const rule = findRule(packageName);
      const requiredRange = rule?.angularVersionMap[targetMajor] ?? undefined;

      const base = buildFinding({
        affectedNodeId: appNodeId,
        reasonCode: code,
        scope: 'production',
        migrationRunId,
      });

      // Augment with package-specific fields
      const finding: FindingNode = {
        ...base,
        // Override the id to be package-specific (include packageName for uniqueness per package)
        id: buildFindingId(`${appNodeId}::${packageName}`, code, 'production'),
        packageName,
        installedVersion: installedVersion.trim(),
        requiredVersion: requiredRange ?? undefined,
        targetAngularVersion,
      };

      findings.push(finding);
    }

    const blockersFound = findings.filter((f) => f.type === 'blocker').length;
    const risksFound = findings.filter((f) => f.type === 'risk').length;
    const packagesAnalyzed = Object.keys(deps).filter((name) => findRule(name) !== undefined).length;

    return { findings, packagesAnalyzed, blockersFound, risksFound };
  }

  private async fetchApplicationNodeId(): Promise<string> {
    const session = getSession(this.driver, this.appDb);
    try {
      const result = await session.run(
        'MATCH (a:Application) RETURN a.id AS id LIMIT 1',
      );
      const id = result.records[0]?.get('id') as string | undefined;
      return id ?? `app::${this.appDb}`;
    } finally {
      await session.close();
    }
  }
}
