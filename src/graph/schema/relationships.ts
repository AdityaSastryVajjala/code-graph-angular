/**
 * Relationship type registry.
 * Maps RelationshipType enum values to their Neo4j Cypher type strings.
 */

import { RelationshipType } from '../../core/types/graph-ir.js';

export const RELATIONSHIP_TYPES: Record<RelationshipType, string> = {
  [RelationshipType.BelongsToFile]: 'BELONGS_TO_FILE',
  [RelationshipType.UsesComponent]: 'USES_COMPONENT',
  [RelationshipType.UsesDirective]: 'USES_DIRECTIVE',
  [RelationshipType.UsesPipe]: 'USES_PIPE',
  [RelationshipType.HasStyle]: 'HAS_STYLE',
  [RelationshipType.Declares]: 'DECLARES',
  [RelationshipType.Imports]: 'IMPORTS',
  [RelationshipType.Exports]: 'EXPORTS',
  [RelationshipType.Bootstraps]: 'BOOTSTRAPS',
  [RelationshipType.Provides]: 'PROVIDES',
  [RelationshipType.Injects]: 'INJECTS',
  [RelationshipType.LoadsComponent]: 'LOADS_COMPONENT',
  [RelationshipType.LoadsModule]: 'LOADS_MODULE',
  [RelationshipType.LoadsLazyComponent]: 'LOADS_LAZY_COMPONENT',
  [RelationshipType.LoadsLazyModule]: 'LOADS_LAZY_MODULE',
  [RelationshipType.ChildOf]: 'CHILD_OF',
  [RelationshipType.RouteIn]: 'ROUTE_IN',
  [RelationshipType.Tests]: 'TESTS',
  [RelationshipType.UsesExternal]: 'USES_EXTERNAL',
  // Phase 2 — semantic relationships
  [RelationshipType.DeclaresSymbol]: 'DECLARES_SYMBOL',
  [RelationshipType.HasMethod]: 'HAS_METHOD',
  [RelationshipType.HasProperty]: 'HAS_PROPERTY',
  [RelationshipType.Implements]: 'IMPLEMENTS',
  [RelationshipType.Extends]: 'EXTENDS',
  [RelationshipType.UsesTemplate]: 'USES_TEMPLATE',
  [RelationshipType.BindsTo]: 'BINDS_TO',
  [RelationshipType.RoutesTo]: 'ROUTES_TO',
  [RelationshipType.LazyLoads]: 'LAZY_LOADS',
  // Phase 3 — workspace and template binding relationships
  [RelationshipType.BelongsToProject]: 'BELONGS_TO_PROJECT',
  [RelationshipType.ProjectDependsOn]: 'PROJECT_DEPENDS_ON',
  [RelationshipType.TemplateBindsProperty]: 'TEMPLATE_BINDS_PROPERTY',
  [RelationshipType.TemplateBindsEvent]: 'TEMPLATE_BINDS_EVENT',
  [RelationshipType.TemplateTwoWayBinds]: 'TEMPLATE_TWO_WAY_BINDS',
  [RelationshipType.TemplateUsesDirective]: 'TEMPLATE_USES_DIRECTIVE',
  [RelationshipType.TemplateUsesPipe]: 'TEMPLATE_USES_PIPE',
  // Phase 3 — method call tracking
  [RelationshipType.CallsMethod]: 'CALLS_METHOD',
  // Phase 4 — migration intelligence
  [RelationshipType.HasFinding]: 'HAS_FINDING',
  [RelationshipType.FindingGenerates]: 'FINDING_GENERATES',
  [RelationshipType.MigrationOrder]: 'MIGRATION_ORDER',
  [RelationshipType.WorkItemDependsOn]: 'WORK_ITEM_DEPENDS_ON',
  // Phase 5 — file-level dependency graph
  [RelationshipType.ImportsFrom]: 'IMPORTS_FROM',
};
