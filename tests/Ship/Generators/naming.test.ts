import { describe, expect, it } from "bun:test";
import { camelCase, kebabCase, pascalCase, pluralize, snakeCase } from "@ship/Generators/naming";

describe("naming", () => {
	describe("pascalCase", () => {
		it("converts kebab-case", () => {
			expect(pascalCase("place-order")).toBe("PlaceOrder");
		});

		it("converts snake_case", () => {
			expect(pascalCase("place_order")).toBe("PlaceOrder");
		});

		it("converts space-separated", () => {
			expect(pascalCase("place order")).toBe("PlaceOrder");
		});

		it("keeps PascalCase as-is", () => {
			expect(pascalCase("PlaceOrder")).toBe("PlaceOrder");
		});
	});

	describe("camelCase", () => {
		it("converts kebab-case", () => {
			expect(camelCase("place-order")).toBe("placeOrder");
		});

		it("keeps camelCase as-is", () => {
			expect(camelCase("placeOrder")).toBe("placeOrder");
		});
	});

	describe("kebabCase", () => {
		it("converts PascalCase", () => {
			expect(kebabCase("PlaceOrder")).toBe("place-order");
		});

		it("converts camelCase", () => {
			expect(kebabCase("placeOrder")).toBe("place-order");
		});

		it("converts snake_case", () => {
			expect(kebabCase("place_order")).toBe("place-order");
		});
	});

	describe("snakeCase", () => {
		it("converts PascalCase", () => {
			expect(snakeCase("PlaceOrder")).toBe("place_order");
		});

		it("converts kebab-case", () => {
			expect(snakeCase("place-order")).toBe("place_order");
		});
	});

	describe("pluralize", () => {
		it("adds 's' to simple words", () => {
			expect(pluralize("user")).toBe("users");
			expect(pluralize("role")).toBe("roles");
		});

		it("converts -y to -ies", () => {
			expect(pluralize("category")).toBe("categories");
		});

		it("keeps words already ending in 's'", () => {
			expect(pluralize("status")).toBe("status");
		});
	});
});
