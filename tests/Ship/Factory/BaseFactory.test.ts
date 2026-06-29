import { beforeEach, describe, expect, it } from "bun:test";
import { BaseFactory } from "@ship/Factory/BaseFactory";
import type { FactoryCreateFn } from "@ship/Factory/BaseFactory";

interface TestEntity {
	name: string;
	email: string;
	age: number;
}

class TestFactory extends BaseFactory<TestEntity> {
	definition(): TestEntity {
		return {
			name: this.faker.person.fullName(),
			email: this.faker.internet.email(),
			age: this.faker.number.int({ min: 18, max: 80 }),
		};
	}
}

describe("BaseFactory", () => {
	let factory: TestFactory;

	beforeEach(() => {
		factory = new TestFactory();
	});

	describe("make", () => {
		it("returns an entity matching the definition shape", () => {
			const entity = factory.make();
			expect(typeof entity.name).toBe("string");
			expect(typeof entity.email).toBe("string");
			expect(typeof entity.age).toBe("number");
			expect(entity.name.length).toBeGreaterThan(0);
			expect(entity.email).toContain("@");
		});

		it("applies overrides on top of definition", () => {
			const entity = factory.make({ name: "Fixed Name", age: 25 });
			expect(entity.name).toBe("Fixed Name");
			expect(entity.age).toBe(25);
			expect(typeof entity.email).toBe("string");
		});

		it("generates different values on each call", () => {
			const a = factory.make();
			const b = factory.make();
			// With faker, different calls should produce different data
			// (extremely unlikely to collide)
			expect(a).not.toEqual(b);
		});
	});

	describe("makeMany", () => {
		it("returns the requested count", () => {
			const entities = factory.makeMany(5);
			expect(entities).toHaveLength(5);
		});

		it("applies overrides to all entities", () => {
			const entities = factory.makeMany(3, { email: "fixed@test.com" });
			for (const entity of entities) {
				expect(entity.email).toBe("fixed@test.com");
			}
		});

		it("returns empty array for count 0", () => {
			expect(factory.makeMany(0)).toHaveLength(0);
		});
	});

	describe("seed", () => {
		it("produces deterministic output with the same seed", () => {
			const a = new TestFactory().seed(42).make();
			const b = new TestFactory().seed(42).make();
			expect(a).toEqual(b);
		});

		it("produces different output with different seeds", () => {
			const a = new TestFactory().seed(1).make();
			const b = new TestFactory().seed(2).make();
			expect(a).not.toEqual(b);
		});
	});

	describe("create", () => {
		it("calls repo.create with the generated data", async () => {
			const created: TestEntity[] = [];
			const repo: FactoryCreateFn<TestEntity> = {
				async create(data) {
					created.push(data);
					return { ...data, id: "1" };
				},
			};

			const result = await factory.create(repo, { name: "Test" });
			expect(created).toHaveLength(1);
			expect(created[0]?.name).toBe("Test");
			expect(result).toEqual({ ...created[0]!, id: "1" });
		});
	});

	describe("createMany", () => {
		it("creates the requested count sequentially", async () => {
			const created: TestEntity[] = [];
			const repo: FactoryCreateFn<TestEntity> = {
				async create(data) {
					created.push(data);
					return data;
				},
			};

			await factory.createMany(4, repo);
			expect(created).toHaveLength(4);
		});
	});
});
