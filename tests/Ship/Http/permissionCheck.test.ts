import { describe, expect, it } from "bun:test";
import { hasPermission } from "@ship/Http/permissionCheck";

describe("hasPermission", () => {
	const perms = [
		{ resource: "user", action: "read" },
		{ resource: "user", action: "create" },
		{ resource: "product", action: "*" },
	];

	it("matches exact permission", () => {
		expect(hasPermission(perms, { resource: "user", action: "read" })).toBe(true);
	});

	it("rejects missing permission", () => {
		expect(hasPermission(perms, { resource: "user", action: "delete" })).toBe(false);
	});

	it("matches action wildcard (resource/*)", () => {
		expect(hasPermission(perms, { resource: "product", action: "read" })).toBe(true);
		expect(hasPermission(perms, { resource: "product", action: "delete" })).toBe(true);
	});

	it("matches resource wildcard (* /action)", () => {
		const admin = [{ resource: "*", action: "read" }];
		expect(hasPermission(admin, { resource: "anything", action: "read" })).toBe(true);
	});

	it("matches full wildcard (* / *)", () => {
		const superAdmin = [{ resource: "*", action: "*" }];
		expect(hasPermission(superAdmin, { resource: "user", action: "delete" })).toBe(true);
		expect(hasPermission(superAdmin, { resource: "anything", action: "anything" })).toBe(true);
	});

	it("returns false for empty permissions", () => {
		expect(hasPermission([], { resource: "user", action: "read" })).toBe(false);
	});
});
