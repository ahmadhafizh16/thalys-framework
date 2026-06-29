# Localization

Thalys includes a lightweight localization system that resolves message keys against JSON catalogs and integrates with the global error handler. Error messages carry a `messageKey` and `messageParams` — the actual translated string is resolved at the response layer, using the request's `Accept-Language` header to select the locale.

## How it works under the hood

```txt
AppError thrown in Action/Task
  │  error.messageKey = "errors.NOT_FOUND"
  │  error.messageParams = { resource: "User" }
  │
  ▼
Global onError handler (setup.ts)
  │  locale = parseLocale(request.headers.get("accept-language"))
  │  message = lz(error.messageKey, locale, error.messageParams)
  │
  ▼
lz() → LocalizationService.resolve()
  │  lookup("en", "errors.NOT_FOUND") → "{resource} could not be located."
  │  replace {resource} → "User could not be located."
  │
  ▼
Response: { success: false, error: "NOT_FOUND", message: "User could not be located." }
```

## LocalizationService

The `LocalizationService` loads JSON catalogs from the `locales/` directory at construction time. Each file is a nested object — dotted keys traverse the nesting:

```ts
// src/Ship/Localization/LocalizationService.ts
export class LocalizationService {
	private readonly catalogs = new Map<string, Catalog>();
	private readonly defaultLocale: string;

	constructor(defaultLocale = "en", localesDir?: string) {
		this.defaultLocale = defaultLocale;
		const dir = localesDir ?? join(__dirname, "locales");

		if (existsSync(dir)) {
			for (const file of readdirSync(dir)) {
				if (!file.endsWith(".json")) continue;
				const locale = file.replace(/\.json$/, "");
				const catalog = JSON.parse(readFileSync(join(dir, file), "utf-8"));
				this.catalogs.set(locale, catalog);
			}
		}
	}
}
```

The `resolve()` method looks up a dotted key (e.g. `errors.NOT_FOUND`) in the requested locale's catalog. If the key is missing, it falls back to the default locale (`en`). If it's still missing, it returns the raw key:

```ts
resolve(locale: string, key: string, params?: Record<string, string>): string {
	const catalog = this.catalogs.get(locale) ?? this.catalogs.get(this.defaultLocale);
	if (!catalog) return key;

	let message = this.lookup(catalog, key);

	// Fallback to default locale
	if (message === undefined && locale !== this.defaultLocale) {
		const defaultCatalog = this.catalogs.get(this.defaultLocale);
		if (defaultCatalog) {
			message = this.lookup(defaultCatalog, key);
		}
	}

	if (message === undefined) return key;

	// Parameter interpolation: {resource} → value
	if (params) {
		for (const [param, value] of Object.entries(params)) {
			message = message.replaceAll(`{${param}}`, value);
		}
	}

	return message;
}
```

::: tip Fallback chain
The resolution order is: requested locale → default locale (`en`) → raw key string. This means you can ship with a complete `en.json` and partially translate other locales — any missing keys will fall back to English rather than showing a broken string.
:::

## The lz() global helper

`lz()` is a lazy-initialized singleton. The `LocalizationService` is created on first call, not at import time — this avoids issues with `__dirname` resolution during bundling:

```ts
// src/Ship/Localization/lz.ts
let service: LocalizationService | null = null;

function getService(): LocalizationService {
	if (!service) {
		const { join } = require("node:path");
		service = new LocalizationService("en", join(__dirname, "locales"));
	}
	return service;
}

export function lz(key: string, locale?: string, params?: Record<string, string>): string {
	const resolvedLocale = locale ?? "en";
	return getService().resolve(resolvedLocale, key, params);
}
```

Usage:

```ts
lz("errors.NOT_FOUND", "en", { resource: "User" })
// → "User could not be located."

lz("errors.NOT_FOUND", "ar", { resource: "User" })
// → "لا يمكن العثور على User."

lz("success.USER_CREATED", "en")
// → "User created successfully."
```

## parseLocale()

`parseLocale()` parses an `Accept-Language` header and returns the best matching locale. It handles quality values (`q=`) and language subtags (e.g. `en-US` → `en`):

```ts
// src/Ship/Localization/lz.ts
export function parseLocale(header: string | null): string {
	return getService().parseAcceptLanguage(header);
}
```

```ts
// In LocalizationService:
parseAcceptLanguage(header: string | null): string {
	if (!header) return this.defaultLocale;

	const parts = header
		.split(",")
		.map((part) => {
			const [lang, qPart] = part.trim().split(";q=");
			const q = qPart ? Number.parseFloat(qPart) : 1.0;
			return { lang: lang?.trim().split("-")[0] ?? "", q };
		})
		.filter((p) => p.lang.length > 0)
		.sort((a, b) => b.q - a.q);

	for (const { lang } of parts) {
		if (this.catalogs.has(lang)) return lang;
	}

	return this.defaultLocale;
}
```

Examples:

| Accept-Language header | Resolved locale |
| --- | --- |
| `en-US,en;q=0.9` | `en` |
| `ar,en;q=0.8` | `ar` |
| `fr-FR` | `en` (fallback — no `fr` catalog) |
| `null` (not sent) | `en` |

## Message keys on AppError

`AppError` accepts optional `messageKey` and `messageParams` fields. When set, the global error handler resolves them via `lz()` instead of using the raw `message` string:

```ts
// src/Ship/Exceptions/AppError.ts
export class AppError extends Error {
	constructor(
		public statusCode: number,
		public code: string,
		message: string,
		public messageKey?: string,
		public messageParams?: Record<string, string>,
	) {
		super(message);
		this.name = this.constructor.name;
	}
}

export class NotFoundError extends AppError {
	constructor(resource: string) {
		super(404, "NOT_FOUND", `${resource} could not be located.`, "errors.NOT_FOUND", { resource });
	}
}
```

The `NotFoundError` sets `messageKey = "errors.NOT_FOUND"` and `messageParams = { resource }`. The `message` field is the English fallback — it's used if localization somehow fails.

## Integration with the global error handler

The global `onError` handler in `setup.ts` is where localization meets the response. It parses the locale from the request, resolves the message, and returns it in the error envelope:

```ts
// src/Ship/setup.ts
.onError({ as: "global" }, ({ code, error, set, request }) => {
	const locale = parseLocale(request.headers.get("accept-language"));

	if (code === "VALIDATION") {
		set.status = 422;
		return {
			success: false,
			error: "SCHEMA_VALIDATION_FAILED",
			message: lz("errors.SCHEMA_VALIDATION_FAILED", locale),
			details: error.all,
		};
	}

	if (error instanceof AppError) {
		set.status = error.statusCode;
		const message = error.messageKey
			? lz(error.messageKey, locale, error.messageParams)
			: error.message;
		return {
			success: false,
			error: error.code,
			message,
		};
	}

	set.status = 500;
	return {
		success: false,
		error: "UNHANDLED_INTERNAL_ERROR",
		message: lz("errors.UNHANDLED_INTERNAL_ERROR", locale),
	};
});
```

::: tip The error code is never localized
The `error` field (e.g. `"NOT_FOUND"`, `"FORBIDDEN"`) is always a machine-readable code — clients use it for conditional logic. Only the `message` field is localized, and it's intended for display to end users.
:::

## Available locales

Thalys ships with two locale catalogs:

| Locale | File | Description |
| --- | --- | --- |
| `en` | `src/Ship/Localization/locales/en.json` | English (default) |
| `ar` | `src/Ship/Localization/locales/ar.json` | Arabic |

The `en.json` catalog:

```json
{
	"errors": {
		"NOT_FOUND": "{resource} could not be located.",
		"CONFLICT": "A conflict occurred: {detail}.",
		"INVALID_REQUEST": "Invalid request: {detail}.",
		"UNAUTHORIZED": "Authentication required.",
		"FORBIDDEN": "You do not have permission to perform this action.",
		"RATE_LIMIT_EXCEEDED": "Too many requests. Please try again later.",
		"SCHEMA_VALIDATION_FAILED": "The request body did not match the expected schema.",
		"UNHANDLED_INTERNAL_ERROR": "A fatal server exception occurred.",
		"EMAIL_ALREADY_EXISTS": "An account with this email already exists.",
		"INVALID_CREDENTIALS": "The provided credentials are incorrect.",
		"INVALID_ID_FORMAT": "Invalid format for '{field}'."
	},
	"success": {
		"USER_CREATED": "User created successfully.",
		"LOGIN_SUCCESSFUL": "Login successful.",
		"LOGOUT_SUCCESSFUL": "Logged out successfully.",
		"REGISTRATION_SUCCESSFUL": "Account created successfully."
	}
}
```

## Adding a new locale

To add French support:

**1. Create the catalog file:**

```bash
# src/Ship/Localization/locales/fr.json
```

```json
{
	"errors": {
		"NOT_FOUND": "{resource} est introuvable.",
		"CONFLICT": "Un conflit s'est produit : {detail}.",
		"INVALID_REQUEST": "Requête invalide : {detail}.",
		"UNAUTHORIZED": "Authentification requise.",
		"FORBIDDEN": "Vous n'avez pas la permission d'effectuer cette action.",
		"RATE_LIMIT_EXCEEDED": "Trop de requêtes. Veuillez réessayer plus tard.",
		"SCHEMA_VALIDATION_FAILED": "Le corps de la requête ne correspond pas au schéma attendu.",
		"UNHANDLED_INTERNAL_ERROR": "Une erreur serveur fatale s'est produite.",
		"EMAIL_ALREADY_EXISTS": "Un compte avec cet e-mail existe déjà.",
		"INVALID_CREDENTIALS": "Les informations d'identification fournies sont incorrectes.",
		"INVALID_ID_FORMAT": "Format invalide pour '{field}'."
	},
	"success": {
		"USER_CREATED": "Utilisateur créé avec succès.",
		"LOGIN_SUCCESSFUL": "Connexion réussie.",
		"LOGOUT_SUCCESSFUL": "Déconnexion réussie.",
		"REGISTRATION_SUCCESSFUL": "Compte créé avec succès."
	}
}
```

**2. That's it.** The `LocalizationService` constructor scans the `locales/` directory at startup and auto-loads any `*.json` file. No configuration file to update, no registration step. The file name (minus `.json`) becomes the locale identifier.

Clients can now request French responses:

```bash
curl -X GET http://localhost:3000/api/v1/users/nonexistent \
  -H "Accept-Language: fr-FR" \
  -H "Authorization: Bearer <token>"

# Response:
# { "success": false, "error": "NOT_FOUND", "message": "User est introuvable." }
```

::: tip Missing keys fall back to English
If you forget to translate a key in `fr.json`, the service falls back to `en.json` automatically. You can ship partial translations and fill them in over time.
:::
