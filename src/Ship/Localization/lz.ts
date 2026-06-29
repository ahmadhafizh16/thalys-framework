import { LocalizationService } from "./LocalizationService";

/**
 * Global localization service instance.
 * Loaded once at import time with the default locale and built-in locales.
 */
let service: LocalizationService | null = null;

function getService(): LocalizationService {
	if (!service) {
		// Lazy initialization — avoids issues with __dirname at import time
		const { join } = require("node:path") as typeof import("node:path");
		service = new LocalizationService("en", join(__dirname, "locales"));
	}
	return service;
}

/**
 * Global localization helper.
 * Resolve a dotted message key to a localized string.
 *
 * @example
 * lz("errors.NOT_FOUND", "en", { resource: "User" })
 * // → "User could not be located."
 *
 * lz("errors.NOT_FOUND", "ar", { resource: "User" })
 * // → "لا يمكن العثور على User."
 */
export function lz(key: string, locale?: string, params?: Record<string, string>): string {
	const resolvedLocale = locale ?? "en";
	return getService().resolve(resolvedLocale, key, params);
}

/**
 * Parse an Accept-Language header to the best matching locale.
 *
 * @example
 * parseLocale("en-US,en;q=0.9,ar;q=0.8")
 * // → "en"
 */
export function parseLocale(header: string | null): string {
	return getService().parseAcceptLanguage(header);
}

/**
 * Get the raw LocalizationService instance (for advanced use).
 */
export function getLocalizationService(): LocalizationService {
	return getService();
}
