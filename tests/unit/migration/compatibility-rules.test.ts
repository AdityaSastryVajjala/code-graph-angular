/**
 * Unit tests for compatibility-rules.ts (T007)
 * Verifies the COMPATIBILITY_RULES array and findRule() lookup logic.
 */

import { findRule, COMPATIBILITY_RULES } from '../../../src/migration/compatibility/compatibility-rules.js';

describe('findRule', () => {
  describe('exact-match lookup', () => {
    it('returns the rule for @ngrx/store', () => {
      const rule = findRule('@ngrx/store');
      expect(rule).toBeDefined();
      expect(rule!.pattern).toBe('@ngrx/store');
      expect(rule!.matchType).toBe('exact');
    });

    it('returns the rule for @angular/material', () => {
      const rule = findRule('@angular/material');
      expect(rule).toBeDefined();
      expect(rule!.matchType).toBe('exact');
    });

    it('returns the rule for @angular/cdk', () => {
      const rule = findRule('@angular/cdk');
      expect(rule).toBeDefined();
      expect(rule!.matchType).toBe('exact');
    });

    it('returns the rule for @ngrx/effects', () => {
      const rule = findRule('@ngrx/effects');
      expect(rule).toBeDefined();
      expect(rule!.matchType).toBe('exact');
    });

    it('returns the rule for @rx-angular/state', () => {
      const rule = findRule('@rx-angular/state');
      expect(rule).toBeDefined();
      expect(rule!.matchType).toBe('exact');
    });
  });

  describe('prefix-match lookup', () => {
    it('matches ngx-* packages via prefix', () => {
      const rule = findRule('ngx-toastr');
      expect(rule).toBeDefined();
      expect(rule!.matchType).toBe('prefix');
      expect(rule!.pattern).toBe('ngx-');
    });

    it('matches ngx-bootstrap via prefix', () => {
      const rule = findRule('ngx-bootstrap');
      expect(rule).toBeDefined();
      expect(rule!.matchType).toBe('prefix');
    });

    it('matches @rx-angular/unknown-pkg via prefix fallback when no exact rule', () => {
      const rule = findRule('@rx-angular/unknown-pkg');
      expect(rule).toBeDefined();
      expect(rule!.matchType).toBe('prefix');
      expect(rule!.pattern).toBe('@rx-angular/');
    });
  });

  describe('no-match returns undefined', () => {
    it('returns undefined for lodash (not Angular-adjacent)', () => {
      expect(findRule('lodash')).toBeUndefined();
    });

    it('returns undefined for rxjs (core Angular dep, not in rule set)', () => {
      expect(findRule('rxjs')).toBeUndefined();
    });

    it('returns undefined for @angular/core (Angular itself, not in rule set)', () => {
      expect(findRule('@angular/core')).toBeUndefined();
    });

    it('returns undefined for completely unknown packages', () => {
      expect(findRule('some-unknown-package-xyz')).toBeUndefined();
    });
  });

  describe('exact match takes priority over prefix', () => {
    it('@rx-angular/state exact rule is returned, not the @rx-angular/ prefix rule', () => {
      const rule = findRule('@rx-angular/state');
      expect(rule!.matchType).toBe('exact');
      expect(rule!.pattern).toBe('@rx-angular/state');
    });
  });

  describe('angularVersionMap correctness', () => {
    it('@ngrx/store has correct required range for Angular 17', () => {
      const rule = findRule('@ngrx/store');
      expect(rule!.angularVersionMap[17]).toBe('>=17.0.0');
    });

    it('@ngrx/store has correct required range for Angular 15', () => {
      const rule = findRule('@ngrx/store');
      expect(rule!.angularVersionMap[15]).toBe('>=15.0.0');
    });

    it('@angular/material has correct required range for Angular 18', () => {
      const rule = findRule('@angular/material');
      expect(rule!.angularVersionMap[18]).toBe('>=18.0.0');
    });

    it('@angular/flex-layout has null for Angular 17 (deprecated)', () => {
      const rule = findRule('@angular/flex-layout');
      expect(rule!.angularVersionMap[17]).toBeNull();
    });

    it('ngx-* rules have null for all Angular versions (unverified)', () => {
      const rule = findRule('ngx-toastr');
      expect(rule!.angularVersionMap[15]).toBeNull();
      expect(rule!.angularVersionMap[17]).toBeNull();
    });
  });

  describe('COMPATIBILITY_RULES array structure', () => {
    it('all rules have required fields', () => {
      for (const rule of COMPATIBILITY_RULES) {
        expect(rule.pattern).toBeTruthy();
        expect(['exact', 'prefix']).toContain(rule.matchType);
        expect(rule.angularVersionMap).toBeDefined();
      }
    });

    it('no duplicate exact patterns', () => {
      const exactPatterns = COMPATIBILITY_RULES
        .filter((r) => r.matchType === 'exact')
        .map((r) => r.pattern);
      const unique = new Set(exactPatterns);
      expect(unique.size).toBe(exactPatterns.length);
    });
  });
});
