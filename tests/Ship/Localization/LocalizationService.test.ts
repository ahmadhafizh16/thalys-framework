import { beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { LocalizationService } from "@ship/Localization/LocalizationService";

const LOCALES_DIR = join(import.meta.dir, "../../../src/Ship/Localization/locales");

describe("LocalizationService", () => {
	let service: LocalizationService;

	beforeEach(() => {
		service = new LocalizationService("en", LOCALES_DIR);
	});

	describe("resolve", () => {
		it("resolves a simple key in English", () => {
			const message = service.resolve("en", "errors.NOT_FOUND", { resource: "User" });
			expect(message).toBe("User could not be located.");
		});

		it("resolves a simple key in Arabic", () => {
			const message = service.resolve("ar", "errors.NOT_FOUND", { resource: "User" });
			expect(message).toBe("لا يمكن العثور على User.");
		});

		it("falls back to default locale when key is missing in requested locale", () => {
			// "success.USER_CREATED" exists in both en and ar, but if we request a
			// non-existent locale, it should fall back to en
			const message = service.resolve("fr", "errors.NOT_FOUND", { resource: "Product" });
			expect(message).toBe("Product could not be located.");
		});

		it("returns the key itself when not found in any catalog", () => {
			const message = service.resolve("en", "errors.NONEXISTENT_KEY");
			expect(message).toBe("errors.NONEXISTENT_KEY");
		});

		it("replaces multiple parameters", () => {
			const message = service.resolve("en", "errors.CONFLICT", { detail: "duplicate email" });
			expect(message).toBe("A conflict occurred: duplicate email.");
		});

		it("handles missing parameters gracefully (leaves placeholder intact)", () => {
			const message = service.resolve("en", "errors.NOT_FOUND");
			expect(message).toBe("{resource} could not be located.");
		});

		it("resolves success messages", () => {
			const message = service.resolve("en", "success.LOGIN_SUCCESSFUL");
			expect(message).toBe("Login successful.");
		});

		it("resolves success messages in Arabic", () => {
			const message = service.resolve("ar", "success.LOGIN_SUCCESSFUL");
			expect(message).toBe("تم تسجيل الدخول بنجاح.");
		});
	});

	describe("parseAcceptLanguage", () => {
		it("parses a single locale", () => {
			expect(service.parseAcceptLanguage("ar")).toBe("ar");
		});

		it("parses weighted list and picks highest quality", () => {
			expect(service.parseAcceptLanguage("fr;q=0.5,ar;q=0.9,en;q=0.8")).toBe("ar");
		});

		it("picks the first available locale by quality", () => {
			expect(service.parseAcceptLanguage("en-US,en;q=0.9,fr;q=0.8")).toBe("en");
		});

		it("strips region subtag (en-US → en)", () => {
			expect(service.parseAcceptLanguage("en-US")).toBe("en");
		});

		it("falls back to default for unknown locales", () => {
			expect(service.parseAcceptLanguage("fr,de,ja")).toBe("en");
		});

		it("falls back to default for null header", () => {
			expect(service.parseAcceptLanguage(null)).toBe("en");
		});

		it("falls back to default for empty header", () => {
			expect(service.parseAcceptLanguage("")).toBe("en");
		});

		it("handles quality values without leading zero", () => {
			expect(service.parseAcceptLanguage("ar;q=1,en;q=0.5")).toBe("ar");
		});
	});
});
