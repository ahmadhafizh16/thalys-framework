import { describe, expect, it, mock } from "bun:test";
import { DeleteUserAction } from "@containers/User/Actions/DeleteUserAction";
import { UpdateUserAction, type UpdateUserInput } from "@containers/User/Actions/UpdateUserAction";

interface MockRepo {
	withTransaction: ReturnType<typeof mock>;
	findById: ReturnType<typeof mock>;
	update: ReturnType<typeof mock>;
	delete: ReturnType<typeof mock>;
}

function createMockRepo(opts?: {
	existingUser?: { id: string; name: string; email: string } | null;
	updatedUser?: { id: string; name: string; email: string } | null;
}): MockRepo {
	const repo: MockRepo = {
		withTransaction: mock(() => repo),
		findById: mock(() => Promise.resolve(opts?.existingUser ?? null)),
		update: mock(() => Promise.resolve(opts?.updatedUser ?? null)),
		delete: mock(() => Promise.resolve(true)),
	};
	return repo;
}

function createMockDb() {
	return {
		transaction: mock(async (callback: (tx: unknown) => Promise<unknown>) => callback({})),
	};
}

describe("UpdateUserAction", () => {
	it("updates a user when the user exists", async () => {
		const repo = createMockRepo({
			existingUser: { id: "u1", name: "Old", email: "old@test.com" },
			updatedUser: { id: "u1", name: "New Name", email: "old@test.com" },
		});
		const mockDb = createMockDb();
		// biome-ignore lint/suspicious/noExplicitAny: test mock
		const action = new UpdateUserAction(mockDb as any, repo as any);

		const result = await action.execute({ id: "u1", name: "New Name" });

		expect(result.name).toBe("New Name");
		expect(repo.findById).toHaveBeenCalledWith("u1");
		expect(repo.update).toHaveBeenCalled();
	});

	it("throws NotFoundError when user does not exist", async () => {
		const repo = createMockRepo({ existingUser: null });
		const mockDb = createMockDb();
		// biome-ignore lint/suspicious/noExplicitAny: test mock
		const action = new UpdateUserAction(mockDb as any, repo as any);

		expect(async () => {
			await action.execute({ id: "nonexistent", name: "X" } satisfies UpdateUserInput);
		}).toThrow();
	});

	it("only passes defined fields to update", async () => {
		const repo = createMockRepo({
			existingUser: { id: "u1", name: "Old", email: "old@test.com" },
			updatedUser: { id: "u1", name: "Old", email: "old@test.com" },
		});
		const mockDb = createMockDb();
		// biome-ignore lint/suspicious/noExplicitAny: test mock
		const action = new UpdateUserAction(mockDb as any, repo as any);

		await action.execute({ id: "u1", phone: "+1234567890" });

		const updateCall = repo.update.mock.calls[0];
		expect(updateCall).toBeDefined();
		const updates = updateCall![1] as Record<string, unknown>;
		expect(updates.phone).toBe("+1234567890");
		expect(updates.name).toBeUndefined();
	});
});

describe("DeleteUserAction", () => {
	it("deletes a user when the user exists", async () => {
		const repo = createMockRepo({
			existingUser: { id: "u1", name: "A", email: "a@b.com" },
		});
		const mockDb = createMockDb();
		// biome-ignore lint/suspicious/noExplicitAny: test mock
		const action = new DeleteUserAction(mockDb as any, repo as any);

		await action.execute("u1");

		expect(repo.findById).toHaveBeenCalledWith("u1");
		expect(repo.delete).toHaveBeenCalled();
	});

	it("throws NotFoundError when user does not exist", async () => {
		const repo = createMockRepo({ existingUser: null });
		const mockDb = createMockDb();
		// biome-ignore lint/suspicious/noExplicitAny: test mock
		const action = new DeleteUserAction(mockDb as any, repo as any);

		expect(async () => {
			await action.execute("nonexistent");
		}).toThrow();
	});
});
