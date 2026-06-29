import { describe, expect, it } from "bun:test";
import type { RawUserEntity } from "@containers/User/Models/user.schema";
import { UserTransformer } from "@containers/User/Transformers/UserTransformer";

describe("UserTransformer", () => {
	const transformer = new UserTransformer();

	const raw: RawUserEntity = {
		id: "0197a5d0-6e0c-7b4a-8c3f-1a2b3c4d5e6f",
		name: "Ada Lovelace",
		email: "ada@example.com",
		emailVerified: false,
		image: null,
		phone: null,
		profilePic: null,
		password: "$bcrypt$hash-never-exposed",
		roleId: "0197a5d0-6e0c-7b4a-8c3f-abcdef123456",
		createdAt: new Date("2026-01-01T00:00:00.000Z"),
		updatedAt: new Date("2026-01-01T00:00:00.000Z"),
	};

	it("maps raw entity fields to the safe client shape", () => {
		const out = transformer.transform(raw);
		expect(out).toEqual({
			id: "0197a5d0-6e0c-7b4a-8c3f-1a2b3c4d5e6f",
			fullName: "Ada Lovelace",
			emailAddress: "ada@example.com",
			phone: null,
			profilePic: null,
			roleId: "0197a5d0-6e0c-7b4a-8c3f-abcdef123456",
			registeredOn: "2026-01-01T00:00:00.000Z",
		});
	});

	it("uses the UUID primary key as the public id", () => {
		const out = transformer.transform(raw);
		expect(out.id).toBe(raw.id);
	});

	it("never leaks keys outside the SafeUserOutput contract", () => {
		const out = transformer.transform(raw);
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
