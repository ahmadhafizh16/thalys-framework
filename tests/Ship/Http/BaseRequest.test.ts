import { describe, expect, it } from "bun:test";
import { BaseRequest, RequestValidationError } from "@ship/Http/BaseRequest";

describe("BaseRequest", () => {
	describe("validateId", () => {
		it("accepts a valid alphanumeric ID", () => {
			expect(BaseRequest.validateId("abc123")).toBe("abc123");
		});

		it("accepts a UUID-style ID", () => {
			const id = "550e8400-e29b-41d4-a716-446655440000";
			expect(BaseRequest.validateId(id)).toBe(id);
		});

		it("accepts a nanoid-style ID", () => {
			expect(BaseRequest.validateId("NKjBatfsInLMBMpE9g2HtB6ajgPjy9ZC")).toBe(
				"NKjBatfsInLMBMpE9g2HtB6ajgPjy9ZC",
			);
		});

		it("rejects empty string", () => {
			expect(() => BaseRequest.validateId("")).toThrow(RequestValidationError);
		});

		it("rejects IDs with special characters", () => {
			expect(() => BaseRequest.validateId("id with spaces")).toThrow(RequestValidationError);
			expect(() => BaseRequest.validateId("id@special")).toThrow(/Invalid format/);
		});
	});

	describe("parseQuery", () => {
		const allowlist = {
			filterable: ["email", "roleId"],
			sortable: ["name", "createdAt"],
			defaultSort: { field: "createdAt", direction: "desc" as const },
			defaultLimit: 10,
			maxLimit: 50,
		};

		it("parses filter[field]=value", () => {
			const result = BaseRequest.parseQuery({ "filter[email]": "test@example.com" }, allowlist);
			expect(result.filter).toEqual({ email: "test@example.com" });
		});

		it("rejects a filterable field not in the allowlist", () => {
			expect(() => BaseRequest.parseQuery({ "filter[password]": "secret" }, allowlist)).toThrow(
				/Filtering by 'password' is not allowed/,
			);
		});

		it("parses sort=-field (descending)", () => {
			const result = BaseRequest.parseQuery({ sort: "-createdAt" }, allowlist);
			expect(result.sort).toEqual([{ field: "createdAt", direction: "desc" }]);
		});

		it("parses sort=field (ascending)", () => {
			const result = BaseRequest.parseQuery({ sort: "name" }, allowlist);
			expect(result.sort).toEqual([{ field: "name", direction: "asc" }]);
		});

		it("parses multiple sort fields", () => {
			const result = BaseRequest.parseQuery({ sort: "-createdAt,name" }, allowlist);
			expect(result.sort).toEqual([
				{ field: "createdAt", direction: "desc" },
				{ field: "name", direction: "asc" },
			]);
		});

		it("rejects a sortable field not in the allowlist", () => {
			expect(() => BaseRequest.parseQuery({ sort: "password" }, allowlist)).toThrow(
				/Sorting by 'password' is not allowed/,
			);
		});

		it("applies default sort when no sort param", () => {
			const result = BaseRequest.parseQuery({}, allowlist);
			expect(result.sort).toEqual([{ field: "createdAt", direction: "desc" }]);
		});

		it("parses limit param", () => {
			const result = BaseRequest.parseQuery({ limit: "25" }, allowlist);
			expect(result.page?.limit).toBe(25);
		});

		it("caps limit at maxLimit", () => {
			const result = BaseRequest.parseQuery({ limit: "999" }, allowlist);
			expect(result.page?.limit).toBe(50);
		});

		it("uses defaultLimit when no limit param", () => {
			const result = BaseRequest.parseQuery({}, allowlist);
			expect(result.page?.limit).toBe(10);
		});

		it("parses page[cursor] param", () => {
			const result = BaseRequest.parseQuery(
				{ "page[cursor]": "550e8400-e29b-41d4-a716-446655440000" },
				allowlist,
			);
			expect(result.page?.cursor).toBe("550e8400-e29b-41d4-a716-446655440000");
		});

		it("returns empty filter/sort when no params", () => {
			const result = BaseRequest.parseQuery({}, { filterable: [], sortable: [] });
			expect(result.filter).toBeUndefined();
			expect(result.sort).toBeUndefined();
		});
	});
});
