/**
 * Idempotent schema DDL — constraints and indexes.
 * All statements use IF NOT EXISTS so this can be re-run safely on any database.
 */

import { Session } from 'neo4j-driver';

const CONSTRAINTS = [
  // Phase 4 — migration intelligence
  'CREATE CONSTRAINT IF NOT EXISTS FOR (n:Finding) REQUIRE n.id IS UNIQUE',
  'CREATE CONSTRAINT IF NOT EXISTS FOR (n:WorkItemSeed) REQUIRE n.id IS UNIQUE',
  // Phase 3 — workspace
  'CREATE CONSTRAINT IF NOT EXISTS FOR (n:Project) REQUIRE n.id IS UNIQUE',
  'CREATE CONSTRAINT IF NOT EXISTS FOR (n:Application) REQUIRE n.id IS UNIQUE',
  'CREATE CONSTRAINT IF NOT EXISTS FOR (n:File) REQUIRE n.id IS UNIQUE',
  'CREATE CONSTRAINT IF NOT EXISTS FOR (n:Component) REQUIRE n.id IS UNIQUE',
  'CREATE CONSTRAINT IF NOT EXISTS FOR (n:Service) REQUIRE n.id IS UNIQUE',
  'CREATE CONSTRAINT IF NOT EXISTS FOR (n:NgModule) REQUIRE n.id IS UNIQUE',
  'CREATE CONSTRAINT IF NOT EXISTS FOR (n:Directive) REQUIRE n.id IS UNIQUE',
  'CREATE CONSTRAINT IF NOT EXISTS FOR (n:Pipe) REQUIRE n.id IS UNIQUE',
  'CREATE CONSTRAINT IF NOT EXISTS FOR (n:Route) REQUIRE n.id IS UNIQUE',
  'CREATE CONSTRAINT IF NOT EXISTS FOR (n:StyleFile) REQUIRE n.id IS UNIQUE',
  'CREATE CONSTRAINT IF NOT EXISTS FOR (n:SpecFile) REQUIRE n.id IS UNIQUE',
  'CREATE CONSTRAINT IF NOT EXISTS FOR (n:ExternalComponent) REQUIRE n.id IS UNIQUE',
  // Phase 2 — semantic symbol constraints
  'CREATE CONSTRAINT IF NOT EXISTS FOR (n:Class) REQUIRE n.id IS UNIQUE',
  'CREATE CONSTRAINT IF NOT EXISTS FOR (n:Interface) REQUIRE n.id IS UNIQUE',
  'CREATE CONSTRAINT IF NOT EXISTS FOR (n:Method) REQUIRE n.id IS UNIQUE',
  'CREATE CONSTRAINT IF NOT EXISTS FOR (n:Property) REQUIRE n.id IS UNIQUE',
  'CREATE CONSTRAINT IF NOT EXISTS FOR (n:Template) REQUIRE n.id IS UNIQUE',
  'CREATE CONSTRAINT IF NOT EXISTS FOR (n:InjectionToken) REQUIRE n.id IS UNIQUE',
];

const INDEXES = [
  'CREATE INDEX IF NOT EXISTS FOR (n:Component) ON (n.selector)',
  'CREATE INDEX IF NOT EXISTS FOR (n:Component) ON (n.name)',
  'CREATE INDEX IF NOT EXISTS FOR (n:Component) ON (n.filePath)',
  'CREATE INDEX IF NOT EXISTS FOR (n:Service) ON (n.name)',
  'CREATE INDEX IF NOT EXISTS FOR (n:Service) ON (n.filePath)',
  'CREATE INDEX IF NOT EXISTS FOR (n:NgModule) ON (n.name)',
  'CREATE INDEX IF NOT EXISTS FOR (n:Directive) ON (n.selector)',
  'CREATE INDEX IF NOT EXISTS FOR (n:Pipe) ON (n.pipeName)',
  'CREATE INDEX IF NOT EXISTS FOR (n:Route) ON (n.path)',
  'CREATE INDEX IF NOT EXISTS FOR (n:ExternalComponent) ON (n.selector)',
  'CREATE INDEX IF NOT EXISTS FOR (n:ExternalComponent) ON (n.package)',
  // Phase 2 — semantic symbol indexes
  'CREATE INDEX IF NOT EXISTS FOR (n:Class) ON (n.name)',
  'CREATE INDEX IF NOT EXISTS FOR (n:Class) ON (n.sourceFile)',
  'CREATE INDEX IF NOT EXISTS FOR (n:Interface) ON (n.name)',
  'CREATE INDEX IF NOT EXISTS FOR (n:Interface) ON (n.sourceFile)',
  'CREATE INDEX IF NOT EXISTS FOR (n:Method) ON (n.name)',
  'CREATE INDEX IF NOT EXISTS FOR (n:Method) ON (n.className)',
  'CREATE INDEX IF NOT EXISTS FOR (n:Method) ON (n.sourceFile)',
  'CREATE INDEX IF NOT EXISTS FOR (n:Property) ON (n.name)',
  'CREATE INDEX IF NOT EXISTS FOR (n:Property) ON (n.className)',
  'CREATE INDEX IF NOT EXISTS FOR (n:Property) ON (n.sourceFile)',
  'CREATE INDEX IF NOT EXISTS FOR (n:Template) ON (n.componentName)',
  'CREATE INDEX IF NOT EXISTS FOR (n:Template) ON (n.sourceFile)',
  'CREATE INDEX IF NOT EXISTS FOR (n:InjectionToken) ON (n.name)',
  'CREATE INDEX IF NOT EXISTS FOR (n:InjectionToken) ON (n.sourceFile)',
  // Phase 3 — workspace indexes
  'CREATE INDEX IF NOT EXISTS FOR (n:Project) ON (n.name, n.workspaceRoot)',
  'CREATE INDEX IF NOT EXISTS FOR (n:Project) ON (n.type)',
  'CREATE INDEX IF NOT EXISTS FOR (n:Project) ON (n.sourceRoot)',
  // Phase 3 — method call tracking
  'CREATE INDEX IF NOT EXISTS FOR ()-[r:CALLS_METHOD]-() ON (r.line)',
  // Phase 4 — migration intelligence
  'CREATE INDEX IF NOT EXISTS FOR (n:Finding) ON (n.affectedNodeId)',
  'CREATE INDEX IF NOT EXISTS FOR (n:Finding) ON (n.severity)',
  'CREATE INDEX IF NOT EXISTS FOR (n:Finding) ON (n.category)',
  'CREATE INDEX IF NOT EXISTS FOR (n:Finding) ON (n.type)',
  'CREATE INDEX IF NOT EXISTS FOR (n:Finding) ON (n.scope)',
  'CREATE INDEX IF NOT EXISTS FOR (n:Finding) ON (n.migrationRunId)',
  'CREATE INDEX IF NOT EXISTS FOR (n:WorkItemSeed) ON (n.priority)',
  'CREATE INDEX IF NOT EXISTS FOR (n:WorkItemSeed) ON (n.migrationRunId)',
  'CREATE INDEX IF NOT EXISTS FOR (n:Component) ON (n.isStandaloneCandidate)',
  'CREATE INDEX IF NOT EXISTS FOR (n:NgModule) ON (n.moduleComplexityScore)',
  'CREATE INDEX IF NOT EXISTS FOR (n:NgModule) ON (n.standaloneMigrationFeasibility)',
  'CREATE INDEX IF NOT EXISTS FOR (n:NgModule) ON (n.migrationOrderIndex)',
];

/**
 * Apply all constraints and indexes to the current database.
 * Safe to call multiple times — all statements are idempotent.
 */
export async function applySchema(session: Session): Promise<void> {
  for (const ddl of [...CONSTRAINTS, ...INDEXES]) {
    await session.run(ddl);
  }
}
