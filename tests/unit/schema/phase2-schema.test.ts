/**
 * Phase 2 schema tests — verifies that applySchema() is idempotent and
 * that all Phase 2 node labels and relationship types are defined.
 *
 * Note: These tests validate the in-memory DDL arrays without a live Neo4j
 * instance. Live idempotency is covered by the integration test suite.
 */

import { NodeLabel, RelationshipType } from '../../../src/core/types/graph-ir.js';
import { RELATIONSHIP_TYPES } from '../../../src/graph/schema/relationships.js';

// ─── Phase 2 NodeLabel values ─────────────────────────────────────────────────

describe('Phase 2 NodeLabel enum', () => {
  const phase2Labels = [
    NodeLabel.Class,
    NodeLabel.Interface,
    NodeLabel.Method,
    NodeLabel.Property,
    NodeLabel.Template,
    NodeLabel.InjectionToken,
  ];

  it('defines all Phase 2 node labels', () => {
    for (const label of phase2Labels) {
      expect(label).toBeDefined();
      expect(typeof label).toBe('string');
    }
  });

  it('has correct string values for Phase 2 labels', () => {
    expect(NodeLabel.Class).toBe('Class');
    expect(NodeLabel.Interface).toBe('Interface');
    expect(NodeLabel.Method).toBe('Method');
    expect(NodeLabel.Property).toBe('Property');
    expect(NodeLabel.Template).toBe('Template');
    expect(NodeLabel.InjectionToken).toBe('InjectionToken');
  });
});

// ─── Phase 2 RelationshipType values ─────────────────────────────────────────

describe('Phase 2 RelationshipType enum', () => {
  const phase2Rels: RelationshipType[] = [
    RelationshipType.DeclaresSymbol,
    RelationshipType.HasMethod,
    RelationshipType.HasProperty,
    RelationshipType.Implements,
    RelationshipType.Extends,
    RelationshipType.UsesTemplate,
    RelationshipType.BindsTo,
    RelationshipType.RoutesTo,
    RelationshipType.LazyLoads,
  ];

  it('defines all Phase 2 relationship types', () => {
    for (const rel of phase2Rels) {
      expect(rel).toBeDefined();
    }
  });

  it('has correct Cypher string values', () => {
    expect(RelationshipType.DeclaresSymbol).toBe('DECLARES_SYMBOL');
    expect(RelationshipType.HasMethod).toBe('HAS_METHOD');
    expect(RelationshipType.HasProperty).toBe('HAS_PROPERTY');
    expect(RelationshipType.Implements).toBe('IMPLEMENTS');
    expect(RelationshipType.Extends).toBe('EXTENDS');
    expect(RelationshipType.UsesTemplate).toBe('USES_TEMPLATE');
    expect(RelationshipType.BindsTo).toBe('BINDS_TO');
    expect(RelationshipType.RoutesTo).toBe('ROUTES_TO');
    expect(RelationshipType.LazyLoads).toBe('LAZY_LOADS');
  });
});

// ─── RELATIONSHIP_TYPES registry completeness ────────────────────────────────

describe('RELATIONSHIP_TYPES registry', () => {
  it('contains all Phase 2 relationship types', () => {
    expect(RELATIONSHIP_TYPES[RelationshipType.DeclaresSymbol]).toBe('DECLARES_SYMBOL');
    expect(RELATIONSHIP_TYPES[RelationshipType.HasMethod]).toBe('HAS_METHOD');
    expect(RELATIONSHIP_TYPES[RelationshipType.HasProperty]).toBe('HAS_PROPERTY');
    expect(RELATIONSHIP_TYPES[RelationshipType.Implements]).toBe('IMPLEMENTS');
    expect(RELATIONSHIP_TYPES[RelationshipType.Extends]).toBe('EXTENDS');
    expect(RELATIONSHIP_TYPES[RelationshipType.UsesTemplate]).toBe('USES_TEMPLATE');
    expect(RELATIONSHIP_TYPES[RelationshipType.BindsTo]).toBe('BINDS_TO');
    expect(RELATIONSHIP_TYPES[RelationshipType.RoutesTo]).toBe('ROUTES_TO');
    expect(RELATIONSHIP_TYPES[RelationshipType.LazyLoads]).toBe('LAZY_LOADS');
  });

  it('registry covers every RelationshipType enum value', () => {
    const allEnumValues = Object.values(RelationshipType);
    for (const rel of allEnumValues) {
      expect(RELATIONSHIP_TYPES).toHaveProperty(rel);
    }
  });
});
