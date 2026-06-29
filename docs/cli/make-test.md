# make:test

The `thalys:make:test` command creates a new test file scaffold using `bun:test`. Tests can be placed in a container-specific directory or in the shared `Ship` directory.

## Signature

```bash
thalys:make:test {name} {--container=} {--f|force}
```

## Arguments

| Argument | Description |
| --- | --- |
| `name` | The test name. Converted to PascalCase for the `describe` block and kebab-case for the filename (e.g. `UserTransformer` → `user-transformer.test.ts`). |

## Options

| Option | Shortcut | Description |
| --- | --- | --- |
| `--container` | `-c` | Target container name. When provided, the test is placed in `tests/Containers/<Container>/`. When omitted, the test is placed in `tests/Ship/`. |
| `--force` | `-f` | Overwrite the file if it already exists. |

## What it generates

Creates a single test file:

- **With `--container`:** `tests/Containers/<Container>/<name>.test.ts`
- **Without `--container`:** `tests/Ship/<name>.test.ts`

The scaffold includes a `describe` block, a `beforeEach` hook for setup, and a single `it` block with Arrange/Act/Assert comment placeholders.

## Example usage

```bash
# Container test
bun run command thalys:make:test UserTransformer --container=User

# Ship test (no container)
bun run command thalys:make:test Logger

# Overwrite
bun run command thalys:make:test UserTransformer --container=User --force
```

Output:

```bash
Created test file: tests/Containers/User/user-transformer.test.ts
```

## Generated file example

```ts
// tests/Containers/User/user-transformer.test.ts
import { describe, expect, it, beforeEach } from "bun:test";

describe("UserTransformerTest", () => {
	beforeEach(() => {
		// Setup
	});

	it("should work correctly", async () => {
		// Arrange

		// Act

		// Assert
	});
});
```

::: tip Run a single test file
Thalys uses Bun's built-in test runner. Run a specific file with:

```bash
bun test tests/Containers/User/user-transformer.test.ts
```

Match by test name with `-t`:

```bash
bun test -t "should work correctly"
```
:::

::: tip Ship vs Container tests
Place pure unit tests for framework utilities (logger, container, transformers) in `tests/Ship/`. Place domain-specific tests (actions, repositories, request validation) in `tests/Containers/<Container>/`. This mirrors the `src/` Ship-vs-Container split.
:::
