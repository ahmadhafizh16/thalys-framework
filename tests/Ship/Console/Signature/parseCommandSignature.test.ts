import { describe, expect, it } from "bun:test";
import { parseCommandSignature } from "@ship/Console/Signature/parseCommandSignature";

describe("parseCommandSignature", () => {
	it("parses a command name without inputs", () => {
		expect(parseCommandSignature("db:seed:roles")).toEqual({
			name: "db:seed:roles",
			arguments: [],
			options: [],
		});
	});

	it("parses required, optional, defaulted, and variadic arguments", () => {
		const signature = `mail:send
			{user : The user ID}
			{queue? : Optional queue name}
			{attempts=3 : Retry attempts}
			{tags?* : Zero or more tags}`;

		expect(parseCommandSignature(signature).arguments).toEqual([
			{
				name: "user",
				description: "The user ID",
				required: true,
				multiple: false,
			},
			{
				name: "queue",
				description: "Optional queue name",
				required: false,
				multiple: false,
			},
			{
				name: "attempts",
				description: "Retry attempts",
				required: false,
				multiple: false,
				defaultValue: "3",
			},
			{
				name: "tags",
				description: "Zero or more tags",
				required: false,
				multiple: true,
			},
		]);
	});

	it("parses boolean, valued, defaulted, shortcut, and repeated options", () => {
		const signature = `mail:send
			{--queue : Whether the job should be queued}
			{--connection= : Queue connection}
			{--limit=10 : Result limit}
			{--Q|priority=high : Priority name}
			{--id=* : IDs to include}`;

		expect(parseCommandSignature(signature).options).toEqual([
			{
				name: "queue",
				description: "Whether the job should be queued",
				requiresValue: false,
				multiple: false,
			},
			{
				name: "connection",
				description: "Queue connection",
				requiresValue: true,
				multiple: false,
			},
			{
				name: "limit",
				description: "Result limit",
				requiresValue: true,
				multiple: false,
				defaultValue: "10",
			},
			{
				name: "priority",
				shortcut: "Q",
				description: "Priority name",
				requiresValue: true,
				multiple: false,
				defaultValue: "high",
			},
			{
				name: "id",
				description: "IDs to include",
				requiresValue: true,
				multiple: true,
			},
		]);
	});

	it("throws when an option name is missing", () => {
		expect(() => parseCommandSignature("mail:send {--=bad}")).toThrow();
	});

	it("throws when an argument default is empty", () => {
		expect(() => parseCommandSignature("mail:send {user=}")).toThrow();
	});

	it("throws when a required argument follows an optional argument", () => {
		expect(() => parseCommandSignature("mail:send {user?} {queue}")).toThrow();
	});

	it("throws when braces are unbalanced", () => {
		expect(() => parseCommandSignature("mail:send {user")).toThrow();
	});
});
