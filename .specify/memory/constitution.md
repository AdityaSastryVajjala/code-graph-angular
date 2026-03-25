<!--
## Sync Impact Report

**Version change**: (placeholder) → 1.0.0
**Bump rationale**: MAJOR — first complete instantiation of constitution from blank template.
  All principles defined for the first time; no prior baseline existed.

### Modified Principles
- All 10 principles: new (no prior titles to compare against)

### Added Sections
- Core Principles (10 principles)
- Quality Standards
- Governance

### Removed Sections
- None (template placeholders replaced, not removed)

### Templates Requiring Updates
- ✅ `.specify/memory/constitution.md` — this file, fully written
- ✅ `.specify/templates/plan-template.md` — Constitution Check section uses
  `[Gates determined based on constitution file]`; no outdated references found.
  Gates are feature-specific and filled by `/speckit.plan` at runtime. No change needed.
- ✅ `.specify/templates/spec-template.md` — generic; no constitution-specific
  references found. Functional Requirements use MUST/SHOULD language consistent
  with this constitution's declarative style. No change needed.
- ✅ `.specify/templates/tasks-template.md` — task phases align with Incremental
  Indexing, Testability, and Observability principles. No outdated references found.
- ✅ `.specify/templates/constitution-template.md` — source template; not modified
  (operates only on memory file per skill instructions).

### Deferred Items
- None. All placeholders resolved.
-->

# CodeGraph Angular Constitution

## Core Principles

### I. Accuracy First

All graph relationships MUST be derived from compiler- or analyzer-level truth.
Heuristic or grep-style matching MAY be used only as a documented fallback with
measurable accuracy trade-offs explicitly recorded.

- Angular 14+ behavior is the strong-support baseline; Angular 2–13 MAY receive
  best-effort support with documented limitations.
- Shortcuts that reduce semantic correctness for speed MUST NOT be introduced
  unless the trade-off is explicitly documented, measurable, and approved.

### II. One Application, One Bounded Graph

Each Angular application in a repository MUST be indexed into its own isolated
graph/database boundary.

- Cross-application pollution of symbols, dependencies, queries, or analytics is
  NOT ALLOWED unless explicitly modeled as a named cross-app relationship.
- Database names MUST be deterministic, sanitized, and unique per application clone.
- Wipe-and-recreate flows MUST be explicit, safe, and reproducible.

### III. Incremental Indexing by Default

The normal operational model is incremental updates driven by git diff and file
watching. Full rebuilds MUST remain supported but are not the expected default.

- Re-indexing MUST be scoped to impacted files and their affected graph
  relationships wherever technically feasible.
- File-watcher-driven updates MUST use a 30-second rolling debounce with a
  visible countdown indicator exposed to the user.
- Debounced change handling and countdown visibility are REQUIRED for all
  watcher-driven update paths.

### IV. Deterministic Developer Experience

The same repository state MUST produce the same graph structure and equivalent
query results across independent runs.

- CLI, indexing, import, and MCP/tool responses MUST be predictable, documented,
  and automation-friendly.
- All wipe-and-recreate flows MUST be explicit, safe, and reproducible.
- Non-determinism MUST be treated as a bug and tracked to resolution.

### V. Spec Discipline

Product artifacts MUST maintain strict separation of concerns:

- **Specs** describe *what* and *why* — product requirements only.
- **Plans** describe architecture, stack, modules, constraints, and technical decisions.
- **Tasks** describe concrete implementation work in execution order.
- Generated artifacts MUST NOT mix product requirements with low-level
  implementation details.

### VI. Testability and Verification

All major graph extraction features MUST be backed by automated tests.

Mandatory coverage areas include:
- Selector, directive, and pipe usage extraction
- Routing graph construction
- Template and style linkage
- `*.spec.ts` file indexing
- Angular workspace and Nx monorepo project discovery

Changes to parsers, graph schema, or the indexing flow MUST include regression
coverage. Query behavior MUST be validated against representative Angular repo
fixtures before merge.

### VII. Operational Observability

Every indexing run MUST expose the following measurable signals:

- Indexing duration
- DB write throughput
- Node and edge counts (total and delta)
- Changed-file count per run
- Failure reasons with actionable diagnostic logs

Long-running steps MUST expose progress clearly. Errors MUST be diagnosable
without access to internal state beyond the logs.

### VIII. Performance With Guardrails

Performance matters, but MUST NEVER come at the cost of graph correctness.

- Batch writes, import strategies, and DB optimizations SHOULD be preferred when
  they preserve correctness.
- Large repositories and monorepos are primary targets; design MUST avoid
  unnecessary full reprocessing.
- Any performance optimization that degrades correctness MUST be rejected or
  explicitly approved with documented trade-offs (see Principle I).

### IX. Extensibility

The system MUST be designed so Angular support can expand into:

- Richer template semantics
- Standalone component APIs
- Signals-based change detection analysis
- Advanced routing analysis
- Migration tooling

MCP/tool contracts MUST be modular so Angular-specific tools can evolve
independently of platform infrastructure.

### X. Governance

Any change that affects graph semantics, schema meaning, indexing boundaries, or
tool contracts MUST update the relevant spec, plan, tasks, and this constitution
if the rule is lasting.

If a proposed implementation conflicts with this constitution, the constitution
wins unless it is explicitly amended following the amendment procedure below.

## Quality Standards

The following standards apply as non-negotiable quality gates across all features:

**Angular Workspace + Nx Monorepo Support**
- Project discovery MUST handle both single-app Angular workspaces and Nx-style
  monorepos with multiple apps and libraries.
- Each discovered application MUST map to exactly one isolated graph boundary
  (Principle II).

**Selector / Directive / Pipe Usage Extraction**
- Usage extraction MUST be compiler-derived, not regex-based, for Angular 14+.
- Extraction coverage MUST include: component selectors in templates, directive
  attribute selectors, pipe usage in template expressions, and host bindings.

**`*.spec.ts` Indexing**
- Spec files MUST be indexed as first-class graph nodes linked to their subjects.
- Spec coverage relationships (spec → component/service/pipe) MUST be queryable.

**Linked Styles Support (MVP)**
- Components with `styleUrls` or `styles` metadata MUST have style linkage edges
  in the graph as part of the MVP feature set.

**Neo4j Enterprise in Docker with Multi-Database Support**
- The runtime target is Neo4j Enterprise running in Docker with multi-database
  enabled.
- Each application database MUST be created, managed, and dropped independently.
- Schema initialization scripts MUST be idempotent.

**Database Wipe / Recreate on Reindex**
- Full reindex operations MUST drop and recreate the target database.
- Drop-and-recreate MUST be a safe, confirmed, and logged operation.
- Partial wipe of a subset of nodes/edges is distinct from full reindex and MUST
  be supported separately.

**Git Diff + File Watcher Incremental Flow**
- Incremental updates triggered by git diff MUST resolve the changed-file set
  before any graph writes begin.
- File watcher events MUST be accumulated and deduplicated during the debounce
  window before triggering re-indexing.

**30-Second Rolling Debounce with Visible Countdown**
- The debounce window is 30 seconds, rolling (reset on each new event).
- A countdown indicator MUST be visible to the user during the debounce window
  showing remaining seconds until indexing triggers.
- The countdown MUST reset visibly when new events arrive within the window.

## Governance

**Amendment Procedure**
1. Open a proposal describing the principle or rule to be changed and the
   rationale (spec-level, not implementation-level).
2. Update the relevant spec, plan, and tasks documents to reflect the change.
3. Increment the constitution version following semantic versioning:
   - **MAJOR**: Backward-incompatible principle removals or redefinitions.
   - **MINOR**: New principle or section added or materially expanded.
   - **PATCH**: Clarifications, wording corrections, non-semantic refinements.
4. Record the amendment in the Sync Impact Report (HTML comment at top of this file).
5. Update `LAST_AMENDED_DATE` to the date of the change.

**Compliance**
- All PRs affecting graph semantics, schema, indexing boundaries, or tool
  contracts MUST include a constitution compliance check.
- The constitution supersedes all other practices. Deviations require explicit
  written justification in the relevant plan or spec.
- Runtime development guidance is maintained in `.specify/` artifacts; this
  constitution governs the non-negotiable rules those artifacts MUST respect.

**Version**: 1.0.0 | **Ratified**: 2026-03-24 | **Last Amended**: 2026-03-24
