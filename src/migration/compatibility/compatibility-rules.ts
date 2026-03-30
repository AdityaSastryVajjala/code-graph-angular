/**
 * Phase 5 — Package Compatibility Analyzer
 * Bundled rule set mapping known Angular-adjacent packages to their version
 * compatibility requirements per Angular major version.
 *
 * Rules are evaluated in order. Exact matches take priority over prefix matches.
 * No external network calls are made at runtime.
 */

export interface PackageRule {
  /** Exact package name (e.g. '@ngrx/store') or name prefix (e.g. 'ngx-'). */
  pattern: string;
  matchType: 'exact' | 'prefix';
  /**
   * Maps target Angular major version to the minimum required package semver range.
   * null means no known Angular peer dependency declared → PKG_UNVERIFIED_COMPAT.
   * An absent key means this package is not evaluated against that Angular version.
   */
  angularVersionMap: Record<number, string | null>;
}

/**
 * Look up the first matching rule for a package name.
 * Exact matches are checked before prefix matches.
 * Returns undefined if no rule matches (package is not Angular-adjacent).
 */
export function findRule(packageName: string): PackageRule | undefined {
  const exactMatch = COMPATIBILITY_RULES.find(
    (r) => r.matchType === 'exact' && r.pattern === packageName,
  );
  if (exactMatch) return exactMatch;

  return COMPATIBILITY_RULES.find(
    (r) => r.matchType === 'prefix' && packageName.startsWith(r.pattern),
  );
}

/**
 * Bundled compatibility rule set.
 * Covers Angular majors 14–18. Extend by adding entries to this array.
 * No changes to the analyzer or classifier are required when adding rules.
 */
export const COMPATIBILITY_RULES: PackageRule[] = [
  // ─── NgRx ────────────────────────────────────────────────────────────────
  {
    pattern: '@ngrx/store',
    matchType: 'exact',
    angularVersionMap: { 14: '>=14.0.0', 15: '>=15.0.0', 16: '>=16.0.0', 17: '>=17.0.0', 18: '>=18.0.0' },
  },
  {
    pattern: '@ngrx/effects',
    matchType: 'exact',
    angularVersionMap: { 14: '>=14.0.0', 15: '>=15.0.0', 16: '>=16.0.0', 17: '>=17.0.0', 18: '>=18.0.0' },
  },
  {
    pattern: '@ngrx/entity',
    matchType: 'exact',
    angularVersionMap: { 14: '>=14.0.0', 15: '>=15.0.0', 16: '>=16.0.0', 17: '>=17.0.0', 18: '>=18.0.0' },
  },
  {
    pattern: '@ngrx/router-store',
    matchType: 'exact',
    angularVersionMap: { 14: '>=14.0.0', 15: '>=15.0.0', 16: '>=16.0.0', 17: '>=17.0.0', 18: '>=18.0.0' },
  },
  {
    pattern: '@ngrx/component-store',
    matchType: 'exact',
    angularVersionMap: { 14: '>=14.0.0', 15: '>=15.0.0', 16: '>=16.0.0', 17: '>=17.0.0', 18: '>=18.0.0' },
  },
  {
    pattern: '@ngrx/signals',
    matchType: 'exact',
    angularVersionMap: { 17: '>=17.0.0', 18: '>=18.0.0' },
  },

  // ─── Angular Material / CDK ───────────────────────────────────────────────
  {
    pattern: '@angular/material',
    matchType: 'exact',
    angularVersionMap: { 14: '>=14.0.0', 15: '>=15.0.0', 16: '>=16.0.0', 17: '>=17.0.0', 18: '>=18.0.0' },
  },
  {
    pattern: '@angular/cdk',
    matchType: 'exact',
    angularVersionMap: { 14: '>=14.0.0', 15: '>=15.0.0', 16: '>=16.0.0', 17: '>=17.0.0', 18: '>=18.0.0' },
  },
  {
    pattern: '@angular/flex-layout',
    matchType: 'exact',
    // No official support beyond Angular 15; deprecated
    angularVersionMap: { 14: '>=14.0.0', 15: '>=15.0.0', 16: null, 17: null, 18: null },
  },

  // ─── Rx-Angular ──────────────────────────────────────────────────────────
  {
    pattern: '@rx-angular/state',
    matchType: 'exact',
    angularVersionMap: { 14: '>=14.0.0', 15: '>=15.0.0', 16: '>=16.0.0', 17: '>=17.0.0', 18: '>=18.0.0' },
  },
  {
    pattern: '@rx-angular/push',
    matchType: 'exact',
    angularVersionMap: { 14: '>=14.0.0', 15: '>=15.0.0', 16: '>=16.0.0', 17: '>=17.0.0', 18: '>=18.0.0' },
  },
  {
    pattern: '@rx-angular/cdk',
    matchType: 'exact',
    angularVersionMap: { 14: '>=14.0.0', 15: '>=15.0.0', 16: '>=16.0.0', 17: '>=17.0.0', 18: '>=18.0.0' },
  },
  {
    pattern: '@rx-angular/',
    matchType: 'prefix',
    angularVersionMap: { 14: '>=14.0.0', 15: '>=15.0.0', 16: '>=16.0.0', 17: '>=17.0.0', 18: '>=18.0.0' },
  },

  // ─── Angular Fire ────────────────────────────────────────────────────────
  {
    pattern: '@angular/fire',
    matchType: 'exact',
    angularVersionMap: { 14: '>=7.0.0', 15: '>=7.0.0', 16: '>=16.0.0', 17: '>=17.0.0', 18: '>=18.0.0' },
  },

  // ─── Prefix matches (broad ecosystem coverage) ───────────────────────────
  {
    pattern: 'ngx-',
    matchType: 'prefix',
    // Most ngx-* packages do not declare explicit Angular peer deps in a queryable way
    angularVersionMap: { 14: null, 15: null, 16: null, 17: null, 18: null },
  },
];
