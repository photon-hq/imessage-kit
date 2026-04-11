# Domain Layer Specification

## Definition

Domain 层是系统的事实层。它定义问题域中**已被观察和验证的事实**，不包含任何猜测、防御性逻辑或工程权衡。

## Hard Constraints

| # | Constraint | Rationale |
|---|-----------|-----------|
| 1 | **Zero I/O** | No filesystem, network, process, or OS calls |
| 2 | **Zero external dependencies** | No npm packages |
| 3 | **Zero cross-layer imports** | Only imports from within `domain/` |
| 4 | **Pure functions** | Same input → same output, no side effects |
| 5 | **Verified facts only** | Every constant, mapping, and type must have an observable source. No defensive parsing, no speculative formats |

## What Belongs Here

- Type definitions that describe **what the domain is** (not how the SDK exposes it)
- Data shapes that model **observed domain entities**
- Constants whose values are **protocol-level and version-invariant**
- Mapping functions from raw protocol codes to typed domain values
- Value objects that encapsulate domain parsing and normalization
- Validation rules grounded in **domain constraints** (not engineering guardrails)

## What Does NOT Belong Here

- Version-specific adaptation (belongs in `infra/`)
- Engineering guardrails — timeouts, retry limits, concurrency caps (belongs in `infra/`)
- SDK API contracts — request/response shapes, plugin interfaces (belongs in `types/`)
- Orchestration logic — scheduling, event dispatching, chaining (belongs in `application/`)

## Admission Test

Before adding anything to this layer, answer:

1. **Is this an observed fact?** Can you point to a database column, protocol field, or system behavior that produces this value? If not, it doesn't belong here.
2. **Is this version-invariant?** Does it hold across all known system versions? If it depends on runtime detection, it belongs in `infra/`.
3. **Would you still need this if the storage mechanism changed?** If swapping SQLite for a REST API would make it irrelevant, it belongs in `infra/`.

## File Organization

One file per cohesive domain concept. Each file contains the concept's:
- Type definitions
- Constants
- Resolution / mapping functions

No file should serve as a catch-all bucket.

## Naming Conventions

| Category | Convention | Example |
|----------|-----------|---------|
| Files | kebab-case | `chat-id.ts` |
| Types / Interfaces | PascalCase, no `I` prefix | `Message`, `Service` |
| Constants | UPPER_SNAKE_CASE | `MAC_EPOCH`, `CHAT_STYLE_GROUP` |
| Resolution functions | `resolve` + target type | `resolveService()`, `resolveChatKind()` |
| Validation functions | `validate` + subject | `validateRecipient()` |
| Boolean predicates | `is` + condition | `isURL()` |
| Error factories | Category + `Error` | `SendError()`, `DatabaseError()` |
| Value objects | PascalCase class, static factories, private constructor | `ChatId.fromUserInput()` |

### Resolution function contract

```
resolve<Type>(raw: <primitive | null>): <DomainType>
```

- Accepts `null` (raw data may be null)
- Returns the domain type's default value (never throws)
- Pure, stateless

## Code Style

- 4-space indent, single quotes, trailing commas, semicolons as needed
- 120-character line width
- `readonly` on all interface properties
- Section separators: `// -----------------------------------------------`
- File-level JSDoc at the top of every file
