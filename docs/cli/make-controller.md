# make:controller

The `thalys:make:controller` command creates a new controller **function** for a Container. Controllers are plain `async function`s — one per file — that take typed input plus the DI `Container`, call Actions (or repositories), transform the result, and return it wrapped in the standard response envelope via `wrapResponse()` / `wrapPaginated()`.

Controllers live in `src/Containers/<Container>/UI/API/Controllers/` and are imported by route files, keeping routes as thin wiring that delegates to a controller function.

## Signature

```bash
thalys:make:controller {container} {name} {--f|force}
```

## Arguments

| Argument | Description |
| --- | --- |
| `container` | The target container name (PascalCase, e.g. `Product`). |
| `name` | The controller name. The function name is derived as `<camelCase(name)><PascalCase(name)>` (e.g. `createProduct` → function `createProduct`; `Product` → function `productProduct`). Pass a verb+noun like `createProduct` for a clean function name. |

## Options

| Option | Shortcut | Description |
| --- | --- | --- |
| `--force` | `-f` | Overwrite the file if it already exists. |

## What it generates

Creates a single file:

```txt
src/Containers/<Container>/UI/API/Controllers/<functionName>.ts
```

The generated function is a standalone `async function` — it does **not** extend `MainController`. The `MainController` abstract class still exists in `src/Ship/Http/MainController.ts`, but it is no longer used by routes; `wrapResponse` and `wrapPaginated` are standalone functions imported directly from that module.

## Example usage

```bash
bun run command thalys:make:controller Product createProduct

bun run command thalys:make:controller User createUser --force
```

Output:

```bash
Created createProduct  path=src/Containers/Product/UI/API/Controllers/createProduct.ts
```

## Generated file example

```ts
// src/Containers/Product/UI/API/Controllers/createProduct.ts
import type { CreateProductDTO } from "@containers/Product/Requests/product.request";
import type { Container } from "@ship/Container/Container";
import { wrapResponse } from "@ship/Http/MainController";

export async function createProduct(input: CreateProductDTO, container: Container) {
	// TODO: implement — call Actions, transform result, return wrapResponse
	return wrapResponse({ success: true });
}
```

The stub imports a `Create<Entity>DTO` type and `wrapResponse` so you can fill in the body. Replace the placeholder with a real Action call and Transformer:

```ts
import { CreateProductAction } from "@containers/Product/Actions/CreateProductAction";
import type { CreateProductDTO } from "@containers/Product/Requests/product.request";
import { ProductTransformer } from "@containers/Product/Transformers/ProductTransformer";
import type { Container } from "@ship/Container/Container";
import { wrapResponse } from "@ship/Http/MainController";

const transformer = new ProductTransformer();

export async function createProduct(body: CreateProductDTO, container: Container) {
	const action = container.make(CreateProductAction);
	const created = await action.execute(body);
	return wrapResponse(transformer.transform(created));
}
```

::: tip When to use a controller function
Most Thalys routes delegate to a controller function that calls a single Action. Use a dedicated controller function whenever a route orchestrates multiple Actions, applies complex pre/post-processing, or shares logic across endpoints. One function per file keeps each handler testable and individually importable from the route file.
:::

::: tip Inject dependencies via the container
Controller functions are not auto-registered in `registerServices.ts`. They receive the DI `Container` as an argument (passed from the route handler's `container`), so resolve Actions and repositories inside the function body via `container.make(...)`:

```ts
export async function checkout(
	orderId: string,
	container: Container,
) {
	const validateAction = container.make(ValidateOrderAction);
	const chargeAction = container.make(ChargePaymentAction);
	const order = await validateAction.execute(orderId);
	return wrapResponse(await chargeAction.execute(order));
}
```

The route handler simply forwards the request-scoped `container`:

```ts
.post(
	"/checkout",
	async ({ container, body }) => checkout(body.orderId, container as Container),
)
```
:::
