import { describe, expect, it } from "bun:test";
import type { RawUserEntity } from "@containers/User/Models/user.schema";
import { UserTransformer } from "@containers/User/Transformers/UserTransformer";

describe("UserTransformer", () => {
	const raw: RawUserEntity = {
		id: 42,
		externalId: "01JX3M2K7NQWVYRZ4A5B6C7D8E",
		name: "Ada Lovelace",
		email: "ada@example.com",
		phone: null,
		profilePic: null,
		passwordHash: "$bcrypt$hash-never-exposed",
		roleId: 1,
		createdAt: new Date("2026-01-01T00:00:00.000Z"),
		updatedAt: new Date("2026-01-01T00:00:00.000Z"),
	};

	it("maps raw entity fields to the safe client shape", () => {
		const out = UserTransformer.transform(raw);
		expect(out).toEqual({
			id: "01JX3M2K7NQWVYRZ4A5B6C7D8E",
			fullName: "Ada Lovelace",
			emailAddress: "ada@example.com",
			phone: null,
			profilePic: null,
			roleId: 1,
			registeredOn: "2026-01-01T00:00:00.000Z",
		});
	});

	it("exposes externalId to clients, never the internal integer id", () => {
		const out = UserTransformer.transform(raw);
		expect(out.id).toBe(raw.externalId);
		expect(out.id).not.toBe(raw.id.toString());
	});

	it("never leaks keys outside the SafeUserOutput contract", () => {
		const out = UserTransformer.transform(raw);
		expect(Object.keys(out).sort()).toEqual([
			"emailAddress",
			"fullName",
			"id",
			"phone",
			"profilePic",
			"registeredOn",
			"roleId",
		]);
	});
});
