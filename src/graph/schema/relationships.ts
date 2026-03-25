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
};
