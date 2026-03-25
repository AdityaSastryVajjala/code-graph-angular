import { classifyImpact } from '../../../src/impact/impact-classifier.js';

describe('classifyImpact', () => {
  describe('template-derived', () => {
    it('returns template-derived when any edge is TemplateBindsProperty', () => {
      expect(classifyImpact(['INJECTS', 'TEMPLATE_BINDS_PROPERTY'], 2)).toBe('template-derived');
    });

    it('returns template-derived when any edge is TemplateBindsEvent', () => {
      expect(classifyImpact(['TEMPLATE_BINDS_EVENT'], 1)).toBe('template-derived');
    });

    it('returns template-derived when any edge is TemplateTwoWayBinds', () => {
      expect(classifyImpact(['TEMPLATE_TWO_WAY_BINDS'], 1)).toBe('template-derived');
    });

    it('returns template-derived when any edge is TemplateUsesDirective', () => {
      expect(classifyImpact(['EXTENDS', 'TEMPLATE_USES_DIRECTIVE'], 2)).toBe('template-derived');
    });

    it('returns template-derived when any edge is TemplateUsesPipe', () => {
      expect(classifyImpact(['TEMPLATE_USES_PIPE'], 1)).toBe('template-derived');
    });

    it('returns template-derived when any edge is BINDS_TO', () => {
      expect(classifyImpact(['INJECTS', 'BINDS_TO'], 2)).toBe('template-derived');
    });

    it('prioritizes template-derived over structural', () => {
      expect(classifyImpact(['EXTENDS', 'TEMPLATE_BINDS_PROPERTY', 'IMPLEMENTS'], 3)).toBe('template-derived');
    });
  });

  describe('structural', () => {
    it('returns structural when all edges are EXTENDS', () => {
      expect(classifyImpact(['EXTENDS'], 1)).toBe('structural');
    });

    it('returns structural when all edges are IMPLEMENTS', () => {
      expect(classifyImpact(['IMPLEMENTS'], 1)).toBe('structural');
    });

    it('returns structural when all edges are DECLARES', () => {
      expect(classifyImpact(['DECLARES', 'DECLARES'], 2)).toBe('structural');
    });

    it('returns structural when all edges are IMPORTS', () => {
      expect(classifyImpact(['IMPORTS', 'IMPORTS', 'IMPORTS'], 3)).toBe('structural');
    });

    it('returns structural when mix of structural edge types', () => {
      expect(classifyImpact(['EXTENDS', 'IMPLEMENTS'], 2)).toBe('structural');
    });

    it('returns structural even at depth 1 when structural edge present', () => {
      expect(classifyImpact(['EXTENDS'], 1)).toBe('structural');
    });
  });

  describe('direct', () => {
    it('returns direct at depth 1 with non-structural, non-template edge', () => {
      expect(classifyImpact(['INJECTS'], 1)).toBe('direct');
    });

    it('returns direct at depth 1 with USES_COMPONENT', () => {
      expect(classifyImpact(['USES_COMPONENT'], 1)).toBe('direct');
    });

    it('returns direct at depth 1 with ROUTES_TO', () => {
      expect(classifyImpact(['ROUTES_TO'], 1)).toBe('direct');
    });

    it('returns direct at depth 1 with empty chain', () => {
      expect(classifyImpact([], 1)).toBe('direct');
    });
  });

  describe('indirect', () => {
    it('returns indirect at depth 2 with non-structural, non-template edges', () => {
      expect(classifyImpact(['INJECTS', 'USES_COMPONENT'], 2)).toBe('indirect');
    });

    it('returns indirect at depth 3', () => {
      expect(classifyImpact(['INJECTS', 'INJECTS', 'USES_PIPE'], 3)).toBe('indirect');
    });

    it('returns indirect at depth 2 with empty chain', () => {
      expect(classifyImpact([], 2)).toBe('indirect');
    });
  });
});
