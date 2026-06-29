import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

type Catalog = Record<string, string | Record<string, string>>;

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
				const catalog = JSON.parse(readFileSync(join(dir, file), "utf-8")) as Catalog;
				this.catalogs.set(locale, catalog);
			}
		}
	}

	/**
	 * Resolve a dotted message key to a localized string.
	 * Supports parameter interpolation: `{resource}` in the message is replaced.
	 */
	resolve(locale: string, key: string, params?: Record<string, string>): string {
		const catalog = this.catalogs.get(locale) ?? this.catalogs.get(this.defaultLocale);
		if (!catalog) return key;

		let message = this.lookup(catalog, key);

		if (message === undefined && locale !== this.defaultLocale) {
			const defaultCatalog = this.catalogs.get(this.defaultLocale);
			if (defaultCatalog) {
				message = this.lookup(defaultCatalog, key);
			}
		}

		if (message === undefined) return key;

		if (params) {
			for (const [param, value] of Object.entries(params)) {
				message = message.replaceAll(`{${param}}`, value);
			}
		}

		return message;
	}

	/**
	 * Parse `Accept-Language` header and return the best matching locale.
	 */
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

	private lookup(catalog: Catalog, key: string): string | undefined {
		const parts = key.split(".");
		let current: string | Catalog | undefined = catalog;

		for (const part of parts) {
			if (current === undefined || typeof current === "string") return undefined;
			current = current[part];
		}

		return typeof current === "string" ? current : undefined;
	}
}
