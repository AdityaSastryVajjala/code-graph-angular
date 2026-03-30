/**
 * Phase 4 — Migration Intelligence
 * Confidence rules: fixed, rule-based confidence scores keyed by reason code.
 * Each entry defines the deterministic confidence value for a detection pattern.
 */

export interface ConfidenceRule {
  confidenceScore: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  category: 'angular' | 'rxjs' | 'template' | 'architecture' | 'package';
  description: string;
  recommendedAction: string;
}

export const CONFIDENCE_RULES: Record<string, ConfidenceRule> = {
  // ─── Angular Patterns ────────────────────────────────────────────────────

  ANG_NGMODULE_HEAVY: {
    confidenceScore: 0.95,
    severity: 'medium',
    category: 'angular',
    description: 'Component/Directive/Pipe uses NgModule-based architecture with isStandalone=false.',
    recommendedAction: 'Migrate to standalone APIs using the Angular standalone migration schematic.',
  },

  ANG_ENTRY_COMPONENTS: {
    confidenceScore: 0.90,
    severity: 'high',
    category: 'angular',
    description: 'NgModule uses entryComponents — deprecated since Angular 9 (Ivy).',
    recommendedAction: 'Remove entryComponents array; components are resolved dynamically by Ivy without it.',
  },

  ANG_CLASS_BASED_GUARD: {
    confidenceScore: 0.92,
    severity: 'medium',
    category: 'angular',
    description: 'Class implements a deprecated guard interface (CanActivate, CanDeactivate, etc.).',
    recommendedAction: 'Replace with a functional guard using the inject() function.',
  },

  ANG_CLASS_BASED_RESOLVER: {
    confidenceScore: 0.92,
    severity: 'medium',
    category: 'angular',
    description: 'Class implements the deprecated Resolve<T> interface.',
    recommendedAction: 'Replace with a functional resolver using the ResolveFn<T> type.',
  },

  ANG_MODULE_WITH_PROVIDERS: {
    confidenceScore: 0.88,
    severity: 'low',
    category: 'angular',
    description: 'Method returns ModuleWithProviders — pattern discouraged in standalone architectures.',
    recommendedAction: 'Consider migrating to standalone providers via ApplicationConfig or importProvidersFrom.',
  },

  ANG_LEGACY_ROUTER_CONFIG: {
    confidenceScore: 0.85,
    severity: 'medium',
    category: 'angular',
    description: 'Router configured via forRoot()/forChild() in NgModule imports.',
    recommendedAction: 'Migrate to provideRouter() in standalone bootstrap or ApplicationConfig.',
  },

  ANG_APP_INITIALIZER_CLASS: {
    confidenceScore: 0.80,
    severity: 'low',
    category: 'angular',
    description: 'APP_INITIALIZER used with a class-based factory provider.',
    recommendedAction: 'Replace with a functional initializer using provideAppInitializer().',
  },

  ANG_CD_DEFAULT: {
    confidenceScore: 0.90,
    severity: 'low',
    category: 'angular',
    description: 'Component uses ChangeDetectionStrategy.Default — potential performance issue.',
    recommendedAction: 'Migrate to OnPush change detection for better performance with standalone components.',
  },

  ANG_BARREL_COUPLING: {
    confidenceScore: 0.75,
    severity: 'low',
    category: 'architecture',
    description: 'File participates in multi-level barrel re-exports creating tight coupling.',
    recommendedAction: 'Flatten barrel exports or use direct imports to reduce coupling.',
  },

  ANG_COMPONENT_FACTORY: {
    confidenceScore: 0.90,
    severity: 'high',
    category: 'angular',
    description: 'ComponentFactory or ComponentFactoryResolver usage detected — removed in Angular 15+.',
    recommendedAction: 'Replace with ViewContainerRef.createComponent() which accepts a component type directly.',
  },

  // ─── RxJS Patterns ───────────────────────────────────────────────────────

  RXJS_PATCH_IMPORTS: {
    confidenceScore: 0.99,
    severity: 'high',
    category: 'rxjs',
    description: 'RxJS patch operator import detected (rxjs/add/operator/*).',
    recommendedAction: 'Replace with pipeable operators from rxjs/operators.',
  },

  RXJS_NON_PIPEABLE: {
    confidenceScore: 0.85,
    severity: 'high',
    category: 'rxjs',
    description: 'Non-pipeable operator usage detected (pre-RxJS 6 style method chaining).',
    recommendedAction: 'Refactor to use pipe() with pipeable operators from rxjs/operators.',
  },

  RXJS_SUBSCRIPTION_LEAK: {
    confidenceScore: 0.70,
    severity: 'high',
    category: 'rxjs',
    description: 'subscribe() call detected without corresponding unsubscribe, takeUntil, or async pipe.',
    recommendedAction: 'Use takeUntilDestroyed(), async pipe, or manual unsubscribe in ngOnDestroy.',
  },

  RXJS_SUBJECT_BUS: {
    confidenceScore: 0.65,
    severity: 'medium',
    category: 'rxjs',
    description: 'Service uses Subject as an event bus injected into multiple consumers — anti-pattern.',
    recommendedAction: 'Consider using a signal-based state management approach or NgRx ComponentStore.',
  },

  RXJS_TO_PROMISE: {
    confidenceScore: 0.95,
    severity: 'medium',
    category: 'rxjs',
    description: 'toPromise() usage detected — deprecated in RxJS 7, removed in RxJS 8.',
    recommendedAction: 'Replace with firstValueFrom() or lastValueFrom() from rxjs.',
  },

  RXJS_THROW_ERROR_STRING: {
    confidenceScore: 0.95,
    severity: 'medium',
    category: 'rxjs',
    description: 'throwError() called with a string argument — deprecated API.',
    recommendedAction: 'Replace with throwError(() => new Error(message)) factory function form.',
  },

  // ─── Template Patterns ───────────────────────────────────────────────────

  TMPL_NGMODEL_MISSING_IMPORT: {
    confidenceScore: 0.90,
    severity: 'high',
    category: 'template',
    description: 'Template uses ngModel but standalone component does not import FormsModule.',
    recommendedAction: 'Add FormsModule to the standalone component\'s imports array.',
  },

  TMPL_PIPE_MISSING_IMPORT: {
    confidenceScore: 0.90,
    severity: 'high',
    category: 'template',
    description: 'Template uses a pipe but standalone component does not import it.',
    recommendedAction: 'Add the pipe class to the standalone component\'s imports array.',
  },

  TMPL_ASYNC_WITHOUT_ONPUSH: {
    confidenceScore: 0.75,
    severity: 'low',
    category: 'template',
    description: 'Template uses async pipe but component does not use OnPush change detection.',
    recommendedAction: 'Enable ChangeDetectionStrategy.OnPush for optimal async pipe performance.',
  },

  TMPL_OLD_STRUCTURAL_DIRECTIVE: {
    confidenceScore: 0.75,
    severity: 'low',
    category: 'template',
    description: 'Template uses legacy structural directive syntax (*ngIf, *ngFor, *ngSwitch).',
    recommendedAction: 'Consider migrating to built-in control flow syntax (@if, @for, @switch) introduced in Angular 17.',
  },

  // ─── Cycle / Architecture ────────────────────────────────────────────────

  ARCH_CIRCULAR_DEPENDENCY: {
    confidenceScore: 1.0,
    severity: 'critical',
    category: 'architecture',
    description: 'Circular dependency detected in module import chain — migration ordering is blocked.',
    recommendedAction: 'Resolve circular dependency before attempting standalone migration of affected modules.',
  },

  // ─── Phase 5: Package Compatibility ─────────────────────────────────────────

  PKG_INCOMPATIBLE_PEER: {
    confidenceScore: 1.0,
    severity: 'critical',
    category: 'package',
    description: 'Package version does not satisfy the required peer dependency range for the target Angular version.',
    recommendedAction: 'Review the package changelog and upgrade to a version compatible with the target Angular release.',
  },

  PKG_MAJOR_UPGRADE_REQUIRED: {
    confidenceScore: 0.85,
    severity: 'high',
    category: 'package',
    description: 'Package requires a major version upgrade to support the target Angular version. A compatible version is available.',
    recommendedAction: 'Plan a major upgrade of this package as part of the Angular migration.',
  },

  PKG_UNVERIFIED_COMPAT: {
    confidenceScore: 0.60,
    severity: 'medium',
    category: 'package',
    description: 'Package compatibility with the target Angular version cannot be verified from available metadata.',
    recommendedAction: 'Manually verify that this package supports the target Angular version before migrating.',
  },
};

/**
 * Look up confidence rules for a given reason code.
 * Throws if the reason code is not registered.
 */
export function getConfidenceRule(reasonCode: string): ConfidenceRule {
  const rule = CONFIDENCE_RULES[reasonCode];
  if (!rule) {
    throw new Error(`Unknown reason code: ${reasonCode}`);
  }
  return rule;
}
