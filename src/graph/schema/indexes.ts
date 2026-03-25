/**
 * Idempotent schema DDL — constraints and indexes.
 * All statements use IF NOT EXISTS so this can be re-run safely on any database.
 */

import { Session } from 'neo4j-driver';

const CONSTRAINTS = [
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
